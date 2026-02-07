"""
Agrivoltaics optimization model for Michigan (FULL‑DEV only)

This script implements a simplified version of the linear optimization framework
described in the updated agrivoltaics model outline for Michigan.  The goal is
to identify how many acres of land should be devoted to solar generation
(agrivoltaics) and how many should remain in traditional row crop production.
Where possible, numerical inputs are tied to publicly available data.  Key
assumptions, citations and calculations appear inline as comments.

Two stages are represented:

1.  **Lease rate derivation** –  Under the full development (FULL‑DEV) approach
    there is no scenario in which the developer receives lease revenue without
    constructing solar.  The maximum per‑acre solar lease rate (``L_solar``)
    consistent with non‑negative project economics is computed by first
    evaluating the net present value (NPV) of the solar project absent any
    lease payments and then dividing that value by the present value of a
    dollar‐per‐acre lease stream over the project life.  If the derived rate
    falls below the developer’s lower bound (``L_min``) or exceeds the upper
    bound (``L_max``) then the bound applies.  This stage corresponds to
    Section 6.1 of the specification.

2.  **Land‑allocation optimization** –  With ``L_solar`` fixed at the value
    obtained in stage 1, we solve a linear program that allocates a total
    available land area between solar and crop production.  The objective is
    to maximize the combined present value (PV) of net cashflows from both
    activities while respecting land availability, farmland preservation
    requirements, and a cap on solar development on prime soils.  This
    represents Section 6.2 and the competition problem of the specification.

The model is intentionally limited to a single representative crop (soybeans)
and a single solar configuration (fixed‑tilt), but the underlying
formulations can be generalized to additional crops, configurations and
constraints without fundamental changes.

Dependencies:

* Python ≥3.9
* NumPy (for array operations)
* SciPy (linear programming solver)

The script can be executed directly: ``python agrivoltaics_model.py``.  It
prints the assumed parameters, intermediate calculations, the derived lease
rate and the optimal land allocation together with associated financial
metrics.
"""

from dataclasses import dataclass, asdict
from typing import List, Tuple, Optional, Dict, Any

import numpy as np
from scipy.optimize import linprog
import json


@dataclass
class EconomicParameters:
    """Global economic and escalation parameters."""
    discount_rate: float  # annual discount rate (real)
    inflation_rate: float  # annual inflation rate (ignored for real calculations)
    electricity_escalation: float  # annual escalation rate for electricity price
    crop_escalation: float  # annual escalation rate for crop price
    project_life: int  # project lifetime in years (27 = 2 construction + 25 operating)

    @property
    def discount_factors(self) -> np.ndarray:
        """Return a vector of discount factors 1/(1+r)^t for t=0..T."""
        T = self.project_life
        r = self.discount_rate
        return np.array([1 / ((1 + r) ** t) for t in range(T + 1)])


@dataclass
class LeaseParameters:
    """Solar lease assumptions and bounds."""
    min_rate: Optional[float] = None  # $/acre-yr (optional lower bound)
    max_rate: Optional[float] = None  # $/acre-yr (optional upper bound)
    escalation_rate: float = 0.0  # real escalation for lease, per year

    def pv_factor(self, econ: EconomicParameters) -> float:
        """Present value factor for a $1/acre-yr lease from t=1..T."""
        df = econ.discount_factors
        return float(sum(df[t] * ((1 + self.escalation_rate) ** t) for t in range(1, econ.project_life + 1)))


@dataclass
class SolarParameters:
    """Parameters specific to the solar installation."""
    land_intensity_acres_per_MW: float  # α_ac/MW (acres per MWac)
    capacity_factor: float  # average capacity factor (fraction)
    degradation_rate: float  # annual degradation rate (fraction)
    installed_cost_per_MW: float  # $/MWac (overnight cost)
    site_prep_cost_per_acre: float  # $/acre
    grading_cost_per_acre: float  # $/acre
    retilling_cost_per_acre: float  # $/acre (field retilling for solar installation)
    interconnection_fraction: float  # fraction of installed cost used for upgrades
    bond_cost_per_acre: float  # $/acre (decommissioning assurance)
    vegetation_cost_per_acre: float  # $/acre-yr
    insurance_cost_per_acre: float  # $/acre-yr
    oandm_cost_per_kw: float  # $/kWac-yr
    replacement_cost_per_MW: float  # $/MWac (inverter replacement)
    replacement_year: int  # year of inverter replacement
    decommission_cost_per_kw: float  # $/kWac
    remediation_cost_per_acre: float  # $/acre
    salvage_value_per_acre: float  # $/acre (positive means salvage credit)
    itc_rate: float  # fraction of CAPEX offset via ITC (50% means 0.5)
    electricity_price_0: float  # $/kWh initial electricity sell price
    availability_factor: float = 1.0  # fraction of uptime (availability)
    curtailment_factor: float = 1.0  # fraction not curtailed
    export_factor: float = 1.0  # fraction exportable to grid

    @property
    def energy_per_MW_year(self) -> float:
        """Annual energy production per MWac in kWh for the first year."""
        # 8760 hours/year × capacity factor × 1000 kW/MW
        return 8760 * self.capacity_factor * 1000

    def net_energy(self, t: int) -> float:
        """Net energy in year t (kWh per MW) accounting for degradation and derates."""
        derate = self.availability_factor * self.curtailment_factor * self.export_factor
        return self.energy_per_MW_year * ((1 - self.degradation_rate) ** t) * derate

    def price_electricity(self, t: int, econ: EconomicParameters) -> float:
        """Electricity price ($/kWh) in year t."""
        return self.electricity_price_0 * ((1 + econ.electricity_escalation) ** t)

    def capex_per_acre(self) -> float:
        """Compute the upfront CAPEX per acre (year 0)."""
        # Convert installed cost per MW to per acre using α
        # Include interconnection fraction on the construction portion
        const_per_acre = self.installed_cost_per_MW / self.land_intensity_acres_per_MW
        inter_upgrade = self.interconnection_fraction * const_per_acre
        return (const_per_acre + self.site_prep_cost_per_acre +
                self.grading_cost_per_acre + self.retilling_cost_per_acre +
                self.bond_cost_per_acre + inter_upgrade)

    def opex_per_acre(self) -> float:
        """Compute the annual OPEX per acre (excluding lease)."""
        # O&M per kWac × 1000 / α + vegetation + insurance
        oandm_per_acre = self.oandm_cost_per_kw * 1000 / self.land_intensity_acres_per_MW
        return oandm_per_acre + self.vegetation_cost_per_acre + self.insurance_cost_per_acre

    def replacement_cost_per_acre(self) -> float:
        """Inverter replacement cost per acre at the specified replacement year."""
        return self.replacement_cost_per_MW / self.land_intensity_acres_per_MW

    def decommission_cost_per_acre(self) -> float:
        """Decommissioning cost (minus salvage) per acre at end of life."""
        decom = self.decommission_cost_per_kw * 1000 / self.land_intensity_acres_per_MW
        # Add remediation cost and subtract salvage value
        return decom + self.remediation_cost_per_acre - self.salvage_value_per_acre


def create_solar_parameters_from_pvwatts(pvwatts_response: Dict[str, Any], base_solar_params: Dict[str, Any]) -> SolarParameters:
    """
    Create SolarParameters instance using data from PVWatts API response.

    Args:
        pvwatts_response: The JSON response from PVWatts API
        base_solar_params: Base solar parameters dict (excluding capacity_factor which comes from PVWatts)

    Returns:
        SolarParameters instance with capacity_factor updated from PVWatts
    """
    if 'outputs' not in pvwatts_response:
        raise ValueError("Invalid PVWatts response: missing 'outputs' field")

    outputs = pvwatts_response['outputs']

    # Extract capacity factor from PVWatts (convert from percentage to fraction)
    capacity_factor_pct = outputs.get('capacity_factor')
    if capacity_factor_pct is None:
        raise ValueError("PVWatts response missing capacity_factor")

    # Convert percentage to fraction (e.g., 20.5% -> 0.205)
    capacity_factor = capacity_factor_pct / 100.0

    # Create SolarParameters with capacity_factor from PVWatts
    solar_params = base_solar_params.copy()
    solar_params['capacity_factor'] = capacity_factor

    return SolarParameters(**solar_params)


@dataclass
class CropParameters:
    """Parameters specific to a crop."""
    name: str
    yield_per_acre: float  # yield in appropriate units per acre
    price_per_unit_0: float  # price at t=0 ($ per unit)
    unit: str  # unit for price (e.g., 'bushel', 'ton', 'cwt', 'lb')
    cost_per_acre: float  # annual operating cost ($/acre-yr), includes rent
    escalation_rate: float = 0.0  # annual escalation rate for crop price

    def price_crop(self, t: int, econ: EconomicParameters) -> float:
        """Crop price in year t."""
        return self.price_per_unit_0 * ((1 + self.escalation_rate) ** t)


@dataclass
class LandConstraints:
    """Land, permitting, and interconnection constraints."""
    total_land: float
    min_ag_fraction: float
    max_prime_solar: Optional[float] = None
    zoning_max_solar: Optional[float] = None
    setback_fraction: float = 0.0
    easement_acres: float = 0.0
    wetland_exclusion_acres: float = 0.0
    interconnect_capacity_mw: Optional[float] = None

    def usable_land(self) -> float:
        usable = self.total_land * (1 - self.setback_fraction) - self.easement_acres - self.wetland_exclusion_acres
        return max(0.0, usable)


@dataclass
class FarmerParameters:
    """Farmer-side financial additions (e.g., PA 116 credit)."""
    pa116_credit_per_acre: float = 0.0  # $/acre-yr (if applicable)


def present_value_stream(values: List[float], econ: EconomicParameters) -> float:
    """Compute the present value of a stream of values given EconomicParameters."""
    df = econ.discount_factors
    if len(values) != len(df):
        raise ValueError("Length of values must equal project life + 1")
    return float(sum(v * d for v, d in zip(values, df)))


def compute_solar_pv_no_lease(solar: SolarParameters, econ: EconomicParameters) -> Tuple[float, float, float]:
    """Return (pv_revenue, pv_cost, pv_net) per acre for solar without lease."""
    T = econ.project_life
    df = econ.discount_factors

    revenues = [0.0] * (T + 1)
    costs = [0.0] * (T + 1)

    # Construction costs in years 0 and 1 (no ITC applied yet)
    capex_per_year = solar.capex_per_acre() / 2  # Split construction costs over 2 years
    costs[0] = capex_per_year
    costs[1] = capex_per_year

    # ITC benefit applied at year 2 (placed in service)
    itc_benefit = solar.capex_per_acre() * solar.itc_rate
    revenues[2] = itc_benefit  # ITC treated as a revenue inflow

    opex = solar.opex_per_acre()
    for t in range(2, T + 1):  # Operating expenses start from year 2
        energy = solar.net_energy(t) / solar.land_intensity_acres_per_MW
        price = solar.price_electricity(t, econ)
        revenues[t] += energy * price
        costs[t] = opex

    if 0 < solar.replacement_year <= T:
        costs[solar.replacement_year] += solar.replacement_cost_per_acre()

    costs[T] += solar.decommission_cost_per_acre()

    pv_revenue = float(sum(revenues[t] * df[t] for t in range(T + 1)))
    pv_cost = float(sum(costs[t] * df[t] for t in range(T + 1)))
    pv_net = pv_revenue - pv_cost
    return pv_revenue, pv_cost, pv_net


def compute_lease_rate(solar: SolarParameters, econ: EconomicParameters, lease: LeaseParameters) -> float:
    """
    Determine the solar lease rate ($ per acre-year) that keeps developer NPV ≥ 12% of pre-lease NPV.
    The developer must retain at least 12% of the project's economic value after lease payments.
    Bounds are optional and can be None.
    """
    _, _, pv_net_no_lease = compute_solar_pv_no_lease(solar, econ)
    pv_factor_lease = lease.pv_factor(econ)
    if pv_factor_lease == 0:
        raise ValueError("Discount factor sum is zero; check discount rate and project life.")

    # Developer retention constraint: retain at least 12% of pre-lease NPV
    # Maximum lease PV that can be extracted: 88% of pre-lease NPV
    max_lease_pv = 0.88 * pv_net_no_lease
    derived_L = max_lease_pv / pv_factor_lease if pv_net_no_lease > 0 else 0.0

    # Apply optional bounds
    L_star = derived_L
    if lease.min_rate is not None:
        L_star = max(lease.min_rate, L_star)
    if lease.max_rate is not None:
        L_star = min(lease.max_rate, L_star)

    return L_star


def compute_crop_pv_per_acre(crop: CropParameters, econ: EconomicParameters, farmer: FarmerParameters) -> float:
    """Present value of net crop margin per acre over project life."""
    T = econ.project_life
    df = econ.discount_factors
    pv = 0.0
    for t in range(1, T + 1):
        price = crop.price_crop(t, econ)
        revenue = crop.yield_per_acre * price
        net = revenue - crop.cost_per_acre + farmer.pa116_credit_per_acre
        pv += net * df[t]
    return float(pv)


def optimize_land_allocation(
    solar: SolarParameters,
    econ: EconomicParameters,
    crops: List[CropParameters],
    lease: LeaseParameters,
    farmer: FarmerParameters,
    constraints: LandConstraints,
    L_solar: float,
) -> dict:
    """
    Solve the land allocation linear program using SciPy's linprog solver.  The
    objective is to maximize farmer NPV (lease + crop net income) given the
    derived lease rate and subject to land availability and permitting/
    preservation constraints.

    The optimisation problem is:

        maximize    z = pv_lease * A_s + sum_j pv_crop_j * A_cj
        subject to  A_s ≤ usable_land (solar limited by setbacks)
                sum_j A_cj ≤ crop_land (crops not limited by setbacks)
                sum_j A_cj ≥ min_ag_fraction * total_land
                A_s ≤ max_solar
                A_s + sum_j A_cj ≤ crop_land (coupling constraint)
                A_s ≥ 0,
                A_cj ≥ 0.

    SciPy's linprog minimises c^T x, so we minimise -z.
    """
    pv_factor_lease = lease.pv_factor(econ)
    pv_lease_per_acre = L_solar * pv_factor_lease

    pv_crop_per_acre = [compute_crop_pv_per_acre(crop, econ, farmer) for crop in crops]

    # Objective coefficients (minimisation): minimise -[pv_lease, pv_crop_1..J]
    c = np.array([-pv_lease_per_acre] + [-pv for pv in pv_crop_per_acre], dtype=float)

    # Inequality constraints A_ub x ≤ b_ub
    A_ub = []
    b_ub = []

    usable_land = constraints.usable_land()  # Land available for solar (includes setbacks)
    crop_land = constraints.total_land - constraints.easement_acres - constraints.wetland_exclusion_acres  # Land available for crops (no setbacks)

    # 1) A_s ≤ usable_land (solar limited by setbacks)
    A_ub.append([1.0] + [0.0] * len(crops))
    b_ub.append(usable_land)

    # 2) sum A_cj ≤ crop_land (crops can use land without setback restrictions)
    A_ub.append([0.0] + [1.0] * len(crops))
    b_ub.append(crop_land)

    # 3) -sum A_cj ≤ -min_ag_fraction * total_land (ensure minimum agriculture)
    A_ub.append([0.0] + [-1.0] * len(crops))
    b_ub.append(-constraints.min_ag_fraction * constraints.total_land)

    # 4) A_s ≤ max_solar (prime cap, zoning cap, interconnect cap, usable land)
    max_solar_candidates = [usable_land]
    if constraints.max_prime_solar is not None:
        max_solar_candidates.append(constraints.max_prime_solar)
    if constraints.zoning_max_solar is not None:
        max_solar_candidates.append(constraints.zoning_max_solar)
    if constraints.interconnect_capacity_mw is not None:
        max_solar_candidates.append(constraints.interconnect_capacity_mw * solar.land_intensity_acres_per_MW)
    max_solar = min(max_solar_candidates)

    A_ub.append([1.0] + [0.0] * len(crops))
    b_ub.append(max_solar)

    # 5) A_s + sum A_cj ≤ crop_land (coupling — no double-counting land)
    A_ub.append([1.0] + [1.0] * len(crops))
    b_ub.append(crop_land)

    # 6) -(A_s + sum A_cj) ≤ -crop_land  (all land is in use — farmer is already farming)
    A_ub.append([-1.0] + [-1.0] * len(crops))
    b_ub.append(-crop_land)

    A_ub = np.array(A_ub, dtype=float)
    b_ub = np.array(b_ub, dtype=float)

    # Bounds for variables
    # Solar is only available when the developer can pay a positive lease;
    # otherwise no solar deal occurs and all land stays in crops.
    solar_upper = None if pv_lease_per_acre > 0 else 0.0
    x_bounds: List[Tuple[float, float]] = [(0, solar_upper)] + [(0, None)] * len(crops)

    # Solve LP
    res = linprog(c, A_ub=A_ub, b_ub=b_ub, bounds=x_bounds, method="highs")

    if res.status != 0:
        raise RuntimeError(f"Linear program did not solve successfully: {res.message}")

    A_s_opt = float(res.x[0])
    A_c_opts = [float(v) for v in res.x[1:]]
    objective_value = pv_lease_per_acre * A_s_opt + sum(
        pv_crop_per_acre[i] * A_c_opts[i] for i in range(len(crops))
    )

    solar_pv_revenue, solar_pv_cost, solar_pv_no_lease = compute_solar_pv_no_lease(solar, econ)
    solar_pv_after_lease = solar_pv_no_lease - pv_lease_per_acre
    result = {
        "A_s": A_s_opt,
        "A_c_by_crop": {crop.name: A_c_opts[i] for i, crop in enumerate(crops)},
        "pv_lease_per_acre": pv_lease_per_acre,
        "pv_crop_per_acre": {crop.name: pv_crop_per_acre[i] for i, crop in enumerate(crops)},
        "pv_solar_net_per_acre_after_lease": solar_pv_after_lease,
        "pv_solar_net_per_acre_no_lease": solar_pv_no_lease,
        "objective_farmer_NPV": float(objective_value),
        "usable_land": usable_land,
        "crop_land": crop_land,
        "max_solar": max_solar,
    }
    return result


def main(
    acres: float,
    crop_names: str,
    pvwatts_response_path: Optional[str] = None,
    pvwatts_data: Optional[Dict[str, Any]] = None,
    output_json: bool = False,
    crop_data: Optional[List[Dict[str, Any]]] = None,
):
    """
    Run the agrivoltaics optimization model for the specified crops.

    Args:
        acres: Total land area in acres for optimization
        crop_names: Comma-separated string of crop names to optimize for (e.g., "Corn (grain),Soybeans,Wheat")
        pvwatts_response_path: Path to JSON file containing PVWatts API response
        pvwatts_data: Direct PVWatts API response data (alternative to file path)
        output_json: If True, output results as JSON; otherwise, print detailed results
    """
    import json
    print(f"[Python] Main function called with acres={acres}, crop_names='{crop_names}', output_json={output_json}")
    print(f"[Python] PVWatts data source: {'file' if pvwatts_response_path else 'inline data'}")

    # Parse crop names (comma-separated)
    crop_name_list = [name.strip() for name in crop_names.split(',') if name.strip()]
    print(f"[Python] Parsed crop names: {crop_name_list}")

    # Load PVWatts data
    if pvwatts_response_path:
        print(f"[Python] Loading PVWatts data from file: {pvwatts_response_path}")
        with open(pvwatts_response_path, 'r') as f:
            pvwatts_response = json.load(f)
    elif pvwatts_data:
        print(f"[Python] Using provided PVWatts data directly ({len(str(pvwatts_data))} chars)")
        pvwatts_response = pvwatts_data
    else:
        raise ValueError("Must provide either pvwatts_response_path or pvwatts_data")

    print(f"[Python] PVWatts response status: {pvwatts_response.get('status', 'unknown')}")
    print(f"[Python] PVWatts has outputs: {bool(pvwatts_response.get('outputs'))}")
    if pvwatts_response.get('outputs'):
        outputs = pvwatts_response['outputs']
        print(f"[Python] PVWatts capacity factor: {outputs.get('capacity_factor', 'missing')}")
        print(f"[Python] PVWatts AC annual: {outputs.get('ac_annual', 'missing')} kWh")

    print("[Python] PVWatts data loaded successfully, proceeding with optimization...")

    # Economic parameters
    econ = EconomicParameters(
        discount_rate=0.08,  # 8% real discount rate
        inflation_rate=0.02,  # 2% (not used for real calculations)
        electricity_escalation=0.02,  # 2% escalation for electricity price
        crop_escalation=0.00,  # retained for backward compatibility (unused)
        project_life=27,  # 2 construction years + 25 operating years
    )

    # Base solar parameters (excluding capacity_factor which comes from PVWatts)
    base_solar_params = {
        'land_intensity_acres_per_MW': 5.5,
        'degradation_rate': 0.005,  # 0.5% per year degradation
        'installed_cost_per_MW': 1_610_000.0,  # $1.61/WAC => $/MWac
        'site_prep_cost_per_acre': 36_800.0,
        'grading_cost_per_acre': 8_286.0,  # median of 5,524–11,048
        'retilling_cost_per_acre': 950.0,  # $950/acre for field retilling
        'interconnection_fraction': 0.30,  # 30% of construction for upgrades
        'bond_cost_per_acre': 10_000.0,
        'vegetation_cost_per_acre': 225.0,
        'insurance_cost_per_acre': 100.0,
        'oandm_cost_per_kw': 11.0,
        'replacement_cost_per_MW': 100_000.0,  # assume $0.10/W
        'replacement_year': 14,  # Year 14 in 27-year timeline (was year 12 in 25-year)
        'decommission_cost_per_kw': 400.0,
        'remediation_cost_per_acre': 2_580.0,
        'salvage_value_per_acre': 12_500.0,
        'itc_rate': 0.50,
        'electricity_price_0': 0.08,
        'availability_factor': 0.98,
        'curtailment_factor': 0.95,
        'export_factor': 1.0,
    }

    # All crop parameters
    all_crops = [
        CropParameters(
            name="Corn (grain)",
            yield_per_acre=178.0,  # bu/acre (USDA NASS 2025)
            price_per_unit_0=4.16,  # $/bu (USDA NASS 2024)
            unit="bushel",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Soybeans",
            yield_per_acre=48.5,  # bu/acre (USDA NASS 2025)
            price_per_unit_0=10.50,  # $/bu (USDA NASS 2024)
            unit="bushel",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Wheat",
            yield_per_acre=90.0,  # bu/acre (USDA NASS 2025)
            price_per_unit_0=5.55,  # $/bu (USDA NASS 2024)
            unit="bushel",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Dry beans",
            yield_per_acre=20.22,  # cwt/acre (converted from database)
            price_per_unit_0=40.50,  # $/cwt (USDA NASS 2024)
            unit="cwt",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Sugar beets",
            yield_per_acre=28.6,  # ton/acre (USDA NASS 2025)
            price_per_unit_0=59.70,  # $/ton (USDA NASS 2023)
            unit="ton",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Potatoes",
            yield_per_acre=435.0,  # cwt/acre (USDA NASS 2025)
            price_per_unit_0=16.20,  # $/cwt (USDA NASS 2024)
            unit="cwt",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Tart cherries",
            yield_per_acre=5.058,  # ton/acre (converted from database)
            price_per_unit_0=1706.00,  # $/ton (USDA NASS 2024, converted)
            unit="ton",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Apples",
            yield_per_acre=14.16,  # ton/acre (converted from database)
            price_per_unit_0=748.00,  # $/ton (USDA NASS 2024, converted)
            unit="ton",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Blueberries",
            yield_per_acre=6474.0,  # lb/acre (converted from database)
            price_per_unit_0=1.76,  # $/lb (USDA NASS 2024)
            unit="lb",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Grapes",
            yield_per_acre=4.047,  # ton/acre (converted from database)
            price_per_unit_0=2400.00,  # $/ton (Michigan Wine Collaborative, mid-range)
            unit="ton",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Cucumbers",
            yield_per_acre=10.12,  # ton/acre (converted from database)
            price_per_unit_0=212.00,  # $/ton (USDA NASS 2024)
            unit="ton",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Tomatoes",
            yield_per_acre=20.23,  # ton/acre (converted from database)
            price_per_unit_0=116.00,  # $/ton (USDA NASS 2024)
            unit="ton",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Asparagus",
            yield_per_acre=4856.0,  # lb/acre (converted from database)
            price_per_unit_0=0.909,  # $/lb (USDA NASS 2024, converted)
            unit="lb",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Carrots",
            yield_per_acre=14.16,  # ton/acre (converted from database)
            price_per_unit_0=195.00,  # $/ton (USDA NASS 2024)
            unit="ton",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Onions",
            yield_per_acre=283.2,  # cwt/acre (converted from database)
            price_per_unit_0=10.80,  # $/cwt (USDA NASS 2024, converted)
            unit="cwt",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
        CropParameters(
            name="Alfalfa hay",
            yield_per_acre=3.1,  # ton/acre (USDA NASS 2025)
            price_per_unit_0=173.00,  # $/ton (USDA NASS 2024)
            unit="ton",
            cost_per_acre=500.0,
            escalation_rate=0.00,
        ),
    ]

    selected_crops: List[CropParameters] = []

    if crop_data:
        # Build crops directly from provided data (no gating on name)
        for idx, entry in enumerate(crop_data):
            try:
                name = entry.get('name') or entry.get('crop')
                if not name:
                    raise ValueError("missing name")
                selected_crops.append(
                    CropParameters(
                        name=str(name),
                        yield_per_acre=float(entry['yield_per_acre']),
                        price_per_unit_0=float(entry['price_per_unit_0']),
                        unit=str(entry.get('unit') or ''),
                        cost_per_acre=float(entry['cost_per_acre']),
                        escalation_rate=float(entry.get('escalation_rate') or 0.0),
                    )
                )
            except KeyError as exc:
                raise ValueError(f"Crop entry {idx} missing required field: {exc}") from exc
            except (TypeError, ValueError) as exc:
                raise ValueError(f"Crop entry {idx} has invalid numeric field: {exc}") from exc
        if not selected_crops:
            raise ValueError("No crop data provided")
        print(f"[Python] Using {len(selected_crops)} crop(s) from provided data: {[c.name for c in selected_crops]}")
    else:
        # Select the specified crops from the predefined set; reject unknowns
        crop_dict = {c.name: c for c in all_crops}
        invalid_crops = []

        for crop_name in crop_name_list:
            if crop_name in crop_dict:
                selected_crops.append(crop_dict[crop_name])
            else:
                invalid_crops.append(crop_name)

        if invalid_crops:
            raise ValueError(f"Unknown crops: {', '.join(invalid_crops)}. Available crops: {', '.join(crop_dict.keys())}")

        if not selected_crops:
            raise ValueError("No valid crops specified")

        print(f"[Python] Selected {len(selected_crops)} crop(s) for analysis: {[c.name for c in selected_crops]}")

    results = {}

    # Run for each selected crop
    for crop in selected_crops:
        print(f"\n[Python] === ANALYZING CROP: {crop.name} ===")
        crops = [crop]  # Analysis expects a list, but we run one at a time
        results[crop.name] = {}

        # Run three ITC scenarios
        itc_scenarios = [0.30, 0.40, 0.50]  # 30%, 40%, 50%

        for itc_rate in itc_scenarios:
            # Create solar parameters for this ITC scenario
            scenario_solar_params = base_solar_params.copy()
            scenario_solar_params['itc_rate'] = itc_rate
            solar = create_solar_parameters_from_pvwatts(pvwatts_response, scenario_solar_params)

            lease = LeaseParameters(
                # No min or max rate bounds - lease rate determined purely by economics
                escalation_rate=0.0,
            )

            farmer = FarmerParameters(
                pa116_credit_per_acre=0.0,
            )

            # Stage 1: compute lease rate
            L_solar = compute_lease_rate(solar, econ, lease)

            # Stage 2: optimize land allocation
            constraints = LandConstraints(
                total_land=acres,
                min_ag_fraction=0.51,
                max_prime_solar=40.0,
                zoning_max_solar=40.0,
                setback_fraction=0.10,
                easement_acres=0.0,
                wetland_exclusion_acres=0.0,
                interconnect_capacity_mw=10.0,
            )

            result = optimize_land_allocation(
                solar=solar,
                econ=econ,
                crops=crops,
                lease=lease,
                farmer=farmer,
                constraints=constraints,
                L_solar=L_solar,
            )

            results[crop.name][f"{int(itc_rate*100)}%"] = result

            if not output_json:
                # Print results for this scenario
                print("Economic parameters:")
                for k, v in asdict(econ).items():
                    print(f"  {k}: {v}")
                print()
                print("Derived discount factors (first 5):", econ.discount_factors[:5])
                print()
                print("Solar parameters:")
                for k, v in asdict(solar).items():
                    print(f"  {k}: {v}")
                print()
                print(f"Calculated CAPEX per acre (before ITC): ${solar.capex_per_acre():,.2f}")
                print(f"  - Construction cost: ${(solar.installed_cost_per_MW / solar.land_intensity_acres_per_MW):,.2f}")
                print(f"  - Site preparation: ${solar.site_prep_cost_per_acre:,.2f}")
                print(f"  - Grading: ${solar.grading_cost_per_acre:,.2f}")
                print(f"  - Retilling: ${solar.retilling_cost_per_acre:,.2f}")
                print(f"  - Interconnection upgrades: ${(solar.interconnection_fraction * solar.installed_cost_per_MW / solar.land_intensity_acres_per_MW):,.2f}")
                print(f"  - Decommissioning bond: ${solar.bond_cost_per_acre:,.2f}")
                print(f"ITC benefit per acre (applied in year 2): ${solar.capex_per_acre() * solar.itc_rate:,.2f}")
                print(f"Calculated OPEX per acre (excluding lease): ${solar.opex_per_acre():,.2f} per year")
                print(f"Replacement cost per acre at year {solar.replacement_year}: ${solar.replacement_cost_per_acre():,.2f}")
                print(f"End-of-life net cost per acre (decom + remediation - salvage): ${solar.decommission_cost_per_acre():,.2f}")
                print()

                print("Crop parameters:")
                for crop in crops:
                    for k, v in asdict(crop).items():
                        print(f"  {crop.name} - {k}: {v}")
                print()
                print(f"Derived solar lease rate (L_solar): ${L_solar:,.2f} per acre-year")
                print()
                print("Developer retention constraint (12% minimum):")
                pv_net_no_lease = result['pv_solar_net_per_acre_no_lease']
                developer_retained_pv = 0.12 * pv_net_no_lease
                developer_after_lease_pv = pv_net_no_lease - result['pv_lease_per_acre']
                print(f"  Pre-lease solar NPV per acre: ${pv_net_no_lease:,.2f}")
                print(f"  Developer minimum retained NPV per acre (12%): ${developer_retained_pv:,.2f}")
                print(f"  Developer NPV after lease per acre: ${developer_after_lease_pv:,.2f}")
                print(f"  Lease PV to farmer per acre: ${result['pv_lease_per_acre']:,.2f}")
                print()
                print("Stage 2 optimization results (farmer objective):")
                print(f"  Usable land for solar (after setbacks/exclusions): {result['usable_land']:.2f} acres")
                print(f"  Available land for crops (no setbacks): {result['crop_land']:.2f} acres")
                print(f"  Max solar allowed by caps: {result['max_solar']:.2f} acres")
                print(f"  Solar acres (A_s): {result['A_s']:.2f} acres")
                for name, acres in result["A_c_by_crop"].items():
                    print(f"  Crop acres ({name}): {acres:.2f} acres")
                print()
                print("Per-acre present value contributions:")
                print(f"  PV net solar (per acre, no lease): ${result['pv_solar_net_per_acre_no_lease']:,.2f}")
                print(f"  PV net solar (per acre, after lease): ${result['pv_solar_net_per_acre_after_lease']:,.2f}")
                print(f"  PV lease to farmer (per acre): ${result['pv_lease_per_acre']:,.2f}")
                for name, pv in result["pv_crop_per_acre"].items():
                    print(f"  PV net crop (per acre, {name}): ${pv:,.2f}")
                print()
                print(f"Total farmer NPV: ${result['objective_farmer_NPV']:,.2f}")


    if output_json:
        import json
        print(json.dumps(results))

    return results


if __name__ == "__main__":
    import sys
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Run agrivoltaics optimizer with PVWatts data")
    parser.add_argument('--acres', type=float, required=True, help='Total acres available')
    parser.add_argument('--crops', type=str, help='Comma-separated crop names')
    parser.add_argument('--crop-data', dest='crop_data', type=str, help='JSON array of crop parameter objects')
    parser.add_argument('--data', type=str, required=True, help='PVWatts JSON payload (string)')
    parser.add_argument('--json', action='store_true', help='Output JSON only')
    args = parser.parse_args()

    try:
        pvwatts_data = json.loads(args.data)
    except json.JSONDecodeError as exc:
        print(f"[Python] ERROR: Invalid PVWatts JSON: {exc}")
        sys.exit(1)

    crop_data_json = None
    if args.crop_data:
        try:
            crop_data_json = json.loads(args.crop_data)
        except json.JSONDecodeError as exc:
            print(f"[Python] ERROR: Invalid crop_data JSON: {exc}")
            sys.exit(1)

    if not args.crops and not crop_data_json:
        print("[Python] ERROR: Provide at least --crops or --crop-data")
        sys.exit(1)

    result = main(
        acres=args.acres,
        crop_names=args.crops or '',
        pvwatts_response_path=None,
        pvwatts_data=pvwatts_data,
        output_json=args.json,
        crop_data=crop_data_json,
    )

    if args.json:
        print(json.dumps(result))