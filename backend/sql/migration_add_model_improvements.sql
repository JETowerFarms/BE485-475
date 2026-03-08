-- Migration: Add 17 new columns to models table for 12 improvements
-- Safe to run multiple times (IF NOT EXISTS / DO NOTHING patterns)

-- ── New columns ──────────────────────────────────────────────────
ALTER TABLE models ADD COLUMN IF NOT EXISTS construction_interest_rate DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS developer_discount_rate DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS developer_tax_rate DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS electricity_price_0 DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS oandm_escalation_rate DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS opex_escalation_rate DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS property_tax_per_kw DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS property_tax_escalation DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS ppa_price_kwh DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS ppa_years INTEGER;
ALTER TABLE models ADD COLUMN IF NOT EXISTS merchant_discount DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS debt_fraction DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS debt_interest_rate DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS debt_term_years INTEGER;
ALTER TABLE models ADD COLUMN IF NOT EXISTS soft_cost_fraction DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS dc_ac_ratio DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS working_capital_months DOUBLE PRECISION;
ALTER TABLE models ADD COLUMN IF NOT EXISTS curtailment_annual_increase DOUBLE PRECISION;

-- ── Backfill Default model with sensible values ──────────────────
UPDATE models SET
    construction_interest_rate = COALESCE(construction_interest_rate, 0.065),
    developer_discount_rate = COALESCE(developer_discount_rate, 0.055),
    developer_tax_rate = COALESCE(developer_tax_rate, 0.257),
    electricity_price_0 = COALESCE(electricity_price_0, 0.10),
    oandm_escalation_rate = COALESCE(oandm_escalation_rate, 0.0075),
    opex_escalation_rate = COALESCE(opex_escalation_rate, 0.005),
    property_tax_per_kw = COALESCE(property_tax_per_kw, 0.0),
    property_tax_escalation = COALESCE(property_tax_escalation, 0.01),
    ppa_price_kwh = COALESCE(ppa_price_kwh, 0.0),
    ppa_years = COALESCE(ppa_years, 0),
    merchant_discount = COALESCE(merchant_discount, 0.20),
    debt_fraction = COALESCE(debt_fraction, 0.0),
    debt_interest_rate = COALESCE(debt_interest_rate, 0.07),
    debt_term_years = COALESCE(debt_term_years, 18),
    soft_cost_fraction = COALESCE(soft_cost_fraction, 0.05),
    dc_ac_ratio = COALESCE(dc_ac_ratio, 1.0),
    working_capital_months = COALESCE(working_capital_months, 0.0),
    curtailment_annual_increase = COALESCE(curtailment_annual_increase, 0.0),
    developer_retention_fraction = 0.25
WHERE name = 'Default';

-- ── Update Default model equations to reflect new formulas ──────
UPDATE models SET equations = '[
    {"title": "Solar CAPEX per acre", "eq": "CAPEX = [(C_install / α) + C_site + C_grade + C_retill + C_bond + f_inter × (C_install / α)] × (1 + f_soft)"},
    {"title": "Construction financing (IDC)", "eq": "ConFinFactor = 0.5×[1 + (1−τ)×((1+r_con)^1.5 − 1)] + 0.5×[1 + (1−τ)×((1+r_con)^0.5 − 1)]"},
    {"title": "Solar energy (year t)", "eq": "E_t = 8760 × CF × R_dc:ac × clip × 1000 × (1−d)^t × η_avail × η_curt(t) × η_export"},
    {"title": "Curtailment (increasing)", "eq": "η_curt(t) = η_curt × (1 − c_inc × (t−2))"},
    {"title": "Revenue: PPA / merchant", "eq": "Rev_t = E_t/α × (PPA_rate if t<PPA_end, else P_elec(t) × (1−d_merchant))"},
    {"title": "O&M cost (escalating)", "eq": "OM_t = OM_base × (1+g_om)^(t−2) + (Veg+Ins) × (1+g_opex)^(t−2) + PropTax × (1+g_ptax)^(t−2)"},
    {"title": "Debt service (annual)", "eq": "DS = P_debt × r(1+r)^n / [(1+r)^n − 1]"},
    {"title": "MACRS depreciation", "eq": "DepBasis = CAPEX × (1 − ITC/2); shield = DepBasis × MACRS_5yr[i] × τ_dev"},
    {"title": "ITC benefit (year 2)", "eq": "ITC = CAPEX × itc_rate (30% base, up to 70% with adders)"},
    {"title": "Lease rate", "eq": "L = (1 − f_retain) × NPV_solar / Σ_{t=1…T} 1/(1+r_farmer)^t"},
    {"title": "Crop PV per acre", "eq": "PV_crop = Σ_{t=1…T} (yield × price_t − cost) / (1+r_farmer)^t"},
    {"title": "Objective (maximize)", "eq": "max z = PV_lease × A_s + Σ_j PV_crop_j × A_cj"},
    {"title": "Coupling constraint", "eq": "A_s + Σ A_cj = crop_land"},
    {"title": "Min agriculture", "eq": "Σ A_cj ≥ 0.51 × total_land"},
    {"title": "Solar cap", "eq": "A_s ≤ min(usable, prime_cap, zoning_cap, interconnect × α)"}
]'::jsonb
WHERE name = 'Default';
