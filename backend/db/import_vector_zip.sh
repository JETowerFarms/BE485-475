#!/usr/bin/env bash
set -euo pipefail

ZIP_NAME="$1"
STAGING_TABLE="$2"

ZIP_PATH="/datasets/${ZIP_NAME}"

if [ ! -f "$ZIP_PATH" ]; then
  echo "Zip not found: $ZIP_PATH" >&2
  exit 1
fi

# Prefer gzipped GeoJSON chunks, fallback to plain GeoJSON.
mapfile -t entries < <(unzip -Z1 "$ZIP_PATH" | grep -Ei '\.geojson(\.gz)?$' || true)
if [ ${#entries[@]} -eq 0 ]; then
  echo "No .geojson/.geojson.gz found inside $ZIP_PATH" >&2
  exit 1
fi

# Build OGR VFS paths.
# - For *.geojson.gz: /vsigzip//vsizip//datasets/<zip>/<entry>
# - For *.geojson   : /vsizip//datasets/<zip>/<entry>
function vfs_path() {
  local entry="$1"
  if [[ "$entry" =~ \.gz$ ]]; then
    echo "/vsigzip//vsizip//datasets/${ZIP_NAME}/${entry}"
  else
    echo "/vsizip//datasets/${ZIP_NAME}/${entry}"
  fi
}

first="${entries[0]}"
echo "Import (overwrite): $first"
ogr2ogr -overwrite -f PostgreSQL "PG:dbname=michigan_solar user=postgres" "$(vfs_path "$first")" \
  -nln "$STAGING_TABLE" -lco GEOMETRY_NAME=geom -lco SPATIAL_INDEX=NONE -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326

if [ ${#entries[@]} -gt 1 ]; then
  for ((i=1; i<${#entries[@]}; i++)); do
    e="${entries[$i]}"
    echo "Import (append): $e"
    ogr2ogr -append -update -f PostgreSQL "PG:dbname=michigan_solar user=postgres" "$(vfs_path "$e")" \
      -nln "$STAGING_TABLE" -lco GEOMETRY_NAME=geom -nlt PROMOTE_TO_MULTI -t_srs EPSG:4326
  done
fi
