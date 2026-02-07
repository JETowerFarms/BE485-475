#include <napi.h>
#include <vector>
#include <cmath>
#include <algorithm>
#include <unordered_map>
#include <string>
#include <fstream>
#include <sstream>
#include <tuple>

// Clearing cost data structure (matches data grabber output)
struct RawClearingData {
    double lng, lat;
    double nlcd_value;
    double building_coverage;
    double road_coverage;
    double water_coverage;

    RawClearingData(double lng, double lat, double nlcd, double buildings, double roads, double water)
        : lng(lng), lat(lat), nlcd_value(nlcd), building_coverage(buildings),
          road_coverage(roads), water_coverage(water) {}
};

// Global state for batch processing
static size_t TOTAL_POINTS = 0;
static std::vector<RawClearingData> accumulatedData;

// Clearing cost result structure
struct ClearingCostResult {
    double lng, lat;
    double total_cost_per_acre;
    double site_prep_cost;
    double infrastructure_cost;
    double vegetation_cost;
    double confidence_level;

    ClearingCostResult() : lng(0), lat(0), total_cost_per_acre(0),
                          site_prep_cost(0), infrastructure_cost(0),
                          vegetation_cost(0), confidence_level(0) {}
};

// Clearing cost summary structure
struct ClearingCostSummary {
    size_t totalPoints;
    size_t validPoints;
    double averageCostPerAcre;
    double totalEstimatedCost;
    double minCostPerAcre;
    double maxCostPerAcre;
    size_t highCostAreas;    // > $5000/acre
    size_t mediumCostAreas;  // $2000-5000/acre
    size_t lowCostAreas;     // < $2000/acre

    ClearingCostSummary() : totalPoints(0), validPoints(0), averageCostPerAcre(0.0),
                           totalEstimatedCost(0.0), minCostPerAcre(0.0), maxCostPerAcre(0.0),
                           highCostAreas(0), mediumCostAreas(0), lowCostAreas(0) {}
};

// NOTE: Static pricing tables were removed. All pricing should come from live snapshots
// and be applied in the dynamic probabilistic model on the JS side.

// Probabilistic distribution calculation functions
double meanBeta(double alpha, double beta) {
    if (!std::isfinite(alpha) || !std::isfinite(beta) || alpha <= 0 || beta <= 0) return 0.0;
    return alpha / (alpha + beta);
}

double lognormalMuForMean(double mean, double sigma) {
    if (!std::isfinite(mean) || mean <= 0 || !std::isfinite(sigma) || sigma <= 0) return 0.0;
    return std::log(mean) - 0.5 * sigma * sigma;
}

double meanLogNormal(double mu, double sigma) {
    if (!std::isfinite(mu) || !std::isfinite(sigma) || sigma <= 0) return 0.0;
    return std::exp(mu + 0.5 * sigma * sigma);
}

double meanMixture(const std::vector<std::tuple<double, double>>& components) {
    if (components.empty()) return 0.0;
    double sumW = 0.0;
    double sum = 0.0;
    for (const auto& component : components) {
        double weight, mean;
        std::tie(weight, mean) = component;
        if (!std::isfinite(weight) || weight <= 0 || !std::isfinite(mean)) continue;
        sumW += weight;
        sum += weight * mean;
    }
    if (sumW <= 0) return 0.0;
    return sum / sumW;
}

// Probabilistic assumptions for clearing costs
struct ProbabilisticAssumptions {
    // Vegetation clearing assumptions
    struct VegetationAssumptions {
        double treeDensityMean;        // trees per acre
        double treeDensityDispersion;  // negative binomial dispersion
        double removalProbability;     // probability tree is removed
        double stumpProbability;       // probability stump is left given removal
    } vegetation;

    // Infrastructure assumptions
    struct InfrastructureAssumptions {
        struct BuildingAssumptions {
            double densityAlpha, densityBeta;  // Beta distribution for building density
            double sizeMean, sizeSigma;        // LogNormal for building size
            double demolitionMultiplier;       // Cost multiplier for demolition
        } buildings;

        struct RoadAssumptions {
            double densityAlpha, densityBeta;  // Beta distribution for road density
            double widthMean, widthSigma;      // LogNormal for road width
            double accessCostPerFt;            // Cost per linear foot
        } roads;
    } infrastructure;

    // Site preparation assumptions
    struct SitePrepAssumptions {
        double gradingIntensityAlpha, gradingIntensityBeta;  // Beta for grading intensity
        double cutDepthMean, cutDepthSigma;                  // LogNormal for cut depth
        double gradingCostPerCyd;                            // Cost per cubic yard
    } sitePrep;
};

// Default probabilistic assumptions (calibrated to match industry standards)
const ProbabilisticAssumptions CLEARING_ASSUMPTIONS = {
    // Vegetation
    {
        50.0,   // treeDensityMean (trees/acre)
        20.0,   // treeDensityDispersion
        1.0,    // removalProbability (assume all trees removed)
        1.0     // stumpProbability (assume all stumps removed)
    },
    // Infrastructure
    {
        // Buildings
        {
            1.0, 49.0,    // density: Beta(1,49) -> mean=0.02 buildings/acre
            2000.0, 0.8,  // size: LogNormal(mean=2000 sq ft, sigma=0.8)
            1.5           // demolition multiplier
        },
        // Roads
        {
            1.0, 999.0,   // density: Beta(1,999) -> mean=0.001 miles/acre
            20.0, 0.3,    // width: LogNormal(mean=20 ft, sigma=0.3)
            50.0          // access cost per linear foot
        }
    },
    // Site Prep
    {
        1.0, 9.0,        // grading intensity: Beta(1,9) -> mean=0.1 (10% needs grading)
        2.0, 0.5,        // cut depth: LogNormal(mean=2 ft, sigma=0.5)
        25.0             // grading cost per cubic yard
    }
};

// Calculate expected values from probabilistic assumptions
struct ExpectedValues {
    double expectedTreesPerAcre;
    double expectedBuildingsPerAcre;
    double expectedBuildingSizeSqFt;
    double expectedRoadDensity;
    double expectedRoadWidthFt;
    double expectedGradingIntensity;
    double expectedCutDepthFt;
};

ExpectedValues calculateExpectedValues() {
    ExpectedValues ev = {0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0};

    // Vegetation expected values
    ev.expectedTreesPerAcre = CLEARING_ASSUMPTIONS.vegetation.treeDensityMean *
                             CLEARING_ASSUMPTIONS.vegetation.removalProbability;

    // Building expected values
    ev.expectedBuildingsPerAcre = meanBeta(
        CLEARING_ASSUMPTIONS.infrastructure.buildings.densityAlpha,
        CLEARING_ASSUMPTIONS.infrastructure.buildings.densityBeta
    );

    double mu = lognormalMuForMean(
        CLEARING_ASSUMPTIONS.infrastructure.buildings.sizeMean,
        CLEARING_ASSUMPTIONS.infrastructure.buildings.sizeSigma
    );
    ev.expectedBuildingSizeSqFt = meanLogNormal(mu, CLEARING_ASSUMPTIONS.infrastructure.buildings.sizeSigma);

    // Road expected values
    ev.expectedRoadDensity = meanBeta(
        CLEARING_ASSUMPTIONS.infrastructure.roads.densityAlpha,
        CLEARING_ASSUMPTIONS.infrastructure.roads.densityBeta
    );

    mu = lognormalMuForMean(
        CLEARING_ASSUMPTIONS.infrastructure.roads.widthMean,
        CLEARING_ASSUMPTIONS.infrastructure.roads.widthSigma
    );
    ev.expectedRoadWidthFt = meanLogNormal(mu, CLEARING_ASSUMPTIONS.infrastructure.roads.widthSigma);

    // Site prep expected values
    ev.expectedGradingIntensity = meanBeta(
        CLEARING_ASSUMPTIONS.sitePrep.gradingIntensityAlpha,
        CLEARING_ASSUMPTIONS.sitePrep.gradingIntensityBeta
    );

    mu = lognormalMuForMean(
        CLEARING_ASSUMPTIONS.sitePrep.cutDepthMean,
        CLEARING_ASSUMPTIONS.sitePrep.cutDepthSigma
    );
    ev.expectedCutDepthFt = meanLogNormal(mu, CLEARING_ASSUMPTIONS.sitePrep.cutDepthSigma);

    return ev;
}

// NOTE: Pricing-based cost calculations are intentionally removed here.

// Calculate confidence level based on data completeness
double calculateConfidenceLevel(const RawClearingData& data) {
    // Throw if data is invalid
    if (std::isnan(data.nlcd_value) || data.nlcd_value <= 0) {
        return 0.0;
    }
    if (std::isnan(data.building_coverage)) {
        return 0.0;
    }
    if (std::isnan(data.road_coverage)) {
        return 0.0;
    }
    if (std::isnan(data.water_coverage)) {
        return 0.0;
    }

    return 1.0; // Full confidence if all data is valid
}

// Calculate clearing cost for a single point using probabilistic model
ClearingCostResult calculateClearingCostForPoint(const RawClearingData& data) {
    ClearingCostResult result;
    result.lng = data.lng;
    result.lat = data.lat;

    // Calculate expected values from probabilistic assumptions (computed once per analysis)
    static ExpectedValues expectedValues = calculateExpectedValues();

    // Native parser no longer assigns pricing. JS dynamic model applies live pricing snapshots.
    result.vegetation_cost = 0.0;
    result.infrastructure_cost = 0.0;
    result.site_prep_cost = 0.0;

    // Calculate total cost per acre
    result.total_cost_per_acre = 0.0;

    // Calculate confidence level
    result.confidence_level = calculateConfidenceLevel(data);

    return result;
}

// Calculate summary statistics from results
ClearingCostSummary calculateClearingCostSummary(const std::vector<ClearingCostResult>& results) {
    ClearingCostSummary summary;
    summary.totalPoints = results.size();

    std::vector<double> validCosts;
    for (const auto& result : results) {
        if (!std::isfinite(result.total_cost_per_acre) || result.total_cost_per_acre < 0) {
            throw std::invalid_argument("Invalid cost value: " + std::to_string(result.total_cost_per_acre));
        }
        validCosts.push_back(result.total_cost_per_acre);

        // Categorize cost levels
        if (result.total_cost_per_acre > 5000) {
            summary.highCostAreas++;
        } else if (result.total_cost_per_acre > 2000) {
            summary.mediumCostAreas++;
        } else {
            summary.lowCostAreas++;
        }
    }

    summary.validPoints = validCosts.size();

    if (!validCosts.empty()) {
        // Calculate statistics
        double sum = 0.0;
        summary.minCostPerAcre = *std::min_element(validCosts.begin(), validCosts.end());
        summary.maxCostPerAcre = *std::max_element(validCosts.begin(), validCosts.end());

        for (double cost : validCosts) {
            sum += cost;
        }
        summary.averageCostPerAcre = sum / validCosts.size();

        // Estimate total cost (assuming 1 acre per point for simplicity)
        summary.totalEstimatedCost = sum;
    }

    return summary;
}

// NAPI function to set total points for batch processing
Napi::Value setTotalPoints(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Expected a number for total points").ThrowAsJavaScriptException();
        return env.Null();
    }

    TOTAL_POINTS = info[0].As<Napi::Number>().Uint32Value();
    accumulatedData.clear(); // Reset accumulated data

    return Napi::Boolean::New(env, true);
}

// NAPI function to process clearing cost data for a batch of points
Napi::Value processClearingCostData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "Expected an array of clearing cost data").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Array dataArray = info[0].As<Napi::Array>();

    // Process each data point
    for (size_t i = 0; i < dataArray.Length(); i++) {
        Napi::Value item = dataArray[i];

        if (!item.IsObject()) {
            Napi::TypeError::New(env, "All data points must be objects").ThrowAsJavaScriptException();
            return env.Null();
        }

        Napi::Object dataObj = item.As<Napi::Object>();

        // Validate required properties exist
        if (!dataObj.Has("lng") || !dataObj.Has("lat") || !dataObj.Has("nlcd_value") ||
            !dataObj.Has("building_coverage") || !dataObj.Has("road_coverage") || !dataObj.Has("water_coverage")) {
            Napi::TypeError::New(env, "Data point missing required properties").ThrowAsJavaScriptException();
            return env.Null();
        }

        double lng = dataObj.Get("lng").As<Napi::Number>().DoubleValue();
        double lat = dataObj.Get("lat").As<Napi::Number>().DoubleValue();
        double nlcd = dataObj.Get("nlcd_value").As<Napi::Number>().DoubleValue();
        double buildings = dataObj.Get("building_coverage").As<Napi::Number>().DoubleValue();
        double roads = dataObj.Get("road_coverage").As<Napi::Number>().DoubleValue();
        double water = dataObj.Get("water_coverage").As<Napi::Number>().DoubleValue();

        RawClearingData data(lng, lat, nlcd, buildings, roads, water);
        accumulatedData.push_back(data);
    }

    return Napi::Boolean::New(env, true);
}

// NAPI function to get clearing cost results and summary
Napi::Value getClearingCostResults(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // Calculate results for all accumulated data
    std::vector<ClearingCostResult> results;
    for (const auto& data : accumulatedData) {
        ClearingCostResult result = calculateClearingCostForPoint(data);
        results.push_back(result);
    }

    // Calculate summary statistics
    ClearingCostSummary summary = calculateClearingCostSummary(results);

    // Create results array
    Napi::Array resultsArray = Napi::Array::New(env, results.size());
    for (size_t i = 0; i < results.size(); i++) {
        Napi::Object resultObj = Napi::Object::New(env);

        resultObj.Set("lng", Napi::Number::New(env, results[i].lng));
        resultObj.Set("lat", Napi::Number::New(env, results[i].lat));
        resultObj.Set("total_cost_per_acre", Napi::Number::New(env, results[i].total_cost_per_acre));
        resultObj.Set("site_prep_cost", Napi::Number::New(env, results[i].site_prep_cost));
        resultObj.Set("infrastructure_cost", Napi::Number::New(env, results[i].infrastructure_cost));
        resultObj.Set("vegetation_cost", Napi::Number::New(env, results[i].vegetation_cost));
        resultObj.Set("confidence_level", Napi::Number::New(env, results[i].confidence_level));

        resultsArray.Set(i, resultObj);
    }

    // Create summary object
    Napi::Object summaryObj = Napi::Object::New(env);
    summaryObj.Set("totalPoints", Napi::Number::New(env, summary.totalPoints));
    summaryObj.Set("validPoints", Napi::Number::New(env, summary.validPoints));
    summaryObj.Set("averageCostPerAcre", Napi::Number::New(env, summary.averageCostPerAcre));
    summaryObj.Set("totalEstimatedCost", Napi::Number::New(env, summary.totalEstimatedCost));
    summaryObj.Set("minCostPerAcre", Napi::Number::New(env, summary.minCostPerAcre));
    summaryObj.Set("maxCostPerAcre", Napi::Number::New(env, summary.maxCostPerAcre));
    summaryObj.Set("highCostAreas", Napi::Number::New(env, summary.highCostAreas));
    summaryObj.Set("mediumCostAreas", Napi::Number::New(env, summary.mediumCostAreas));
    summaryObj.Set("lowCostAreas", Napi::Number::New(env, summary.lowCostAreas));

    // Create response object
    Napi::Object response = Napi::Object::New(env);
    response.Set("results", resultsArray);
    response.Set("summary", summaryObj);

    // Clear accumulated data after processing
    accumulatedData.clear();

    return response;
}

// NAPI function to get clearing cost for a single point (for testing)
Napi::Value calculateSinglePointCost(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Expected an object with clearing cost data").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Object dataObj = info[0].As<Napi::Object>();

    // Validate required properties exist
    if (!dataObj.Has("lng") || !dataObj.Has("lat") || !dataObj.Has("nlcd_value") ||
        !dataObj.Has("building_coverage") || !dataObj.Has("road_coverage") || !dataObj.Has("water_coverage")) {
        Napi::TypeError::New(env, "Data object missing required properties").ThrowAsJavaScriptException();
        return env.Null();
    }

    double lng = dataObj.Get("lng").As<Napi::Number>().DoubleValue();
    double lat = dataObj.Get("lat").As<Napi::Number>().DoubleValue();
    double nlcd = dataObj.Get("nlcd_value").As<Napi::Number>().DoubleValue();
    double buildings = dataObj.Get("building_coverage").As<Napi::Number>().DoubleValue();
    double roads = dataObj.Get("road_coverage").As<Napi::Number>().DoubleValue();
    double water = dataObj.Get("water_coverage").As<Napi::Number>().DoubleValue();

    RawClearingData data(lng, lat, nlcd, buildings, roads, water);
    ClearingCostResult result = calculateClearingCostForPoint(data);

    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("lng", Napi::Number::New(env, result.lng));
    resultObj.Set("lat", Napi::Number::New(env, result.lat));
    resultObj.Set("total_cost_per_acre", Napi::Number::New(env, result.total_cost_per_acre));
    resultObj.Set("site_prep_cost", Napi::Number::New(env, result.site_prep_cost));
    resultObj.Set("infrastructure_cost", Napi::Number::New(env, result.infrastructure_cost));
    resultObj.Set("vegetation_cost", Napi::Number::New(env, result.vegetation_cost));
    resultObj.Set("confidence_level", Napi::Number::New(env, result.confidence_level));

    return resultObj;
}

// Get probabilistic expected values (for testing/debugging)
Napi::Value getExpectedValues(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    ExpectedValues ev = calculateExpectedValues();

    Napi::Object resultObj = Napi::Object::New(env);
    resultObj.Set("expectedTreesPerAcre", Napi::Number::New(env, ev.expectedTreesPerAcre));
    resultObj.Set("expectedBuildingsPerAcre", Napi::Number::New(env, ev.expectedBuildingsPerAcre));
    resultObj.Set("expectedBuildingSizeSqFt", Napi::Number::New(env, ev.expectedBuildingSizeSqFt));
    resultObj.Set("expectedRoadDensity", Napi::Number::New(env, ev.expectedRoadDensity));
    resultObj.Set("expectedRoadWidthFt", Napi::Number::New(env, ev.expectedRoadWidthFt));
    resultObj.Set("expectedGradingIntensity", Napi::Number::New(env, ev.expectedGradingIntensity));
    resultObj.Set("expectedCutDepthFt", Napi::Number::New(env, ev.expectedCutDepthFt));

    return resultObj;
}

// Module initialization
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "setTotalPoints"), Napi::Function::New(env, setTotalPoints));
    exports.Set(Napi::String::New(env, "processClearingCostData"), Napi::Function::New(env, processClearingCostData));
    exports.Set(Napi::String::New(env, "getClearingCostResults"), Napi::Function::New(env, getClearingCostResults));
    exports.Set(Napi::String::New(env, "calculateSinglePointCost"), Napi::Function::New(env, calculateSinglePointCost));
    exports.Set(Napi::String::New(env, "getExpectedValues"), Napi::Function::New(env, getExpectedValues));

    return exports;
}

NODE_API_MODULE(clearingCostParser, Init)