# Import slope tiles into slope_raster table
# First tile creates the table, others append

$tilesDir = "o:\N\OptimizationTool\Datasets\slope_tiles"
$firstTile = "slope_tile_0_0.tif"
$otherTiles = Get-ChildItem "$tilesDir\slope_tile_*.tif" | Where-Object { $_.Name -ne $firstTile }

# Create table with first tile
Write-Host "Creating slope_raster table with first tile..."
& raster2pgsql -s 5070 -I -Y -t 10000x10000 "$tilesDir\$firstTile" slope_raster | & psql -h localhost -p 5432 -U postgres -d michigan_solar

# Append other tiles
foreach ($tile in $otherTiles) {
    Write-Host "Appending $($tile.Name)..."
    & raster2pgsql -a -t 10000x10000 $tile.FullName slope_raster | & psql -h localhost -p 5432 -U postgres -d michigan_solar
}

Write-Host "Slope raster import complete."