# Backend Quick Start Guide

## Prerequisites Check

Before starting, ensure you have:
- ✅ Node.js 18+ installed
- ✅ PostgreSQL 14+ installed
- ✅ 15GB free disk space (for database + import)
- ✅ 30x30 grid data file at `src/data/michiganSolarSuitability_30x30.json`

## Setup Steps

### 1. Install Dependencies

```powershell
cd backend
npm install
```

Expected: ~300 packages installed in 1-2 minutes

### 2. Configure Environment

```powershell
Copy-Item .env.example .env
```

Edit `.env` and set your PostgreSQL password:
```env
DB_PASSWORD=your_postgres_password
```

### 3. Setup Database

```powershell
npm run db:setup
```

Expected output:
```
✓ Connected to PostgreSQL
📦 Creating database: michigan_solar
✓ Database created
🗺️  Enabling PostGIS extension...
✓ PostGIS extension enabled
📄 Executing schema SQL...
✓ Schema created successfully
```

### 4. Import Solar Data (30-45 minutes)

```powershell
npm run db:import
```

This will import 119,920,500 data points. Get a coffee! ☕

Expected progress:
```
📥 Starting import...
  ✓ Imported 50,000 records (12,500/sec)
  ✓ Imported 100,000 records (13,200/sec)
  ...
✅ Import Complete!
⏱️  Total time: 32.4 minutes
```

### 5. Start Server

```powershell
npm run dev
```

Expected:
```
✓ Database connection successful
✓ Michigan Solar API Server running
✓ Port: 3000
✓ API Base URL: http://localhost:3000/api
```

## Test the API

### Health Check
```powershell
Invoke-WebRequest http://localhost:3000/health | Select-Object -ExpandProperty Content | ConvertFrom-Json
```

### Get Solar Point
```powershell
Invoke-WebRequest http://localhost:3000/api/solar/point/42.7325/-84.5555 | Select-Object -ExpandProperty Content | ConvertFrom-Json
```

### Get Statistics
```powershell
Invoke-WebRequest http://localhost:3000/api/solar/stats | Select-Object -ExpandProperty Content | ConvertFrom-Json
```

## Verify Database

```powershell
# Connect to PostgreSQL (adjust password)
psql -h localhost -U postgres -d michigan_solar
```

```sql
-- Check total records
SELECT COUNT(*) FROM solar_suitability;
-- Expected: 119920500

-- Check table size
SELECT pg_size_pretty(pg_total_relation_size('solar_suitability'));
-- Expected: ~12 GB

-- View sample data
SELECT lat, lng, overall_score 
FROM solar_suitability 
LIMIT 5;
```

## Troubleshooting

### "Database connection failed"
- Check PostgreSQL is running
- Verify password in `.env`
- Test: `psql -h localhost -U postgres`

### "File not found" during import
- Verify path in `import-solar-data.js`
- Check file exists: `Test-Path ..\src\data\michiganSolarSuitability_30x30.json`

### Import is very slow
- Normal! 120M records takes time
- Check available RAM (need 4GB+)
- Monitor progress - it will complete

## Next: Configure Mobile App

Update `OptimizationToolRN/src/utils/api.js`:

```javascript
const API_BASE_URL = 'http://10.0.2.2:3000/api';  // Android emulator
```

Then test the mobile app!

## Production Deployment

See `backend/README.md` for full deployment guide to:
- AWS RDS + EC2
- Google Cloud
- DigitalOcean
- Azure

---

**Total Setup Time:** ~45-60 minutes (mostly waiting for import)
