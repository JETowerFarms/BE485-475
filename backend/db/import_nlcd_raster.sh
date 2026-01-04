#!/usr/bin/env bash
set -euo pipefail

ZIP_NAME="$1"
TABLE="landcover_nlcd_2024_raster"

ZIP_PATH="/datasets/${ZIP_NAME}"
if [ ! -f "$ZIP_PATH" ]; then
  echo "Zip not found: $ZIP_PATH" >&2
  exit 1
fi

mkdir -p /tmp/nlcd

# Find a GeoTIFF in the archive
TIF=$(unzip -Z1 "$ZIP_PATH" | grep -Ei '\.tif(f)?$' | head -n 1 || true)
if [ -z "$TIF" ]; then
  echo "No .tif found inside $ZIP_PATH" >&2
  exit 1
fi

echo "Found TIF: $TIF"

# Extract only the tif
unzip -j -o "$ZIP_PATH" "$TIF" -d /tmp/nlcd >/dev/null
TIF_BASENAME=$(basename "$TIF")
TIF_PATH="/tmp/nlcd/${TIF_BASENAME}"

# Detect SRID (fallback to 5070 for NLCD)
SRID=$(gdalsrsinfo -o epsg "$TIF_PATH" 2>/dev/null | sed -n 's/.*EPSG:\([0-9][0-9]*\).*/\1/p' | head -n 1 || true)
if [ -z "${SRID:-}" ]; then
  SRID=5070
fi

echo "Using SRID: ${SRID}"

echo "Truncating ${TABLE}..."
psql -U postgres -d michigan_solar -v ON_ERROR_STOP=1 -c "TRUNCATE ${TABLE};"

echo "Loading raster tiles into ${TABLE} (this can take a while)..."
# Table already exists; use -a (append) after TRUNCATE.
raster2pgsql -a -s "$SRID" -I -C -M -t 256x256 "$TIF_PATH" "$TABLE" \
  | psql -U postgres -d michigan_solar -v ON_ERROR_STOP=1

echo "Stamping source_file..."
psql -U postgres -d michigan_solar -v ON_ERROR_STOP=1 -c "UPDATE ${TABLE} SET source_file='${ZIP_NAME}' WHERE source_file IS NULL;"

psql -U postgres -d michigan_solar -v ON_ERROR_STOP=1 -c "SELECT COUNT(*) AS raster_tiles FROM ${TABLE};"