import rasterio
with rasterio.open(r'C:/Users/money/AppData/Local/Temp/slope/LF2020_SlpD_220_CONUS/Tif/LC20_SlpD_220.tif') as src:
    print(f'Width: {src.width}, Height: {src.height}, CRS: {src.crs}')