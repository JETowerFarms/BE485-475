const express = require('express');
const Joi = require('joi');
const { db } = require('../database');

const router = express.Router();

const DEFAULT_EQUATIONS = [
  { title: 'Solar CAPEX per acre', eq: 'CAPEX = [(C_install / α) + C_site + C_grade + C_retill + C_bond + f_inter × (C_install / α)] × (1 + f_soft)' },
  { title: 'Construction financing (IDC)', eq: 'ConFinFactor = 0.5×[1 + (1−τ)×((1+r_con)^1.5 − 1)] + 0.5×[1 + (1−τ)×((1+r_con)^0.5 − 1)]' },
  { title: 'Solar energy (year t)', eq: 'E_t = 8760 × CF × R_dc:ac × clip_limit × 1000 × (1−d)^t × η_avail × η_curt(t) × η_export' },
  { title: 'Curtailment (increasing)', eq: 'η_curt(t) = η_curt × (1 − c_inc × (t−2))' },
  { title: 'Revenue: PPA / merchant', eq: 'Rev_t = E_t/α × (PPA_rate if t<PPA_end, else P_elec(t) × (1−d_merchant))' },
  { title: 'O&M cost (escalating)', eq: 'OM_t = OM_base × (1+g_om)^(t−2) + (Veg+Ins) × (1+g_opex)^(t−2) + PropTax × (1+g_ptax)^(t−2)' },
  { title: 'Debt service (annual)', eq: 'DS = P_debt × r(1+r)^n / [(1+r)^n − 1]' },
  { title: 'MACRS depreciation', eq: 'DepBasis = CAPEX × (1 − ITC/2); shield_yr = DepBasis × MACRS_5yr[i] × τ_dev' },
  { title: 'ITC benefit (year 2)', eq: 'ITC = CAPEX × itc_rate (30% base, up to 70% with adders)' },
  { title: 'Lease rate', eq: 'L = (1 − f_retain) × NPV_solar / Σ_{t=1…T} 1/(1+r_farmer)^t' },
  { title: 'Crop PV per acre', eq: 'PV_crop = Σ_{t=1…T} (yield × price_t − cost) / (1+r_farmer)^t' },
  { title: 'Objective (maximize)', eq: 'max z = PV_lease × A_s + Σ_j PV_crop_j × A_cj' },
  { title: 'Coupling constraint', eq: 'A_s + Σ A_cj = crop_land' },
  { title: 'Min agriculture', eq: 'Σ A_cj ≥ 0.51 × total_land' },
  { title: 'Solar cap', eq: 'A_s ≤ min(usable, prime_cap, zoning_cap, interconnect × α)' },
];

const FIELD_DEFS = [
  { camel: 'discountRate', column: 'discount_rate' },
  { camel: 'inflationRate', column: 'inflation_rate' },
  { camel: 'electricityEscalation', column: 'electricity_escalation' },
  { camel: 'cropEscalation', column: 'crop_escalation' },
  { camel: 'projectLife', column: 'project_life' },

  { camel: 'degradationRate', column: 'degradation_rate' },
  { camel: 'installedCostPerMW', column: 'installed_cost_per_mw' },
  { camel: 'sitePrepCostPerAcre', column: 'site_prep_cost_per_acre' },
  { camel: 'gradingCostPerAcre', column: 'grading_cost_per_acre' },
  { camel: 'retillingCostPerAcre', column: 'retilling_cost_per_acre' },
  { camel: 'interconnectionFraction', column: 'interconnection_fraction' },
  { camel: 'bondCostPerAcre', column: 'bond_cost_per_acre' },
  { camel: 'vegetationCostPerAcre', column: 'vegetation_cost_per_acre' },
  { camel: 'insuranceCostPerAcre', column: 'insurance_cost_per_acre' },
  { camel: 'oandmCostPerKw', column: 'oandm_cost_per_kw' },
  { camel: 'replacementCostPerMW', column: 'replacement_cost_per_mw' },
  { camel: 'replacementYear', column: 'replacement_year' },
  { camel: 'decommissionCostPerKw', column: 'decommission_cost_per_kw' },
  { camel: 'remediationCostPerAcre', column: 'remediation_cost_per_acre' },
  { camel: 'salvageValuePerAcre', column: 'salvage_value_per_acre' },
  { camel: 'availabilityFactor', column: 'availability_factor' },
  { camel: 'curtailmentFactor', column: 'curtailment_factor' },
  { camel: 'exportFactor', column: 'export_factor' },
  { camel: 'leaseMinRate', column: 'lease_min_rate' },
  { camel: 'leaseMaxRate', column: 'lease_max_rate' },
  { camel: 'leaseEscalationRate', column: 'lease_escalation_rate' },
  { camel: 'developerRetentionFraction', column: 'developer_retention_fraction' },
  { camel: 'constraintsMinAgFraction', column: 'constraints_min_ag_fraction' },
  { camel: 'constraintsMaxPrimeSolar', column: 'constraints_max_prime_solar' },
  { camel: 'constraintsZoningMaxSolar', column: 'constraints_zoning_max_solar' },
  { camel: 'constraintsSetbackFraction', column: 'constraints_setback_fraction' },
  { camel: 'constraintsEasementAcres', column: 'constraints_easement_acres' },
  { camel: 'constraintsWetlandExclusionAcres', column: 'constraints_wetland_exclusion_acres' },
  { camel: 'constraintsInterconnectCapacityMw', column: 'constraints_interconnect_capacity_mw' },
  { camel: 'farmerPa116CreditPerAcre', column: 'farmer_pa116_credit_per_acre' },
  // ── New parameters (12 improvements) ──
  { camel: 'constructionInterestRate', column: 'construction_interest_rate' },
  { camel: 'developerDiscountRate', column: 'developer_discount_rate' },
  { camel: 'developerTaxRate', column: 'developer_tax_rate' },
  { camel: 'electricityPrice0', column: 'electricity_price_0' },
  { camel: 'oandmEscalationRate', column: 'oandm_escalation_rate' },
  { camel: 'opexEscalationRate', column: 'opex_escalation_rate' },
  { camel: 'propertyTaxPerKw', column: 'property_tax_per_kw' },
  { camel: 'propertyTaxEscalation', column: 'property_tax_escalation' },
  { camel: 'ppaPriceKwh', column: 'ppa_price_kwh' },
  { camel: 'ppaYears', column: 'ppa_years' },
  { camel: 'merchantDiscount', column: 'merchant_discount' },
  { camel: 'debtFraction', column: 'debt_fraction' },
  { camel: 'debtInterestRate', column: 'debt_interest_rate' },
  { camel: 'debtTermYears', column: 'debt_term_years' },
  { camel: 'softCostFraction', column: 'soft_cost_fraction' },
  { camel: 'dcAcRatio', column: 'dc_ac_ratio' },
  { camel: 'workingCapitalMonths', column: 'working_capital_months' },
  { camel: 'curtailmentAnnualIncrease', column: 'curtailment_annual_increase' },
];

const modelSchema = Joi.object({
  name: Joi.string().trim().min(1).required(),
  description: Joi.string().allow('', null).default(null),
  equations: Joi.array().items(Joi.object({
    title: Joi.string().trim().required(),
    eq: Joi.string().trim().required(),
  })).optional(),
  ...FIELD_DEFS.reduce((acc, field) => {
    acc[field.camel] = Joi.number().optional().allow(null);
    return acc;
  }, {}),
});

function toDbPayload(body) {
  const payload = {};
  FIELD_DEFS.forEach(({ camel, column }) => {
    if (Object.prototype.hasOwnProperty.call(body, camel)) {
      const val = body[camel];
      payload[column] = val === undefined ? null : val;
    }
  });
  if (Object.prototype.hasOwnProperty.call(body, 'equations')) {
    payload.equations = body.equations ? JSON.stringify(body.equations) : null;
  }
  return payload;
}

function serialize(row) {
  if (!row) return null;
  const out = {
    id: row.id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    equations: row.equations,
  };
  FIELD_DEFS.forEach(({ camel, column }) => {
    out[camel] = row[column];
  });
  return out;
}

router.get('/', async (req, res) => {
  try {
    const rows = await db.any('SELECT * FROM models ORDER BY created_at DESC');
    res.json({ models: rows.map(serialize) });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch models', details: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { value, error } = modelSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(422).json({ error: 'Validation failed', details: error.details.map((d) => d.message) });
    }

    const dbPayload = toDbPayload(value);
    const columns = Object.keys(dbPayload).filter((key) => dbPayload[key] !== undefined);
    const values = columns.map((c) => dbPayload[c]);

    let row;
    if (columns.length === 0) {
      row = await db.one(
        'INSERT INTO models (name, description) VALUES ($1, $2) RETURNING *',
        [value.name, value.description || null]
      );
    } else {
      const idxParams = columns.map((_, idx) => `$${idx + 1}`).join(', ');
      const colList = columns.join(', ');
      const insertSql = `INSERT INTO models (name, description, ${colList}) VALUES ($${values.length + 1}, $${values.length + 2}, ${idxParams}) RETURNING *`;
      row = await db.one(insertSql, [...values, value.name, value.description || null]);
    }

    // Return with camelCase keys for the client
    res.status(201).json(serialize(row));
  } catch (err) {
    const status = err?.code === '23505' ? 409 : 500; // unique violation
    res.status(status).json({ error: 'Failed to create model', details: err.message });
  }
});

router.get('/template', async (req, res) => {
  try {
    const row = await db.oneOrNone("SELECT * FROM models WHERE name='Default' ORDER BY id ASC LIMIT 1");
    if (row) {
      const serialized = serialize(row);
      if (!serialized.equations) {
        serialized.equations = DEFAULT_EQUATIONS;
      }
      return res.json({ template: serialized });
    }

    const fallback = {
      name: 'Default',
      description: 'Baseline parameters prior to user-defined overrides',
      discountRate: 0.08,
      inflationRate: 0.02,
      electricityEscalation: 0.02,
      cropEscalation: 0.0,
      projectLife: 27,
      landIntensityAcresPerMW: 5.5,
      degradationRate: 0.005,
      installedCostPerMW: 1610000.0,
      sitePrepCostPerAcre: 36800.0,
      gradingCostPerAcre: 8286.0,
      retillingCostPerAcre: 950.0,
      interconnectionFraction: 0.30,
      bondCostPerAcre: 10000.0,
      vegetationCostPerAcre: 225.0,
      insuranceCostPerAcre: 100.0,
      oandmCostPerKw: 11.0,
      replacementCostPerMW: 100000.0,
      replacementYear: 14,
      decommissionCostPerKw: 400.0,
      remediationCostPerAcre: 2580.0,
      salvageValuePerAcre: 12500.0,
      availabilityFactor: 0.98,
      curtailmentFactor: 0.95,
      exportFactor: 1.0,
      leaseMinRate: null,
      leaseMaxRate: null,
      leaseEscalationRate: 0.0,
      developerRetentionFraction: 0.25,
      constraintsMinAgFraction: 0.51,
      constraintsMaxPrimeSolar: 40.0,
      constraintsZoningMaxSolar: 40.0,
      constraintsSetbackFraction: 0.10,
      constraintsEasementAcres: 0.0,
      constraintsWetlandExclusionAcres: 0.0,
      constraintsInterconnectCapacityMw: 10.0,
      farmerPa116CreditPerAcre: 0.0,
      // ── New parameters (12 improvements) ──
      constructionInterestRate: 0.065,
      developerDiscountRate: 0.055,
      developerTaxRate: 0.257,
      electricityPrice0: 0.10,
      oandmEscalationRate: 0.0075,
      opexEscalationRate: 0.005,
      propertyTaxPerKw: 0.0,
      propertyTaxEscalation: 0.01,
      ppaPriceKwh: 0.0,
      ppaYears: 0,
      merchantDiscount: 0.20,
      debtFraction: 0.0,
      debtInterestRate: 0.07,
      debtTermYears: 18,
      softCostFraction: 0.05,
      dcAcRatio: 1.0,
      workingCapitalMonths: 0.0,
      curtailmentAnnualIncrease: 0.0,
      equations: DEFAULT_EQUATIONS,
    };
    return res.json({ template: fallback });
  } catch (err) {
    res.status(500).json({ error: 'Failed to load model template', details: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) {
      return res.status(400).json({ error: 'Invalid model id' });
    }

    // Prevent deletion of the Default model
    const row = await db.oneOrNone('SELECT id, name FROM models WHERE id = $1', [id]);
    if (!row) {
      return res.status(404).json({ error: 'Model not found' });
    }
    if (row.name === 'Default') {
      return res.status(403).json({ error: 'The Default model cannot be deleted' });
    }

    await db.none('DELETE FROM models WHERE id = $1', [id]);
    res.json({ deleted: true, id });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete model', details: err.message });
  }
});

module.exports = router;
