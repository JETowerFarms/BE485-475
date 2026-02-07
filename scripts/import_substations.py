import json
import psycopg2

# Import Michigan substations from GeoJSON to PostGIS
conn = psycopg2.connect("host=localhost port=5432 dbname=michigan_solar user=postgres")
cursor = conn.cursor()

with open('o:/N/OptimizationTool/Datasets/MISubstations.geojson', 'r') as f:
    data = json.load(f)

for feature in data['features']:
    properties = feature['properties']
    geom_json = json.dumps(feature['geometry'])

    cursor.execute("""
        INSERT INTO substations (properties, geom)
        VALUES (%s, ST_GeomFromGeoJSON(%s))
    """, (json.dumps(properties), geom_json))

conn.commit()
cursor.close()
conn.close()

print(f"Imported {len(data['features'])} substations")