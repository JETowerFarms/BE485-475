import rasterio

# Check GPW population raster dimensions and CRS
with rasterio.open('o:/N/OptimizationTool/Datasets/gpw_unzipped/gpw_v4_population_density_rev11_2020_1_deg.tif') as src:
    print(f"Width: {src.width}")
    print(f"Height: {src.height}")
    print(f"CRS: {src.crs}")
    print(f"Bounds: {src.bounds}")
    print(f"Pixel size: {src.res}")