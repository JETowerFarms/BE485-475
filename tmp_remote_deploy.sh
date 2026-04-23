#!/bin/bash
set -e
sudo cp /tmp/analysisWorker.js  /home/money/backend/src/analysisWorker.js
sudo cp /tmp/reportsHandler.js  /home/money/backend/src/routes/reportsHandler.js
sudo chown money:money /home/money/backend/src/analysisWorker.js /home/money/backend/src/routes/reportsHandler.js
echo "[ok] files installed"
sudo -u money pm2 restart solar-api --update-env
echo "[ok] restarted"
