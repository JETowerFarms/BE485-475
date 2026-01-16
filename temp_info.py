import rasterio
with rasterio.open(r'C:/Users/money/AppData/Local/Temp/nlcd/Annual_NLCD_LndCov_2024_CU_C1V1.tif') as src:
    print(f'Width: {src.width}, Height: {src.height}, CRS: {src.crs}')