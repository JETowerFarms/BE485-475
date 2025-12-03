"""
Generate 30x30 subdivided solar suitability grid from existing 0.02° grid.
Creates 900 interpolated points per original cell using bilinear interpolation.
Output: ~120.6 million data points at 0.000667° spacing (~0.96 acres per cell)
Uses parallel processing and streaming writes to optimize performance.
"""

import json
import sys
from pathlib import Path
from multiprocessing import Pool, cpu_count, Manager
import threading
import time
from datetime import datetime

def interpolate_with_fallback(corners, tx, ty):
    """
    Hierarchical interpolation with graceful degradation.
    Uses maximum available information from corners.
    
    Priority 1: BILINEAR (4 corners) - Full 2D interpolation
    Priority 2: LINEAR (2-3 corners) - 1D interpolation along available axis
    Priority 3: CONSTANT (1 corner) - Copy single available value
    Priority 4: SKIP (0 corners) - No data available
    
    Args:
        corners: dict with keys 'c00', 'c10', 'c01', 'c11' (values may be None)
        tx, ty: normalized coordinates [0, 1] within the cell
    
    Returns:
        dict with interpolated field values or None if no data
    """
    c00, c10, c01, c11 = corners['c00'], corners['c10'], corners['c01'], corners['c11']
    available = [c for c in [c00, c10, c01, c11] if c is not None]
    
    if len(available) == 0:
        return None  # No data - skip this point
    
    fields = ['overall', 'land_cover', 'slope', 'transmission', 'population']
    result = {}
    
    # PRIORITY 1: BILINEAR - All 4 corners available
    if c00 and c10 and c01 and c11:
        for field in fields:
            v00 = c00.get(field, 0)
            v10 = c10.get(field, 0)
            v01 = c01.get(field, 0)
            v11 = c11.get(field, 0)
            
            # Bilinear interpolation formula
            value = (v00 * (1 - tx) * (1 - ty) +
                     v10 * tx * (1 - ty) +
                     v01 * (1 - tx) * ty +
                     v11 * tx * ty)
            
            result[field] = round(value, 2)
        return result
    
    # PRIORITY 2: LINEAR - 2 or 3 corners available
    if len(available) >= 2:
        # Case A: Horizontal edge interpolation (bottom or top edge)
        if c00 and c10:  # Bottom edge
            for field in fields:
                v00 = c00.get(field, 0)
                v10 = c10.get(field, 0)
                value = v00 * (1 - tx) + v10 * tx
                result[field] = round(value, 2)
            return result
        
        if c01 and c11:  # Top edge
            for field in fields:
                v01 = c01.get(field, 0)
                v11 = c11.get(field, 0)
                value = v01 * (1 - tx) + v11 * tx
                result[field] = round(value, 2)
            return result
        
        # Case B: Vertical edge interpolation (left or right edge)
        if c00 and c01:  # Left edge
            for field in fields:
                v00 = c00.get(field, 0)
                v01 = c01.get(field, 0)
                value = v00 * (1 - ty) + v01 * ty
                result[field] = round(value, 2)
            return result
        
        if c10 and c11:  # Right edge
            for field in fields:
                v10 = c10.get(field, 0)
                v11 = c11.get(field, 0)
                value = v10 * (1 - ty) + v11 * ty
                result[field] = round(value, 2)
            return result
        
        # Case C: Diagonal or 3 corners - use closest 2 corners
        # For 3 corners, pick the 2 closest to interpolation point
        if c00 and c11:  # Diagonal corners
            # Use weighted average based on distance
            w00 = (1 - tx) * (1 - ty)
            w11 = tx * ty
            total_w = w00 + w11
            for field in fields:
                v00 = c00.get(field, 0)
                v11 = c11.get(field, 0)
                value = (v00 * w00 + v11 * w11) / total_w
                result[field] = round(value, 2)
            return result
        
        if c01 and c10:  # Other diagonal
            w01 = (1 - tx) * ty
            w10 = tx * (1 - ty)
            total_w = w01 + w10
            for field in fields:
                v01 = c01.get(field, 0)
                v10 = c10.get(field, 0)
                value = (v01 * w01 + v10 * w10) / total_w
                result[field] = round(value, 2)
            return result
    
    # PRIORITY 3: CONSTANT - Only 1 corner available
    if len(available) == 1:
        corner = available[0]
        for field in fields:
            result[field] = corner.get(field, 0)
        return result
    
    return None


def load_source_data():
    """Load the original solar suitability grid"""
    print("Loading source data...")
    with open('src/data/michiganSolarSuitability.json', 'r') as f:
        data = json.load(f)
    
    # Get sorted keys
    lat_keys = sorted([float(k) for k in data.keys()])
    
    print(f"Loaded {len(lat_keys)} latitude keys")
    print(f"Latitude range: {min(lat_keys):.2f} to {max(lat_keys):.2f}")
    
    return data, lat_keys


def process_cell_batch(args):
    """
    Process a batch of cells in parallel.
    This function is called by worker processes.
    """
    cell_batch, solarSuitabilityData, SUBDIVISIONS, ORIGINAL_SPACING, worker_id, progress_dict = args
    
    # Update worker status
    progress_dict[worker_id] = {
        'status': 'processing',
        'cells_total': len(cell_batch),
        'cells_done': 0,
        'points': 0,
        'last_update': time.time()
    }
    
    batch_results = {}
    cells_processed = 0
    
    for cell_info in cell_batch:
        lat_lower, lat_upper, lng_lower, lng_upper = cell_info
        
        lat_lower_key = f"{lat_lower:.2f}"
        lat_upper_key = f"{lat_upper:.2f}"
        lng_lower_key = f"{lng_lower:.2f}"
        lng_upper_key = f"{lng_upper:.2f}"
        
        # Get corner data
        lat_lower_data = solarSuitabilityData.get(lat_lower_key, {})
        lat_upper_data = solarSuitabilityData.get(lat_upper_key, {})
        
        c00 = lat_lower_data.get(lng_lower_key)
        c01 = lat_lower_data.get(lng_upper_key)
        c10 = lat_upper_data.get(lng_lower_key)
        c11 = lat_upper_data.get(lng_upper_key)
        
        # Count available corners
        available_corners = sum([1 for c in [c00, c01, c10, c11] if c is not None])
        if available_corners == 0:
            continue
        
        # Generate 30x30 grid within this cell
        for sub_i in range(SUBDIVISIONS):
            for sub_j in range(SUBDIVISIONS):
                ty = sub_i / SUBDIVISIONS
                tx = sub_j / SUBDIVISIONS
                
                new_lat = lat_lower + ty * ORIGINAL_SPACING
                new_lng = lng_lower + tx * ORIGINAL_SPACING
                
                corners = {'c00': c00, 'c10': c10, 'c01': c01, 'c11': c11}
                interpolated = interpolate_with_fallback(corners, tx, ty)
                
                if interpolated is None:
                    continue
                
                lat_key = f"{new_lat:.6f}"
                lng_key = f"{new_lng:.6f}"
                
                if lat_key not in batch_results:
                    batch_results[lat_key] = {}
                
                batch_results[lat_key][lng_key] = interpolated
        
        cells_processed += 1
        
        # Update progress every 100 cells
        if cells_processed % 100 == 0:
            points_count = sum(len(lng_data) for lng_data in batch_results.values())
            progress_dict[worker_id] = {
                'status': 'processing',
                'cells_total': len(cell_batch),
                'cells_done': cells_processed,
                'points': points_count,
                'last_update': time.time()
            }
    
    # Final update
    points_count = sum(len(lng_data) for lng_data in batch_results.values())
    progress_dict[worker_id] = {
        'status': 'complete',
        'cells_total': len(cell_batch),
        'cells_done': cells_processed,
        'points': points_count,
        'last_update': time.time()
    }
    
    return batch_results


def print_progress_table(progress_dict, batch_info):
    """Print a real-time progress table for all workers"""
    # Clear screen (works in most terminals)
    print("\033[2J\033[H", end='')
    
    print("="*100)
    print("SOLAR SUITABILITY 30x30 GRID GENERATION - WORKER STATUS")
    print("="*100)
    print(f"Batch {batch_info['current']}/{batch_info['total']} | "
          f"Total Progress: {batch_info['cells_done']:,}/{batch_info['cells_total']:,} cells | "
          f"Points: {batch_info['points_total']:,}")
    print("="*100)
    
    # Table header
    print(f"{'Worker':<8} {'Status':<12} {'Cells':<20} {'Points':<15} {'Last Update':<15}")
    print("-"*100)
    
    # Worker rows
    for worker_id in sorted(progress_dict.keys()):
        info = progress_dict[worker_id]
        status = info.get('status', 'idle')
        cells_done = info.get('cells_done', 0)
        cells_total = info.get('cells_total', 0)
        points = info.get('points', 0)
        last_update = info.get('last_update', 0)
        
        # Calculate time since last update
        if last_update > 0:
            elapsed = time.time() - last_update
            time_str = f"{elapsed:.1f}s ago"
        else:
            time_str = "N/A"
        
        # Progress bar
        if cells_total > 0:
            pct = (cells_done / cells_total) * 100
            cells_str = f"{cells_done:,}/{cells_total:,} ({pct:.1f}%)"
        else:
            cells_str = "0/0"
        
        print(f"Worker {worker_id:<2} {status:<12} {cells_str:<20} {points:>12,}   {time_str:<15}")
    
    print("="*100)
    print()


def generate_subdivided_grid():
    """Generate 30x30 subdivided grid with parallel processing and streaming writes"""
    
    data, lat_keys = load_source_data()
    
    SUBDIVISIONS = 30
    ORIGINAL_SPACING = 0.02
    NEW_SPACING = ORIGINAL_SPACING / SUBDIVISIONS
    BATCH_SIZE = 20000  # Cells per batch
    NUM_WORKERS = 10  # Use 10 cores (leave 2 for system/file I/O)
    
    print(f"\nGenerating {SUBDIVISIONS}x{SUBDIVISIONS} subdivision...")
    print(f"Original spacing: {ORIGINAL_SPACING}°")
    print(f"New spacing: {NEW_SPACING:.6f}°")
    print(f"Cell size: ~0.96 acres")
    print(f"Batch size: {BATCH_SIZE} cells per batch")
    print(f"Parallel workers: {NUM_WORKERS}")
    print("\nStarting processing...")
    time.sleep(2)
    
    total_points = 0
    processed_cells = 0
    batch_count = 0
    output_file = Path('src/data') / 'michiganSolarSuitability_30x30.json'
    
    # Initialize output file
    with open(output_file, 'w') as f:
        f.write('{\n')
    
    # Build list of all cells to process
    all_cells = []
    for i in range(len(lat_keys) - 1):
        lat_lower = lat_keys[i]
        lat_upper = lat_keys[i + 1]
        
        lat_lower_key = f"{lat_lower:.2f}"
        lat_lower_data = data[lat_lower_key]
        lng_keys = sorted([float(k) for k in lat_lower_data.keys()])
        
        for j in range(len(lng_keys) - 1):
            lng_lower = lng_keys[j]
            lng_upper = lng_keys[j + 1]
            all_cells.append((lat_lower, lat_upper, lng_lower, lng_upper))
    
    print(f"Total cells to process: {len(all_cells)}")
    
    # Create shared progress dictionary
    with Manager() as manager:
        progress_dict = manager.dict()
        
        # Initialize all workers as idle
        for i in range(NUM_WORKERS):
            progress_dict[i] = {'status': 'idle', 'cells_total': 0, 'cells_done': 0, 'points': 0, 'last_update': 0}
        
        # Start progress monitoring thread
        stop_monitoring = threading.Event()
        
        def monitor_progress():
            while not stop_monitoring.is_set():
                batch_info = {
                    'current': batch_count,
                    'total': (len(all_cells) + BATCH_SIZE - 1) // BATCH_SIZE,
                    'cells_done': processed_cells,
                    'cells_total': len(all_cells),
                    'points_total': total_points
                }
                print_progress_table(dict(progress_dict), batch_info)
                time.sleep(2)  # Update every 2 seconds
        
        monitor_thread = threading.Thread(target=monitor_progress, daemon=True)
        monitor_thread.start()
        
        # Process cells in batches using parallel workers
        with Pool(processes=NUM_WORKERS) as pool:
            for batch_start in range(0, len(all_cells), BATCH_SIZE):
                batch_end = min(batch_start + BATCH_SIZE, len(all_cells))
                
                # Split batch among workers
                cells_per_worker = (batch_end - batch_start + NUM_WORKERS - 1) // NUM_WORKERS
                async_results = []
                
                for worker_id in range(NUM_WORKERS):
                    worker_start = batch_start + worker_id * cells_per_worker
                    worker_end = min(worker_start + cells_per_worker, batch_end)
                    
                    if worker_start >= worker_end:
                        break
                    
                    cell_batch = all_cells[worker_start:worker_end]
                    worker_args = (cell_batch, data, SUBDIVISIONS, ORIGINAL_SPACING, worker_id, progress_dict)
                    
                    result = pool.apply_async(process_cell_batch, (worker_args,))
                    async_results.append(result)
                
                # Collect results from all workers
                subdivided_grid = {}
                for result in async_results:
                    worker_results = result.get()
                    # Merge worker results
                    for lat_key, lng_data in worker_results.items():
                        if lat_key not in subdivided_grid:
                            subdivided_grid[lat_key] = {}
                        subdivided_grid[lat_key].update(lng_data)
                
                # Count points
                points_in_batch = sum(len(lng_data) for lng_data in subdivided_grid.values())
                total_points += points_in_batch
                processed_cells += (batch_end - batch_start)
                
                # Write batch
                write_batch(output_file, subdivided_grid, batch_count > 0)
                batch_count += 1
        
        # Stop monitoring
        stop_monitoring.set()
        monitor_thread.join(timeout=1)
    
    # Close JSON
    with open(output_file, 'a') as f:
        f.write('\n}')
    
    print(f"\n✓ Generated {total_points:,} interpolated points")
    print(f"✓ Processed {processed_cells} original cells")
    print(f"✓ Wrote {batch_count} batches")
    
    return total_points


def write_batch(output_file, batch_data, append_comma):
    """Append batch data to JSON file incrementally"""
    with open(output_file, 'a') as f:
        for i, (lat_key, lng_data) in enumerate(batch_data.items()):
            # Add comma before new entry if not first entry
            if append_comma or i > 0:
                f.write(',\n')
            
            # Write latitude key and its data
            f.write(f'"{lat_key}":{{')
            
            # Write longitude entries
            lng_items = list(lng_data.items())
            for j, (lng_key, values) in enumerate(lng_items):
                if j > 0:
                    f.write(',')
                
                # Write compact JSON for each point
                values_json = json.dumps(values, separators=(',', ':'))
                f.write(f'"{lng_key}":{values_json}')
            
            f.write('}')


def get_file_size(filename):
    """Get file size in MB"""
    output_path = Path('src/data') / filename
    if output_path.exists():
        file_size = output_path.stat().st_size / (1024 * 1024)
        return file_size
    return 0


if __name__ == '__main__':
    print("="*70)
    print("SOLAR SUITABILITY 30x30 GRID GENERATOR")
    print("STREAMING MODE - Batch writes to avoid RAM exhaustion")
    print("="*70)
    
    try:
        total_points = generate_subdivided_grid()
        file_size = get_file_size('michiganSolarSuitability_30x30.json')
        
        print("\n" + "="*70)
        print("GENERATION COMPLETE")
        print("="*70)
        print(f"Output file: src/data/michiganSolarSuitability_30x30.json")
        print(f"Total points: {total_points:,}")
        print(f"File size: {file_size:.1f} MB")
        print(f"Grid spacing: 0.000667°")
        print(f"Cell size: ~0.96 acres")
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
