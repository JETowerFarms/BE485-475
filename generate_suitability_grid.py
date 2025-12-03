"""
Generate simplified Michigan solar suitability data for the app.

Since raster processing requires GDAL which is complex to install,
this script creates a simplified grid-based dataset for Michigan
using the power plants as proxy substation locations.
"""

import json
import math
import os

# Michigan bounding box
MI_BOUNDS = {
    'min_lat': 41.7,
    'max_lat': 48.3,
    'min_lng': -90.5,
    'max_lng': -82.4
}

# Grid resolution (degrees) - about 1km at Michigan latitudes
GRID_RESOLUTION = 0.01  # ~1km

def load_facilities():
    """Load extracted Michigan facilities"""
    with open('src/data/michigan_facilities.json', 'r') as f:
        return json.load(f)

def distance_km(lat1, lon1, lat2, lon2):
    """Calculate distance between two points in kilometers"""
    R = 6371  # Earth radius in km
    
    dlat = math.radians(lat2 - lat1)
    dlon = math.radians(lon2 - lon1)
    
    a = (math.sin(dlat / 2) * math.sin(dlat / 2) +
         math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) *
         math.sin(dlon / 2) * math.sin(dlon / 2))
    
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c

def distance_miles(lat1, lon1, lat2, lon2):
    """Calculate distance between two points in miles"""
    return distance_km(lat1, lon1, lat2, lon2) * 0.621371

def calculate_substation_score(lat, lng, facilities):
    """Calculate distance to nearest substation score"""
    # Find nearest facility
    min_distance = float('inf')
    
    for facility in facilities:
        dist = distance_miles(lat, lng, facility['lat'], facility['lng'])
        if dist < min_distance:
            min_distance = dist
    
    # Score based on EGLE methodology
    if min_distance <= 1:
        return 100
    elif min_distance <= 5:
        return 90
    elif min_distance <= 10:
        return 75
    else:
        return 50

def estimate_land_cover_score(lat, lng):
    """Estimate land cover score based on location"""
    # This is a simplification - in reality we'd read from NLCD raster
    # For Michigan, most agricultural/rural land scores high (90)
    # Urban areas (Detroit, Grand Rapids, etc.) score lower
    
    # Detroit area
    if 42.2 < lat < 42.5 and -83.3 < lng < -82.9:
        return 50  # Mixed urban/developed
    # Grand Rapids area
    elif 42.8 < lat < 43.1 and -85.8 < lng < -85.5:
        return 50
    # Flint area
    elif 42.9 < lat < 43.1 and -83.8 < lng < -83.6:
        return 50
    # Lansing area
    elif 42.6 < lat < 42.8 and -84.7 < lng < -84.4:
        return 50
    # Great Lakes shorelines (often developed or forest)
    elif lat > 45 or lng < -86:
        return 65  # Northern forests/lakeshore
    else:
        return 90  # Agricultural land (most of Michigan)

def estimate_slope_score(lat, lng):
    """Estimate slope score based on location"""
    # Michigan is mostly flat, especially in agricultural areas
    # Upper Peninsula and northwest have more terrain
    
    # Upper Peninsula
    if lat > 46:
        return 75  # Some rolling terrain
    # Northwest Michigan
    elif lat > 44 and lng < -85:
        return 80
    # Rest of Michigan (mostly flat agricultural land)
    else:
        return 95  # Very flat, excellent for solar

def estimate_population_score(lat, lng):
    """Estimate population density score based on location"""
    # Detroit metro
    if 42.1 < lat < 42.6 and -83.5 < lng < -82.9:
        return 25  # High density
    # Grand Rapids metro
    elif 42.8 < lat < 43.1 and -85.8 < lng < -85.3:
        return 50
    # Flint/Lansing areas
    elif ((42.9 < lat < 43.1 and -83.8 < lng < -83.5) or
          (42.6 < lat < 42.8 and -84.7 < lng < -84.3)):
        return 50
    # Small cities (Ann Arbor, Kalamazoo, etc.)
    elif lat < 43 and lng > -86:
        return 75  # Moderate density
    # Rural areas (most of Michigan)
    else:
        return 100  # Low density, excellent

def calculate_suitability(lat, lng, facilities):
    """Calculate overall solar suitability score using EGLE methodology"""
    # Get individual scores
    land_cover = estimate_land_cover_score(lat, lng)
    slope = estimate_slope_score(lat, lng)
    substation = calculate_substation_score(lat, lng, facilities)
    population = estimate_population_score(lat, lng)
    
    # Apply EGLE weights: LandCover(4), Substation(3), Slope(2), Population(1)
    weighted_score = (
        land_cover * 4 +
        substation * 3 +
        slope * 2 +
        population * 1
    ) / 10.0
    
    return {
        'overall': round(weighted_score, 1),
        'land_cover': land_cover,
        'slope': slope,
        'substation': substation,
        'population': population
    }

def generate_grid():
    """Generate solar suitability grid for Michigan"""
    print("Loading facilities...")
    facilities = load_facilities()
    print(f"Loaded {len(facilities)} facilities")
    
    print("\nGenerating suitability grid...")
    suitability_grid = {}
    
    # Sample every 0.02 degrees (about 2km) for reasonable file size
    sample_resolution = 0.02
    
    lat = MI_BOUNDS['min_lat']
    count = 0
    
    while lat <= MI_BOUNDS['max_lat']:
        lng = MI_BOUNDS['min_lng']
        
        lat_key = f"{lat:.2f}"
        suitability_grid[lat_key] = {}
        
        while lng <= MI_BOUNDS['max_lng']:
            lng_key = f"{lng:.2f}"
            
            # Calculate suitability for this location
            scores = calculate_suitability(lat, lng, facilities)
            suitability_grid[lat_key][lng_key] = scores
            
            count += 1
            if count % 1000 == 0:
                print(f"  Processed {count} points...")
            
            lng += sample_resolution
        
        lat += sample_resolution
    
    print(f"\nGenerated {count} grid points")
    
    # Save grid
    print("Saving suitability grid...")
    with open('src/data/michiganSolarSuitability.json', 'w') as f:
        json.dump(suitability_grid, f, indent=2)
    
    print("Done!")
    
    # Print some statistics
    all_scores = []
    for lat_data in suitability_grid.values():
        for scores in lat_data.values():
            all_scores.append(scores['overall'])
    
    print(f"\nSuitability Statistics:")
    print(f"  Min: {min(all_scores):.1f}")
    print(f"  Max: {max(all_scores):.1f}")
    print(f"  Average: {sum(all_scores)/len(all_scores):.1f}")

if __name__ == '__main__':
    print("=" * 60)
    print("Michigan Solar Suitability Grid Generation")
    print("=" * 60)
    
    os.makedirs('src/data', exist_ok=True)
    generate_grid()
    
    print("\n" + "=" * 60)
    print("Grid generation complete!")
    print("File saved to: src/data/michiganSolarSuitability.json")
    print("=" * 60)
