# SQL Guide for Spatial Queries in OptimizationTool

## Purpose
This guide is the authoritative SQL and PostGIS reference for our codebase. It focuses on the farm analysis pipeline, raster sampling, and query patterns used by the backend. It is optimized for correctness, performance, and operational safety at the scale of our datasets.

## Scope and Primary Data Sources
- **Raster sources**: landcover, slope, solar suitability. All raster tables are indexed and queried through PostGIS raster functions.
- **Vector sources**: farm polygons and derived point samples.
- **Backend usage**: query patterns from `backend/src/database.js` and routes in `backend/src/routes/` that rely on raster sampling and polygon analysis.

## Core Principles
1. **Never build cartesian products** between large point sets and raster tiles.
2. **Filter early, join late**: apply polygon containment and bounding constraints before raster value extraction.
3. **Always transform to raster SRID** before `ST_Intersects`, `ST_Contains`, or `ST_Value`.
4. **Keep sampling density reasonable** and proportional to polygon area.
5. **Keep queries deterministic** and ordered when results are mapped back to generated samples.

## Coordinate Systems
- Input geometry is in **EPSG:4326** (lat/lng).
- Raster tables are in **EPSG:5070** (CONUS Albers).
- Always transform points and polygons before raster operations:
	- `ST_Transform(geom, 5070)` for raster operations.
	- `ST_SetSRID(ST_MakePoint(lng, lat), 4326)` for point creation.

## Sampling Strategy
### Default Grid Sampling
- Use a grid-based sample for heatmaps with **2,500 points** as a default ceiling.
- For large polygons, use adaptive sampling based on area, bounded by minimum/maximum limits.

### Adaptive Sampling Formula
Use:
$$\text{samples} = \min(\text{max}, \max(\text{min}, \lceil \text{area} / k \rceil))$$
Where:
- `area` is in projected units (5070).
- `k` is a tuning constant based on raster resolution.
- `min` and `max` should be safe limits (e.g., 400 to 4000).

### When to Use Random Sampling
- Use random sampling only for quick preview or when the polygon area is huge.
- Keep it reproducible with a fixed seed or a deterministic grid.

## Raster Query Patterns

### Recommended Pattern: Point-to-Raster Join
```sql
SELECT p.lat, p.lng,
			 COALESCE(ST_Value(r.rast, ST_Transform(p.geom, 5070)), 0) AS value
FROM sample_points p
LEFT JOIN raster_table r
	ON ST_Intersects(r.rast, ST_Transform(p.geom, 5070))
WHERE ST_Contains(polygon_5070, ST_Transform(p.geom, 5070))
ORDER BY p.ord;
```

**Why this works**:
- Each point touches at most a small number of tiles.
- Avoids the cartesian explosion caused by `CROSS JOIN`.
- Preserves point order (`ord`) for heatmap reconstruction.

### Anti-Pattern: Cartesian Explosion
```sql
SELECT p.lat, p.lng, ST_Value(r.rast, point_geom)
FROM unnest(lats, lngs) AS p(lat, lng)
CROSS JOIN raster_table r
WHERE ST_Intersects(r.rast, polygon_geom);
```
Never use this. It multiplies point count by tile count before spatial filtering.

## Polygon Filtering
Use `ST_Contains` (or `ST_Covers` if boundary inclusion is needed) to ensure points are inside the target polygon.

### Recommended
```sql
WHERE ST_Contains(polygon_5070, ST_Transform(p.geom, 5070))
```

### If you need boundary inclusion
```sql
WHERE ST_Covers(polygon_5070, ST_Transform(p.geom, 5070))
```

## Working with Raster NoData
Always normalize NoData values using `COALESCE` or a documented sentinel. If 0 is a valid domain value, use `NULLIF` plus a domain-aware fallback.

### Example
```sql
COALESCE(NULLIF(ST_Value(r.rast, geom), -9999), 0)
```

## Table-Specific Guidance
### solar_suitability
- Use direct `ST_Value` for per-point sampling.
- Use `LEFT JOIN` + `ST_Intersects` between points and raster tiles.

### slope_raster
- Use for slope-derived metrics.
- Do not use as elevation unless explicitly documented as a proxy.

### landcover_nlcd_2024_raster
- Use for landcover classification or mask generation.
- Ensure you sample landcover only after filtering points to the polygon.

## Elevation Data Gap
As of this guide, **true elevation data is not imported**. Current logic uses slope as a proxy, which is not a valid substitute for elevation. If elevation is required:
1. Import an elevation raster (DEM).
2. Add a dedicated elevation table with proper SRID and indexes.
3. Update query paths to use the new table.
4. Document the change in API responses and notes.

## Indexes and Storage
### Required Indexes
- Raster tables: `GIST` index on `rast`.
- Vector tables: `GIST` index on geometry columns.

### Example Index
```sql
CREATE INDEX IF NOT EXISTS idx_solar_suitability_rast
ON solar_suitability
USING GIST (ST_ConvexHull(rast));
```

### Why `ST_ConvexHull(rast)`
It allows spatial indexing on raster extents to speed up `ST_Intersects`.

## Query Planning and Diagnostics

### Use EXPLAIN ANALYZE
```sql
EXPLAIN ANALYZE
SELECT ...;
```
Focus on:
- Nested loops over raster tables.
- Large sequential scans.
- High cost from join explosion.

### Common Red Flags
- Full raster table scans.
- `CROSS JOIN` with large point sets.
- `ST_Intersects` against unindexed raster extents.

## Performance Targets
- **Small polygons**: < 5 seconds.
- **Typical farm polygons**: < 20 seconds.
- **Worst-case polygons**: < 30 seconds (with adaptive sampling).

## Safe Limits and Timeouts
- Set conservative limits for sample count.
- Add server-side query timeouts where feasible.
- Prefer fewer points with meaningful coverage over exhaustive grids.

## Recommended Query Building Pattern
### Step-by-step
1. Convert input polygon to GeoJSON and SRID 4326.
2. Transform polygon to 5070 once.
3. Generate point grid (limit-capped).
4. Filter points with `ST_Contains` on the transformed polygon.
5. Join points to raster tiles using `LEFT JOIN` + `ST_Intersects`.
6. Extract values with `ST_Value`.
7. Preserve ordering for heatmap reconstruction.

## Example End-to-End Query (Template)
```sql
WITH
	polygon AS (
		SELECT ST_Transform(ST_GeomFromGeoJSON($1), 5070) AS geom
	),
	points AS (
		SELECT p.lat, p.lng, p.ord,
					 ST_SetSRID(ST_MakePoint(p.lng, p.lat), 4326) AS geom
		FROM unnest($2::float[], $3::float[]) WITH ORDINALITY AS p(lat, lng, ord)
	)
SELECT p.lat, p.lng,
			 COALESCE(ST_Value(r.rast, ST_Transform(p.geom, 5070)), 0) AS value
FROM points p
JOIN polygon g ON ST_Contains(g.geom, ST_Transform(p.geom, 5070))
LEFT JOIN raster_table r ON ST_Intersects(r.rast, ST_Transform(p.geom, 5070))
ORDER BY p.ord;
```

## Guardrails for Developers
- Never introduce `CROSS JOIN` between raster tables and sampled points.
- Keep sampling limits low by default.
- Always document SRID assumptions in code comments.
- If a query becomes slow, reduce points first before deeper refactors.

## Implementation Checklist
- [ ] Confirm raster SRIDs and indexes
- [ ] Cap sampling to safe defaults
- [ ] Use `ST_Contains` or `ST_Covers` for polygon filtering
- [ ] Use `LEFT JOIN` with `ST_Intersects` for tile selection
- [ ] Normalize NoData values
- [ ] Validate performance with `EXPLAIN ANALYZE`

## Future Enhancements
1. **Adaptive sampling based on polygon area**
2. **Raster clipping (`ST_Clip`) for dense analysis**
3. **Caching hot raster regions**
4. **Batching per tile to improve locality**
5. **Parallel raster reads for large polygons**