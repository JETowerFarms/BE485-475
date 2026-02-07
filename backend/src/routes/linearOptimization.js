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

async function runPython({ acres, crops, cropData, pvwattsData }) {
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

    const { parsed: optimization, stdout: pyStdout, stderr: pyStderr } = await runPython({
      acres: payload.acres,
      crops: payload.crops,
      cropData,
      pvwattsData: pvwattsResponse,
    });

    res.json({
      success: true,
      farmId: payload.farmId,
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
