/**
 * Background analysis worker.
 * Runs on a timer and processes any farms that do not yet have a farm_analysis row.
 * Designed to be started once from server.js — does not block startup.
 */

const { db, queries } = require('./database');

const WORKER_INTERVAL_MS = 15_000;    // How often to check for un-analyzed farms
const MAX_CONCURRENT_FARMS = 1;       // C++ parsers use process-global accumulators — must be 1
const MAX_FARM_ACRES = 1000;          // Must match reportsHandler — oversized farms get rejected there

let workerTimer = null;
let isRunning = false;
let oversizedLogged = false;

async function getUnanalyzedFarms() {
  return db.any(
    `SELECT f.id, ST_AsGeoJSON(f.boundary)::json AS boundary
       FROM farms f
       LEFT JOIN farm_analysis fa ON fa.farm_id = f.id
      WHERE fa.farm_id IS NULL
        AND (ST_Area(f.boundary::geography) / 4046.8564224) <= $2
      ORDER BY f.created_at ASC
      LIMIT $1`,
    [MAX_CONCURRENT_FARMS * 5, MAX_FARM_ACRES]
  );
}

async function logOversizedOnce() {
  if (oversizedLogged) return;
  oversizedLogged = true;
  try {
    const rows = await db.any(
      `SELECT f.id, f.name, (ST_Area(f.boundary::geography)/4046.8564224)::numeric(10,1) AS acres
         FROM farms f
         LEFT JOIN farm_analysis fa ON fa.farm_id = f.id
        WHERE fa.farm_id IS NULL
          AND (ST_Area(f.boundary::geography) / 4046.8564224) > $1
        ORDER BY f.id`,
      [MAX_FARM_ACRES]
    );
    if (rows.length) {
      console.log(`[worker] Skipping ${rows.length} oversized farm(s) (>${MAX_FARM_ACRES} acres):`);
      rows.forEach(r => console.log(`[worker]   - farm ${r.id} "${r.name}" = ${r.acres} acres`));
    }
  } catch (e) {
    console.warn('[worker] oversized log failed:', e.message);
  }
}

async function runWorkerCycle(executeAnalysis, analyzingFarmIds) {
  if (isRunning) return;
  isRunning = true;

  try {
    const farms = await getUnanalyzedFarms();
    if (farms.length === 0) {
      await logOversizedOnce();
      return;
    }

    console.log(`[worker] ${farms.length} farm(s) need analysis`);

    for (const farm of farms.slice(0, MAX_CONCURRENT_FARMS)) {
      const farmId = farm.id;
      const farmIdStr = String(farmId);

      if (analyzingFarmIds.has(farmIdStr)) {
        console.log(`[worker] Farm ${farmId} already queued, skipping`);
        continue;
      }

      const boundary = farm.boundary;
      // boundary is a GeoJSON Polygon — extract the outer ring as [[lng,lat], ...]
      const coordinates = boundary?.coordinates?.[0];
      if (!Array.isArray(coordinates) || coordinates.length < 3) {
        console.warn(`[worker] Farm ${farmId} has invalid boundary, skipping`);
        continue;
      }

      // Strip the closing duplicate point if present
      const coords = coordinates.length > 1 &&
        coordinates[0][0] === coordinates[coordinates.length - 1][0] &&
        coordinates[0][1] === coordinates[coordinates.length - 1][1]
        ? coordinates.slice(0, -1)
        : coordinates;

      console.log(`[worker] Starting analysis for farm ${farmId}`);
      analyzingFarmIds.add(farmIdStr);

      // Run async but don't await — let the worker loop move on
      executeAnalysis({ coordinates: coords, farmId })
        .then((result) => {
          if (result && result.success === false) {
            console.error(`[worker] Analysis returned failure for farm ${farmId}: status=${result.statusCode} msg=${result.error || result.message || 'unknown'}`);
          } else {
            console.log(`[worker] Analysis complete for farm ${farmId}`);
          }
        })
        .catch((err) => {
          console.error(`[worker] Analysis failed for farm ${farmId}:`, err.message);
        })
        .finally(() => {
          analyzingFarmIds.delete(farmIdStr);
        });
    }
  } catch (err) {
    console.error('[worker] Error in worker cycle:', err.message);
  } finally {
    isRunning = false;
  }
}

function startWorker(executeAnalysis, analyzingFarmIds) {
  if (workerTimer) return;

  // First run shortly after startup, then on schedule
  setTimeout(() => {
    runWorkerCycle(executeAnalysis, analyzingFarmIds);
    workerTimer = setInterval(() => {
      runWorkerCycle(executeAnalysis, analyzingFarmIds);
    }, WORKER_INTERVAL_MS);
  }, 15_000); // 15s delay so server finishes starting

  console.log(
    `[worker] Analysis worker started — checks every ${WORKER_INTERVAL_MS / 1000}s`
  );
}

function stopWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

module.exports = { startWorker, stopWorker };
