const PVWATTS_BASE_URL = 'https://developer.nrel.gov';
const PVWATTS_PATH = '/api/pvwatts/v8.json';
const DEFAULT_TIMEOUT_MS = 15000;
const REQUIRED_FIELDS = ['lat', 'lon', 'system_capacity', 'module_type', 'array_type', 'tilt', 'azimuth', 'losses'];

function assertRequired(payload) {
  const missing = REQUIRED_FIELDS.filter((f) => payload[f] === undefined || payload[f] === null || payload[f] === '');
  if (missing.length) {
    const error = new Error(`Missing required PVWatts parameters: ${missing.join(', ')}`);
    error.statusCode = 422;
    throw error;
  }
}

async function callPvwatts(params, { apiKey, signal } = {}) {
  assertRequired(params);
  if (!apiKey) {
    const err = new Error('Missing PVWatts API key');
    err.statusCode = 500;
    throw err;
  }

  const search = new URLSearchParams({ ...params, api_key: apiKey, format: 'json' });
  const url = `${PVWATTS_BASE_URL}${PVWATTS_PATH}?${search.toString()}`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  const mergedSignal = signal || controller.signal;

  try {
    const res = await fetch(url, { method: 'GET', signal: mergedSignal });
    if (!res.ok) {
      const text = await res.text();
      const err = new Error(`PVWatts request failed (${res.status}): ${text}`);
      err.statusCode = res.status;
      throw err;
    }
    const data = await res.json();
    if (Array.isArray(data?.errors) && data.errors.length) {
      const err = new Error(`PVWatts returned errors: ${data.errors.join('; ')}`);
      err.statusCode = 422;
      throw err;
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  callPvwatts,
};
