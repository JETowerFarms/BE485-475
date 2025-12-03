#!/usr/bin/env python3
"""
Generate detailed Michigan elevation data from USGS elevation API
This script samples elevation data at higher resolution (0.01 degree grid)
and saves it as JSON for use in the React Native app.

Requirements: pip install requests
"""

import requests
import json
import time

# Michigan bounds
MIN_LAT = 41.7
MAX_LAT = 48.3
MIN_LNG = -90.5
MAX_LNG = -82.4

# Grid resolution (0.01 degrees ≈ 1km)
GRID_RESOLUTION = 0.01

# USGS Elevation Point Query Service
USGS_API_URL = "https://epqs.nationalmap.gov/v1/json"

def get_elevation(lat, lng):
    """Query USGS API for elevation at a specific point."""
    try:
        params = {
            'x': lng,
            'y': lat,
            'units': 'Meters',
            'output': 'json'
        }
        response = requests.get(USGS_API_URL, params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            elevation = data.get('value')
            if elevation and elevation != -1000000:  # -1000000 means no data
                return float(elevation)
        return None
    except Exception as e:
        print(f"Error getting elevation for {lat}, {lng}: {e}")
        return None

def generate_elevation_grid():
    """Generate detailed elevation grid for Michigan."""
    print("Generating detailed Michigan elevation grid...")
    print(f"Resolution: {GRID_RESOLUTION} degrees (~{GRID_RESOLUTION * 111:.1f}km)")
    
    elevation_grid = {}
    total_points = 0
    successful_points = 0
    
    # Sample at 0.01 degree intervals
    lat = MIN_LAT
    while lat <= MAX_LAT:
        lat_key = f"{lat:.2f}"
        elevation_grid[lat_key] = {}
        
        lng = MIN_LNG
        while lng <= MAX_LNG:
            lng_key = f"{lng:.2f}"
            
            # Get elevation from USGS API
            elev = get_elevation(lat, lng)
            
            if elev is not None:
                elevation_grid[lat_key][lng_key] = round(elev, 1)
                successful_points += 1
            
            total_points += 1
            
            # Progress indicator
            if total_points % 100 == 0:
                print(f"Sampled {total_points} points ({successful_points} with data)...")
            
            # Rate limiting - be nice to USGS servers
            time.sleep(0.1)  # 100ms delay between requests
            
            lng += GRID_RESOLUTION
        
        lat += GRID_RESOLUTION
    
    print(f"\nCompleted! {successful_points}/{total_points} points have elevation data")
    
    # Create output JSON
    output = {
        "metadata": {
            "source": "USGS Elevation Point Query Service (EPQS)",
            "description": "Michigan elevation data grid for topological visualization",
            "units": "meters",
            "resolution": f"{GRID_RESOLUTION} degrees (~{GRID_RESOLUTION * 111:.1f}km)",
            "datum": "NAVD88",
            "bounds": {
                "minLat": MIN_LAT,
                "maxLat": MAX_LAT,
                "minLng": MIN_LNG,
                "maxLng": MAX_LNG
            },
            "generated": "2025-11-27"
        },
        "elevationGrid": elevation_grid
    }
    
    # Save to file
    output_file = "src/data/michiganElevationDetailed.json"
    with open(output_file, 'w') as f:
        json.dump(output, f, indent=2)
    
    print(f"Saved to {output_file}")
    print(f"File size: {len(json.dumps(output)) / 1024:.1f} KB")

if __name__ == "__main__":
    print("=" * 60)
    print("Michigan Detailed Elevation Data Generator")
    print("=" * 60)
    print("\nWARNING: This will make thousands of API requests to USGS.")
    print("It may take 30-60 minutes to complete due to rate limiting.")
    print("\nPress Ctrl+C to cancel, or wait 5 seconds to continue...")
    
    try:
        time.sleep(5)
        generate_elevation_grid()
    except KeyboardInterrupt:
        print("\n\nCancelled by user.")
