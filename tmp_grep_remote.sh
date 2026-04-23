#!/bin/bash
sudo grep -rn 'fa\.id' /home/money/backend/src --include='*.js' 2>/dev/null
echo "---also check destructured queries---"
sudo grep -rn 'queries\.' /home/money/backend/src --include='*.js' 2>/dev/null | head -10
echo "---tail err log for stack---"
sudo -u money pm2 logs solar-api --err --lines 5 --nostream 2>&1 | sed 's/\x1b\[[0-9;]*m//g' | grep -A2 'fa\.id' | head -10
