#!/bin/bash
# Michigan Solar Data Import Script
# This script imports all necessary data for the Michigan Solar Optimization Tool
# Runs as part of PostgreSQL database initialization in Docker

set -e

echo "Starting Michigan Solar data import..."

# Database connection parameters (use environment variables set by Docker)
DB_HOST=${DB_HOST:-localhost}
DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-michigan_solar}
DB_USER=${DB_USER:-postgres}
DB_PASSWORD=${DB_PASSWORD:-solarpassword123}

# Function to check if file exists
file_exists() {
  [ -f "$1" ]
}

# Function to check if directory exists and has files
dir_has_files() {
  [ -d "$1" ] && [ "$(ls -A $1 2>/dev/null)" ]
}

# Wait for database to be ready
echo "Waiting for database to be ready..."
until pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER"; do
  echo "Database not ready, waiting..."
  sleep 2
done

echo "Database is ready, starting data import..."

# Import county boundaries
echo "Importing county boundaries..."
if file_exists "/datasets/County.geojson"; then
  echo "Found County.geojson, importing..."
  ogr2ogr -f "PostgreSQL" "PG:host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER password=$DB_PASSWORD" \
    -nln county_boundaries_temp \
    -lco GEOMETRY_NAME=geom \
    -lco FID=id \
    /datasets/County.geojson

  # Process county boundaries to create bboxes
  echo "Creating county bounding boxes..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    INSERT INTO county_bboxes (name, bbox, bbox_5070)
    SELECT
      name,
      ST_Envelope(geom) as bbox,
      ST_Transform(ST_Envelope(geom), 5070) as bbox_5070
    FROM county_boundaries_temp
    WHERE geom IS NOT NULL;
  "
else
  echo "Warning: County.geojson not found, skipping county import"
fi

# Import substations
echo "Importing substations..."
if file_exists "/datasets/MISubstations.geojson"; then
  echo "Found MISubstations.geojson, importing..."
  ogr2ogr -f "PostgreSQL" "PG:host=$DB_HOST port=$DB_PORT dbname=$DB_NAME user=$DB_USER password=$DB_PASSWORD" \
    -nln substations_temp \
    -lco GEOMETRY_NAME=geom \
    /datasets/MISubstations.geojson

  # Process substations to assign counties
  echo "Processing substations with county assignment..."
  psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
    INSERT INTO substations (properties, geom)
    SELECT
      properties,
      geom
    FROM substations_temp;
  "
else
  echo "Warning: MISubstations.geojson not found, skipping substation import"
fi

# Import landcover raster
echo "Importing landcover raster..."
if file_exists "/datasets/nlcd_tiles_small/landcover_michigan.tif"; then
  echo "Found landcover_michigan.tif, importing..."
  raster2pgsql -s 5070 -t 256x256 -I /datasets/nlcd_tiles_small/landcover_michigan.tif landcover_nlcd_2024_raster | \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
elif dir_has_files "/datasets/nlcd_tiles"; then
  echo "Found nlcd_tiles directory, importing tiles..."
  for file in /datasets/nlcd_tiles/*.tif; do
    if file_exists "$file"; then
      echo "Importing $file..."
      raster2pgsql -s 5070 -t 256x256 -I "$file" landcover_nlcd_2024_raster | \
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
    fi
  done
else
  echo "Warning: No landcover raster files found"
fi

# Import slope raster
echo "Importing slope raster..."
if file_exists "/datasets/slope_tiles/slope_michigan.tif"; then
  echo "Found slope_michigan.tif, importing..."
  raster2pgsql -s 5070 -t 256x256 -I /datasets/slope_tiles/slope_michigan.tif slope_raster | \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
elif dir_has_files "/datasets/slope_tiles"; then
  echo "Found slope_tiles directory, importing tiles..."
  for file in /datasets/slope_tiles/*.tif; do
    if file_exists "$file"; then
      echo "Importing $file..."
      raster2pgsql -s 5070 -t 256x256 -I "$file" slope_raster | \
        psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
    fi
  done
else
  echo "Warning: No slope raster files found"
fi

# Import population raster
echo "Importing population density raster..."
if file_exists "/datasets/gpw_unzipped/gpw_v4_population_density_rev11_2020_1_deg.tif"; then
  echo "Found population raster, importing..."
  raster2pgsql -s 4326 -t 256x256 -I /datasets/gpw_unzipped/gpw_v4_population_density_rev11_2020_1_deg.tif population_raster | \
    psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME"
else
  echo "Warning: Population raster file not found"
fi

# Clean up temporary tables
echo "Cleaning up temporary tables..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
  DROP TABLE IF EXISTS county_boundaries_temp;
  DROP TABLE IF EXISTS substations_temp;
" 2>/dev/null || true

# Create spatial indexes and analyze tables
echo "Creating spatial indexes and analyzing tables..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -c "
  REINDEX INDEX idx_county_bboxes_bbox;
  REINDEX INDEX idx_county_bboxes_bbox_5070;
  REINDEX INDEX idx_substations_geom;
  REINDEX INDEX idx_landcover_nlcd_2024_raster_rast;
  REINDEX INDEX idx_slope_raster_rast;
  REINDEX INDEX idx_population_raster_rast;
  ANALYZE county_bboxes;
  ANALYZE substations;
  ANALYZE landcover_nlcd_2024_raster;
  ANALYZE slope_raster;
  ANALYZE population_raster;
" 2>/dev/null || true

echo "Michigan Solar data import completed successfully!"