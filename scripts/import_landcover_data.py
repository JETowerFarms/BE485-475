import os
import gzip
import json
import psycopg2
from psycopg2.extras import execute_values
import glob
from pathlib import Path

# Database connection
conn = psycopg2.connect("host=localhost port=5432 dbname=michigan_solar user=postgres")
cursor = conn.cursor()

# Mapping of data types to table names (matching ZIP file patterns)
DATA_MAPPING = {
    'lakes_(usace_ienc)': 'landcover_lakes',
    'river_lines_(usace_ienc)': 'landcover_river_lines',
    'river_areas_(usace_ienc)': 'landcover_river_areas',
    'local_roads': 'landcover_local_roads',
    'primary_roads': 'landcover_primary_roads',
    'waterbody': 'landcover_waterbody',
    'coastlines_(usace_ienc)': 'landcover_coastlines',
    'streams_(mouth)': 'landcover_streams_mouth',
    'roads_(usace_ienc)': 'landcover_roads_usace_ienc',
    'building_locations_(usace_ienc)': 'landcover_building_locations_usace_ienc',
    'base_flood_elevations': 'landcover_base_flood_elevations',
    'landforms': 'landcover_landforms'
}

def import_geojson_file(file_path, table_name):
    """Import a compressed NDJSON GeoJSON file into the specified table"""
    print(f"Importing {file_path} into {table_name}")

    # Decompress and load NDJSON (Newline Delimited JSON)
    features = []
    with gzip.open(file_path, 'rt', encoding='utf-8') as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if line:  # Skip empty lines
                try:
                    feature = json.loads(line)
                    features.append(feature)
                except json.JSONDecodeError as e:
                    print(f"Error parsing line {line_num} in {file_path}: {e}")
                    continue

    print(f"Found {len(features)} features in {file_path}")

    if not features:
        print(f"No features found in {file_path}")
        return

    # Prepare data for bulk insert
    data_to_insert = []
    for feature in features:
        geom = json.dumps(feature['geometry'])
        attrs = json.dumps(feature.get('properties', {}))
        source_file = os.path.basename(file_path)

        data_to_insert.append((geom, attrs, source_file))

    if data_to_insert:
        # Bulk insert
        query = f"""
            INSERT INTO {table_name} (geom, attrs, source_file)
            VALUES %s
        """
        execute_values(cursor, query, data_to_insert)
        print(f"Inserted {len(data_to_insert)} records into {table_name}")

def process_all_landcover_data():
    """Process all landcover data files"""
    datasets_path = Path(r"o:\N\OptimizationTool\Datasets")

    # Process each data type
    data_patterns = {
        'landcover_lakes': ['lakes_(usace_ienc)'],
        'landcover_river_lines': ['river_lines_(usace_ienc)'],
        'landcover_river_areas': ['river_areas_(usace_ienc)'],
        'landcover_local_roads': ['local_roads-20251203T011909Z-1-001', 'local_roads-20251203T011909Z-1-002'],
        'landcover_primary_roads': ['primary_roads'],
        'landcover_waterbody': ['waterbody'],
        'landcover_coastlines': ['coastlines_(usace_ienc)'],
        'landcover_streams_mouth': ['streams_(mouth)'],
        'landcover_roads_usace_ienc': ['roads_(usace_ienc)'],
        'landcover_building_locations_usace_ienc': ['building_locations_(usace_ienc)'],
        'landcover_base_flood_elevations': ['base_flood_elevations'],
        'landcover_landforms': ['landforms']
    }

    for table_name, dir_patterns in data_patterns.items():
        print(f"\nProcessing {table_name}")

        for dir_pattern in dir_patterns:
            data_dir = datasets_path / dir_pattern
            if data_dir.exists() and data_dir.is_dir():
                # Find GeoJSON.gz files (including in subdirectories)
                geojson_files = list(data_dir.rglob("*.geojson.gz"))
                print(f"Found {len(geojson_files)} GeoJSON files in {data_dir}")

                for geojson_file in geojson_files:
                    try:
                        import_geojson_file(str(geojson_file), table_name)
                    except Exception as e:
                        print(f"Error importing {geojson_file}: {e}")
                        conn.rollback()
                        continue

                    # Commit after each file
                    conn.commit()
            else:
                print(f"Directory {data_dir} not found")

    print("\nAll landcover data import completed!")

if __name__ == "__main__":
    try:
        process_all_landcover_data()
    except Exception as e:
        print(f"Error: {e}")
        conn.rollback()
    finally:
        cursor.close()
        conn.close()