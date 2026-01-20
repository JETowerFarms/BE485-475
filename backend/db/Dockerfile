FROM postgis/postgis:14-3.3

# Add tooling needed to import GIS datasets (vectors + raster)
# - gdal-bin provides ogr2ogr/ogrinfo/gdalinfo
# - unzip is used to read/extract dataset zips
# Note: PostGIS is already included in the base image
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    gdal-bin \
    unzip \
  && rm -rf /var/lib/apt/lists/*

# Copy the data import script and make it executable
COPY import_data.sh /docker-entrypoint-initdb.d/05-import-data.sh
RUN chmod +x /docker-entrypoint-initdb.d/05-import-data.sh
