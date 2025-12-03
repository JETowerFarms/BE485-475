import json

with open('src/data/michiganSolarSuitability.json', 'r') as f:
    data = json.load(f)

coords = [('44.02', '-82.98'), ('44.02', '-82.96'), ('44.02', '-82.94'), ('44.02', '-82.92'), ('44.02', '-82.90'), ('43.98', '-82.94')]

print('Values for coordinates being sampled:')
for lat_key, lng_key in coords:
    if lat_key in data and lng_key in data[lat_key]:
        details = data[lat_key][lng_key]
        print(f'  {lat_key}, {lng_key}: {details["overall"]} (land: {details["land_cover"]}, slope: {details["slope"]}, sub: {details["substation"]}, pop: {details["population"]})')
    else:
        print(f'  {lat_key}, {lng_key}: NOT FOUND')

print('\nChecking variation across different regions:')
test_coords = [('42.50', '-84.50'), ('42.30', '-83.00'), ('46.50', '-87.50')]
for lat_key, lng_key in test_coords:
    if lat_key in data and lng_key in data[lat_key]:
        details = data[lat_key][lng_key]
        print(f'  {lat_key}, {lng_key}: {details["overall"]} (land: {details["land_cover"]}, slope: {details["slope"]}, sub: {details["substation"]}, pop: {details["population"]})')
    else:
        print(f'  {lat_key}, {lng_key}: NOT FOUND')