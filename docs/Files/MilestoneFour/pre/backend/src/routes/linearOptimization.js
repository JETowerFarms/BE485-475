const express = require('express');
const Joi = require('joi');
const { callPvwatts } = require('../services/pvwatts');
const { db } = require('../database');
const { spawn } = require('child_process');
const path = require('path');

const router = express.Router();

// Resolve Python binary: explicit env override wins, then platform default.
const PYTHON_BIN = process.env.PYTHON_BIN || (process.platform === 'win32' ? 'python' : 'python3');

const schema = Joi.object({
  farmId: Joi.string().required(),
  geometry: Joi.object({
    coordinates: Joi.array().required(),
  }).required(),
  acres: Joi.number().positive().required(),
  crops: Joi.array().items(Joi.string().trim()).min(1).required(),
  modelId: Joi.number().integer().allow(null).optional(),
  pvwatts: Joi.object({
    lat: Joi.number().required(),
    lon: Joi.number().required(),
    system_capacity: Joi.number().positive().required(),
    module_type: Joi.number().required(),
    array_type: Joi.number().required(),
    tilt: Joi.number().required(),
    azimuth: Joi.number().required(),
    losses: Joi.number().required(),
  }).required(),
  modelFlags: Joi.object().optional(),
});

function validate(body) {
  const { error, value } = schema.validate(body, { abortEarly: false, stripUnknown: true });
  if (error) {
    const err = new Error('Validation failed');
    err.statusCode = 422;
    err.details = error.details.map((d) => d.message);
    throw err;
  }
  return value;
}

async function fetchCropData(cropNames) {
  const rows = await db.any(
    `SELECT name, yield_per_acre, price_per_unit_0, unit, cost_per_acre,
            COALESCE(escalation_rate, 0) AS escalation_rate
       FROM crops
      WHERE name = ANY($1::text[])`,
    [cropNames]
  );

  const foundNames = new Set(rows.map((r) => r.name));
  const missing = cropNames.filter((n) => !foundNames.has(n));
  if (missing.length) {
    const err = new Error(`Missing crop parameters for: ${missing.join(', ')}`);
    err.statusCode = 422;
    throw err;
  }

  rows.forEach((row) => {
    const required = ['yield_per_acre', 'price_per_unit_0', 'unit', 'cost_per_acre'];
    const missingField = required.find((key) => row[key] === null || row[key] === undefined);
    if (missingField) {
      const err = new Error(`Crop '${row.name}' missing required field '${missingField}'`);
      err.statusCode = 422;
      throw err;
    }
  });

  return rows;
}

const DEFAULT_MODEL_CONFIG = {
  name: 'Default',
  discount_rate: 0.08,
  inflation_rate: 0.02,
  electricity_escalation: 0.02,
  crop_escalation: 0.0,
  project_life: 27,
  degradation_rate: 0.005,
  installed_cost_per_MW: 1610000.0,
  site_prep_cost_per_acre: 36800.0,
  grading_cost_per_acre: 8286.0,
  retiling_cost_per_acre: 950.0,
  interconnection_fraction: 0.3,
  bond_cost_per_acre: 10000.0,
  vegetation_cost_per_acre: 225.0,
  insurance_cost_per_acre: 100.0,
  oandm_cost_per_kw: 11.0,
  replacement_cost_per_MW: 100000.0,
  replacement_year: 14,
  decommission_cost_per_kw: 400.0,
  remediation_cost_per_acre: 2580.0,
  salvage_value_per_acre: 12500.0,
  availability_factor: 0.98,
  curtailment_factor: 0.95,
  export_factor: 1.0,
  lease_min_rate: null,
  lease_max_rate: null,
  lease_escalation_rate: 0.0,
  developer_retention_fraction: 0.25,
  constraints_min_ag_fraction: 0.51,
  constraints_max_prime_solar: 0,       // 0 = no cap (site-specific; set per-model when known)
  constraints_zoning_max_solar: 0,      // 0 = no cap (site-specific; set per-model when known)
  constraints_setback_fraction: 0.10,
  constraints_easement_acres: 0.0,
  constraints_wetland_exclusion_acres: 0.0,
  constraints_interconnect_capacity_mw: 10.0,
  farmer_pa116_credit_per_acre: 0.0,
  // ── New parameters (12 improvements) ──
  construction_interest_rate: 0.065,
  developer_discount_rate: 0.055,
  developer_tax_rate: 0.257,
  electricity_price_0: 0.10,
  oandm_escalation_rate: 0.0075,
  opex_escalation_rate: 0.005,
  property_tax_per_kw: 0.0,
  property_tax_escalation: 0.01,
  ppa_price_kwh: 0.0,
  ppa_years: 0,
  merchant_discount: 0.20,
  debt_fraction: 0.0,
  debt_interest_rate: 0.07,
  debt_term_years: 18,
  soft_cost_fraction: 0.05,
  dc_ac_ratio: 1.0,
  working_capital_months: 0.0,
  curtailment_annual_increase: 0.0,
};

async function fetchModel(modelId) {
  if (!modelId) return null;
  return db.oneOrNone('SELECT * FROM models WHERE id = $1', [modelId]);
}

function buildModelConfig(row) {
  if (!row) return null;
  const cfg = { name: row.name };
  Object.keys(DEFAULT_MODEL_CONFIG).forEach((key) => {
    if (key === 'name') return;
    // Only include non-null DB values so DEFAULT_MODEL_CONFIG wins for NULLs
    if (row[key] != null) {
      cfg[key] = row[key];
    }
  });
  return cfg;
}

async function runPython({ acres, crops, cropData, pvwattsData, modelConfig, timeoutMs = 130000 }) {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(__dirname, '..', 'agrivoltaics_model.py');
    const args = [
      scriptPath,
      '--acres',
      String(acres),
      '--crops',
      crops.join(','),
      '--data',
      JSON.stringify(pvwattsData),
      '--crop-data',
      JSON.stringify(cropData),
      '--json',
    ];

    if (modelConfig) {
      args.push('--model-config', JSON.stringify(modelConfig));
    }
    const proc = spawn(PYTHON_BIN, args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    // Kill the process if it exceeds the timeout
    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGKILL');
    }, timeoutMs);

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      if (timedOut) {
        const err = new Error('Optimization timed out — the model did not finish within the allowed time. Try selecting fewer incentive programs.');
        err.statusCode = 504;
        return reject(err);
      }
      if (code !== 0) {
        const err = new Error(`Python optimizer failed with code ${code}: ${stderr || stdout}`);
        err.statusCode = 500;
        return reject(err);
      }
      try {
        const parsed = JSON.parse(stdout.trim().split('\n').pop());
        // Check for Python-side timeout error
        if (parsed && parsed.error === 'timeout') {
          const err = new Error(parsed.message || 'Optimization timed out');
          err.statusCode = 504;
          return reject(err);
        }
        resolve({ parsed, stdout, stderr });
      } catch (parseErr) {
        const err = new Error(`Failed to parse optimizer output: ${parseErr.message}`);
        err.statusCode = 500;
        err.debug = { stdout, stderr };
        reject(err);
      }
    });
  });
}

async function fetchIncentives() {
  return db.any(
    `SELECT id, name, category, description, eligibility, incentive_group,
            itc_override, itc_bonus, ptc_per_kwh, ptc_years,
            capex_grant_fraction, capex_grant_cap, capex_flat_reduction,
            opex_savings_per_mw_yr, depreciation_100pct, depreciation_tax_rate,
            rec_per_mwh, rec_years, community_payment_per_mw,
            farmer_cost_share_per_acre, farmer_annual_revenue_per_acre,
            farmer_annual_cost_per_acre, configurable,
            mutual_exclusion_group, requires_group
       FROM incentives
      WHERE active = TRUE
      ORDER BY sort_order, id`
  );
}

// ═══════════════════════════════════════════════════════════════════
// Incentive CRUD
// ═══════════════════════════════════════════════════════════════════

// Valid groups define the "net" — they control how the model uses the incentive.
const VALID_GROUPS = [
  'itc_base',       // sets ITC rate override
  'itc_adder',      // adds percentage points to ITC
  'ptc',            // per-kWh production credit (mutually exclusive with ITC)
  'federal_grant',  // fraction/cap CAPEX grant
  'state',          // flat CAPEX reduction or OPEX savings
  'conservation',   // farmer cost-share or annual revenue
  'depreciation',   // tax depreciation shield
  'market',         // REC or other per-MWh revenue
  'regulatory',     // informational only, no financial effect
];

// Maps group -> which numeric fields the user should fill in
const GROUP_FIELDS = {
  itc_base:      ['itc_override'],
  itc_adder:     ['itc_bonus'],
  ptc:           ['ptc_per_kwh', 'ptc_years'],
  federal_grant: ['capex_grant_fraction', 'capex_grant_cap'],
  state:         ['capex_flat_reduction', 'opex_savings_per_mw_yr', 'community_payment_per_mw'],
  conservation:  ['farmer_cost_share_per_acre', 'farmer_annual_revenue_per_acre', 'farmer_annual_cost_per_acre'],
  depreciation:  ['depreciation_100pct', 'depreciation_tax_rate'],
  market:        ['rec_per_mwh', 'rec_years'],
  regulatory:    [],
};

const incentiveSchema = Joi.object({
  id: Joi.string().trim().regex(/^[a-z0-9_]+$/).max(80).required(),
  name: Joi.string().trim().max(200).required(),
  category: Joi.string().trim().max(100).required(),
  description: Joi.string().trim().max(2000).required(),
  eligibility: Joi.string().trim().max(1000).required(),
  incentive_group: Joi.string().valid(...VALID_GROUPS).required(),
  itc_override: Joi.number().min(0).max(1).allow(null).default(null),
  itc_bonus: Joi.number().min(0).max(1).default(0),
  ptc_per_kwh: Joi.number().min(0).default(0),
  ptc_years: Joi.number().integer().min(0).default(0),
  capex_grant_fraction: Joi.number().min(0).max(1).default(0),
  capex_grant_cap: Joi.number().min(0).allow(null).default(null),
  capex_flat_reduction: Joi.number().min(0).default(0),
  opex_savings_per_mw_yr: Joi.number().min(0).default(0),
  depreciation_100pct: Joi.boolean().default(false),
  depreciation_tax_rate: Joi.number().min(0).max(1).default(0.21),
  rec_per_mwh: Joi.number().min(0).default(0),
  rec_years: Joi.number().integer().min(0).default(0),
  community_payment_per_mw: Joi.number().min(0).default(0),
  farmer_cost_share_per_acre: Joi.number().min(0).default(0),
  farmer_annual_revenue_per_acre: Joi.number().min(0).default(0),
  farmer_annual_cost_per_acre: Joi.number().min(0).default(0),
  configurable: Joi.object().allow(null).default(null),
  mutual_exclusion_group: Joi.string().trim().max(80).allow(null, '').default(null),
  requires_group: Joi.string().valid(...VALID_GROUPS).allow(null, '').default(null),
  active: Joi.boolean().default(true),
  sort_order: Joi.number().integer().default(0),
});

// GET /incentives – full catalog for selection UI
router.get('/incentives', async (_req, res) => {
  try {
    const rows = await fetchIncentives();
    const incentives = rows
      .filter((r) => r.incentive_group !== 'regulatory')
      .map((r) => {
        const entry = {
          id: r.id,
          name: r.name,
          category: r.category,
          description: r.description,
          group: r.incentive_group,
        };
        if (r.configurable) entry.configurable = r.configurable;
        return entry;
      });
    res.json({ success: true, incentives });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /incentives/all – full detail for admin management
router.get('/incentives/all', async (_req, res) => {
  try {
    const rows = await db.any(
      `SELECT * FROM incentives ORDER BY sort_order, id`
    );
    res.json({ success: true, incentives: rows, validGroups: VALID_GROUPS, groupFields: GROUP_FIELDS });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /incentives – create a new incentive
router.post('/incentives', async (req, res) => {
  try {
    const { error, value } = incentiveSchema.validate(req.body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(422).json({ error: 'Validation failed', details: error.details.map((d) => d.message) });
    }

    const existing = await db.oneOrNone('SELECT id FROM incentives WHERE id = $1', [value.id]);
    if (existing) {
      return res.status(409).json({ error: `Incentive '${value.id}' already exists` });
    }

    const cols = Object.keys(value);
    const nums = cols.map((_, i) => `$${i + 1}`);
    await db.none(
      `INSERT INTO incentives (${cols.join(', ')}) VALUES (${nums.join(', ')})`,
      cols.map((c) => value[c])
    );

    res.status(201).json({ success: true, id: value.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /incentives/:id – update an existing incentive
router.put('/incentives/:id', async (req, res) => {
  try {
    const existing = await db.oneOrNone('SELECT id FROM incentives WHERE id = $1', [req.params.id]);
    if (!existing) {
      return res.status(404).json({ error: `Incentive '${req.params.id}' not found` });
    }

    // Allow partial updates — merge with id from URL
    const body = { ...req.body, id: req.params.id };
    const updateSchema = incentiveSchema.fork(['id'], (s) => s.optional());
    const { error, value } = updateSchema.validate(body, { abortEarly: false, stripUnknown: true });
    if (error) {
      return res.status(422).json({ error: 'Validation failed', details: error.details.map((d) => d.message) });
    }

    const sets = [];
    const vals = [];
    let idx = 1;
    for (const [k, v] of Object.entries(value)) {
      if (k === 'id') continue;
      sets.push(`${k} = $${idx}`);
      vals.push(v);
      idx++;
    }
    vals.push(req.params.id);
    await db.none(`UPDATE incentives SET ${sets.join(', ')} WHERE id = $${idx}`, vals);

    res.json({ success: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /incentives/:id – soft-delete (set active=false)
router.delete('/incentives/:id', async (req, res) => {
  try {
    const result = await db.result(
      'UPDATE incentives SET active = FALSE WHERE id = $1 AND active = TRUE',
      [req.params.id]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: `Incentive '${req.params.id}' not found or already inactive` });
    }
    res.json({ success: true, id: req.params.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const payload = validate(req.body);

    const nrelKey = process.env.NREL_API_KEY;
    if (!nrelKey) {
      return res.status(500).json({ error: 'Missing NREL API key' });
    }

    const pvwattsResponse = await callPvwatts(payload.pvwatts, { apiKey: nrelKey });

    const cropData = await fetchCropData(payload.crops);

    let modelRow = null;
    modelRow = await fetchModel(payload.modelId);
    if (payload.modelId && !modelRow) {
      return res.status(404).json({ error: `Model ${payload.modelId} not found` });
    }

    const modelConfig = modelRow
      ? { ...DEFAULT_MODEL_CONFIG, ...buildModelConfig(modelRow) }
      : { ...DEFAULT_MODEL_CONFIG };

    // Derive land intensity from user-supplied kW/acre (system_capacity = acres × kW/acre)
    modelConfig.land_intensity_acres_per_MW = 1000 * payload.acres / payload.pvwatts.system_capacity;

    // Load full incentive definitions from DB and pass to Python
    const incentiveRows = await fetchIncentives();
    modelConfig.incentive_definitions = incentiveRows;

    // Pass selected incentive IDs from frontend into model config
    if (payload.modelFlags?.eligible_incentives) {
      modelConfig.eligible_incentives = payload.modelFlags.eligible_incentives;
    }
    // Pass user-configurable incentive parameters (e.g. brownfield grant amount)
    if (payload.modelFlags?.incentive_params) {
      modelConfig.incentive_params = payload.modelFlags.incentive_params;
    }

    const { parsed: optimization, stdout: pyStdout, stderr: pyStderr } = await runPython({
      acres: payload.acres,
      crops: payload.crops,
      cropData,
      pvwattsData: pvwattsResponse,
      modelConfig,
    });

    res.json({
      success: true,
      farmId: payload.farmId,
      modelId: payload.modelId || modelRow?.id || null,
      modelName: modelRow?.name || DEFAULT_MODEL_CONFIG.name,
      optimization,
      logs: {
        stdout: pyStdout,
        stderr: pyStderr,
      },
    });
  } catch (err) {
    const status = err.statusCode || 500;
    res.status(status).json({
      error: err.message || 'Internal Server Error',
      ...(err.details ? { details: err.details } : {}),
      ...(err.debug ? { debug: err.debug } : {}),
    });
  }
});

module.exports = router;
