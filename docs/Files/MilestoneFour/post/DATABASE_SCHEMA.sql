-- ============================================================================
-- Michigan Solar Optimization Database Schema  (Artifact 3 – canonical DDL)
-- ============================================================================
-- This file is the SINGLE source of truth for every table the application
-- uses.  Migrations add/alter columns on top of this baseline.  Seed data
-- lives in a separate idempotent section at the bottom.
--
-- Safe to run repeatedly: every statement uses IF NOT EXISTS / ON CONFLICT.
-- ============================================================================

-- ── Extensions ──────────────────────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Custom scoring function ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION score_landcover(nlcd_code integer)
RETURNS integer AS $$
BEGIN
  CASE nlcd_code
    WHEN 11 THEN RETURN 100;
    WHEN 12 THEN RETURN 100;
    WHEN 21 THEN RETURN 90;
    WHEN 22 THEN RETURN 70;
    WHEN 23 THEN RETURN 50;
    WHEN 24 THEN RETURN 30;
    WHEN 31 THEN RETURN 100;
    WHEN 32 THEN RETURN 100;
    WHEN 41 THEN RETURN 80;
    WHEN 42 THEN RETURN 80;
    WHEN 43 THEN RETURN 80;
    WHEN 51 THEN RETURN 100;
    WHEN 52 THEN RETURN 100;
    WHEN 71 THEN RETURN 100;
    WHEN 72 THEN RETURN 100;
    WHEN 73 THEN RETURN 100;
    WHEN 74 THEN RETURN 100;
    WHEN 81 THEN RETURN 100;
    WHEN 82 THEN RETURN 100;
    WHEN 90 THEN RETURN 100;
    WHEN 95 THEN RETURN 100;
    ELSE RETURN 60;
  END CASE;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- ══════════════════════════════════════════════════════════════════════════════
-- Core application tables
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS farms (
    id            BIGSERIAL PRIMARY KEY,
    user_id       TEXT NOT NULL,
    name          TEXT NOT NULL,
    boundary      GEOGRAPHY(POLYGON, 4326) NOT NULL,
    area_acres    DOUBLE PRECISION,
    centroid      GEOGRAPHY(POINT, 4326),
    avg_suitability DOUBLE PRECISION,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_farms_boundary ON farms USING GIST (boundary);
CREATE INDEX IF NOT EXISTS idx_farms_user_id  ON farms (user_id);

CREATE TABLE IF NOT EXISTS farm_analysis (
    farm_id             BIGINT PRIMARY KEY REFERENCES farms(id) ON DELETE CASCADE,
    total_points        INTEGER,
    avg_overall         DOUBLE PRECISION,
    avg_land_cover      DOUBLE PRECISION,
    avg_slope           DOUBLE PRECISION,
    avg_transmission    DOUBLE PRECISION,
    avg_population      DOUBLE PRECISION,
    min_score           DOUBLE PRECISION,
    max_score           DOUBLE PRECISION,
    suitable_area_acres DOUBLE PRECISION,
    analysis_data       JSONB,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS farm_landcover_reports (
    id                            BIGSERIAL PRIMARY KEY,
    farm_id                       BIGINT NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
    water_percent                 DOUBLE PRECISION,
    is_fully_water                BOOLEAN,
    estimated_site_prep_cost_usd  DOUBLE PRECISION,
    report                        JSONB NOT NULL,
    created_at                    TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_farm_landcover_reports_farm_id_created_at
  ON farm_landcover_reports (farm_id, created_at DESC);

CREATE TABLE IF NOT EXISTS pricing_snapshots (
    id            BIGSERIAL PRIMARY KEY,
    snapshot_key  TEXT NOT NULL,
    payload       JSONB NOT NULL,
    retrieved_at  TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_pricing_snapshots_key_retrieved_at
  ON pricing_snapshots (snapshot_key, retrieved_at DESC);

-- ══════════════════════════════════════════════════════════════════════════════
-- Geo reference tables
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS counties (
    id        BIGSERIAL PRIMARY KEY,
    name      TEXT NOT NULL,
    fips_code TEXT,
    boundary  GEOGRAPHY(MULTIPOLYGON, 4326)
);

CREATE INDEX IF NOT EXISTS idx_counties_name ON counties (name);

CREATE TABLE IF NOT EXISTS cities (
    id         BIGSERIAL PRIMARY KEY,
    county_id  BIGINT REFERENCES counties(id) ON DELETE SET NULL,
    name       TEXT NOT NULL,
    population BIGINT,
    location   GEOGRAPHY(POINT, 4326)
);

CREATE INDEX IF NOT EXISTS idx_cities_county_id ON cities (county_id);

CREATE TABLE IF NOT EXISTS county_bboxes (
    id         SERIAL PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    bbox       GEOMETRY(POLYGON, 4326) NOT NULL,
    bbox_5070  GEOMETRY(POLYGON, 5070) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_county_bboxes_bbox      ON county_bboxes USING GIST (bbox);
CREATE INDEX IF NOT EXISTS idx_county_bboxes_bbox_5070 ON county_bboxes USING GIST (bbox_5070);

CREATE TABLE IF NOT EXISTS substations (
    id         SERIAL PRIMARY KEY,
    properties JSONB,
    geom       GEOMETRY(POINT, 4326),
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_substations_geom ON substations USING GIST (geom);

-- ══════════════════════════════════════════════════════════════════════════════
-- Raster tiles
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS landcover_nlcd_2024_raster (
    rid      SERIAL PRIMARY KEY,
    rast     RASTER,
    filename TEXT
);
CREATE INDEX IF NOT EXISTS idx_landcover_nlcd_2024_raster_rast
  ON landcover_nlcd_2024_raster USING GIST (ST_ConvexHull(rast));

CREATE TABLE IF NOT EXISTS slope_raster (
    rid      SERIAL PRIMARY KEY,
    rast     RASTER,
    filename TEXT
);
CREATE INDEX IF NOT EXISTS idx_slope_raster_rast
  ON slope_raster USING GIST (ST_ConvexHull(rast));

CREATE TABLE IF NOT EXISTS population_raster (
    rid      SERIAL PRIMARY KEY,
    rast     RASTER,
    filename TEXT
);
CREATE INDEX IF NOT EXISTS idx_population_raster_rast
  ON population_raster USING GIST (ST_ConvexHull(rast));

-- ══════════════════════════════════════════════════════════════════════════════
-- Optimizer models
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS models (
    id                              SERIAL PRIMARY KEY,
    name                            TEXT NOT NULL UNIQUE,
    description                     TEXT,
    discount_rate                   DOUBLE PRECISION,
    inflation_rate                  DOUBLE PRECISION,
    electricity_escalation          DOUBLE PRECISION,
    crop_escalation                 DOUBLE PRECISION,
    project_life                    INTEGER,
    degradation_rate                DOUBLE PRECISION,
    installed_cost_per_MW           DOUBLE PRECISION,
    site_prep_cost_per_acre         DOUBLE PRECISION,
    grading_cost_per_acre           DOUBLE PRECISION,
    retiling_cost_per_acre          DOUBLE PRECISION,
    interconnection_fraction        DOUBLE PRECISION,
    bond_cost_per_acre              DOUBLE PRECISION,
    vegetation_cost_per_acre        DOUBLE PRECISION,
    insurance_cost_per_acre         DOUBLE PRECISION,
    oandm_cost_per_kw               DOUBLE PRECISION,
    replacement_cost_per_MW         DOUBLE PRECISION,
    replacement_year                INTEGER,
    decommission_cost_per_kw        DOUBLE PRECISION,
    remediation_cost_per_acre       DOUBLE PRECISION,
    salvage_value_per_acre          DOUBLE PRECISION,
    availability_factor             DOUBLE PRECISION,
    curtailment_factor              DOUBLE PRECISION,
    export_factor                   DOUBLE PRECISION,
    lease_min_rate                  DOUBLE PRECISION,
    lease_max_rate                  DOUBLE PRECISION,
    lease_escalation_rate           DOUBLE PRECISION,
    developer_retention_fraction    DOUBLE PRECISION,
    constraints_min_ag_fraction             DOUBLE PRECISION,
    constraints_max_prime_solar             DOUBLE PRECISION,
    constraints_zoning_max_solar            DOUBLE PRECISION,
    constraints_setback_fraction            DOUBLE PRECISION,
    constraints_easement_acres              DOUBLE PRECISION,
    constraints_wetland_exclusion_acres     DOUBLE PRECISION,
    constraints_interconnect_capacity_mw    DOUBLE PRECISION,
    farmer_pa116_credit_per_acre    DOUBLE PRECISION,
    construction_interest_rate      DOUBLE PRECISION,
    developer_discount_rate         DOUBLE PRECISION,
    developer_tax_rate              DOUBLE PRECISION,
    electricity_price_0             DOUBLE PRECISION,
    oandm_escalation_rate           DOUBLE PRECISION,
    opex_escalation_rate            DOUBLE PRECISION,
    property_tax_per_kw             DOUBLE PRECISION,
    property_tax_escalation         DOUBLE PRECISION,
    ppa_price_kwh                   DOUBLE PRECISION,
    ppa_years                       INTEGER,
    merchant_discount               DOUBLE PRECISION,
    debt_fraction                   DOUBLE PRECISION,
    debt_interest_rate              DOUBLE PRECISION,
    debt_term_years                 INTEGER,
    soft_cost_fraction              DOUBLE PRECISION,
    dc_ac_ratio                     DOUBLE PRECISION,
    working_capital_months          DOUBLE PRECISION,
    curtailment_annual_increase     DOUBLE PRECISION,
    equations                       JSONB,
    created_at                      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at                      TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ══════════════════════════════════════════════════════════════════════════════
-- Incentives catalog
-- ══════════════════════════════════════════════════════════════════════════════

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
    mutual_exclusion_group         TEXT,
    requires_group                 TEXT,
    active                         BOOLEAN NOT NULL DEFAULT TRUE,
    sort_order                     INTEGER NOT NULL DEFAULT 0
);

-- ── Users ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
    id            SERIAL PRIMARY KEY,
    username      TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at    TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ── Crops ───────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS crops (
    id              BIGSERIAL PRIMARY KEY,
    crop            TEXT NOT NULL UNIQUE,
    name            TEXT NOT NULL,
    category        TEXT,
    yield_per_acre  DOUBLE PRECISION,
    price_per_unit_0 DOUBLE PRECISION,
    unit            TEXT,
    cost_per_acre   DOUBLE PRECISION,
    escalation_rate DOUBLE PRECISION DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_crops_name ON crops (name);

-- ══════════════════════════════════════════════════════════════════════════════
-- Seed data  (idempotent)
-- ══════════════════════════════════════════════════════════════════════════════

INSERT INTO models (
    name, description,
    discount_rate, inflation_rate, electricity_escalation, crop_escalation,
    project_life, degradation_rate, installed_cost_per_MW,
    site_prep_cost_per_acre, grading_cost_per_acre, retiling_cost_per_acre,
    interconnection_fraction, bond_cost_per_acre, vegetation_cost_per_acre,
    insurance_cost_per_acre, oandm_cost_per_kw, replacement_cost_per_MW,
    replacement_year, decommission_cost_per_kw, remediation_cost_per_acre,
    salvage_value_per_acre, availability_factor, curtailment_factor,
    export_factor, lease_escalation_rate, developer_retention_fraction,
    constraints_min_ag_fraction, constraints_setback_fraction,
    constraints_interconnect_capacity_mw,
    construction_interest_rate, developer_discount_rate, developer_tax_rate,
    electricity_price_0, oandm_escalation_rate, opex_escalation_rate,
    property_tax_escalation, merchant_discount, debt_interest_rate,
    debt_term_years, soft_cost_fraction, dc_ac_ratio, equations
) VALUES (
    'Default', 'Baseline parameters prior to user-defined overrides',
    0.08, 0.02, 0.02, 0.00,
    27, 0.005, 1610000.0,
    36800.0, 8286.0, 950.0,
    0.30, 10000.0, 225.0,
    100.0, 11.0, 100000.0,
    14, 400.0, 2580.0,
    12500.0, 0.98, 0.95,
    1.0, 0.0, 0.25,
    0.51, 0.10,
    10.0,
    0.065, 0.055, 0.257,
    0.10, 0.0075, 0.005,
    0.01, 0.20, 0.07,
    18, 0.05, 1.0,
    '[
      {"title":"Solar CAPEX per acre","eq":"CAPEX = [(C_install / α) + C_site + C_grade + C_retill + C_bond + f_inter × (C_install / α)] × (1 + f_soft)"},
      {"title":"Construction financing (IDC)","eq":"ConFinFactor = 0.5×[1 + (1−τ)×((1+r_con)^1.5 − 1)] + 0.5×[1 + (1−τ)×((1+r_con)^0.5 − 1)]"},
      {"title":"Solar energy (year t)","eq":"E_t = 8760 × CF × R_dc:ac × clip × 1000 × (1−d)^t × η_avail × η_curt(t) × η_export"},
      {"title":"Curtailment (increasing)","eq":"η_curt(t) = η_curt × (1 − c_inc × (t−2))"},
      {"title":"Revenue: PPA / merchant","eq":"Rev_t = E_t/α × (PPA_rate if t<PPA_end, else P_elec(t) × (1−d_merchant))"},
      {"title":"O&M cost (escalating)","eq":"OM_t = OM_base × (1+g_om)^(t−2) + (Veg+Ins) × (1+g_opex)^(t−2) + PropTax × (1+g_ptax)^(t−2)"},
      {"title":"Debt service (annual)","eq":"DS = P_debt × r(1+r)^n / [(1+r)^n − 1]"},
      {"title":"MACRS depreciation","eq":"DepBasis = CAPEX × (1 − ITC/2); shield = DepBasis × MACRS_5yr[i] × τ_dev"},
      {"title":"ITC benefit (year 2)","eq":"ITC = CAPEX × itc_rate (30% base, up to 70% with adders)"},
      {"title":"Lease rate","eq":"L = (1 − f_retain) × NPV_solar / Σ_{t=1…T} 1/(1+r_farmer)^t"},
      {"title":"Crop PV per acre","eq":"PV_crop = Σ_{t=1…T} (yield × price_t − cost) / (1+r_farmer)^t"},
      {"title":"Objective (maximize)","eq":"max z = PV_lease × A_s + Σ_j PV_crop_j × A_cj"},
      {"title":"Coupling constraint","eq":"A_s + Σ A_cj = crop_land"},
      {"title":"Min agriculture","eq":"Σ A_cj ≥ 0.51 × total_land"},
      {"title":"Solar cap","eq":"A_s ≤ min(usable, prime_cap, zoning_cap, interconnect × α)"}
    ]'::jsonb
) ON CONFLICT (name) DO NOTHING;

-- Incentive seed rows
INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, itc_override, sort_order)
VALUES ('itc_base', 'Federal ITC (30%)', 'Federal Tax Credit', 'Clean Electricity Investment Credit under IRC §48E – 30% credit.', 'Commercial solar; construction by Jul 4 2026.', 'itc_base', 0.30, 10)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, itc_bonus, sort_order)
VALUES ('itc_domestic_content', 'Domestic Content Bonus (+10%)', 'Federal Tax Credit', 'Additional 10pp ITC for domestic content.', 'Projects using domestic steel/iron/components.', 'itc_adder', 0.10, 20)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, itc_bonus, sort_order)
VALUES ('itc_energy_community', 'Energy Community Bonus (+10%)', 'Federal Tax Credit', 'Additional 10pp ITC for energy communities.', 'Projects in designated energy communities.', 'itc_adder', 0.10, 30)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, itc_bonus, mutual_exclusion_group, sort_order)
VALUES ('itc_low_income_10', 'Low-Income Community Bonus (+10%)', 'Federal Tax Credit', '10pp ITC adder for <5 MW in low-income areas.', '<5 MW AC in low-income communities; competitive.', 'itc_adder', 0.10, 'low_income', 40)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, itc_bonus, mutual_exclusion_group, sort_order)
VALUES ('itc_low_income_20', 'Low-Income Benefit Bonus (+20%)', 'Federal Tax Credit', '20pp ITC adder for <5 MW benefiting low-income.', '<5 MW AC providing direct economic benefit.', 'itc_adder', 0.20, 'low_income', 50)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, ptc_per_kwh, ptc_years, sort_order)
VALUES ('ptc', 'Federal PTC (3.0c/kWh)', 'Federal Tax Credit', 'IRC §45Y – 3.0c/kWh for 10 years.', 'Clean generators; mutually exclusive with ITC.', 'ptc', 0.030, 10, 60)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, capex_grant_fraction, capex_grant_cap, mutual_exclusion_group, sort_order)
VALUES ('reap_25', 'USDA REAP Grant (25%)', 'Federal Grant', 'REAP – 25% of costs, max $1M.', 'Ag producers; ground-mount <=50 kW.', 'federal_grant', 0.25, 1000000.0, 'reap', 70)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, capex_grant_fraction, capex_grant_cap, mutual_exclusion_group, sort_order)
VALUES ('reap_50', 'USDA REAP Grant (50%)', 'Federal Grant', 'REAP – 50% of costs, max $1M (zero-GHG).', 'Ag producers; zero-emission; <=50 kW.', 'federal_grant', 0.50, 1000000.0, 'reap', 80)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, opex_savings_per_mw_yr, sort_order)
VALUES ('pa108_solar_exemption', 'PA 108 Solar Exemption', 'State Program', 'PA 108 specific tax replaces ad valorem.', 'Solar >= 2 MW.', 'state', 8000.0, 90)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, capex_flat_reduction, sort_order)
VALUES ('egle_ag_grant', 'EGLE Ag Energy Grant ($50K)', 'State Grant', 'EGLE matching grant up to $50K.', 'MI farms <500 employees; 1:1 match.', 'state', 50000.0, 100)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, capex_flat_reduction, sort_order)
VALUES ('mdard_regen_grant', 'MDARD Regen Network Grant ($50K)', 'State Grant', 'MDARD grant up to $50K.', 'Regenerative ag practices.', 'state', 50000.0, 110)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, capex_flat_reduction, configurable, sort_order)
VALUES ('brownfield_egle', 'EGLE Brownfield Grant (up to $1M)', 'State Grant', 'EGLE grants/loans up to $1M.', 'Brownfield authorities.', 'state', 1000000.0, '{"key":"brownfield_egle_amount","label":"Grant Amount","type":"currency","min":0,"max":1000000,"step":50000,"default":500000}'::jsonb, 120)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, farmer_cost_share_per_acre, sort_order)
VALUES ('eqip_pollinator', 'NRCS EQIP Pollinator ($878/ac)', 'Conservation', 'EQIP E420B – $877.63/ac.', 'USDA-registered land.', 'conservation', 877.63, 130)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, farmer_annual_revenue_per_acre, sort_order)
VALUES ('crp_conservation', 'CRP Conservation Cover ($250/ac/yr)', 'Conservation', 'CRP annual rental.', 'Environmentally sensitive land.', 'conservation', 250.0, 140)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, depreciation_100pct, depreciation_tax_rate, sort_order)
VALUES ('bonus_depreciation', 'MACRS + 100% Bonus Depreciation', 'Federal Tax Benefit', '100% bonus depreciation (OBBBA).', 'Solar placed in service after Jan 19 2025.', 'depreciation', TRUE, 0.21, 150)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, farmer_annual_revenue_per_acre, sort_order)
VALUES ('csp_stewardship', 'NRCS CSP ($35/ac/yr)', 'Conservation', 'CSP ~$35/ac/yr 5-yr contracts.', 'NRCS conservation plan.', 'conservation', 35.0, 160)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, opex_savings_per_mw_yr, sort_order)
VALUES ('act381_brownfield_tif', 'Act 381 Brownfield TIF', 'State Program', 'Act 381 TIF recapture.', 'BRA-approved brownfields.', 'state', 4000.0, 170)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, rec_per_mwh, sort_order)
VALUES ('rec_revenue', 'MI REC Revenue (~$5/MWh)', 'Market Revenue', 'Michigan RECs via MIRECS.', 'Grid-connected solar.', 'market', 5.0, 180)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, community_payment_per_mw, sort_order)
VALUES ('rrca_community', 'EGLE RRCA ($5K/MW)', 'State Program', 'RRCA host community payment.', 'Solar >= 50 MW.', 'state', 5000.0, 190)
ON CONFLICT (id) DO NOTHING;

INSERT INTO incentives (id, name, category, description, eligibility, incentive_group, sort_order)
VALUES ('pa116_suspension', 'PA 116 Credit Suspension', 'State Regulatory', 'PA 116 credit suspended on solar acres.', 'PA 116-enrolled land.', 'regulatory', 200)
ON CONFLICT (id) DO NOTHING;

-- NOTE: Admin user is NOT seeded here.  Use seed_admin.js with the
-- ADMIN_PASSWORD environment variable to create the admin account.
