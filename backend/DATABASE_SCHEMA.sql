-- Michigan Solar Optimization Database Schema
-- This file contains the complete database schema for the Michigan Solar Optimization Tool

-- Enable PostGIS extension (skip if already exists)
CREATE EXTENSION IF NOT EXISTS postgis;
-- Enable pgcrypto for password hashing
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create custom functions for solar suitability scoring (skip if already exist)
CREATE OR REPLACE FUNCTION score_landcover(nlcd_code integer)
RETURNS integer AS $$
BEGIN
  CASE nlcd_code
    WHEN 11 THEN RETURN 100; -- Open water
    WHEN 12 THEN RETURN 100; -- Perennial ice/snow
    WHEN 21 THEN RETURN 90;  -- Developed, open space
    WHEN 22 THEN RETURN 70;  -- Developed, low intensity
    WHEN 23 THEN RETURN 50;  -- Developed, medium intensity
    WHEN 24 THEN RETURN 30;  -- Developed, high intensity
    WHEN 31 THEN RETURN 100; -- Barren land
    WHEN 32 THEN RETURN 100; -- Unconsolidated shore
    WHEN 41 THEN RETURN 80;  -- Deciduous forest
    WHEN 42 THEN RETURN 80;  -- Evergreen forest
    WHEN 43 THEN RETURN 80;  -- Mixed forest
    WHEN 51 THEN RETURN 100; -- Dwarf scrub
    WHEN 52 THEN RETURN 100; -- Shrub/scrub
    WHEN 71 THEN RETURN 100; -- Grassland/herbaceous
    WHEN 72 THEN RETURN 100; -- Sedge/herbaceous
    WHEN 73 THEN RETURN 100; -- Lichens
    WHEN 74 THEN RETURN 100; -- Moss
    WHEN 81 THEN RETURN 100; -- Pasture/hay
    WHEN 82 THEN RETURN 100; -- Cultivated crops
    WHEN 90 THEN RETURN 100; -- Woody wetlands
    WHEN 95 THEN RETURN 100; -- Emergent herbaceous wetlands
    ELSE RETURN 60; -- Default for unknown values
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Skip creating functions that already exist
-- score_slope, score_population, score_transmission_distance already exist

-- Create tables (skip if already exist)
CREATE TABLE IF NOT EXISTS farms (
    id BIGSERIAL PRIMARY KEY,
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    boundary GEOGRAPHY(POLYGON, 4326) NOT NULL,
    area_acres DOUBLE PRECISION,
    centroid GEOGRAPHY(POINT, 4326),
    avg_suitability DOUBLE PRECISION,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS county_bboxes (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    bbox GEOMETRY(POLYGON, 4326) NOT NULL,
    bbox_5070 GEOMETRY(POLYGON, 5070) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS substations (
    id SERIAL PRIMARY KEY,
    properties JSONB,
    geom GEOMETRY(POINT, 4326),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Create indexes (skip if already exist)
CREATE INDEX IF NOT EXISTS idx_farms_boundary ON farms USING GIST (boundary);
CREATE INDEX IF NOT EXISTS idx_farms_user_id ON farms (user_id);
CREATE INDEX IF NOT EXISTS idx_county_bboxes_bbox ON county_bboxes USING GIST (bbox);
CREATE INDEX IF NOT EXISTS idx_county_bboxes_bbox_5070 ON county_bboxes USING GIST (bbox_5070);
CREATE INDEX IF NOT EXISTS idx_substations_geom ON substations USING GIST (geom);

-- Create raster tables (skip if already exist)
CREATE TABLE IF NOT EXISTS landcover_nlcd_2024_raster (
    rid SERIAL PRIMARY KEY,
    rast RASTER,
    filename TEXT
);

CREATE TABLE IF NOT EXISTS slope_raster (
    rid SERIAL PRIMARY KEY,
    rast RASTER,
    filename TEXT
);

CREATE TABLE IF NOT EXISTS population_raster (
    rid SERIAL PRIMARY KEY,
    rast RASTER,
    filename TEXT
);

-- Optimizer models table: each row is a set of tunable inputs
CREATE TABLE IF NOT EXISTS models (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    description TEXT,
    -- Economic parameters
    discount_rate DOUBLE PRECISION,
    inflation_rate DOUBLE PRECISION,
    electricity_escalation DOUBLE PRECISION,
    crop_escalation DOUBLE PRECISION,
    project_life INTEGER,
    -- Solar parameters (capacity_factor comes from PVWatts; land_intensity derived from kW/acre at request time)
    degradation_rate DOUBLE PRECISION,
    installed_cost_per_MW DOUBLE PRECISION,
    site_prep_cost_per_acre DOUBLE PRECISION,
    grading_cost_per_acre DOUBLE PRECISION,
    retiling_cost_per_acre DOUBLE PRECISION,
    interconnection_fraction DOUBLE PRECISION,
    bond_cost_per_acre DOUBLE PRECISION,
    vegetation_cost_per_acre DOUBLE PRECISION,
    insurance_cost_per_acre DOUBLE PRECISION,
    oandm_cost_per_kw DOUBLE PRECISION,
    replacement_cost_per_MW DOUBLE PRECISION,
    replacement_year INTEGER,
    decommission_cost_per_kw DOUBLE PRECISION,
    remediation_cost_per_acre DOUBLE PRECISION,
    salvage_value_per_acre DOUBLE PRECISION,
    availability_factor DOUBLE PRECISION,
    curtailment_factor DOUBLE PRECISION,
    export_factor DOUBLE PRECISION,
    -- Lease parameters
    lease_min_rate DOUBLE PRECISION,
    lease_max_rate DOUBLE PRECISION,
    lease_escalation_rate DOUBLE PRECISION,
    developer_retention_fraction DOUBLE PRECISION,
    -- Constraint parameters
    constraints_min_ag_fraction DOUBLE PRECISION,
    constraints_max_prime_solar DOUBLE PRECISION,
    constraints_zoning_max_solar DOUBLE PRECISION,
    constraints_setback_fraction DOUBLE PRECISION,
    constraints_easement_acres DOUBLE PRECISION,
    constraints_wetland_exclusion_acres DOUBLE PRECISION,
    constraints_interconnect_capacity_mw DOUBLE PRECISION,
    -- Farmer parameters
    farmer_pa116_credit_per_acre DOUBLE PRECISION,
    -- Developer financing parameters (12 improvements)
    construction_interest_rate DOUBLE PRECISION,
    developer_discount_rate DOUBLE PRECISION,
    developer_tax_rate DOUBLE PRECISION,
    electricity_price_0 DOUBLE PRECISION,
    oandm_escalation_rate DOUBLE PRECISION,
    opex_escalation_rate DOUBLE PRECISION,
    property_tax_per_kw DOUBLE PRECISION,
    property_tax_escalation DOUBLE PRECISION,
    ppa_price_kwh DOUBLE PRECISION,
    ppa_years INTEGER,
    merchant_discount DOUBLE PRECISION,
    debt_fraction DOUBLE PRECISION,
    debt_interest_rate DOUBLE PRECISION,
    debt_term_years INTEGER,
    soft_cost_fraction DOUBLE PRECISION,
    dc_ac_ratio DOUBLE PRECISION,
    working_capital_months DOUBLE PRECISION,
    curtailment_annual_increase DOUBLE PRECISION,
    -- Equations metadata (optional editable list)
    equations JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed default model matching current hard-coded values
INSERT INTO models (
    name,
    description,
    discount_rate,
    inflation_rate,
    electricity_escalation,
    crop_escalation,
    project_life,
    degradation_rate,
    installed_cost_per_MW,
    site_prep_cost_per_acre,
    grading_cost_per_acre,
    retiling_cost_per_acre,
    interconnection_fraction,
    bond_cost_per_acre,
    vegetation_cost_per_acre,
    insurance_cost_per_acre,
    oandm_cost_per_kw,
    replacement_cost_per_MW,
    replacement_year,
    decommission_cost_per_kw,
    remediation_cost_per_acre,
    salvage_value_per_acre,
    availability_factor,
    curtailment_factor,
    export_factor,
    lease_min_rate,
    lease_max_rate,
    lease_escalation_rate,
    developer_retention_fraction,
    constraints_min_ag_fraction,
    constraints_max_prime_solar,
    constraints_zoning_max_solar,
    constraints_setback_fraction,
    constraints_easement_acres,
    constraints_wetland_exclusion_acres,
    constraints_interconnect_capacity_mw,
    farmer_pa116_credit_per_acre,
    construction_interest_rate,
    developer_discount_rate,
    developer_tax_rate,
    electricity_price_0,
    oandm_escalation_rate,
    opex_escalation_rate,
    property_tax_per_kw,
    property_tax_escalation,
    ppa_price_kwh,
    ppa_years,
    merchant_discount,
    debt_fraction,
    debt_interest_rate,
    debt_term_years,
    soft_cost_fraction,
    dc_ac_ratio,
    working_capital_months,
    curtailment_annual_increase,
    equations
)
VALUES (
    'Default',
    'Baseline parameters prior to user-defined overrides',
    0.08,
    0.02,
    0.02,
    0.00,
    27,
    0.005,
    1610000.0,
    36800.0,
    8286.0,
    950.0,
    0.30,
    10000.0,
    225.0,
    100.0,
    11.0,
    100000.0,
    14,
    400.0,
    2580.0,
    12500.0,
    0.98,
    0.95,
    1.0,
    NULL,
    NULL,
    0.0,
    0.25,
    0.51,
    0,        -- constraints_max_prime_solar (0 = no cap; site-specific)
    0,        -- constraints_zoning_max_solar (0 = no cap; site-specific)
    0.10,
    0.0,
    0.0,
    10.0,
    0.0,
    0.065,
    0.055,
    0.257,
    0.10,
    0.0075,
    0.005,
    0.0,
    0.01,
    0.0,
    0,
    0.20,
    0.0,
    0.07,
    18,
    0.05,
    1.0,
    0.0,
    0.0,
    '[
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
)
ON CONFLICT (name) DO NOTHING;

-- ─── Incentive catalog ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS incentives (
    id                             TEXT PRIMARY KEY,
    name                           TEXT NOT NULL,
    category                       TEXT NOT NULL,
    description                    TEXT NOT NULL,
    eligibility                    TEXT NOT NULL,
    incentive_group                TEXT NOT NULL,
    itc_override                   DOUBLE PRECISION,
    itc_bonus                      DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    ptc_per_kwh                    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    ptc_years                      INTEGER NOT NULL DEFAULT 0,
    capex_grant_fraction           DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    capex_grant_cap                DOUBLE PRECISION,
    capex_flat_reduction           DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    opex_savings_per_mw_yr         DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    depreciation_100pct            BOOLEAN NOT NULL DEFAULT FALSE,
    depreciation_tax_rate          DOUBLE PRECISION NOT NULL DEFAULT 0.21,
    rec_per_mwh                    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    rec_years                      INTEGER NOT NULL DEFAULT 0,
    community_payment_per_mw       DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    farmer_cost_share_per_acre     DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    farmer_annual_revenue_per_acre DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    farmer_annual_cost_per_acre    DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    configurable                   JSONB,
    mutual_exclusion_group          TEXT,
    requires_group                  TEXT,
    active                         BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order                     INTEGER NOT NULL DEFAULT 0
);

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, itc_override, sort_order)
VALUES ('itc_base', 'Federal ITC (30%)', 'Federal Tax Credit', 'Clean Electricity Investment Credit under IRC §48E provides a 30% credit on eligible solar project costs when prevailing wage and apprenticeship requirements are met. Projects under 1 MW AC auto-qualify. Under the OBBBA (2025), solar must begin construction by July 4 2026 or be placed in service by Dec 31 2027.', 'Commercial solar meeting prevailing wage & apprenticeship requirements; construction must begin by Jul 4 2026.', 'itc_base', 0.30, 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, itc_bonus, sort_order)
VALUES ('itc_domestic_content', 'Domestic Content Bonus (+10%)', 'Federal Tax Credit', 'Additional 10 percentage points of ITC for projects meeting domestic content requirements. Steel and iron must be 100% US-made. Manufactured products threshold: 45% for construction starting in 2025, 50% in 2026, 55% in 2027+. FEOC restrictions apply.', 'Projects using domestically sourced steel, iron, and manufactured components (45-55% threshold).', 'itc_adder', 0.10, 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, itc_bonus, sort_order)
VALUES ('itc_energy_community', 'Energy Community Bonus (+10%)', 'Federal Tax Credit', 'Additional 10 percentage points of ITC for projects in energy communities — areas with closed coal mines/plants, brownfield sites, or statistical areas with significant fossil fuel employment.', 'Projects sited in designated energy communities.', 'itc_adder', 0.10, 30)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, itc_bonus, mutual_exclusion_group, sort_order)
VALUES ('itc_low_income_10', 'Low-Income Community Bonus (+10%)', 'Federal Tax Credit', '10 additional ITC percentage points for facilities <5 MW AC in low-income communities or on Tribal land under §48E(h). Competitively allocated; 2026 applications open Feb 2. 1.8 GW annual capacity limit across four categories.', 'Facilities <5 MW AC in low-income communities/Tribal land; competitively awarded.', 'itc_adder', 0.10, 'low_income', 40)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, itc_bonus, mutual_exclusion_group, sort_order)
VALUES ('itc_low_income_20', 'Low-Income Benefit Bonus (+20%)', 'Federal Tax Credit', '20 additional ITC percentage points for facilities <5 MW AC that are part of qualified low-income residential buildings or provide >=50% output to low-income households. Competitively allocated with limited annual capacity.', 'Facilities <5 MW AC providing direct economic benefit to low-income households.', 'itc_adder', 0.20, 'low_income', 50)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, ptc_per_kwh, ptc_years, sort_order)
VALUES ('ptc', 'Federal PTC (3.0c/kWh)', 'Federal Tax Credit', 'Clean Electricity Production Credit under IRC §45Y offers 3.0 cents/kWh (2025 inflation-adjusted) for the first 10 years of generation when prevailing wage and apprenticeship requirements are met. Mutually exclusive with ITC. OBBBA requires construction to begin by Jul 4 2026 or PIS by Dec 31 2027 for solar.', 'Clean electricity generators meeting labor standards; mutually exclusive with ITC; construction by Jul 4 2026.', 'ptc', 0.030, 10, 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, capex_grant_fraction, capex_grant_cap, mutual_exclusion_group, sort_order)
VALUES ('reap_25', 'USDA REAP Grant (25%)', 'Federal Grant', 'USDA Rural Energy for America Program grant covering up to 25% of eligible renewable energy project costs (max $1M). Note: as of 2025, USDA will not fund ground-mounted solar >50 kW and prohibits foreign-manufactured panels. Primarily applicable to rooftop or small behind-the-meter systems.', 'Agricultural producers/rural small businesses; ground-mount solar limited to <=50 kW since 2025.', 'federal_grant', 0.25, 1000000.0, 'reap', 70)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, capex_grant_fraction, capex_grant_cap, mutual_exclusion_group, sort_order)
VALUES ('reap_50', 'USDA REAP Grant (50%)', 'Federal Grant', 'REAP grant covering up to 50% of eligible project costs (max $1M) for zero-GHG or energy-community projects. Note: 2025 USDA policy caps ground-mounted solar at 50 kW and bans foreign-manufactured panels. Structures and rooftop installations prioritized.', 'Agricultural producers with zero-emission projects; ground-mount solar <=50 kW since 2025.', 'federal_grant', 0.50, 1000000.0, 'reap', 80)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, opex_savings_per_mw_yr, sort_order)
VALUES ('pa108_solar_exemption', 'PA 108 Solar Exemption', 'State Program', 'Public Act 108 (2023) replaces ad valorem property taxes with a specific tax of $7,000/MW-yr for 20 years on solar facilities >= 2 MW (reduced to $2,000/MW-yr for qualifying community benefit projects). Estimated savings ~$8,000/MW-yr vs ~$15,000/MW ad valorem taxes.', 'Solar projects >= 2 MW approved by local government and MI State Tax Commission.', 'state', 8000.0, 90)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, capex_flat_reduction, sort_order)
VALUES ('egle_ag_grant', 'EGLE Ag Energy Grant ($50K)', 'State Grant', 'EGLE matching grant up to $50,000 for farms and rural businesses to fund renewable energy projects including agrivoltaics. Requires 1:1 match; entities must have fewer than 500 employees.', 'Michigan farms and rural businesses (<500 employees); 1:1 match required.', 'state', 50000.0, 100)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, capex_flat_reduction, sort_order)
VALUES ('mdard_regen_grant', 'MDARD Regen Network Grant ($50K)', 'State Grant', 'MDARD grant up to $50,000 to farmer-led networks implementing regenerative agriculture practices. May support agrivoltaics with pollinator habitat or cover cropping under panels.', 'Farmers implementing regenerative practices; proposals due annually.', 'state', 50000.0, 110)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, capex_flat_reduction, configurable, sort_order)
VALUES ('brownfield_egle', 'EGLE Brownfield Grant (up to $1M)', 'State Grant', 'EGLE grants/loans up to $1M for environmental investigation, cleanup, UST removal and demolition on contaminated properties. 1.5% interest with 15-year repayment. Combinable with Act 381 TIF. Pending legislation would raise cap to $2M. FY26 budget: $77.6M statewide.', 'Local governments or brownfield authorities with contaminated sites.', 'state', 1000000.0, '{"key":"brownfield_egle_amount","label":"Grant Amount","type":"currency","min":0,"max":1000000,"step":50000,"default":500000}'::jsonb, 120)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, farmer_cost_share_per_acre, sort_order)
VALUES ('eqip_pollinator', 'NRCS EQIP Pollinator ($878/ac)', 'Conservation', 'NRCS EQIP cost-share for pollinator habitat establishment (Practice E420B): $877.63/acre Michigan FY2025 rate (up to 75% cost-share). Historically underserved producers may receive 90% and advance payments. Rates updated annually by NRCS.', 'Farmers with USDA-registered land and conservation plan.', 'conservation', 877.63, 130)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, farmer_annual_revenue_per_acre, sort_order)
VALUES ('crp_conservation', 'CRP Conservation Cover ($250/ac/yr)', 'Conservation', 'FSA Conservation Reserve Program pays annual rental plus 50% establishment cost-share for permanent vegetative cover. Contracts 10-15 years. Representative Michigan rate ~$250/acre/year.', 'Landowners with environmentally sensitive land; voluntary enrollment.', 'conservation', 250.0, 140)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, depreciation_100pct, depreciation_tax_rate, sort_order)
VALUES ('bonus_depreciation', 'MACRS + 100% Bonus Depreciation', 'Federal Tax Benefit', 'OBBBA (P.L. 119-21) permanently restores 100% bonus depreciation under IRC §168(k) for qualified property placed in service after Jan 19, 2025. Solar qualifies as 5-year MACRS property. Depreciable basis = CAPEX minus (ITC x 50%). At 21% corporate tax rate with 30% ITC, the year-1 tax shield equals ~17.85% of gross CAPEX.', 'All commercial solar projects placed in service after Jan 19, 2025.', 'depreciation', TRUE, 0.21, 150)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, farmer_annual_revenue_per_acre, sort_order)
VALUES ('csp_stewardship', 'NRCS CSP ($35/ac/yr)', 'Conservation', 'Conservation Stewardship Program provides annual payments (~$35/ac/yr average, $4,000 minimum) for 5-year contracts to farmers adopting enhanced conservation practices on working lands. Over 200 eligible enhancements. Michigan FY2025 rates vary by practice; agrivoltaic grazing and cover cropping are commonly funded.', 'Agricultural producers with NRCS conservation plan on working lands.', 'conservation', 35.0, 160)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, opex_savings_per_mw_yr, sort_order)
VALUES ('act381_brownfield_tif', 'Act 381 Brownfield TIF', 'State Program', 'Michigan Brownfield Redevelopment Financing Act (PA 381 of 1996) allows developers to recapture eligible cleanup, demolition, and infrastructure costs through tax increment financing (TIF) on the redeveloped property. Performance-based: developer invests first, then captures new property tax increment for reimbursement over 15-30 years. Requires local BRA approval. Combinable with EGLE brownfield grants.', 'Brownfield properties with local BRA-approved redevelopment plan.', 'state', 4000.0, 170)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, rec_per_mwh, sort_order)
VALUES ('rec_revenue', 'MI REC Revenue (~$5/MWh)', 'Market Revenue', 'Michigan solar generators earn Renewable Energy Credits (RECs) tracked through MIRECS/GATS. Michigan has no solar carve-out, but RECs can be sold into the OH/PA Tier-I market or to Michigan utilities for RPS compliance (PA 235 requires 60% renewable by 2035). Conservative estimate ~$5/MWh (range $1-$15/MWh). Stackable with ITC/PTC and all other incentives.', 'Any grid-connected solar facility registered in MIRECS.', 'market', 5.0, 180)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, community_payment_per_mw, sort_order)
VALUES ('rrca_community', 'EGLE RRCA ($5K/MW)', 'State Program', 'EGLE Renewables Ready Communities Award provides $5,000/MW (host+permit) or $2,500/MW (host-only) to municipalities hosting solar/storage projects >= 50 MW. Funded by state budget ($30M initial + $129M federal expansion). Disbursed 50% at construction start, 50% at operation. Reduces community opposition costs; effectively offsets host community payment obligations.', 'Solar/storage projects >= 50 MW with local government host/permit.', 'state', 5000.0, 190)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, sort_order)
VALUES ('pa116_suspension', 'PA 116 Credit Suspension', 'State Regulatory', 'Farmland enrolled in PA 116 leased for solar cannot claim the Farmland Preservation income tax credit on solar acres. Agricultural property tax exemption (18-mill) maintained if >50% stays agricultural.', 'Applies to all PA 116-enrolled land leased for solar.', 'regulatory', 200)
ON CONFLICT (id) DO NOTHING;

-- Users table for simple auth
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Seed admin user (bcrypt via pgcrypto)
INSERT INTO users (username, password_hash)
VALUES ('joshadmin', crypt('BE487', gen_salt('bf')))
ON CONFLICT (username) DO NOTHING;

-- Create raster indexes (skip if already exist)
CREATE INDEX IF NOT EXISTS idx_landcover_nlcd_2024_raster_rast ON landcover_nlcd_2024_raster USING GIST (ST_ConvexHull(rast));
CREATE INDEX IF NOT EXISTS idx_slope_raster_rast ON slope_raster USING GIST (ST_ConvexHull(rast));
CREATE INDEX IF NOT EXISTS idx_population_raster_rast ON population_raster USING GIST (ST_ConvexHull(rast));

-- Insert sample farm data (skip if already exists)
INSERT INTO farms (user_id, name, boundary) VALUES
('demo', 'Small Solar Farm (150 acres)', ST_GeomFromText('POLYGON((-82.8 42.2, -82.8 42.25, -82.75 42.25, -82.75 42.2, -82.8 42.2))', 4326)),
('demo', 'Medium Solar Farm (300 acres)', ST_GeomFromText('POLYGON((-82.85 42.15, -82.85 42.22, -82.78 42.22, -82.78 42.15, -82.85 42.15))', 4326)),
('demo', 'Large Solar Farm (500 acres)', ST_GeomFromText('POLYGON((-82.9 42.1, -82.9 42.2, -82.75 42.2, -82.75 42.1, -82.9 42.1))', 4326))
ON CONFLICT DO NOTHING;