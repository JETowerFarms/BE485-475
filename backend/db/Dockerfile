FROM postgis/postgis:14-3.3

# Add tooling needed to import GIS datasets (vectors + raster)
# - gdal-bin provides ogr2ogr/ogrinfo/gdalinfo
# - unzip is used to read/extract dataset zips
# - postgis scripts package provides raster2pgsql
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    gdal-bin \
    unzip \
    postgis \
    postgresql-14-postgis-3-scripts \
  && rm -rf /var/lib/apt/lists/*

COPY import_vector_zip.sh /usr/local/bin/import_vector_zip
RUN chmod +x /usr/local/bin/import_vector_zip

COPY import_nlcd_raster.sh /usr/local/bin/import_nlcd_raster
RUN chmod +x /usr/local/bin/import_nlcd_raster
