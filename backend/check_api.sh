#!/bin/bash
set -e

echo '{"username":"admin","password":"Solar2026!"}' > /tmp/login_body.json
LOGIN=$(curl -s -X POST https://besolarfarms.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d @/tmp/login_body.json)
echo "Raw login response: $LOGIN"
TOKEN=$(echo "$LOGIN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('token','NO_TOKEN'))")
echo "Token obtained: ${TOKEN:0:30}..."

echo
echo "--- /health ---"
curl -s https://besolarfarms.com/health

echo
echo "--- / ---"
curl -s https://besolarfarms.com/ | python3 -c "import sys,json; d=json.load(sys.stdin); print('endpoints:', list(d['endpoints'].keys()))"

echo
echo "--- /api/farms (authed) ---"
curl -s -o /dev/null -w "HTTP %{http_code}" -H "Authorization: Bearer $TOKEN" https://besolarfarms.com/api/farms

echo
echo "--- /api/geo/counties (authed) ---"
curl -s -o /dev/null -w "HTTP %{http_code}" -H "Authorization: Bearer $TOKEN" https://besolarfarms.com/api/geo/counties

echo
echo "--- /api/crops (authed) ---"
curl -s -o /dev/null -w "HTTP %{http_code}" -H "Authorization: Bearer $TOKEN" https://besolarfarms.com/api/crops

echo
echo "--- /api/reports (authed) ---"
curl -s -o /dev/null -w "HTTP %{http_code}" -H "Authorization: Bearer $TOKEN" https://besolarfarms.com/api/reports

echo
echo "--- /api/linear-optimization (authed) ---"
curl -s -o /dev/null -w "HTTP %{http_code}" -H "Authorization: Bearer $TOKEN" https://besolarfarms.com/api/linear-optimization

echo
echo "--- /api/models (authed) ---"
curl -s -o /dev/null -w "HTTP %{http_code}" -H "Authorization: Bearer $TOKEN" https://besolarfarms.com/api/models

echo
echo "--- /api/farms (no token = 401) ---"
curl -s -o /dev/null -w "HTTP %{http_code}" https://besolarfarms.com/api/farms

echo
echo "Done."
