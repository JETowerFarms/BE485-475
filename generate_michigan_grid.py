import psycopg2

# Generate 100 points in a grid over Michigan
conn = psycopg2.connect("host=localhost port=5432 dbname=michigan_solar user=postgres")
cursor = conn.cursor()

# Michigan bounds (approximate)
min_lng = -90.4
max_lng = -82.4
min_lat = 41.7
max_lat = 48.1

# Create 10x10 grid (100 points)
lng_step = (max_lng - min_lng) / 9  # 9 steps for 10 points
lat_step = (max_lat - min_lat) / 9

points = []
for i in range(10):
    for j in range(10):
        lng = min_lng + i * lng_step
        lat = min_lat + j * lat_step
        points.append((lat, lng))

print(f"Generated {len(points)} grid points over Michigan")

# Insert points with real data sampling
for lat, lng in points:
    try:
        # First get the scores from the function
        cursor.execute("SELECT * FROM calculate_solar_suitability(%s, %s)", (lat, lng))
        scores = cursor.fetchone()

        if scores:
            landcover_score, slope_score, population_score, transmission_score, overall_score = scores

            # Then insert with the real scores
            cursor.execute("""
                INSERT INTO solar_suitability (lat, lng, geom, landcover_score, slope_score, population_score, transmission_score, overall_score)
                VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s, %s)
            """, (lat, lng, lng, lat, landcover_score, slope_score, population_score, transmission_score, overall_score))
        else:
            print(f"No scores returned for point ({lat}, {lng})")
    except Exception as e:
        print(f"Error inserting point ({lat}, {lng}): {e}")

conn.commit()
cursor.close()
conn.close()

print("Grid points inserted successfully")