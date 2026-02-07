#include <napi.h>
#include <vector>
#include <cmath>
#include <algorithm>
#include <unordered_map>
#include <string>
#include <fstream>
#include <sstream>

// Solar suitability data structure (matches solarDataGrabber output)
struct RawSolarData {
    double lng, lat;
    double nlcd_value;
    double slope_elevation;
    double population_density;
    double sub_distance;
    double infra_or_water;
    double water_present;
    double road_present;

    RawSolarData(double lng, double lat, double nlcd, double slope, double pop, double sub_dist, double infra_or_water, double water_present, double road_present)
            : lng(lng), lat(lat), nlcd_value(nlcd), slope_elevation(slope),
                population_density(pop), sub_distance(sub_dist), infra_or_water(infra_or_water),
                water_present(water_present), road_present(road_present) {}
};

// Solar suitability result structure
struct SolarSuitabilityResult {
        double lng, lat;
        double overall_score;
        double land_cover_score;
        double slope_score;
        double transmission_score;
        double population_score;
        double nlcd_value;
        double slope_value;
        double population_density;
        double sub_distance;
        double infra_or_water;
        double water_present;
        double road_present;
        std::string heatmap_color;

        SolarSuitabilityResult(double lng, double lat,
                                                     double overall,
                                                     double land_cover,
                                                     double slope,
                                                     double transmission,
                                                     double population,
                                                     double nlcd_value,
                                                     double slope_value,
                                                     double population_density,
                                                     double sub_distance,
                                                     double infra_or_water,
                                                     double water_present,
                                                     double road_present,
                                                     const std::string& color)
                        : lng(lng), lat(lat), overall_score(overall), land_cover_score(land_cover),
                            slope_score(slope), transmission_score(transmission), population_score(population),
                            nlcd_value(nlcd_value), slope_value(slope_value), population_density(population_density),
                            sub_distance(sub_distance), infra_or_water(infra_or_water), water_present(water_present),
                            road_present(road_present), heatmap_color(color) {}
};

// Global state for batch processing
static size_t TOTAL_POINTS = 0;
static std::vector<RawSolarData> accumulatedData;

// Solar suitability summary structure
struct SolarSuitabilitySummary {
    size_t totalPoints;
    size_t validPoints;
    double averageSuitability;
    size_t excellent; // > 0.8
    size_t good;      // 0.6 - 0.8
    size_t moderate;  // 0.4 - 0.6
    size_t poor;      // 0.2 - 0.4
    size_t unsuitable; // < 0.2

    SolarSuitabilitySummary() : totalPoints(0), validPoints(0), averageSuitability(0.0),
                               excellent(0), good(0), moderate(0), poor(0), unsuitable(0) {}
};

std::unordered_map<std::string, double> calculateComponentScores(const RawSolarData& data);

// Calculate summary statistics from results
SolarSuitabilitySummary calculateSummaryStatistics(const std::vector<SolarSuitabilityResult>& results) {
    SolarSuitabilitySummary summary;
    summary.totalPoints = results.size();

    std::vector<double> validScores;
    for (const auto& result : results) {
        if (!std::isfinite(result.overall_score)) {
            continue;
        }
        validScores.push_back(result.overall_score);
    }

    summary.validPoints = validScores.size();

    if (validScores.empty()) {
        return summary;
    }

    // Calculate average
    double sum = 0.0;
    for (double score : validScores) {
        sum += score;
    }
    summary.averageSuitability = sum / validScores.size();

    // Calculate distribution
    for (double score : validScores) {
        if (score > 0.8) summary.excellent++;
        else if (score > 0.6) summary.good++;
        else if (score > 0.4) summary.moderate++;
        else if (score > 0.2) summary.poor++;
        else summary.unsuitable++;
    }

    return summary;
}

// Convert HSV to RGB (0-360, 0-1, 0-1)
static void hsvToRgb(double h, double s, double v, int &r, int &g, int &b) {
    double c = v * s;
    double x = c * (1 - std::fabs(std::fmod(h / 60.0, 2) - 1));
    double m = v - c;

    double r1 = 0, g1 = 0, b1 = 0;
    if (h < 60) {
        r1 = c; g1 = x; b1 = 0;
    } else if (h < 120) {
        r1 = x; g1 = c; b1 = 0;
    } else if (h < 180) {
        r1 = 0; g1 = c; b1 = x;
    } else if (h < 240) {
        r1 = 0; g1 = x; b1 = c;
    } else if (h < 300) {
        r1 = x; g1 = 0; b1 = c;
    } else {
        r1 = c; g1 = 0; b1 = x;
    }

    r = static_cast<int>(std::round((r1 + m) * 255));
    g = static_cast<int>(std::round((g1 + m) * 255));
    b = static_cast<int>(std::round((b1 + m) * 255));
}

// Calculate heatmap color based on overall score (0-1)
// Full visible spectrum gradient, sensitive to 0.01
std::string calculateHeatmapColor(double score) {
    // Clamp score to [0, 1]
    score = std::max(0.0, std::min(1.0, score));
    score = std::round(score * 100.0) / 100.0; // 0.01 sensitivity

    // Map 0..1 to hue 0..300 (red->violet) for visible spectrum feel
    double hue = 300.0 * score;
    int r = 0, g = 0, b = 0;
    hsvToRgb(hue, 1.0, 1.0, r, g, b);

    char hex[8];
    std::snprintf(hex, sizeof(hex), "#%02X%02X%02X", r, g, b);
    return std::string(hex);
}

// Parse raw solar data and calculate suitability scores
std::vector<SolarSuitabilityResult> parseSolarSuitabilityData(const std::vector<RawSolarData>& rawData) {
    std::vector<SolarSuitabilityResult> results;

    for (const auto& data : rawData) {
        auto scores = calculateComponentScores(data);
        std::string color = calculateHeatmapColor(scores["overall"]);
        results.emplace_back(data.lng, data.lat,
                           scores["overall"],
                           scores["land_cover"],
                           scores["slope"],
                           scores["transmission"],
                           scores["population"],
                           data.nlcd_value,
                           data.slope_elevation,
                           data.population_density,
                           data.sub_distance,
                           data.infra_or_water,
                           data.water_present,
                           data.road_present,
                           color);
    }

    return results;
}
std::unordered_map<std::string, double> calculateComponentScores(const RawSolarData& data) {
    std::unordered_map<std::string, double> scores;

    if (data.infra_or_water > 0.0) {
        scores["land_cover"] = 0.0;
        scores["slope"] = 0.0;
        scores["transmission"] = 0.0;
        scores["population"] = 0.0;
        scores["overall"] = 0.0;
        return scores;
    }

    // Land cover score (0-100, higher is better) - REA solar model (MRLC NLCD 2021 classes)
    if (data.nlcd_value == 0) {
        scores["land_cover"] = 0.0; // Unclassified
    } else if (data.nlcd_value == 11) {
        scores["land_cover"] = 0.0; // Open Water
    } else if (data.nlcd_value == 12) {
        scores["land_cover"] = 0.0; // Perennial Snow/Ice
    } else if (data.nlcd_value >= 21 && data.nlcd_value <= 24) {
        scores["land_cover"] = 0.0; // Developed areas
    } else if (data.nlcd_value == 31) {
        scores["land_cover"] = 50.0; // Barren Land
    } else if (data.nlcd_value == 41 || data.nlcd_value == 42 || data.nlcd_value == 43) {
        scores["land_cover"] = 0.0; // Forests
    } else if (data.nlcd_value == 52) {
        scores["land_cover"] = 90.0; // Shrub/Scrub
    } else if (data.nlcd_value == 71) {
        scores["land_cover"] = 90.0; // Herbaceous
    } else if (data.nlcd_value == 81) {
        scores["land_cover"] = 100.0; // Hay/Pasture
    } else if (data.nlcd_value == 82) {
        scores["land_cover"] = 100.0; // Cultivated Crops
    } else if (data.nlcd_value == 90) {
        scores["land_cover"] = 0.0; // Woody Wetlands
    } else {
        scores["land_cover"] = 0.0; // Other/unknown
    }

    // Slope score (0-100, higher is better - flat is better for solar)
    // Slope raster already provides percent (manual checks show values like 1-2)
    double slope_percent = data.slope_elevation;
    if (slope_percent <= 1.0) {
        scores["slope"] = 100.0; // 0-1%
    } else if (slope_percent <= 3.0) {
        scores["slope"] = 90.0; // 2-3%
    } else if (slope_percent <= 4.0) {
        scores["slope"] = 30.0; // 4%
    } else if (slope_percent <= 5.0) {
        scores["slope"] = 10.0; // 5%
    } else if (slope_percent <= 10.0) {
        scores["slope"] = 1.0; // 6-10%
    } else {
        scores["slope"] = 0.0; // ≥11%
    }

    // Transmission score (0-100, higher is better - closer to substations is better)
    // Convert distance from degrees to miles (rough approximation: 1 degree ≈ 69 miles)
    double distance_miles = data.sub_distance * 69;
    if (distance_miles <= 1.0) {
        scores["transmission"] = 100.0; // 0-1 miles
    } else if (distance_miles <= 5.0) {
        scores["transmission"] = 90.0; // 1-5 miles
    } else if (distance_miles <= 10.0) {
        scores["transmission"] = 75.0; // 5-10 miles
    } else {
        scores["transmission"] = 50.0; // Over 10 miles
    }

    // Population score (0-100, higher is better - moderate density is optimal)
    if (data.population_density <= 150) {
        scores["population"] = 75.0; // 101-150 (assuming 0-100 is 75)
    } else if (data.population_density <= 200) {
        scores["population"] = 50.0; // 151-200
    } else if (data.population_density <= 300) {
        scores["population"] = 25.0; // 201-300
    } else {
        scores["population"] = 0.0; // 301 and higher, or No Data
    }

    // Overall score (weighted combination using documented weights)
    // Weights: Slope=2, Land Cover=4, Population=1, Transmission=3
    double total_weight = 2.0 + 4.0 + 1.0 + 3.0; // = 10
    scores["overall"] = (scores["slope"] * 2.0 +
                        scores["land_cover"] * 4.0 +
                        scores["population"] * 1.0 +
                        scores["transmission"] * 3.0) / (100.0 * total_weight);

    // Convert all scores to [0, 1] range
    for (auto& pair : scores) {
        if (pair.first != "overall") {
            pair.second = pair.second / 100.0; // Convert 0-100 to 0-1
        }
        pair.second = std::max(0.0, std::min(1.0, pair.second));
    }

    return scores;
}

// Set total points for batch processing
Napi::Value SetTotalPoints(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Total points must be a number").ThrowAsJavaScriptException();
        return env.Null();
    }

    TOTAL_POINTS = info[0].As<Napi::Number>().Uint32Value();
    return env.Null();
}

// Add batch data to accumulated data
Napi::Value AddBatchData(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "Raw solar data array is required").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Array rawDataArray = info[0].As<Napi::Array>();
    size_t numPoints = rawDataArray.Length();

    for (size_t i = 0; i < numPoints; i++) {
        Napi::Value element = rawDataArray[i];
        if (!element.IsObject()) {
            Napi::TypeError::New(env, "Each data point must be an object").ThrowAsJavaScriptException();
            return env.Null();
        }

        Napi::Object dataObj = element.As<Napi::Object>();

        auto getNumber = [&](const char* key, double fallback) -> double {
            if (!dataObj.Has(key)) return fallback;
            Napi::Value value = dataObj.Get(key);
            if (!value.IsNumber()) return fallback;
            return value.As<Napi::Number>().DoubleValue();
        };

        double lng = getNumber("lng", 0.0);
        double lat = getNumber("lat", 0.0);
        double nlcd_value = getNumber("nlcd_value", 0.0);
        double slope_elevation = getNumber("slope_elevation", 0.0);
        double population_density = getNumber("population_density", 0.0);
        double sub_distance = getNumber("sub_distance", 0.0);
        double infra_or_water = getNumber("infra_or_water", 0.0);
        double water_present = getNumber("water_present", 0.0);
        double road_present = getNumber("road_present", 0.0);

        accumulatedData.emplace_back(lng, lat, nlcd_value, slope_elevation, population_density, sub_distance, infra_or_water, water_present, road_present);
    }

    return env.Null();
}

// Get results from accumulated data
Napi::Value GetResults(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    auto results = parseSolarSuitabilityData(accumulatedData);

    // Calculate summary statistics
    auto summary = calculateSummaryStatistics(results);

    // Create main result object
    Napi::Object resultObj = Napi::Object::New(env);

    // Convert individual results to JavaScript array
    Napi::Array jsResults = Napi::Array::New(env, results.size());
    for (size_t i = 0; i < results.size(); i++) {
        const SolarSuitabilityResult& result = results[i];

        Napi::Object pointObj = Napi::Object::New(env);

        // Coordinates
        Napi::Array coords = Napi::Array::New(env, 2);
        coords[0u] = Napi::Number::New(env, result.lng);
        coords[1u] = Napi::Number::New(env, result.lat);
        pointObj.Set("coordinates", coords);

        // Scores
        pointObj.Set("overall", Napi::Number::New(env, result.overall_score));
        pointObj.Set("land_cover", Napi::Number::New(env, result.land_cover_score));
        pointObj.Set("slope", Napi::Number::New(env, result.slope_score));
        pointObj.Set("transmission", Napi::Number::New(env, result.transmission_score));
        pointObj.Set("population", Napi::Number::New(env, result.population_score));

        // Raw inputs
        pointObj.Set("nlcd_value", Napi::Number::New(env, result.nlcd_value));
        pointObj.Set("slope_value", Napi::Number::New(env, result.slope_value));
        pointObj.Set("population_density", Napi::Number::New(env, result.population_density));
        pointObj.Set("sub_distance", Napi::Number::New(env, result.sub_distance));
        pointObj.Set("infra_or_water", Napi::Number::New(env, result.infra_or_water));
        pointObj.Set("water_present", Napi::Number::New(env, result.water_present));
        pointObj.Set("road_present", Napi::Number::New(env, result.road_present));

        // Heatmap color
        pointObj.Set("heatmap_color", Napi::String::New(env, result.heatmap_color));

        jsResults[i] = pointObj;
    }

    // Add results array
    resultObj.Set("results", jsResults);

    // Add summary statistics
    Napi::Object jsSummary = Napi::Object::New(env);
    jsSummary.Set("totalPoints", Napi::Number::New(env, summary.totalPoints));
    jsSummary.Set("validPoints", Napi::Number::New(env, summary.validPoints));
    jsSummary.Set("averageSuitability", Napi::Number::New(env, std::round(summary.averageSuitability * 100.0) / 100.0));

    Napi::Object distribution = Napi::Object::New(env);
    distribution.Set("excellent", Napi::Number::New(env, summary.excellent));
    distribution.Set("good", Napi::Number::New(env, summary.good));
    distribution.Set("moderate", Napi::Number::New(env, summary.moderate));
    distribution.Set("poor", Napi::Number::New(env, summary.poor));
    distribution.Set("unsuitable", Napi::Number::New(env, summary.unsuitable));
    jsSummary.Set("suitabilityDistribution", distribution);

    resultObj.Set("summary", jsSummary);

    accumulatedData.clear();
    return resultObj;
}

// Parse solar suitability data from raw database results
Napi::Value ParseSolarSuitability(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "Raw solar data array is required").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Array rawDataArray = info[0].As<Napi::Array>();
    size_t numPoints = rawDataArray.Length();

    std::vector<RawSolarData> rawData;
    for (size_t i = 0; i < numPoints; i++) {
        Napi::Value element = rawDataArray[i];
        if (!element.IsObject()) {
            Napi::TypeError::New(env, "Each data point must be an object").ThrowAsJavaScriptException();
            return env.Null();
        }

        Napi::Object dataObj = element.As<Napi::Object>();

        // Extract required fields from the raw data object
        double lng = dataObj.Get("lng").As<Napi::Number>().DoubleValue();
        double lat = dataObj.Get("lat").As<Napi::Number>().DoubleValue();
        double nlcd_value = dataObj.Get("nlcd_value").As<Napi::Number>().DoubleValue();
        double slope_elevation = dataObj.Get("slope_elevation").As<Napi::Number>().DoubleValue();
        double population_density = dataObj.Get("population_density").As<Napi::Number>().DoubleValue();
        double sub_distance = dataObj.Get("sub_distance").As<Napi::Number>().DoubleValue();
        double infra_or_water = 0.0;
        double water_present = 0.0;
        double road_present = 0.0;
        if (dataObj.Has("infra_or_water")) {
            infra_or_water = dataObj.Get("infra_or_water").As<Napi::Number>().DoubleValue();
        }
        if (dataObj.Has("water_present")) {
            water_present = dataObj.Get("water_present").As<Napi::Number>().DoubleValue();
        }
        if (dataObj.Has("road_present")) {
            road_present = dataObj.Get("road_present").As<Napi::Number>().DoubleValue();
        }

        rawData.emplace_back(lng, lat, nlcd_value, slope_elevation, population_density, sub_distance, infra_or_water, water_present, road_present);
    }

    // Parse the raw data and calculate suitability scores
    auto results = parseSolarSuitabilityData(rawData);

    // Convert results to JavaScript array
    Napi::Array jsResults = Napi::Array::New(env, results.size());
    for (size_t i = 0; i < results.size(); i++) {
        const SolarSuitabilityResult& result = results[i];

        Napi::Object resultObj = Napi::Object::New(env);

        // Coordinates
        Napi::Array coords = Napi::Array::New(env, 2);
        coords[0u] = Napi::Number::New(env, result.lng);
        coords[1u] = Napi::Number::New(env, result.lat);
        resultObj.Set("coordinates", coords);

        // Scores
        resultObj.Set("overall", Napi::Number::New(env, result.overall_score));
        resultObj.Set("land_cover", Napi::Number::New(env, result.land_cover_score));
        resultObj.Set("slope", Napi::Number::New(env, result.slope_score));
        resultObj.Set("transmission", Napi::Number::New(env, result.transmission_score));
        resultObj.Set("population", Napi::Number::New(env, result.population_score));

        // Raw inputs
        resultObj.Set("nlcd_value", Napi::Number::New(env, result.nlcd_value));
        resultObj.Set("slope_value", Napi::Number::New(env, result.slope_value));
        resultObj.Set("population_density", Napi::Number::New(env, result.population_density));
        resultObj.Set("sub_distance", Napi::Number::New(env, result.sub_distance));
        resultObj.Set("infra_or_water", Napi::Number::New(env, result.infra_or_water));
        resultObj.Set("water_present", Napi::Number::New(env, result.water_present));
        resultObj.Set("road_present", Napi::Number::New(env, result.road_present));

        // Heatmap color
        resultObj.Set("heatmap_color", Napi::String::New(env, result.heatmap_color));

        jsResults[i] = resultObj;
    }

    return jsResults;
}

// Initialize module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "parseSolarSuitability"), Napi::Function::New(env, ParseSolarSuitability));
    exports.Set(Napi::String::New(env, "setTotalPoints"), Napi::Function::New(env, SetTotalPoints));
    exports.Set(Napi::String::New(env, "addBatchData"), Napi::Function::New(env, AddBatchData));
    exports.Set(Napi::String::New(env, "getResults"), Napi::Function::New(env, GetResults));

    return exports;
}

NODE_API_MODULE(solarSuitabilityParser, Init)

/*
Model Parameters (Modified upon GEM models): Utility Scale PV (Solar)

Parameters

Weight

Slope

2

Land Cover

4

Population Density

1

Distance to substation

3

Data Sources and Model Weighting:

Slope (Land Fire slope)
SUITABILITY

RANGE/CLASS

100

0 - 1%

90

2%

90

3%

30

4%

10

5%

1

6 - 10%

0

≥ 11%

Land Cover (Multi-Resolution Land Characteristics (MRLC) Consortium – CONUS 2021)
GEM - Solar

REA - solar

SUITABILITY

RANGE/CLASS

SUITABILITY

RANGE/CLASS

100

Unclassified (0)

0

Unclassified (0)

1

Open Water (11)

0

Open Water (11)

10

Perennial Snow/Ice (12)

0

Perennial Snow/Ice (12)

75

Developed, Open Space (21)

0

Developed, Open Space (21)

75

Developed, Low Intensity (22)

0

Developed, Low Intensity (22)

75

Developed, Medium Intensity (23)

0

Developed, Medium Intensity (23)

75

Developed, High Intensity (24)

0

Developed, High Intensity (24)

100

Barren Land (31)

50

Barren Land (31)

50

Deciduous Forest (41)

0

Deciduous Forest (41)

50

Evergreen Forest (42)

0

Evergreen Forest (42)

50

Mixed Forest

0

Mixed Forest

90

Shrub/Scrub (52)

90

Herbaceous (71)

90

Hay/Pasture (81)

100

Hay/Pasture (81)

90

Cultivated Crops (82)

100

Cultivated Crops (82)

40

Woody Wetlands (90)

0

Woody Wetlands (90)

Distance to Substation (220 to 345kV) (ArcGIS Substations)
SUITABILITY

RANGE/CLASS

100

0 - 1 miles

90

1 - 5 miles

75

5 - 10 miles

50

Over 10 miles

Population Density (GPW v4 Population Density)
SUITABILITY

RANGE/CLASS

75

101 - 150

50

151 - 200

25

201 - 300

0

301 and higher

0

No Data
*/