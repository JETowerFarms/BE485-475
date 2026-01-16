import rasterio
from rasterio.windows import Window
import os

input_path = r'C:/Users/money/AppData/Local/Temp/slope/LF2020_SlpD_220_CONUS/Tif/LC20_SlpD_220.tif'
output_dir = r'o:/N/OptimizationTool/Datasets/slope_tiles'

os.makedirs(output_dir, exist_ok=True)

tile_size = 10000

with rasterio.open(input_path) as src:
    width = src.width
    height = src.height
    crs = src.crs
    transform = src.transform
    
    for i in range(0, width, tile_size):
        for j in range(0, height, tile_size):
            window = Window(i, j, min(tile_size, width - i), min(tile_size, height - j))
            data = src.read(window=window)
            transform_window = src.window_transform(window)
            
            output_path = os.path.join(output_dir, f'slope_tile_{i}_{j}.tif')
            with rasterio.open(output_path, 'w', driver='GTiff', height=data.shape[1], width=data.shape[2], count=src.count, dtype=data.dtype, crs=crs, transform=transform_window) as dst:
                dst.write(data)
            
            print(f'Created {output_path}')