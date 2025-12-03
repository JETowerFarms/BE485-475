"""
Process solar suitability datasets for Michigan EGLE Solar Energy Suitability Tool replication.

This script:
1. Extracts and processes NLCD 2021 land cover data
2. Processes LandFire slope data
3. Processes GPW v4 population density data
4. Extracts Michigan substations from power plants data
5. Calculates solar suitability scores using EGLE methodology
"""

import json
import gzip
import zipfile
import os
from pathlib import Path

# Michigan bounding box
MI_BOUNDS = {
    'min_lat': 41.7,
    'max_lat': 48.3,
    'min_lng': -90.5,
    'max_lng': -82.4
}

def extract_power_plants():
    """Extract power plants/substations data from geojson.gz"""
    print("Extracting power plants data...")
    
    michigan_facilities = []
    
    try:
        # Try reading as newline-delimited JSON
        with gzip.open('Power_Plants_20250824_025710_chunk0000.geojson.gz', 'rt') as f:
            for line_num, line in enumerate(f):
                if not line.strip():
                    continue
                
                try:
                    feature = json.loads(line)
                    
                    props = feature.get('properties', {})
                    geom = feature.get('geometry', {})
                    
                    if geom.get('type') != 'Point':
                        continue
                    
                    coords = geom.get('coordinates', [])
                    if len(coords) < 2:
                        continue
                    
                    lng, lat = coords[0], coords[1]
                    
                    # Check if in Michigan bounds
                    if not (MI_BOUNDS['min_lat'] <= lat <= MI_BOUNDS['max_lat'] and
                            MI_BOUNDS['min_lng'] <= lng <= MI_BOUNDS['max_lng']):
                        continue
                    
                    # Look for voltage information (we need 220-345kV)
                    voltage = None
                    for field in ['VOLTAGE', 'voltage', 'VOLT', 'volt', 'VOLTAGE_KV', 'kV', 'MAX_VOLT']:
                        if field in props:
                            try:
                                voltage = float(str(props[field]).replace('kV', '').strip())
                                break
                            except:
                                pass
                    
                    # Check for facility information
                    facility_type = props.get('TYPE', props.get('type', props.get('PRIM_TYPE', props.get('STATUS', ''))))
                    name = props.get('NAME', props.get('name', props.get('PLANT_NAME', props.get('UTILITY', ''))))
                    
                    michigan_facilities.append({
                        'lat': lat,
                        'lng': lng,
                        'voltage': voltage,
                        'type': facility_type,
                        'name': name,
                        'all_fields': list(props.keys())[:10]  # Save field names for reference
                    })
                    
                except json.JSONDecodeError:
                    continue
    
    except Exception as e:
        print(f"Error reading power plants file: {e}")
    
    print(f"Found {len(michigan_facilities)} facilities in Michigan")
    
    # Save extracted facilities
    os.makedirs('src/data', exist_ok=True)
    with open('src/data/michigan_facilities.json', 'w') as f:
        json.dump(michigan_facilities, f, indent=2)
    
    return michigan_facilities

def check_zip_contents():
    """Check what's inside the zip files"""
    print("\nChecking NLCD zip contents...")
    try:
        with zipfile.ZipFile('Annual_NLCD_LndCov_2024_CU_C1V1.zip', 'r') as z:
            print("NLCD files:")
            for name in z.namelist()[:10]:  # Show first 10 files
                print(f"  {name}")
    except Exception as e:
        print(f"Error reading NLCD zip: {e}")
    
    print("\nChecking Slope zip contents...")
    try:
        with zipfile.ZipFile('LF2020_SlpD_220_CONUS.zip', 'r') as z:
            print("Slope files:")
            for name in z.namelist()[:10]:
                print(f"  {name}")
    except Exception as e:
        print(f"Error reading Slope zip: {e}")
    
    print("\nChecking Population zip contents...")
    try:
        with zipfile.ZipFile('gpw-v4-population-density-rev11_2020_1_deg_tif.zip', 'r') as z:
            print("Population files:")
            for name in z.namelist()[:10]:
                print(f"  {name}")
    except Exception as e:
        print(f"Error reading Population zip: {e}")

def create_egle_scoring_reference():
    """Create reference for EGLE scoring methodology"""
    scoring = {
        "methodology": "Michigan EGLE Solar Energy Suitability Tool",
        "weights": {
            "land_cover": 4,
            "distance_to_substation": 3,
            "slope": 2,
            "population_density": 1
        },
        "scoring_tables": {
            "land_cover": {
                "0": {"class": "No Data", "score": 0},
                "11": {"class": "Open Water", "score": 1},
                "12": {"class": "Perennial Ice/Snow", "score": 1},
                "21": {"class": "Developed, Open Space", "score": 75},
                "22": {"class": "Developed, Low Intensity", "score": 50},
                "23": {"class": "Developed, Medium Intensity", "score": 25},
                "24": {"class": "Developed, High Intensity", "score": 1},
                "31": {"class": "Barren Land", "score": 90},
                "41": {"class": "Deciduous Forest", "score": 50},
                "42": {"class": "Evergreen Forest", "score": 50},
                "43": {"class": "Mixed Forest", "score": 50},
                "52": {"class": "Shrub/Scrub", "score": 75},
                "71": {"class": "Grassland/Herbaceous", "score": 90},
                "81": {"class": "Pasture/Hay", "score": 90},
                "82": {"class": "Cultivated Crops", "score": 90},
                "90": {"class": "Woody Wetlands", "score": 1},
                "95": {"class": "Emergent Herbaceous Wetlands", "score": 1}
            },
            "slope_percent": {
                "0-1": 100,
                "2-3": 90,
                "4": 30,
                "5": 10,
                "6-10": 1,
                "11+": 0
            },
            "distance_miles": {
                "0-1": 100,
                "1-5": 90,
                "5-10": 75,
                "10+": 50
            },
            "population_density": {
                "0-100": 100,
                "101-150": 75,
                "151-200": 50,
                "201-300": 25,
                "301+": 0
            }
        }
    }
    
    os.makedirs('src/data', exist_ok=True)
    with open('src/data/egle_scoring_methodology.json', 'w') as f:
        json.dump(scoring, f, indent=2)
    
    print("\nCreated EGLE scoring methodology reference")
    return scoring

if __name__ == '__main__':
    print("=" * 60)
    print("Michigan Solar Suitability Data Processing")
    print("=" * 60)
    
    # Create data directory if it doesn't exist
    os.makedirs('src/data', exist_ok=True)
    
    # Step 1: Check zip contents
    check_zip_contents()
    
    # Step 2: Extract power plants/substations
    print("\n" + "=" * 60)
    substations = extract_power_plants()
    
    # Step 3: Create scoring reference
    print("\n" + "=" * 60)
    scoring = create_egle_scoring_reference()
    
    print("\n" + "=" * 60)
    print("Initial processing complete!")
    print("\nNext steps:")
    print("1. Install rasterio and gdal: pip install rasterio gdal")
    print("2. Run raster processing to extract Michigan data")
    print("3. Calculate suitability scores for grid cells")
    print("=" * 60)
