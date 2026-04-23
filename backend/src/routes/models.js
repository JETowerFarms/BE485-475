const express = require('express');
const Joi = require('joi');
const { db } = require('../database');

const router = express.Router();

const DEFAULT_EQUATIONS = [
  {
    title: 'Solar CAPEX per acre',
    eq: 'CAPEX = (C_inst/alpha + C_site + C_grade + C_retile + C_bond\n'
      + '       + f_inter * C_inst/alpha) * (1 + f_soft)\n'
      + 'where C_inst = installed_cost_per_MW / alpha\n'
      + '      alpha  = land_intensity_acres_per_MW',
  },
  {
    title: 'Construction financing factor (IDC)',
    eq: 'CFF = 0.5 * [1 + (1-tau) * ((1+r_con)^1.5 - 1)]\n'
      + '    + 0.5 * [1 + (1-tau) * ((1+r_con)^0.5 - 1)]\n'
      + 'where r_con = construction_interest_rate\n'
      + '      tau   = developer_tax_rate\n'
      + 'Cash CAPEX year 0 & 1 = CFF * CAPEX / 2 each',
  },
  {
    title: 'Solar energy (year t)',
    eq: 'E_t = 8760 * CF * 1000 * clip(dc_ratio, 1.15)\n'
      + '    * (1 - d)^(t-2) * eta_avail * eta_curt(t) * eta_export\n'
      + '                                                  [kWh / MWac / yr]\n'
      + 'where d = degradation_rate, CF from PVWatts API',
  },
  {
    title: 'Curtailment (year t)',
    eq: 'eta_curt(t) = max(0, eta_curt_0 - c_inc * (t - 2))\n'
      + 'where eta_curt_0 = curtailment_factor\n'
      + '      c_inc      = curtailment_annual_increase',
  },
  {
    title: 'Revenue: PPA / merchant tail (year t)',
    eq: 'Rev_t = (E_t / alpha) * price_t             [$/acre/yr]\n'
      + 'price_t = ppa_price_kwh                     if t < 2 + ppa_years\n'
      + '        = P_elec_0 * (1+g_elec)^t * (1 - d_merchant)  otherwise\n'
      + 'where d_merchant = merchant_discount',
  },
  {
    title: 'O&M cost (year t, escalating)',
    eq: 'OM_t = OM_base * (1 + g_om)^(t-2)\n'
      + '     + (veg + ins) * (1 + g_opex)^(t-2)\n'
      + '     + prop_tax * (1 + g_ptax)^(t-2)\n'
      + 'where OM_base = oandm_cost_per_kw * 1000 / alpha',
  },
  {
    title: 'Debt service (annual)',
    eq: 'DS = P_debt * r_d * (1+r_d)^n / ((1+r_d)^n - 1)\n'
      + 'where P_debt = CAPEX * debt_fraction\n'
      + '      r_d    = debt_interest_rate\n'
      + '      n      = debt_term_years',
  },
  {
    title: 'MACRS 5-yr depreciation tax shield',
    eq: 'DepBasis = CAPEX * (1 - itc_rate/2)         [IRC sec 50(c)(3)]\n'
      + 'shield_t = DepBasis * MACRS[t-2] * tau_dev\n'
      + 'MACRS schedule (t=2..7): 20%, 32%, 19.2%, 11.52%, 11.52%, 5.76%\n'
      + 'where tau_dev = developer_tax_rate',
  },
  {
    title: 'ITC benefit (year 2, placed in service)',
    eq: 'ITC = CAPEX * itc_rate\n'
      + 'itc_rate: 30% base + adders (energy community, domestic content,\n'
      + '          low-income) up to 70% effective rate',
  },
  {
    title: 'Lease rate (annual $/acre)',
    eq: 'NPV_dev = sum_{t=0..T} (Rev_t - OM_t - DS + shield_t) / (1+r_dev)^t\n'
      + '        - decommission / (1+r_dev)^T\n'
      + 'PV_ann  = sum_{t=1..T} (1+g_lease)^t / (1+r_farmer)^t\n'
      + 'L = (1 - f_retain) * NPV_dev / PV_ann\n'
      + 'L = clamp(L, L_min, L_max)           if bounds are set',
  },
  {
    title: 'Crop PV per acre',
    eq: 'PV_crop_j = sum_{t=1..T} (yield_j * price_jt - cost_j) / (1+r_farmer)^t\n'
      + 'where price_jt = price_j0 * (1 + g_crop_j)^t',
  },
  {
    title: 'Objective (maximize farmer NPV)',
    eq: 'max z = PV_lease * A_s + sum_j PV_crop_j * A_cj\n'
      + 'where PV_lease = L * PV_ann',
  },
  {
    title: 'Land coupling constraint',
    eq: 'A_s / (1 - setback) + sum_j A_cj = crop_land\n'
      + 'where crop_land = total_land - easements - wetlands\n'
      + '      setback   = constraints_setback_fraction',
  },
  {
    title: 'Min agriculture (traditional crops)',
    eq: 'sum_j A_cj >= min_ag_frac * total_land\n'
      + 'where min_ag_frac = constraints_min_ag_fraction (default 0.51)',
  },
  {
    title: 'Solar panel-acres cap',
    eq: 'A_s <= min(usable, prime_cap, zoning_cap, interconnect_MW * alpha)\n'
      + 'where usable = crop_land * (1 - setback)',
  },
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
  { camel: 'retilingCostPerAcre', column: 'retiling_cost_per_acre' },
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
      retilingCostPerAcre: 950.0,
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
