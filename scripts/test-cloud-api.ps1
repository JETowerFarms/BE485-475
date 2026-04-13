$base = "http://localhost:3003"
$results = @()

# 1. Login
try {
    $loginBody = '{"username":"admin","password":"Solar2026!"}'
    $loginRes = Invoke-RestMethod -Uri "$base/api/auth/login" -Method POST -Body $loginBody -ContentType "application/json" -TimeoutSec 15
    $token = $loginRes.token
    $results += "1. POST /api/auth/login : OK (token obtained)"
} catch {
    $results += "1. POST /api/auth/login : FAIL - $($_.Exception.Message)"
    Write-Host ($results -join "`n")
    exit 1
}

# 2. Health
try {
    $health = Invoke-RestMethod -Uri "$base/health" -TimeoutSec 10
    $results += "2. GET  /health : $($health.status)"
} catch {
    $results += "2. GET  /health : FAIL - $($_.Exception.Message)"
}

# 3. Root
try {
    $root = Invoke-RestMethod -Uri "$base/" -TimeoutSec 10
    $results += "3. GET  / : OK"
} catch {
    $results += "3. GET  / : FAIL - $($_.Exception.Message)"
}

# Authed endpoints
$headers = @{Authorization = "Bearer $token"}
$endpoints = @(
    "/api/farms",
    "/api/geo/counties",
    "/api/crops",
    "/api/linear-optimization/incentives",
    "/api/models"
)

$i = 4
foreach ($ep in $endpoints) {
    try {
        $r = Invoke-WebRequest -Uri "$base$ep" -Headers $headers -TimeoutSec 15 -UseBasicParsing
        $results += "$i. GET  $ep : HTTP $($r.StatusCode)"
    } catch {
        $code = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { "ERR" }
        $results += "$i. GET  $ep : HTTP $code"
    }
    $i++
}

# No-auth test (expect 401)
try {
    $r = Invoke-WebRequest -Uri "$base/api/farms" -TimeoutSec 10 -UseBasicParsing
    $results += "$i. GET  /api/farms (no auth) : HTTP $($r.StatusCode) UNEXPECTED"
} catch {
    $code = if ($_.Exception.Response) { $_.Exception.Response.StatusCode.value__ } else { "ERR" }
    $results += "$i. GET  /api/farms (no auth) : HTTP $code (expected 401)"
}

Write-Host ""
Write-Host "=== GCS API Test Results ==="
$results | ForEach-Object { Write-Host $_ }
Write-Host "=== Done ==="
