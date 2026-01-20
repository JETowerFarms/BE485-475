import requests
import json

# Test the solar analysis with proximity calculations
base_url = 'http://localhost:3001/api'

# Test point in Michigan (somewhere near Detroit area)
test_lat = 42.3314
test_lng = -83.0458

print(f'Testing solar analysis at ({test_lat}, {test_lng})')

# Test the point analysis endpoint
try:
    response = requests.get(f'{base_url}/solar/point/{test_lat}/{test_lng}')
    if response.status_code == 200:
        result = response.json()
        print('Point analysis successful!')
        print(f'Solar suitability score: {result.get("solar_suitability", "N/A")}')

        # Check if proximity data is included
        if 'proximity' in result:
            print('Proximity data found:')
            proximity = result['proximity']
            for key, value in proximity.items():
                print(f'  {key}: {value}')
        else:
            print('No proximity data in response')

    else:
        print(f'Point analysis failed: {response.status_code}')
        print(response.text)

except Exception as e:
    print(f'Error testing point analysis: {e}')

# Test polygon analysis with a small square
print('\nTesting polygon analysis...')
polygon_coords = [
    [test_lng - 0.01, test_lat - 0.01],
    [test_lng + 0.01, test_lat - 0.01],
    [test_lng + 0.01, test_lat + 0.01],
    [test_lng - 0.01, test_lat + 0.01],
    [test_lng - 0.01, test_lat - 0.01]  # Close the polygon
]

try:
    response = requests.post(f'{base_url}/farms/polygon',
                           json={'coordinates': polygon_coords},
                           headers={'Content-Type': 'application/json'})

    if response.status_code == 200:
        result = response.json()
        print('Polygon analysis successful!')
        print(f'Analysis result: {result}')
    else:
        print(f'Polygon analysis failed: {response.status_code}')
        print(response.text)

except Exception as e:
    print(f'Error testing polygon analysis: {e}')