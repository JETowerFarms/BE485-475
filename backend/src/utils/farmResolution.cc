#include <napi.h>
#include <vector>
#include <cmath>
#include <algorithm>
#include <unordered_set>
#include <stdexcept>

// Global resolution variable
static double FARM_RESOLUTION = 0.001;

// Point structure
struct Point {
    double lng;
    double lat;
    Point(double lng, double lat) : lng(lng), lat(lat) {}
};

// Bounding box structure
struct BoundingBox {
    double minLng, maxLng, minLat, maxLat;
};

struct GridPoint {
    int x;
    int y;
};

static inline long long gridKey(int x, int y) {
    return (static_cast<long long>(x) << 32) ^ static_cast<unsigned int>(y);
}

static inline int toGridIndex(double value, double origin) {
    return static_cast<int>(std::llround((value - origin) / FARM_RESOLUTION));
}

static inline double fromGridIndex(int index, double origin) {
    return origin + static_cast<double>(index) * FARM_RESOLUTION;
}

// Check if point is inside polygon using ray casting algorithm
bool pointInPolygon(const Point& point, const std::vector<Point>& polygon) {
    double x = point.lng;
    double y = point.lat;
    bool inside = false;

    size_t n = polygon.size();
    for (size_t i = 0, j = n - 1; i < n; j = i++) {
        const Point& pi = polygon[i];
        const Point& pj = polygon[j];

        if (((pi.lat > y) != (pj.lat > y)) &&
            (x < (pj.lng - pi.lng) * (y - pi.lat) / (pj.lat - pi.lat) + pi.lng)) {
            inside = !inside;
        }
    }

    return inside;
}

// Calculate bounding box of polygon
BoundingBox getBoundingBox(const std::vector<Point>& polygon) {
    double minLng = std::numeric_limits<double>::max();
    double maxLng = std::numeric_limits<double>::lowest();
    double minLat = std::numeric_limits<double>::max();
    double maxLat = std::numeric_limits<double>::lowest();

    for (const auto& point : polygon) {
        minLng = std::min(minLng, point.lng);
        maxLng = std::max(maxLng, point.lng);
        minLat = std::min(minLat, point.lat);
        maxLat = std::max(maxLat, point.lat);
    }

    return {minLng, maxLng, minLat, maxLat};
}

static std::vector<GridPoint> traceBoundaryGrid(const std::vector<Point>& polygon, const BoundingBox& bbox) {
    std::unordered_set<long long> seen;
    std::vector<GridPoint> boundary;

    for (size_t i = 0; i + 1 < polygon.size(); ++i) {
        int x0 = toGridIndex(polygon[i].lng, bbox.minLng);
        int y0 = toGridIndex(polygon[i].lat, bbox.minLat);
        int x1 = toGridIndex(polygon[i + 1].lng, bbox.minLng);
        int y1 = toGridIndex(polygon[i + 1].lat, bbox.minLat);

        int dx = std::abs(x1 - x0);
        int dy = std::abs(y1 - y0);
        int sx = x0 < x1 ? 1 : -1;
        int sy = y0 < y1 ? 1 : -1;
        int err = dx - dy;

        while (true) {
            long long key = gridKey(x0, y0);
            if (seen.insert(key).second) {
                boundary.push_back({x0, y0});
            }
            if (x0 == x1 && y0 == y1) break;
            int e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x0 += sx;
            }
            if (e2 < dx) {
                err += dx;
                y0 += sy;
            }
        }
    }

    return boundary;
}

static std::vector<GridPoint> fillGridByBoundingBox(const BoundingBox& bbox) {
    int maxX = static_cast<int>(std::llround((bbox.maxLng - bbox.minLng) / FARM_RESOLUTION));
    int maxY = static_cast<int>(std::llround((bbox.maxLat - bbox.minLat) / FARM_RESOLUTION));

    std::vector<GridPoint> points;
    points.reserve((maxX + 1) * (maxY + 1));

    for (int y = maxY; y >= 0; --y) {
        for (int x = 0; x <= maxX; ++x) {
            points.push_back({x, y});
        }
    }

    return points;
}

// Generate matrix of points within farm boundaries
std::vector<Point> farmResolution(const std::vector<Point>& boundaryPoints) {
    if (boundaryPoints.size() < 3) {
        throw std::invalid_argument("Boundary points must have at least 3 coordinate pairs");
    }

    // Ensure boundary is closed
    std::vector<Point> polygon = boundaryPoints;
    const Point& first = polygon[0];
    const Point& last = polygon.back();
    if (first.lng != last.lng || first.lat != last.lat) {
        polygon.push_back(first);
    }

    // Calculate bounding box
    BoundingBox bbox = getBoundingBox(polygon);

    std::vector<GridPoint> filled = fillGridByBoundingBox(bbox);
    std::vector<Point> points;
    points.reserve(filled.size());

    for (const auto& cell : filled) {
        double lng = fromGridIndex(cell.x, bbox.minLng);
        double lat = fromGridIndex(cell.y, bbox.minLat);
        points.emplace_back(std::round(lng * 1000000.0) / 1000000.0,
                            std::round(lat * 1000000.0) / 1000000.0);
    }

    return points;
}

// Node.js bindings

// Set farm resolution
Napi::Value SetFarmResolution(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Resolution must be a number").ThrowAsJavaScriptException();
        return env.Null();
    }

    double resolution = info[0].As<Napi::Number>().DoubleValue();
    if (resolution <= 0) {
        Napi::TypeError::New(env, "Resolution must be a positive number").ThrowAsJavaScriptException();
        return env.Null();
    }

    FARM_RESOLUTION = resolution;
    return env.Null();
}

// Get farm resolution
Napi::Value GetFarmResolution(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    return Napi::Number::New(env, FARM_RESOLUTION);
}

// Farm resolution function
Napi::Value FarmResolution(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsArray()) {
        Napi::TypeError::New(env, "Boundary points must be an array").ThrowAsJavaScriptException();
        return env.Null();
    }

    Napi::Array boundaryArray = info[0].As<Napi::Array>();
    size_t length = boundaryArray.Length();

    if (length < 3) {
        Napi::TypeError::New(env, "Boundary points must have at least 3 coordinate pairs").ThrowAsJavaScriptException();
        return env.Null();
    }

    std::vector<Point> boundaryPoints;
    for (size_t i = 0; i < length; i++) {
        Napi::Value element = boundaryArray[i];
        if (!element.IsArray()) {
            Napi::TypeError::New(env, "Each boundary point must be a coordinate pair [lng, lat]").ThrowAsJavaScriptException();
            return env.Null();
        }

        Napi::Array coord = element.As<Napi::Array>();
        if (coord.Length() != 2 || !coord.Get(0u).IsNumber() || !coord.Get(1u).IsNumber()) {
            Napi::TypeError::New(env, "Each boundary point must be a coordinate pair [lng, lat]").ThrowAsJavaScriptException();
            return env.Null();
        }

        double lng = coord.Get(0u).As<Napi::Number>().DoubleValue();
        double lat = coord.Get(1u).As<Napi::Number>().DoubleValue();
        boundaryPoints.emplace_back(lng, lat);
    }

    try {
        std::vector<Point> points = farmResolution(boundaryPoints);

        Napi::Array result = Napi::Array::New(env, points.size());
        for (size_t i = 0; i < points.size(); i++) {
            Napi::Array coord = Napi::Array::New(env, 2);
            coord[0u] = Napi::Number::New(env, points[i].lng);
            coord[1u] = Napi::Number::New(env, points[i].lat);
            result[i] = coord;
        }

        return result;
    } catch (const std::exception& e) {
        Napi::Error::New(env, e.what()).ThrowAsJavaScriptException();
        return env.Null();
    }
}

// Point in polygon function
Napi::Value PointInPolygon(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2 || !info[0].IsArray() || !info[1].IsArray()) {
        Napi::TypeError::New(env, "Point and polygon must be arrays").ThrowAsJavaScriptException();
        return env.Null();
    }

    // Parse point
    Napi::Array pointArray = info[0].As<Napi::Array>();
    if (pointArray.Length() != 2 || !pointArray.Get(0u).IsNumber() || !pointArray.Get(1u).IsNumber()) {
        Napi::TypeError::New(env, "Point must be [lng, lat]").ThrowAsJavaScriptException();
        return env.Null();
    }

    Point point(pointArray.Get(0u).As<Napi::Number>().DoubleValue(),
                pointArray.Get(1u).As<Napi::Number>().DoubleValue());

    // Parse polygon
    Napi::Array polygonArray = info[1].As<Napi::Array>();
    size_t length = polygonArray.Length();
    std::vector<Point> polygon;

    for (size_t i = 0; i < length; i++) {
        Napi::Value element = polygonArray[i];
        if (!element.IsArray()) {
            Napi::TypeError::New(env, "Each polygon point must be a coordinate pair [lng, lat]").ThrowAsJavaScriptException();
            return env.Null();
        }

        Napi::Array coord = element.As<Napi::Array>();
        if (coord.Length() != 2 || !coord.Get(0u).IsNumber() || !coord.Get(1u).IsNumber()) {
            Napi::TypeError::New(env, "Each polygon point must be a coordinate pair [lng, lat]").ThrowAsJavaScriptException();
            return env.Null();
        }

        double lng = coord.Get(0u).As<Napi::Number>().DoubleValue();
        double lat = coord.Get(1u).As<Napi::Number>().DoubleValue();
        polygon.emplace_back(lng, lat);
    }

    bool result = pointInPolygon(point, polygon);
    return Napi::Boolean::New(env, result);
}

// Initialize module
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set(Napi::String::New(env, "farmResolution"), Napi::Function::New(env, FarmResolution));
    exports.Set(Napi::String::New(env, "setFarmResolution"), Napi::Function::New(env, SetFarmResolution));
    exports.Set(Napi::String::New(env, "getFarmResolution"), Napi::Function::New(env, GetFarmResolution));
    exports.Set(Napi::String::New(env, "pointInPolygon"), Napi::Function::New(env, PointInPolygon));

    return exports;
}

NODE_API_MODULE(farmResolution, Init)