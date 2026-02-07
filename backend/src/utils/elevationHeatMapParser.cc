#include <napi.h>
#include <vector>
#include <cmath>
#include <algorithm>
#include <string>

// Elevation data structure (matches elevationDataGrabber output)
struct RawElevationData {
    double lng, lat;
    double elevation;

    RawElevationData(double lng, double lat, double elevation)
        : lng(lng), lat(lat), elevation(elevation) {}
};

// Global state for batch processing
static size_t TOTAL_POINTS = 0;
static std::vector<RawElevationData> accumulatedData;

// Elevation heatmap result structure
struct ElevationHeatMapResult {
    double lng, lat;
    double elevation;
    double overall_score;
    double elevation_score;
    std::string heatmap_color;

    ElevationHeatMapResult(double lng, double lat, double elevation, double overall, double elev_score, std::string color)
        : lng(lng), lat(lat), elevation(elevation), overall_score(overall), elevation_score(elev_score), heatmap_color(color) {}
};

// Elevation heatmap summary structure
struct ElevationHeatMapSummary {
    size_t totalPoints;
    size_t validPoints;
    double averageElevation;
    size_t optimal;    // > 0.8 (100-500m)
    size_t good;       // 0.6 - 0.8
    size_t moderate;   // 0.4 - 0.6
    size_t poor;       // 0.2 - 0.4
    size_t unsuitable; // < 0.2

    ElevationHeatMapSummary() : totalPoints(0), validPoints(0), averageElevation(0.0),
                               optimal(0), good(0), moderate(0), poor(0), unsuitable(0) {}
};

// Calculate summary statistics from results
ElevationHeatMapSummary calculateSummaryStatistics(const std::vector<ElevationHeatMapResult>& results) {
    ElevationHeatMapSummary summary;
    summary.totalPoints = results.size();

    std::vector<double> validScores;
    std::vector<double> validElevations;
    for (const auto& result : results) {
        if (!std::isfinite(result.overall_score)) {
            continue;
        }
        validScores.push_back(result.overall_score);
        validElevations.push_back(result.elevation);
    }

    summary.validPoints = validScores.size();

    if (validScores.empty()) {
        return summary;
    }

    // Calculate average elevation
    double elevationSum = 0.0;
    for (double elev : validElevations) {
        elevationSum += elev;
    }
    summary.averageElevation = elevationSum / validElevations.size();

    // Calculate distribution
    for (double score : validScores) {
        if (score > 0.8) summary.optimal++;
        else if (score > 0.6) summary.good++;
        else if (score > 0.4) summary.moderate++;
        else if (score > 0.2) summary.poor++;
        else summary.unsuitable++;
    }

    return summary;
}

// Calculate elevation score (0-1, higher is better)
// Optimal elevations: 100-500m (score 1.0), decreasing outside this range
double calculateElevationScore(double elevation) {
    // Convert elevation to meters if needed (assuming it's already in meters)
    // Optimal range: 100-500 meters
    if (elevation >= 100.0 && elevation <= 500.0) {
        return 1.0; // Optimal
    } else if (elevation >= 50.0 && elevation < 100.0) {
        // Linear decrease from 50-100m
        return 0.5 + (elevation - 50.0) / 100.0;
    } else if (elevation > 500.0 && elevation <= 1000.0) {
        // Linear decrease from 500-1000m
        return 1.0 - (elevation - 500.0) / 500.0;
    } else if (elevation > 1000.0) {
        return 0.0; // Too high
    } else {
        return 0.0; // Too low or invalid
    }
}

// Calculate heatmap color based on elevation score (0-1)
// Blue = optimal elevation, Red = poor elevation
std::string calculateHeatmapColor(double score) {
    // Clamp score to [0, 1]
    score = std::max(0.0, std::min(1.0, score));

    // Heatmap: red (poor) -> orange -> yellow -> green -> blue (optimal)
    if (score < 0.2) {
        return "#FF0000"; // Red (poor)
    } else if (score < 0.4) {
        return "#FFA500"; // Orange
    } else if (score < 0.6) {
        return "#FFFF00"; // Yellow
    } else if (score < 0.8) {
        return "#008000"; // Green
    } else {
        return "#0000FF"; // Blue (optimal)
    }
}

// Parse raw elevation data and calculate heatmap scores
std::vector<ElevationHeatMapResult> parseElevationHeatMapData(const std::vector<RawElevationData>& rawData) {
    std::vector<ElevationHeatMapResult> results;

    for (const auto& data : rawData) {
        double elevation_score = calculateElevationScore(data.elevation);
        std::string color = calculateHeatmapColor(elevation_score);

        results.emplace_back(data.lng, data.lat, data.elevation, elevation_score, elevation_score, color);
    }

    return results;
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
        Napi::TypeError::New(env, "Raw elevation data array is required").ThrowAsJavaScriptException();
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

        double lng = dataObj.Get("lng").As<Napi::Number>().DoubleValue();
        double lat = dataObj.Get("lat").As<Napi::Number>().DoubleValue();
        double elevation = dataObj.Get("elevation").As<Napi::Number>().DoubleValue();

        accumulatedData.emplace_back(lng, lat, elevation);
    }

    return env.Null();
}

// Get results from accumulated data
Napi::Value GetResults(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    auto results = parseElevationHeatMapData(accumulatedData);

    // Calculate summary statistics
    auto summary = calculateSummaryStatistics(results);

    // Create main result object
    Napi::Object resultObj = Napi::Object::New(env);

    // Convert individual results to JavaScript array
    Napi::Array jsResults = Napi::Array::New(env, results.size());
    for (size_t i = 0; i < results.size(); i++) {
        const ElevationHeatMapResult& result = results[i];

        Napi::Object pointObj = Napi::Object::New(env);

        // Coordinates
        Napi::Array coords = Napi::Array::New(env, 2);
        coords[0u] = Napi::Number::New(env, result.lng);
        coords[1u] = Napi::Number::New(env, result.lat);
        pointObj.Set("coordinates", coords);

        // Scores
        pointObj.Set("overall", Napi::Number::New(env, result.overall_score));
        pointObj.Set("elevation", Napi::Number::New(env, result.elevation_score));

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
    jsSummary.Set("averageElevation", Napi::Number::New(env, std::round(summary.averageElevation * 100.0) / 100.0));

    Napi::Object distribution = Napi::Object::New(env);
    distribution.Set("optimal", Napi::Number::New(env, summary.optimal));
    distribution.Set("good", Napi::Number::New(env, summary.good));
    distribution.Set("moderate", Napi::Number::New(env, summary.moderate));
    distribution.Set("poor", Napi::Number::New(env, summary.poor));
    distribution.Set("unsuitable", Napi::Number::New(env, summary.unsuitable));
    jsSummary.Set("elevationDistribution", distribution);

    resultObj.Set("summary", jsSummary);

    accumulatedData.clear();
    return resultObj;
}

// Parse elevation heatmap data from raw database results
Napi::Value ParseElevationHeatMap(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "Raw elevation data array is required").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Array rawDataArray = info[0].As<Napi::Array>();
    size_t numPoints = rawDataArray.Length();

    std::vector<RawElevationData> rawData;
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
        double elevation = dataObj.Get("elevation").As<Napi::Number>().DoubleValue();

        rawData.emplace_back(lng, lat, elevation);
    }

    // Parse the raw data and calculate heatmap scores
    auto results = parseElevationHeatMapData(rawData);

    // Convert results to JavaScript array
    Napi::Array jsResults = Napi::Array::New(env, results.size());
    for (size_t i = 0; i < results.size(); i++) {
        const ElevationHeatMapResult& result = results[i];

        Napi::Object resultObj = Napi::Object::New(env);

        // Coordinates
        Napi::Array coords = Napi::Array::New(env, 2);
        coords[0u] = Napi::Number::New(env, result.lng);
        coords[1u] = Napi::Number::New(env, result.lat);
        resultObj.Set("coordinates", coords);

        // Scores
        resultObj.Set("overall", Napi::Number::New(env, result.overall_score));
        resultObj.Set("elevation", Napi::Number::New(env, result.elevation_score));

        // Heatmap color
        resultObj.Set("heatmap_color", Napi::String::New(env, result.heatmap_color));

        jsResults[i] = resultObj;
    }

    return jsResults;
}

// Initialize module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "parseElevationHeatMap"), Napi::Function::New(env, ParseElevationHeatMap));
    exports.Set(Napi::String::New(env, "setTotalPoints"), Napi::Function::New(env, SetTotalPoints));
    exports.Set(Napi::String::New(env, "addBatchData"), Napi::Function::New(env, AddBatchData));
    exports.Set(Napi::String::New(env, "getResults"), Napi::Function::New(env, GetResults));

    return exports;
}

NODE_API_MODULE(elevationHeatMapParser, Init)