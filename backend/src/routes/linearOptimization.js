const express = require('express');
const Joi = require('joi');
const { callPvwatts } = require('../services/pvwatts');
const { db } = require('../database');
const { spawn } = require('child_process');
const path = require('path');

const router = express.Router();

const schema = Joi.object({
  farmId: Joi.string().required(),
  geometry: Joi.object({
    coordinates: Joi.array().required(),
  }).required(),
  acres: Joi.number().positive().required(),
  crops: Joi.array().items(Joi.string().trim()).min(1).required(),
  modelId: Joi.number().integer().optional().allow(null),
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
  land_intensity_acres_per_MW: 5.5,
  degradation_rate: 0.005,
  installed_cost_per_MW: 1610000.0,
  site_prep_cost_per_acre: 36800.0,
  grading_cost_per_acre: 8286.0,
  retilling_cost_per_acre: 950.0,
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
  developer_retention_fraction: 0.12,
  constraints_min_ag_fraction: 0.51,
  constraints_max_prime_solar: 40.0,
  constraints_zoning_max_solar: 40.0,
  constraints_setback_fraction: 0.10,
  constraints_easement_acres: 0.0,
  constraints_wetland_exclusion_acres: 0.0,
  constraints_interconnect_capacity_mw: 10.0,
  farmer_pa116_credit_per_acre: 0.0,
};

async function fetchModel(modelId) {
  if (!modelId) return null;
  return db.oneOrNone('SELECT * FROM models WHERE id = $1', [modelId]);
}

async function fetchDefaultModel() {
  return db.oneOrNone('SELECT * FROM models ORDER BY id ASC LIMIT 1');
}

function buildModelConfig(row) {
  if (!row) return null;
  const cfg = { name: row.name };
  Object.keys(DEFAULT_MODEL_CONFIG).forEach((key) => {
    if (key === 'name') return;
    cfg[key] = row[key] !== undefined ? row[key] : null;
  });
  return cfg;
}

async function runPython({ acres, crops, cropData, pvwattsData, modelConfig }) {
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
    const proc = spawn('python', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (err) => {
      reject(err);
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const err = new Error(`Python optimizer failed with code ${code}: ${stderr || stdout}`);
        err.statusCode = 500;
        return reject(err);
      }
      try {
        const parsed = JSON.parse(stdout.trim().split('\n').pop());
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

router.post('/', async (req, res) => {
  try {
    const payload = validate(req.body);

    const nrelKey = 'SP99xSHv1O1gGQjQFtXfJ2QuUzRILBOnPDo2HZTe';
    if (!nrelKey) {
      return res.status(500).json({ error: 'Missing NREL API key' });
    }

    const pvwattsResponse = await callPvwatts(payload.pvwatts, { apiKey: nrelKey });

    const cropData = await fetchCropData(payload.crops);

    let modelRow = null;
    if (payload.modelId) {
      modelRow = await fetchModel(payload.modelId);
      if (!modelRow) {
        return res.status(404).json({ error: `Model ${payload.modelId} not found` });
      }
    } else {
      modelRow = await fetchDefaultModel();
    }

    const modelConfig = modelRow
      ? { ...DEFAULT_MODEL_CONFIG, ...buildModelConfig(modelRow) }
      : DEFAULT_MODEL_CONFIG;

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
