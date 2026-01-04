# Michigan Solar Optimization Backend

Express.js API server with PostgreSQL/PostGIS database for the Michigan Solar Optimization mobile application.

## Features

- ✅ RESTful API for solar suitability data
- ✅ PostGIS spatial queries for geographic data
- ✅ 120M point high-resolution solar grid (0.96 acres/cell)
- ✅ Farm boundary analysis and persistence
- ✅ Caching and rate limiting
- ✅ CORS support for mobile apps

## Architecture

```
backend/
├── src/
│   ├── server.js              # Express server configuration
│   ├── database.js            # Database connection and queries
│   └── routes/
│       ├── solar.js          # Solar data endpoints
│       ├── farms.js          # Farm management endpoints
│       └── geo.js            # Geographic data endpoints
├── scripts/
│   ├── setup-database.js     # Database initialization
│   └── import-solar-data.js  # Import 30x30 grid data
├── DATABASE_SCHEMA.sql       # Complete database schema
├── package.json
└── .env.example
```

## Prerequisites

- **Node.js** 18+ 
- **PostgreSQL** 14+ with PostGIS extension
- **11GB** disk space for solar data

## Installation

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment

Copy `.env.example` to `.env` and configure:

```bash
cp .env.example .env
```

Edit `.env`:
```env
# Database
DB_HOST=localhost
DB_PORT=5432
DB_NAME=michigan_solar
DB_USER=postgres
DB_PASSWORD=your_password_here

# Server
PORT=3000
NODE_ENV=development

# CORS - Update for your mobile app IP
CORS_ORIGIN=*
```

### 3. Setup PostgreSQL

**Install PostgreSQL with PostGIS:**

```bash
# Windows (using chocolatey)
choco install postgresql

# Or download from: https://www.postgresql.org/download/windows/
```

**Enable PostGIS extension:**
```sql
CREATE EXTENSION postgis;
```

### 4. Initialize Database

```bash
npm run db:setup
```

This will:
- Create the `michigan_solar` database
- Enable PostGIS extension
- Create all tables, indexes, and functions

### 5. Import Solar Data

**⚠️ This takes ~30-45 minutes for 120M points**

```bash
npm run db:import
```

Progress will be displayed:
```
📥 Starting import...
  ✓ Imported 50,000 records (12,500/sec)
  ✓ Imported 100,000 records (13,200/sec)
  ...
✅ Import Complete!
📊 Total records imported: 119,920,500
⏱️  Total time: 32.4 minutes
```

## Usage

### Start Development Server

```bash
npm run dev
```

Server will start on `http://localhost:3000`

### Start Production Server

```bash
npm start
```

## API Endpoints

### Solar Data

#### Get Point Data
```http
GET /api/solar/point/:lat/:lng
```

**Example:**
```bash
curl http://localhost:3000/api/solar/point/42.7325/-84.5555
```

**Response:**
```json
{
  "success": true,
  "data": {
    "lat": 42.7325,
    "lng": -84.5555,
    "overall": 67.5,
    "land_cover": 75.2,
    "slope": 89.3,
    "transmission": 45.6,
    "population": 60.1
  }
}
```

#### Get Bounding Box Data
```http
GET /api/solar/bbox?minLat=42.7&minLng=-84.6&maxLat=42.8&maxLng=-84.5&limit=1000
```

#### Get Polygon Data
```http
POST /api/solar/polygon
Content-Type: application/json

{
  "coordinates": [
    [-84.5555, 42.7325],
    [-84.5445, 42.7325],
    [-84.5445, 42.7235],
    [-84.5555, 42.7235]
  ],
  "limit": 5000
}
```

#### Get Statistics
```http
GET /api/solar/stats
```

### Farm Management

#### List User Farms
```http
GET /api/farms?userId=user_123
```

#### Create Farm
```http
POST /api/farms
Content-Type: application/json

{
  "userId": "user_123",
  "name": "North 40",
  "coordinates": [
    [-84.5555, 42.7325],
    [-84.5445, 42.7325],
    [-84.5445, 42.7235],
    [-84.5555, 42.7235]
  ],
  "areaAcres": 45.2
}
```

**Response includes automatic suitability analysis:**
```json
{
  "success": true,
  "data": {
    "id": 1,
    "name": "North 40",
    "areaAcres": 45.2,
    "avgSuitability": 68.3,
    "analysis": {
      "total_points": 47,
      "avg_overall": 68.3,
      "avg_land_cover": 72.1,
      "avg_slope": 85.2,
      "avg_transmission": 52.4,
      "avg_population": 62.8,
      "min_score": 45.2,
      "max_score": 89.6
    }
  }
}
```

#### Get Farm Analysis
```http
GET /api/farms/:id/analysis
```

#### Delete Farm
```http
DELETE /api/farms/:id?userId=user_123
```

### Geographic Data

#### Get Counties
```http
GET /api/geo/counties
```

#### Get Cities by County
```http
GET /api/geo/cities/:countyId
```

## Database Schema

### Main Tables

**solar_suitability** - 120M point grid
- Spatial index on `location`
- Composite index on `(lat, lng)`
- Partitioned by latitude (Upper/Lower Peninsula)

**farms** - User-created farm boundaries
- Spatial index on `boundary`
- Index on `user_id`

**farm_analysis** - Cached farm calculations
- Foreign key to `farms`
- Automatic calculation on farm creation

### Spatial Functions

**get_nearest_solar_point(lat, lng)** - Find closest grid point

**calculate_farm_suitability(boundary)** - Analyze farm area

**get_solar_data_bbox(minLat, minLng, maxLat, maxLng)** - Query rectangle

## Performance

### Query Performance
- Point lookup: < 5ms
- Bounding box (1000 points): 50-100ms
- Farm analysis (5000 points): 200-500ms

### Optimizations
- Spatial indexes on all geography columns
- Table partitioning by latitude
- Connection pooling (20 connections)
- Rate limiting (100 req/15min)

### Scaling Recommendations
For production:
1. Enable query caching (Redis)
2. Use read replicas for queries
3. Implement CDN for static responses
4. Add database connection pooling
5. Enable compression

## Mobile App Integration

### Android Local Testing

Update mobile app's API configuration:

```javascript
// src/utils/api.js
const API_BASE_URL = __DEV__
  ? 'http://10.0.2.2:3000/api'  // Android emulator
  : 'https://your-production-api.com/api';
```

### Network Configuration

**Android - Allow localhost:**
Add to `android/app/src/main/AndroidManifest.xml`:
```xml
<application
  android:usesCleartextTraffic="true">
```

**iOS - Allow localhost:**
Add to `ios/Info.plist`:
```xml
<key>NSAppTransportSecurity</key>
<dict>
  <key>NSAllowsLocalNetworking</key>
  <true/>
</dict>
```

## Deployment

### Production Checklist

- [ ] Set `NODE_ENV=production`
- [ ] Use environment-specific `.env`
- [ ] Configure specific CORS origins
- [ ] Set up SSL/TLS certificates
- [ ] Enable database backups
- [ ] Configure logging to file
- [ ] Set up monitoring (CPU, memory, disk)
- [ ] Implement health checks
- [ ] Configure firewall rules
- [ ] Set up load balancer (if needed)

### Hosting Options

**Database:**
- AWS RDS PostgreSQL with PostGIS
- Google Cloud SQL
- Azure Database for PostgreSQL
- DigitalOcean Managed Databases

**API Server:**
- AWS EC2 / Elastic Beanstalk
- Google Cloud Run
- Azure App Service
- Heroku
- DigitalOcean Droplets

### Example Deployment (AWS)

```bash
# 1. RDS PostgreSQL setup
# - Instance: db.t3.medium (2 vCPU, 4GB RAM)
# - Storage: 100GB SSD
# - Enable PostGIS in parameter group

# 2. EC2 instance
# - Instance: t3.small (2 vCPU, 2GB RAM)
# - Install Node.js, PM2

# 3. Deploy
pm2 start src/server.js --name michigan-solar-api
pm2 save
pm2 startup
```

## Troubleshooting

### Database connection fails
```bash
# Check PostgreSQL is running
pg_isready

# Test connection
psql -h localhost -U postgres -d michigan_solar
```

### Import fails
- Verify the `solar_suitability` table is populated in your database
- Check available disk space and PostgreSQL memory settings for large datasets

### API returns 500 errors
- Check server logs
- Verify database connection in `.env`
- Ensure PostGIS extension is enabled

### Slow queries
- Run `ANALYZE solar_suitability;` to update statistics
- Check indexes: `\d solar_suitability`
- Monitor with: `EXPLAIN ANALYZE SELECT ...`

## Development

### Run Tests
```bash
npm test
```

### Check API Health
```bash
curl http://localhost:3000/health
```

### Database Queries

```sql
-- Check total records
SELECT COUNT(*) FROM solar_suitability;

-- Check table size
SELECT pg_size_pretty(pg_total_relation_size('solar_suitability'));

-- View recent farms
SELECT id, name, area_acres, avg_suitability, created_at 
FROM farms 
ORDER BY created_at DESC 
LIMIT 10;
```

## License

MIT

## Support

For issues or questions:
1. Check this README
2. Review API endpoint documentation
3. Check server logs
4. Verify database connection
