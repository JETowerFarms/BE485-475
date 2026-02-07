// Quick test driver for the linear-optimization pipeline.
// Starts no servers; ensure backend is running (npm start) before running this script.
// Usage: node scripts/run-linear-optimization-sample.js [apiBase]
// apiBase defaults to http://localhost:3000/api

const apiBase = process.argv[2] || 'http://localhost:3000/api';
const PVWATTS_BASE = 'https://developer.nrel.gov/api/pvwatts/v8.json';
const NREL_KEY = process.env.NREL_API_KEY || 'SP99xSHv1O1gGQjQFtXfJ2QuUzRILBOnPDo2HZTe';

async function callPvwatts(pvwatts) {
  const params = new URLSearchParams({
    api_key: NREL_KEY,
    format: 'json',
    lat: pvwatts.lat,
    lon: pvwatts.lon,
    system_capacity: pvwatts.system_capacity,
    module_type: pvwatts.module_type,
    array_type: pvwatts.array_type,
    tilt: pvwatts.tilt,
    azimuth: pvwatts.azimuth,
    losses: pvwatts.losses,
  });

  const url = `${PVWATTS_BASE}?${params.toString()}`;
  console.log('GET', url);
  const res = await fetch(url, { method: 'GET' });
  const text = await res.text();
  console.log('PVWatts status:', res.status);
  if (!res.ok) {
    console.error('PVWatts error body:', text);
    throw new Error(`PVWatts request failed (${res.status})`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (err) {
    console.error('PVWatts parse error:', err.message);
    console.error(text);
    throw err;
  }
  console.log('PVWatts response (trimmed):', JSON.stringify({
    errors: json.errors,
    warnings: json.warnings,
    capacity_factor: json?.outputs?.capacity_factor,
    ac_annual: json?.outputs?.ac_annual,
  }, null, 2));
  return json;
}

async function main() {
  const payload = {
    farmId: 'sample-farm-001',
    geometry: {
      type: 'Polygon',
      coordinates: [
        [
          [-84.55, 42.75],
          [-84.54, 42.75],
          [-84.54, 42.74],
          [-84.55, 42.74],
          [-84.55, 42.75],
        ],
      ],
    },
    acres: 9.0,
    crops: ['Soybeans'],
    pvwatts: {
      lat: 42.745,
      lon: -84.545,
      system_capacity: 9.0 * 200, // kW per acre × acres
      module_type: 0, // 0=Standard, 1=Premium, 2=Thin film
      array_type: 1, // 0=fixed open rack, 1=fixed roof, 2=1-axis, 3=1-axis backtracking, 4=2-axis
      tilt: 30,
      azimuth: 180,
      losses: 14,
    },
    modelFlags: {},
  };

  const url = `${apiBase}/linear-optimization`;
  console.log('POST', url);
  console.log('Payload:', JSON.stringify(payload, null, 2));

  // First, show the live PVWatts response for visibility/debugging
  await callPvwatts(payload.pvwatts);

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  console.log('Status:', res.status);
  if (!res.ok) {
    console.error('Error response:', text);
    process.exit(1);
  }

  try {
    const json = JSON.parse(text);
    console.log('Response JSON:', JSON.stringify(json, null, 2));
  } catch (err) {
    console.error('Failed to parse JSON:', err.message);
    console.error('Raw response:', text);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Request failed:', err);
  process.exit(1);
});
