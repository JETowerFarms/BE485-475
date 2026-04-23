#!/usr/bin/env python3
"""Quick test: does optimize_land_allocation return annual_npv_table?"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from agrivoltaics_model import (
    EconomicParameters, SolarParameters, CropParameters,
    LeaseParameters, FarmerParameters, LandConstraints,
    compute_lease_rate, optimize_land_allocation
)

econ = EconomicParameters(
    discount_rate=0.08, inflation_rate=0.02,
    electricity_escalation=0.02, crop_escalation=0.0,
    project_life=27, developer_discount_rate=0.055,
    developer_tax_rate=0.257,
)

solar = SolarParameters(
    land_intensity_acres_per_MW=7.0, capacity_factor=0.18,
    degradation_rate=0.005, installed_cost_per_MW=1610000.0,
    site_prep_cost_per_acre=36800.0, grading_cost_per_acre=8286.0,
    retiling_cost_per_acre=950.0, interconnection_fraction=0.3,
    bond_cost_per_acre=10000.0, vegetation_cost_per_acre=225.0,
    insurance_cost_per_acre=100.0, oandm_cost_per_kw=11.0,
    replacement_cost_per_MW=100000.0, replacement_year=14,
    decommission_cost_per_kw=400.0, remediation_cost_per_acre=2580.0,
    salvage_value_per_acre=12500.0, itc_rate=0.30,
    electricity_price_0=0.10,
)

crop = CropParameters(
    name='Soybeans', yield_per_acre=50.0,
    price_per_unit_0=11.0, unit='bushel',
    cost_per_acre=400.0,
)

lease = LeaseParameters(escalation_rate=0.0)
farmer = FarmerParameters()
constraints = LandConstraints(total_land=100.0, min_ag_fraction=0.51, setback_fraction=0.10)

L = compute_lease_rate(solar, econ, lease)
result = optimize_land_allocation(solar, econ, [crop], lease, farmer, constraints, L)

print("Keys in result:", sorted(result.keys()))
print()
if 'annual_npv_table' in result:
    table = result['annual_npv_table']
    print(f"annual_npv_table: {len(table)} rows")
    print(f"First row: {table[0]}")
    print(f"Last row: {table[-1]}")
else:
    print("ERROR: annual_npv_table NOT in result!")
    print("All keys:", list(result.keys()))
