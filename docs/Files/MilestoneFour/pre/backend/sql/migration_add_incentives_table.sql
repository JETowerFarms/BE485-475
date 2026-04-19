-- Migration: add incentives catalog table
-- Safe to run against an existing DB; all statements are idempotent.

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
