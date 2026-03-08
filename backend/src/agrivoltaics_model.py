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
    discount_rate: float  # annual discount rate (real) — farmer-side NPV
    inflation_rate: float  # annual inflation rate (informational — model uses real terms)
    electricity_escalation: float  # annual real escalation rate for electricity price
    crop_escalation: float  # annual real escalation rate for crop price
    project_life: int  # project lifetime in years (27 = 2 construction + 25 operating)
    developer_discount_rate: Optional[float] = None  # developer real WACC (None = use discount_rate)
    developer_tax_rate: float = 0.257  # combined federal (21%) + state (~6%) corporate tax rate

    @property
    def discount_factors(self) -> np.ndarray:
        """Return discount factors 1/(1+r)^t for t=0..T using farmer rate."""
        T = self.project_life
        r = self.discount_rate
        return np.array([1 / ((1 + r) ** t) for t in range(T + 1)])

    @property
    def developer_discount_factors(self) -> np.ndarray:
        """Return discount factors using the developer's WACC (lower = cheaper capital)."""
        T = self.project_life
        r = self.developer_discount_rate if self.developer_discount_rate is not None else self.discount_rate
        return np.array([1 / ((1 + r) ** t) for t in range(T + 1)])


@dataclass
class LeaseParameters:
    """Solar lease assumptions and bounds."""
    min_rate: Optional[float] = None  # $/acre-yr (optional lower bound)
    max_rate: Optional[float] = None  # $/acre-yr (optional upper bound)
    escalation_rate: float = 0.0  # real escalation for lease, per year

    def pv_factor(self, econ: EconomicParameters) -> float:
        """Present value factor for a $1/acre-yr lease from t=1..T (farmer rate)."""
        df = econ.discount_factors
        return float(sum(df[t] * ((1 + self.escalation_rate) ** t) for t in range(1, econ.project_life + 1)))

    def pv_factor_developer(self, econ: EconomicParameters) -> float:
        """Present value factor using the developer's discount rate."""
        df = econ.developer_discount_factors
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
    construction_interest_rate: float = 0.065  # interest during construction (IDC)
    # ── Improvement: O&M and OPEX escalation ──
    oandm_escalation_rate: float = 0.0075  # real annual O&M escalation (NREL: 0.5-1.0%)
    opex_escalation_rate: float = 0.005  # real annual escalation for veg+insurance (2-3% nom)
    # ── Improvement: Explicit property tax ──
    property_tax_per_kw: float = 0.0  # $/kWac-yr (set to 0 when PA108 exemption applies)
    property_tax_escalation: float = 0.01  # real annual escalation
    # ── Improvement: PPA pricing with merchant tail ──
    ppa_price_kwh: float = 0.0  # $/kWh PPA price (0 = use electricity_price_0 escalation)
    ppa_years: int = 0  # PPA term in years from COD (0 = no PPA, use escalated price)
    merchant_discount: float = 0.20  # post-PPA merchant price discount vs escalated price
    # ── Improvement: Simplified debt structure ──
    debt_fraction: float = 0.0  # fraction of capex financed with debt (0 = all-equity)
    debt_interest_rate: float = 0.07  # nominal interest rate on term debt
    debt_term_years: int = 18  # amortization period
    # ── Improvement: Development soft costs ──
    soft_cost_fraction: float = 0.05  # soft costs as fraction of installed_cost_per_MW
    # ── Improvement: DC:AC ratio (ILR) ──
    dc_ac_ratio: float = 1.0  # DC nameplate / AC nameplate (1.34 typical; 1.0 = no clipping)
    # ── Improvement: Working capital reserve ──
    working_capital_months: float = 0.0  # months of OPEX held in reserve (0 = none)
    # ── Improvement: Curtailment trend ──
    curtailment_annual_increase: float = 0.0  # annual increase in curtailment fraction

    @property
    def energy_per_MW_year(self) -> float:
        """Annual energy production per MWac in kWh for the first year.

        If dc_ac_ratio > 1.0 (oversized DC field), production increases up to
        a clipping limit of ~15% above nameplate AC.  The simplified approach
        is: extra_dc = min(dc_ac_ratio, 1.15) — i.e., a 1.34 ILR yields ~15%
        more energy but clipping prevents anything above ~15%.
        """
        dc_boost = min(self.dc_ac_ratio, 1.15) if self.dc_ac_ratio > 1.0 else 1.0
        return 8760 * self.capacity_factor * 1000 * dc_boost

    def net_energy(self, t: int, cod_year: int = 2) -> float:
        """Net energy in year t (kWh per MW) accounting for degradation, derates,
        and increasing curtailment over time.
        """
        op_year = max(0, t - cod_year)
        # Curtailment grows over time (solar penetration increase in MISO)
        effective_curtailment = max(0.0, self.curtailment_factor - self.curtailment_annual_increase * op_year)
        derate = self.availability_factor * effective_curtailment * self.export_factor
        return self.energy_per_MW_year * ((1 - self.degradation_rate) ** op_year) * derate

    def price_electricity(self, t: int, econ: EconomicParameters) -> float:
        """Electricity price ($/kWh) in year t."""
        return self.electricity_price_0 * ((1 + econ.electricity_escalation) ** t)

    def capex_per_acre(self) -> float:
        """Compute the upfront CAPEX per acre (year 0), including soft costs."""
        const_per_acre = self.installed_cost_per_MW / self.land_intensity_acres_per_MW
        inter_upgrade = self.interconnection_fraction * const_per_acre
        soft_costs = self.soft_cost_fraction * const_per_acre
        return (const_per_acre + self.site_prep_cost_per_acre +
                self.grading_cost_per_acre + self.retilling_cost_per_acre +
                self.bond_cost_per_acre + inter_upgrade + soft_costs)

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
        """Max land available for solar: at most (1 - min_ag_fraction) of crop_land, reduced by setbacks."""
        crop_land = self.total_land - self.easement_acres - self.wetland_exclusion_acres
        max_solar_share = crop_land * (1.0 - self.min_ag_fraction)
        usable = max_solar_share * (1.0 - self.setback_fraction)
        return max(0.0, usable)


@dataclass
class FarmerParameters:
    """Farmer-side financial additions (e.g., PA 116 credit)."""
    pa116_credit_per_acre: float = 0.0  # $/acre-yr (if applicable)


# ═══════════════════════════════════════════════════════════════════
# Incentive Modeling
# ═══════════════════════════════════════════════════════════════════

@dataclass
class IncentiveDefinition:
    """Describes a financial incentive program with its quantified effect."""
    id: str
    name: str
    category: str
    description: str
    eligibility: str
    group: str  # itc_base | itc_adder | ptc | federal_grant | state | conservation | regulatory
    # Developer-side effects
    itc_override: Optional[float] = None
    itc_bonus: float = 0.0
    ptc_per_kwh: float = 0.0
    ptc_years: int = 0
    capex_grant_fraction: float = 0.0
    capex_grant_cap: float = float('inf')
    capex_flat_reduction: float = 0.0
    opex_savings_per_mw_yr: float = 0.0
    # Depreciation
    depreciation_100pct: bool = False  # 100% bonus depreciation (MACRS)
    depreciation_tax_rate: float = 0.21  # Federal corporate tax rate
    # Market revenue (RECs)
    rec_per_mwh: float = 0.0  # $/MWh REC revenue (stackable with ITC or PTC)
    rec_years: int = 0  # Number of years RECs are sold (0 = project life)
    # Community-side effects (passed through to developer viability)
    community_payment_per_mw: float = 0.0  # One-time $/MW to host community
    # Farmer-side effects
    farmer_cost_share_per_acre: float = 0.0
    farmer_annual_revenue_per_acre: float = 0.0
    farmer_annual_cost_per_acre: float = 0.0


# Incentive catalog — populated at runtime from DB via model config.
# No hardcoded incentives; all definitions live in the 'incentives' table.
INCENTIVE_BY_ID: Dict[str, 'IncentiveDefinition'] = {}

# Mutual-exclusion groups: incentives sharing the same group string cannot
# appear together in a scenario.  Populated from DB 'mutual_exclusion_group' column.
# { group_name: set(incentive_id, ...) }
MUTUAL_EXCLUSION_GROUPS: Dict[str, set] = {}


def _build_catalog_from_defs(defs: list) -> tuple:
    """Reconstruct INCENTIVE_BY_ID and MUTUAL_EXCLUSION_GROUPS from raw dicts
    passed from the DB via model config.

    Returns (incentive_by_id, mutual_exclusion_groups).
    """
    result = {}
    mutex_groups: Dict[str, set] = {}
    for d in defs:
        d = dict(d)
        # DB stores as incentive_group; IncentiveDefinition dataclass uses 'group'
        if 'incentive_group' in d:
            d['group'] = d.pop('incentive_group')
        # DB NULL for capex_grant_cap means no cap (Python uses float('inf'))
        if d.get('capex_grant_cap') is None:
            d['capex_grant_cap'] = float('inf')
        # Extract mutex/requires metadata before stripping
        mutex_grp = d.pop('mutual_exclusion_group', None)
        d.pop('requires_group', None)
        # Strip DB-only fields not in the dataclass
        for key in ('active', 'sort_order', 'configurable'):
            d.pop(key, None)
        try:
            obj = IncentiveDefinition(**d)
            result[obj.id] = obj
            if mutex_grp:
                mutex_groups.setdefault(mutex_grp, set()).add(obj.id)
        except TypeError as e:
            print(f"[Python] Warning: skipping incentive {d.get('id', '?')}: {e}")
    return result, mutex_groups


# Standard MACRS 5-year depreciation schedule (200% DB, half-year convention)
# Applies to all commercial solar as IRC §168 property; 6 tax years for 5-year class.
MACRS_5YR = [0.2000, 0.3200, 0.1920, 0.1152, 0.1152, 0.0576]


def present_value_stream(values: List[float], econ: EconomicParameters) -> float:
    """Compute the present value of a stream of values given EconomicParameters."""
    df = econ.discount_factors
    if len(values) != len(df):
        raise ValueError("Length of values must equal project life + 1")
    return float(sum(v * d for v, d in zip(values, df)))


def compute_solar_pv_no_lease(solar: SolarParameters, econ: EconomicParameters) -> Tuple[float, float, float]:
    """Return (pv_revenue, pv_cost, pv_net) per acre for solar without lease.

    Uses developer discount rate and includes:
      - Construction interest (IDC)
      - Standard MACRS 5-year depreciation tax shield
      - O&M and OPEX escalation
      - Explicit property tax (with escalation)
      - PPA pricing with merchant tail
      - Simplified debt service
      - Working capital reserve
      - DC:AC ratio boost
      - Increasing curtailment
      - Soft costs in CAPEX basis
    """
    T = econ.project_life
    df = econ.developer_discount_factors

    revenues = [0.0] * (T + 1)
    costs = [0.0] * (T + 1)

    capex = solar.capex_per_acre()

    # ── Construction financing: interest during construction (NREL ATB method) ──
    con_fin_factor = 1.0
    if solar.construction_interest_rate > 0:
        idc = solar.construction_interest_rate
        tr = econ.developer_tax_rate
        ai_0 = (1 - tr) * ((1 + idc) ** 1.5 - 1)
        ai_1 = (1 - tr) * ((1 + idc) ** 0.5 - 1)
        con_fin_factor = 0.5 * (1 + ai_0) + 0.5 * (1 + ai_1)

    cash_capex = capex * con_fin_factor
    costs[0] = cash_capex / 2
    costs[1] = cash_capex / 2

    # ── Working capital reserve ── (returned at end of life)
    if solar.working_capital_months > 0:
        wc = solar.opex_per_acre() * (solar.working_capital_months / 12.0)
        costs[1] += wc          # reserve funded at end of construction
        revenues[T] += wc       # reserve returned at decommission

    # ITC benefit at year 2 (placed in service)
    itc_benefit = capex * solar.itc_rate
    revenues[2] = itc_benefit

    # Standard MACRS 5-year depreciation (bonus handled in incentive path)
    depreciable_basis = capex * (1.0 - solar.itc_rate / 2.0)  # IRC §50(c)(3)
    for i, rate in enumerate(MACRS_5YR):
        yr = 2 + i
        if yr <= T:
            revenues[yr] += depreciable_basis * rate * econ.developer_tax_rate

    # ── Debt service ── (simple annual mortgage-style payment)
    annual_debt_service = 0.0
    if solar.debt_fraction > 0 and solar.debt_term_years > 0:
        debt_principal = capex * solar.debt_fraction
        r_debt = solar.debt_interest_rate
        n_debt = solar.debt_term_years
        if r_debt > 0:
            annual_debt_service = debt_principal * (r_debt * (1 + r_debt) ** n_debt) / ((1 + r_debt) ** n_debt - 1)
        else:
            annual_debt_service = debt_principal / n_debt
        # Equity portion of construction cost replaces full cash_capex
        equity_capex = capex * (1.0 - solar.debt_fraction) * con_fin_factor
        costs[0] = equity_capex / 2
        costs[1] = equity_capex / 2
        if solar.working_capital_months > 0:
            costs[1] += solar.opex_per_acre() * (solar.working_capital_months / 12.0)

    # ── Operating years ──
    base_opex = solar.opex_per_acre()
    base_oandm = solar.oandm_cost_per_kw * 1000 / solar.land_intensity_acres_per_MW
    base_veg_ins = solar.vegetation_cost_per_acre + solar.insurance_cost_per_acre
    base_prop_tax = solar.property_tax_per_kw * 1000 / solar.land_intensity_acres_per_MW
    ppa_end = 2 + solar.ppa_years if solar.ppa_years > 0 else 0

    for t in range(2, T + 1):
        op_yr = t - 2
        energy = solar.net_energy(t) / solar.land_intensity_acres_per_MW

        # ── Revenue: PPA or escalated price ──
        if solar.ppa_price_kwh > 0 and solar.ppa_years > 0:
            if t < ppa_end:
                # PPA rate (fixed, no escalation in real terms for simplicity)
                price = solar.ppa_price_kwh
            else:
                # Merchant tail: escalated price with discount
                esc_price = solar.price_electricity(t, econ)
                price = esc_price * (1.0 - solar.merchant_discount)
        else:
            price = solar.price_electricity(t, econ)

        revenues[t] += energy * price

        # ── Costs: O&M with escalation, property tax, debt service ──
        oandm = base_oandm * ((1 + solar.oandm_escalation_rate) ** op_yr)
        veg_ins = base_veg_ins * ((1 + solar.opex_escalation_rate) ** op_yr)
        prop_tax = base_prop_tax * ((1 + solar.property_tax_escalation) ** op_yr)
        costs[t] = oandm + veg_ins + prop_tax + annual_debt_service

    if 0 < solar.replacement_year <= T:
        costs[solar.replacement_year] += solar.replacement_cost_per_acre()

    costs[T] += solar.decommission_cost_per_acre()

    pv_revenue = float(sum(revenues[t] * df[t] for t in range(T + 1)))
    pv_cost = float(sum(costs[t] * df[t] for t in range(T + 1)))
    pv_net = pv_revenue - pv_cost
    return pv_revenue, pv_cost, pv_net


def compute_lease_rate(
    solar: SolarParameters,
    econ: EconomicParameters,
    lease: LeaseParameters,
    developer_retention_fraction: float = 0.12,
) -> float:
    """
    Determine the solar lease rate ($ per acre-year) that keeps developer NPV >= developer_retention_fraction
    of the pre-lease NPV. Bounds are optional and can be None.
    """
    _, _, pv_net_no_lease = compute_solar_pv_no_lease(solar, econ)
    pv_factor_lease = lease.pv_factor(econ)
    if pv_factor_lease == 0:
        raise ValueError("Discount factor sum is zero; check discount rate and project life.")

    retained_frac = developer_retention_fraction if developer_retention_fraction is not None else 0.12
    retained_frac = max(0.0, min(1.0, retained_frac))
    max_lease_pv = (1.0 - retained_frac) * pv_net_no_lease
    derived_L = max_lease_pv / pv_factor_lease if pv_net_no_lease > 0 else 0.0

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
        "lease_annual_per_acre": L_solar,
        "lease_monthly_per_acre": L_solar / 12.0,
        "pv_crop_per_acre": {crop.name: pv_crop_per_acre[i] for i, crop in enumerate(crops)},
        "pv_solar_net_per_acre_after_lease": solar_pv_after_lease,
        "pv_solar_net_per_acre_no_lease": solar_pv_no_lease,
        "objective_farmer_NPV": float(objective_value),
        "usable_land": usable_land,
        "crop_land": crop_land,
        "max_solar": max_solar,
        "interconnect_capacity_mw": constraints.interconnect_capacity_mw,
        "constraints_min_ag_fraction": constraints.min_ag_fraction,
        "constraints_setback_fraction": constraints.setback_fraction,
    }
    return result


# ═══════════════════════════════════════════════════════════════════
# Incentive Scenario Generation & Evaluation
# ═══════════════════════════════════════════════════════════════════

def _powerset(items):
    """Return all subsets of *items* as a list of lists."""
    result = [[]]
    for item in items:
        result += [combo + [item] for combo in result]
    return result


def generate_scenarios(eligible_ids=None):
    """
    Generate all valid incentive stack combinations.

    Returns a list of lists where each inner list is a set of
    IncentiveDefinition objects representing one scenario.

    Mutual-exclusivity rules (data-driven from MUTUAL_EXCLUSION_GROUPS):
      * ITC vs PTC (cannot combine)
      * Incentives in the same mutual_exclusion_group cannot co-exist
      * ITC adders only valid with ITC base
      * Total ITC capped at 70%
    """
    catalog = INCENTIVE_BY_ID
    if eligible_ids is not None:
        eligible = {k: v for k, v in catalog.items() if k in eligible_ids}
    else:
        # Default: exclude brownfield-specific and competitive programs
        exclude_default = {'brownfield_egle', 'act381_brownfield_tif', 'itc_low_income_20'}
        eligible = {k: v for k, v in catalog.items() if k not in exclude_default}

    itc_bases   = [v for v in eligible.values() if v.group == 'itc_base']
    itc_adders  = [v for v in eligible.values() if v.group == 'itc_adder']
    ptc_options = [v for v in eligible.values() if v.group == 'ptc']
    fed_grants  = [v for v in eligible.values() if v.group == 'federal_grant']
    state_progs = [v for v in eligible.values() if v.group == 'state']
    conservation = [v for v in eligible.values() if v.group == 'conservation']
    depreciation = [v for v in eligible.values() if v.group == 'depreciation']
    market       = [v for v in eligible.values() if v.group == 'market']
    # Always-on groups: depreciation and market (RECs) are added to every stack
    always_on = depreciation + market

    # Build a lookup: incentive_id -> set of mutex peer ids
    mutex_lookup: Dict[str, set] = {}
    for grp_name, members in MUTUAL_EXCLUSION_GROUPS.items():
        for mid in members:
            mutex_lookup.setdefault(mid, set()).update(members - {mid})

    def no_mutex_violation(combo):
        """Return True if no two incentives in combo share a mutual-exclusion group."""
        ids = {i.id for i in combo}
        for iid in ids:
            if iid in mutex_lookup and ids & mutex_lookup[iid]:
                return False
        return True

    scenarios = []

    # ── ITC-based scenarios ──
    for base in itc_bases:
        for adders in _powerset(itc_adders):
            if not no_mutex_violation(adders):
                continue
            total_itc = (base.itc_override or 0) + sum(a.itc_bonus for a in adders)
            if total_itc > 0.70:
                continue
            for grants in _powerset(fed_grants):
                if not no_mutex_violation(grants):
                    continue
                for st in _powerset(state_progs):
                    for cons in _powerset(conservation):
                        scenarios.append([base] + adders + grants + always_on + st + cons)

    # ── PTC-based scenarios (no ITC adders) ──
    for ptc in ptc_options:
        for grants in _powerset(fed_grants):
            if not no_mutex_violation(grants):
                continue
            for st in _powerset(state_progs):
                for cons in _powerset(conservation):
                    scenarios.append([ptc] + grants + always_on + st + cons)

    return scenarios


def aggregate_effects(stack):
    """Combine financial effects from all incentives in a stack."""
    eff_itc = 0.0
    use_ptc = False
    ptc_rate = 0.0
    ptc_years = 0
    capex_grant_frac = 0.0
    capex_grant_cap = float('inf')
    capex_flat = 0.0
    opex_savings = 0.0
    has_depreciation = False
    depreciation_tax_rate = 0.21
    rec_per_mwh = 0.0
    rec_years = 0
    community_payment_per_mw = 0.0
    farmer_cs = 0.0
    farmer_rev = 0.0
    farmer_cost = 0.0

    for inc in stack:
        if inc.itc_override is not None:
            eff_itc = inc.itc_override
        eff_itc += inc.itc_bonus
        if inc.ptc_per_kwh > 0:
            use_ptc = True
            ptc_rate = inc.ptc_per_kwh
            ptc_years = inc.ptc_years
            eff_itc = 0.0
        capex_grant_frac += inc.capex_grant_fraction
        if inc.capex_grant_cap < capex_grant_cap:
            capex_grant_cap = inc.capex_grant_cap
        capex_flat += inc.capex_flat_reduction
        opex_savings += inc.opex_savings_per_mw_yr
        if inc.depreciation_100pct:
            has_depreciation = True
            depreciation_tax_rate = inc.depreciation_tax_rate
        if inc.rec_per_mwh > 0:
            rec_per_mwh = max(rec_per_mwh, inc.rec_per_mwh)  # Take best REC price
            rec_years = inc.rec_years
        community_payment_per_mw += inc.community_payment_per_mw
        farmer_cs += inc.farmer_cost_share_per_acre
        farmer_rev += inc.farmer_annual_revenue_per_acre
        farmer_cost += inc.farmer_annual_cost_per_acre

    return {
        'effective_itc': min(eff_itc, 0.70),
        'use_ptc': use_ptc,
        'ptc_rate': ptc_rate,
        'ptc_years': ptc_years,
        'capex_grant_fraction': min(capex_grant_frac, 0.50),
        'capex_grant_cap': capex_grant_cap if capex_grant_cap < float('inf') else None,
        'capex_flat_reduction': capex_flat,
        'opex_savings_per_mw_yr': opex_savings,
        'has_depreciation': has_depreciation,
        'depreciation_tax_rate': depreciation_tax_rate,
        'rec_per_mwh': rec_per_mwh,
        'rec_years': rec_years,
        'community_payment_per_mw': community_payment_per_mw,
        'farmer_cost_share_per_acre': farmer_cs,
        'farmer_annual_revenue_per_acre': farmer_rev,
        'farmer_annual_cost_per_acre': farmer_cost,
    }


def compute_solar_pv_with_incentives(
    solar: SolarParameters,
    econ: EconomicParameters,
    effects: dict,
    est_solar_acres: float,
) -> Tuple[float, float, float]:
    """
    Developer NPV per acre accounting for CAPEX grants, ITC/PTC choice,
    depreciation (bonus or standard MACRS), construction interest (IDC),
    O&M and OPEX escalation, property tax, PPA/merchant pricing,
    debt service, working capital, and annual opex savings from incentives.
    Returns (pv_revenue, pv_cost, pv_net) per acre.
    Uses developer discount rate.
    """
    T = econ.project_life
    df = econ.developer_discount_factors
    revenues = [0.0] * (T + 1)
    costs = [0.0] * (T + 1)

    capex = solar.capex_per_acre()

    # ── CAPEX grant reductions (reduce basis before ITC) ──
    grant_per_acre = 0.0
    if effects['capex_grant_fraction'] > 0 and est_solar_acres > 0:
        total_capex = capex * est_solar_acres
        cap = effects['capex_grant_cap'] or float('inf')
        grant = min(total_capex * effects['capex_grant_fraction'], cap)
        grant_per_acre = grant / est_solar_acres
    if effects['capex_flat_reduction'] > 0 and est_solar_acres > 0:
        grant_per_acre += effects['capex_flat_reduction'] / est_solar_acres

    net_capex = max(0.0, capex - grant_per_acre)

    # ── Construction financing: interest during construction (NREL ATB method) ──
    con_fin_factor = 1.0
    if solar.construction_interest_rate > 0:
        idc = solar.construction_interest_rate
        tr = econ.developer_tax_rate
        ai_0 = (1 - tr) * ((1 + idc) ** 1.5 - 1)
        ai_1 = (1 - tr) * ((1 + idc) ** 0.5 - 1)
        con_fin_factor = 0.5 * (1 + ai_0) + 0.5 * (1 + ai_1)

    cash_capex = net_capex * con_fin_factor
    costs[0] = cash_capex / 2
    costs[1] = cash_capex / 2

    # ── Working capital reserve ── (returned at end of life)
    if solar.working_capital_months > 0:
        wc = solar.opex_per_acre() * (solar.working_capital_months / 12.0)
        costs[1] += wc
        revenues[T] += wc

    # ── Tax credit ──
    if effects['use_ptc']:
        for t in range(2, min(2 + effects['ptc_years'], T + 1)):
            energy_kwh = solar.net_energy(t) / solar.land_intensity_acres_per_MW
            revenues[t] += energy_kwh * effects['ptc_rate']
    else:
        itc_benefit = net_capex * effects['effective_itc']
        revenues[2] = itc_benefit

    # ── Depreciation tax shield (bonus or standard MACRS) ──
    eff_itc = effects['effective_itc'] if not effects['use_ptc'] else 0.0
    depreciable_basis = net_capex * (1.0 - eff_itc / 2.0)  # IRC §50(c)(3)
    tax_rate = econ.developer_tax_rate
    if effects.get('has_depreciation'):
        revenues[2] += depreciable_basis * tax_rate
    else:
        for i, rate in enumerate(MACRS_5YR):
            yr = 2 + i
            if yr <= T:
                revenues[yr] += depreciable_basis * rate * tax_rate

    # ── Debt service ── (mortgage-style annual payment on net_capex)
    annual_debt_service = 0.0
    if solar.debt_fraction > 0 and solar.debt_term_years > 0:
        debt_principal = net_capex * solar.debt_fraction
        r_debt = solar.debt_interest_rate
        n_debt = solar.debt_term_years
        if r_debt > 0:
            annual_debt_service = debt_principal * (r_debt * (1 + r_debt) ** n_debt) / ((1 + r_debt) ** n_debt - 1)
        else:
            annual_debt_service = debt_principal / n_debt
        # Equity portion replaces full cash_capex
        equity_capex = net_capex * (1.0 - solar.debt_fraction) * con_fin_factor
        costs[0] = equity_capex / 2
        costs[1] = equity_capex / 2
        if solar.working_capital_months > 0:
            costs[1] += solar.opex_per_acre() * (solar.working_capital_months / 12.0)

    # ── REC revenue (stackable with ITC/PTC) ──
    if effects.get('rec_per_mwh', 0) > 0:
        rec_years = effects['rec_years'] or T
        rec_end = min(2 + rec_years, T + 1)
        for t in range(2, rec_end):
            energy_mwh = solar.net_energy(t) / solar.land_intensity_acres_per_MW / 1000.0
            revenues[t] += energy_mwh * effects['rec_per_mwh']

    # ── Community payment offset (RRCA) ──
    if effects.get('community_payment_per_mw', 0) > 0:
        mw_per_acre = 1.0 / solar.land_intensity_acres_per_MW
        community_offset = effects['community_payment_per_mw'] * mw_per_acre
        revenues[0] += community_offset / 2
        revenues[2] += community_offset / 2

    # ── Operating revenue and costs (with escalation) ──
    base_oandm = solar.oandm_cost_per_kw * 1000 / solar.land_intensity_acres_per_MW
    base_veg_ins = solar.vegetation_cost_per_acre + solar.insurance_cost_per_acre
    base_prop_tax = solar.property_tax_per_kw * 1000 / solar.land_intensity_acres_per_MW
    opex_savings_per_acre = effects['opex_savings_per_mw_yr'] / solar.land_intensity_acres_per_MW
    ppa_end = 2 + solar.ppa_years if solar.ppa_years > 0 else 0

    for t in range(2, T + 1):
        op_yr = t - 2
        energy_kwh = solar.net_energy(t) / solar.land_intensity_acres_per_MW

        # ── Revenue: PPA or escalated price ──
        if solar.ppa_price_kwh > 0 and solar.ppa_years > 0:
            if t < ppa_end:
                price = solar.ppa_price_kwh
            else:
                esc_price = solar.price_electricity(t, econ)
                price = esc_price * (1.0 - solar.merchant_discount)
        else:
            price = solar.price_electricity(t, econ)

        revenues[t] += energy_kwh * price

        # ── Costs: escalated O&M, property tax, debt service, minus savings ──
        oandm = base_oandm * ((1 + solar.oandm_escalation_rate) ** op_yr)
        veg_ins = base_veg_ins * ((1 + solar.opex_escalation_rate) ** op_yr)
        prop_tax = base_prop_tax * ((1 + solar.property_tax_escalation) ** op_yr)
        annual_opex = oandm + veg_ins + prop_tax + annual_debt_service
        costs[t] = max(0.0, annual_opex - opex_savings_per_acre)

    if 0 < solar.replacement_year <= T:
        costs[solar.replacement_year] += solar.replacement_cost_per_acre()
    costs[T] += solar.decommission_cost_per_acre()

    pv_revenue = float(sum(revenues[t] * df[t] for t in range(T + 1)))
    pv_cost = float(sum(costs[t] * df[t] for t in range(T + 1)))
    pv_net = pv_revenue - pv_cost
    return pv_revenue, pv_cost, pv_net


def build_scenario_label(stack):
    """Build a compact human-readable label for a scenario stack."""
    itc = 0.0
    use_ptc = False
    SHORT = {
        'reap_25': 'REAP25', 'reap_50': 'REAP50',
        'pa108_solar_exemption': 'PA108', 'egle_ag_grant': 'EGLE',
        'mdard_regen_grant': 'MDARD', 'brownfield_egle': 'Brownfield',
        'eqip_pollinator': 'EQIP', 'crp_conservation': 'CRP',
        'rec_revenue': 'REC', 'rrca_community': 'RRCA',
        'csp_stewardship': 'CSP', 'act381_brownfield_tif': 'Act381',
        'bonus_depreciation': 'BonusDep',
    }
    extras = []
    for inc in stack:
        if inc.group == 'regulatory':
            continue
        if inc.itc_override is not None:
            itc = inc.itc_override
        itc += inc.itc_bonus
        if inc.ptc_per_kwh > 0:
            use_ptc = True
        if inc.id in SHORT:
            extras.append(SHORT[inc.id])

    parts = []
    if use_ptc:
        parts.append('PTC')
    elif itc > 0:
        parts.append(f'ITC {int(min(itc, 0.70) * 100)}%')
    parts.extend(extras)
    return ' + '.join(parts) if parts else 'Baseline'


def evaluate_scenario(
    stack,
    solar: SolarParameters,
    econ: EconomicParameters,
    crops: List[CropParameters],
    lease: LeaseParameters,
    farmer: FarmerParameters,
    constraints: LandConstraints,
    developer_retention_fraction: float,
) -> Optional[dict]:
    """
    Evaluate a single incentive stack: compute modified developer economics,
    derive lease rate, run LP for each crop, return results or None on failure.
    """
    effects = aggregate_effects(stack)
    est_solar_acres = constraints.usable_land()

    # Developer economics with incentives (uses developer discount rate)
    pv_rev, pv_cost, pv_net = compute_solar_pv_with_incentives(
        solar, econ, effects, est_solar_acres,
    )

    # Derive lease rate from developer NPV using developer's discount rate
    pv_factor_lease_dev = lease.pv_factor_developer(econ)
    if pv_factor_lease_dev == 0:
        return None
    ret = max(0.0, min(1.0, developer_retention_fraction))
    max_lease_pv = (1.0 - ret) * pv_net
    derived_L = max_lease_pv / pv_factor_lease_dev if pv_net > 0 else 0.0

    L_solar = derived_L
    if lease.min_rate is not None:
        L_solar = max(lease.min_rate, L_solar)
    if lease.max_rate is not None:
        L_solar = min(lease.max_rate, L_solar)

    # Farmer-side annual adjustments (CRP revenue, PA 116 cost, etc.)
    net_farmer_annual = (effects['farmer_annual_revenue_per_acre']
                         - effects['farmer_annual_cost_per_acre'])
    modified_farmer = FarmerParameters(
        pa116_credit_per_acre=farmer.pa116_credit_per_acre + net_farmer_annual,
    )

    # Scenario metadata
    label = build_scenario_label(stack)
    incentives_applied = [
        {
            'id': inc.id,
            'name': inc.name,
            'category': inc.category,
            'description': inc.description,
        }
        for inc in stack if inc.group != 'regulatory'
    ]

    crop_results = {}
    for crop in crops:
        try:
            result = optimize_land_allocation(
                solar=solar, econ=econ, crops=[crop], lease=lease,
                farmer=modified_farmer, constraints=constraints, L_solar=L_solar,
            )
        except RuntimeError:
            continue

        # EQIP one-time cost-share benefit on solar acres
        eqip_bonus = effects['farmer_cost_share_per_acre'] * result['A_s']
        result['objective_farmer_NPV'] += eqip_bonus
        result['eqip_one_time_benefit'] = round(eqip_bonus, 2)

        # Override developer PV values with incentive-aware computation
        result['pv_solar_net_per_acre_no_lease'] = pv_net
        result['pv_solar_net_per_acre_after_lease'] = pv_net - (L_solar * pv_factor_lease_dev)

        # Attach incentive metadata
        result['scenario_name'] = label
        result['incentives_applied'] = incentives_applied
        result['effective_itc'] = effects['effective_itc']
        result['use_ptc'] = effects['use_ptc']

        crop_results[crop.name] = result

    if not crop_results:
        return None
    return crop_results


def main(
    acres: float,
    crop_names: str,
    pvwatts_response_path: Optional[str] = None,
    pvwatts_data: Optional[Dict[str, Any]] = None,
    output_json: bool = False,
    crop_data: Optional[List[Dict[str, Any]]] = None,
    model_config: Optional[Dict[str, Any]] = None,
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
    cfg = model_config or {}

    def pick(key: str):
        """Require a model config key — raises if missing/None."""
        val = cfg.get(key)
        if val is None:
            raise KeyError(
                f"Required model config key '{key}' not found or null. "
                f"Ensure the models table and DEFAULT_MODEL_CONFIG are complete."
            )
        return val

    def pick_optional(key: str):
        """Return a model config value, or None if missing/null."""
        return cfg.get(key)

    def pick_none_if_zero(key: str):
        """Return None when the value is 0 (meaning 'no constraint'), else return the value."""
        val = cfg.get(key)
        if val is None:
            return None
        if val == 0 or val == 0.0 or val == "0":
            return None
        return val

    model_name = cfg.get('name') or 'Default'

    print(f"[Python] Main function called with acres={acres}, crop_names='{crop_names}', output_json={output_json}")
    print(f"[Python] Using model: {model_name}")
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
        discount_rate=pick('discount_rate'),
        inflation_rate=pick('inflation_rate'),
        electricity_escalation=pick('electricity_escalation'),
        crop_escalation=pick('crop_escalation'),
        project_life=int(pick('project_life')),
        developer_discount_rate=pick('developer_discount_rate'),
        developer_tax_rate=pick('developer_tax_rate'),
    )

    # Base solar parameters (excluding capacity_factor which comes from PVWatts)
    base_solar_params = {
        'land_intensity_acres_per_MW': pick('land_intensity_acres_per_MW'),
        'degradation_rate': pick('degradation_rate'),
        'installed_cost_per_MW': pick('installed_cost_per_MW'),
        'site_prep_cost_per_acre': pick('site_prep_cost_per_acre'),
        'grading_cost_per_acre': pick('grading_cost_per_acre'),
        'retilling_cost_per_acre': pick('retilling_cost_per_acre'),
        'interconnection_fraction': pick('interconnection_fraction'),
        'bond_cost_per_acre': pick('bond_cost_per_acre'),
        'vegetation_cost_per_acre': pick('vegetation_cost_per_acre'),
        'insurance_cost_per_acre': pick('insurance_cost_per_acre'),
        'oandm_cost_per_kw': pick('oandm_cost_per_kw'),
        'replacement_cost_per_MW': pick('replacement_cost_per_MW'),
        'replacement_year': int(pick('replacement_year')),
        'decommission_cost_per_kw': pick('decommission_cost_per_kw'),
        'remediation_cost_per_acre': pick('remediation_cost_per_acre'),
        'salvage_value_per_acre': pick('salvage_value_per_acre'),
        'itc_rate': 0.30,  # placeholder — overridden per-scenario in evaluate_scenario()
        'electricity_price_0': pick('electricity_price_0'),
        'availability_factor': pick('availability_factor'),
        'curtailment_factor': pick('curtailment_factor'),
        'export_factor': pick('export_factor'),
        'construction_interest_rate': pick('construction_interest_rate'),
        # ── New parameters (12 improvements) ──
        'oandm_escalation_rate': pick('oandm_escalation_rate'),
        'opex_escalation_rate': pick('opex_escalation_rate'),
        'property_tax_per_kw': pick('property_tax_per_kw'),
        'property_tax_escalation': pick('property_tax_escalation'),
        'ppa_price_kwh': pick('ppa_price_kwh'),
        'ppa_years': int(pick('ppa_years')),
        'merchant_discount': pick('merchant_discount'),
        'debt_fraction': pick('debt_fraction'),
        'debt_interest_rate': pick('debt_interest_rate'),
        'debt_term_years': int(pick('debt_term_years')),
        'soft_cost_fraction': pick('soft_cost_fraction'),
        'dc_ac_ratio': pick('dc_ac_ratio'),
        'working_capital_months': pick('working_capital_months'),
        'curtailment_annual_increase': pick('curtailment_annual_increase'),
    }

    # All crop parameters
    # ── Build crop list from DB data (no hardcoded crop defaults) ──
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
        print(f"[Python] Using {len(selected_crops)} crop(s) from DB: {[c.name for c in selected_crops]}")
    else:
        raise ValueError(
            "No crop data supplied. Crops must come from the database via --crop-data. "
            "Ensure the crops table is populated."
        )

    # ── Shared parameters (constant across incentive scenarios) ──
    lease = LeaseParameters(
        min_rate=pick_optional('lease_min_rate'),
        max_rate=pick_optional('lease_max_rate'),
        escalation_rate=pick('lease_escalation_rate'),
    )
    farmer = FarmerParameters(
        pa116_credit_per_acre=pick('farmer_pa116_credit_per_acre'),
    )
    constraints = LandConstraints(
        total_land=acres,
        min_ag_fraction=pick('constraints_min_ag_fraction'),
        max_prime_solar=pick_none_if_zero('constraints_max_prime_solar'),
        zoning_max_solar=pick_none_if_zero('constraints_zoning_max_solar'),
        setback_fraction=pick('constraints_setback_fraction'),
        easement_acres=pick('constraints_easement_acres'),
        wetland_exclusion_acres=pick('constraints_wetland_exclusion_acres'),
        interconnect_capacity_mw=pick_none_if_zero('constraints_interconnect_capacity_mw'),
    )
    developer_retention_fraction = pick('developer_retention_fraction')

    # Create base SolarParameters (ITC handled per-scenario in evaluate_scenario)
    solar = create_solar_parameters_from_pvwatts(pvwatts_response, base_solar_params)

    # ── Rebuild incentive catalog from DB definitions (if provided) ──
    global INCENTIVE_BY_ID, MUTUAL_EXCLUSION_GROUPS
    incentive_defs = cfg.get('incentive_definitions')
    if incentive_defs:
        INCENTIVE_BY_ID, MUTUAL_EXCLUSION_GROUPS = _build_catalog_from_defs(incentive_defs)
        print(f"[Python] Loaded {len(INCENTIVE_BY_ID)} incentives from DB "
              f"({len(MUTUAL_EXCLUSION_GROUPS)} mutual-exclusion groups)")
    else:
        raise ValueError("No incentive_definitions supplied in model config. "
                         "Ensure the incentives table is populated.")

    # ── Apply user-supplied incentive parameter overrides ──
    incentive_params = cfg.get('incentive_params', {})
    if incentive_params:
        bf_amount = incentive_params.get('brownfield_egle_amount')
        if bf_amount is not None and 'brownfield_egle' in INCENTIVE_BY_ID:
            INCENTIVE_BY_ID['brownfield_egle'].capex_flat_reduction = float(bf_amount)
            print(f"[Python] Brownfield EGLE grant overridden to ${float(bf_amount):,.0f}")

    # ── Generate & evaluate incentive scenarios ──
    eligible_ids = cfg.get('eligible_incentives', None)
    scenarios = generate_scenarios(eligible_ids)
    print(f"[Python] Generated {len(scenarios)} incentive scenario combinations")

    all_evals = []
    for stack in scenarios:
        crop_results = evaluate_scenario(
            stack, solar, econ, selected_crops, lease, farmer, constraints,
            developer_retention_fraction,
        )
        if crop_results:
            all_evals.append(crop_results)

    print(f"[Python] {len(all_evals)} scenarios produced valid results")

    # ── Rank by farmer NPV and select top 3 per crop ──
    results = {}
    for crop in selected_crops:
        ranked = []
        for cr in all_evals:
            if crop.name in cr:
                ranked.append(cr[crop.name])
        ranked.sort(key=lambda r: r['objective_farmer_NPV'], reverse=True)

        top = ranked[:3]
        results[crop.name] = {}
        for i, sc in enumerate(top, 1):
            results[crop.name][f"#{i}"] = sc

        if top:
            print(f"[Python] {crop.name}: best NPV=${top[0]['objective_farmer_NPV']:,.0f} "
                  f"({top[0].get('scenario_name', '?')}), {len(ranked)} evaluated")
        else:
            print(f"[Python] {crop.name}: no feasible scenarios")

    return results


if __name__ == "__main__":
    import sys
    import argparse
    import json

    parser = argparse.ArgumentParser(description="Run agrivoltaics optimizer with PVWatts data")
    parser.add_argument('--acres', type=float, default=None, help='Total acres available')
    parser.add_argument('--crops', type=str, help='Comma-separated crop names')
    parser.add_argument('--crop-data', dest='crop_data', type=str, help='JSON array of crop parameter objects')
    parser.add_argument('--data', type=str, default=None, help='PVWatts JSON payload (string)')
    parser.add_argument('--json', action='store_true', help='Output JSON only')
    parser.add_argument('--model-config', dest='model_config', type=str, help='JSON payload of model parameter overrides')
    args = parser.parse_args()

    if args.acres is None:
        print("[Python] ERROR: --acres is required")
        sys.exit(1)
    if args.data is None:
        print("[Python] ERROR: --data is required")
        sys.exit(1)

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

    model_config_json = None
    if args.model_config:
        try:
            model_config_json = json.loads(args.model_config)
        except json.JSONDecodeError as exc:
            print(f"[Python] ERROR: Invalid model_config JSON: {exc}")
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
        model_config=model_config_json,
    )

    if args.json:
        print(json.dumps(result))