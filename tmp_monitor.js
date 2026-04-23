// Continuous farm analysis monitor + per-batch timer.
// Polls farm_analysis table and tails pm2 logs to compute batch durations.
process.chdir('/home/money/backend');
require('/home/money/backend/node_modules/dotenv').config({ path: '/home/money/backend/.env' });
const { db } = require('/home/money/backend/src/database');
const fs = require('fs');
const { spawn } = require('child_process');

const LOG = '/tmp/worker-monitor.log';
function log(...a) {
  const line = `[${new Date().toISOString()}] ${a.join(' ')}`;
  console.log(line);
  try { fs.appendFileSync(LOG, line + '\n'); } catch {}
}

let lastBatchTime = null;
let lastFarm = null;

// Tail pm2 logs to capture batch timings.
const tail = spawn('sudo', ['-u', 'money', 'tail', '-F', '/home/money/.pm2/logs/solar-api-out.log'], {
  stdio: ['ignore', 'pipe', 'ignore']
});
let buf = '';
tail.stdout.on('data', (chunk) => {
  buf += chunk.toString();
  const lines = buf.split('\n');
  buf = lines.pop();
  for (const line of lines) {
    const mStart = line.match(/Starting analysis for farm (\d+)/);
    if (mStart) {
      lastFarm = mStart[1];
      lastBatchTime = Date.now();
      log(`FARM_START farm=${lastFarm}`);
      continue;
    }
    const mBatch = line.match(/Processing batch (\d+) with (\d+) points/);
    if (mBatch && lastBatchTime) {
      const now = Date.now();
      const dtMs = now - lastBatchTime;
      lastBatchTime = now;
      log(`BATCH farm=${lastFarm} batch=${mBatch[1]} points=${mBatch[2]} dt_ms=${dtMs}`);
      continue;
    }
    const mDone = line.match(/Analysis complete for farm (\d+)/);
    if (mDone) {
      log(`FARM_DONE farm=${mDone[1]}`);
      lastFarm = null;
      lastBatchTime = null;
    }
  }
});

async function poll() {
  try {
    const count = await db.one('SELECT COUNT(*)::int AS n FROM farm_analysis');
    const total = await db.one('SELECT COUNT(*)::int AS n FROM farms');
    log(`STATUS analyzed=${count.n}/${total.n}`);
    if (count.n >= total.n) {
      log('ALL_DONE');
      process.exit(0);
    }
  } catch (e) {
    log('POLL_ERR ' + e.message);
  }
}

setInterval(poll, 30000);
poll();

process.on('SIGTERM', () => process.exit(0));
