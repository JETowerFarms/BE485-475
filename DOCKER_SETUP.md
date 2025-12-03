# Docker Setup Guide

This guide explains how to run the Michigan Solar Suitability application using Docker containers.

## Overview

The Docker setup includes:
- **PostgreSQL 14 with PostGIS 3.3**: Database for storing solar suitability data
- **Node.js Backend API**: Express server serving REST API
- **pgAdmin 4** (optional): Web-based database administration tool

## Prerequisites

- **Docker Desktop**: [Download for Windows](https://www.docker.com/products/docker-desktop/)
- **Docker Compose**: Included with Docker Desktop
- **11.3GB solar data file**: `michiganSolarSuitability_30x30.json` in project root

## Quick Start

### 1. Configure Environment

Copy the Docker environment template:
```powershell
Copy-Item .env.docker .env
```

Edit `.env` if you want to change default passwords:
```bash
DB_PASSWORD=solarpassword123
CORS_ORIGIN=*
```

### 2. Start the Containers

Start the database and API server:
```powershell
docker-compose up -d
```

This will:
- Pull the PostgreSQL with PostGIS image (~500MB)
- Build the backend API image
- Create and start both containers
- Initialize the database schema automatically
- Set up health checks

### 3. Verify Services

Check that services are running:
```powershell
docker-compose ps
```

Expected output:
```
NAME                    STATUS              PORTS
michigan-solar-db       Up (healthy)        0.0.0.0:5432->5432/tcp
michigan-solar-api      Up (healthy)        0.0.0.0:3000->3000/tcp
```

Test the API:
```powershell
Invoke-WebRequest http://localhost:3000/health
```

### 4. Import Solar Data

The solar data file needs to be imported into the database. The file is automatically mounted in the container.

Import using the container:
```powershell
docker-compose exec api npm run db:import
```

This will take **30-45 minutes** to import 119,920,500 data points.

Progress updates will show every 50,000 records.

### 5. Test the API

Once data is imported, test some endpoints:

**Get solar statistics:**
```powershell
Invoke-WebRequest http://localhost:3000/api/solar/stats | Select-Object -Expand Content | ConvertFrom-Json
```

**Get point data:**
```powershell
Invoke-WebRequest http://localhost:3000/api/solar/point/42.7325/-84.5555 | Select-Object -Expand Content | ConvertFrom-Json
```

**Get counties:**
```powershell
Invoke-WebRequest http://localhost:3000/api/geo/counties | Select-Object -Expand Content | ConvertFrom-Json
```

## Optional: Run with pgAdmin

Start the services including pgAdmin for database management:

```powershell
docker-compose --profile dev up -d
```

Access pgAdmin at: http://localhost:5050

- **Email**: admin@solar.com
- **Password**: admin

Connect to database:
- **Host**: db
- **Port**: 5432
- **Database**: michigan_solar
- **Username**: postgres
- **Password**: (from .env file, default: solarpassword123)

## Managing Containers

### View Logs

```powershell
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f api
docker-compose logs -f db
```

### Stop Services

```powershell
docker-compose stop
```

### Start Services

```powershell
docker-compose start
```

### Restart Services

```powershell
docker-compose restart
```

### Stop and Remove Containers

```powershell
docker-compose down
```

### Stop and Remove Everything (including data)

⚠️ **Warning**: This deletes all database data!

```powershell
docker-compose down -v
```

## Database Management

### Access PostgreSQL CLI

```powershell
docker-compose exec db psql -U postgres -d michigan_solar
```

### Run Database Queries

```sql
-- Check table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- Count solar suitability points
SELECT COUNT(*) FROM solar_suitability;

-- Sample data
SELECT * FROM solar_suitability LIMIT 5;
```

### Backup Database

```powershell
docker-compose exec -T db pg_dump -U postgres michigan_solar > backup.sql
```

### Restore Database

```powershell
Get-Content backup.sql | docker-compose exec -T db psql -U postgres michigan_solar
```

## Mobile App Configuration

Update the React Native app to connect to the Docker backend.

### For Android Emulator

Edit `OptimizationToolRN/src/utils/api.js`:
```javascript
const API_BASE_URL = __DEV__ 
  ? 'http://10.0.2.2:3000/api'  // Android emulator → host machine
  : 'http://your-production-url.com/api';
```

### For Physical Device

Find your computer's IP address:
```powershell
ipconfig | Select-String "IPv4"
```

Update `api.js`:
```javascript
const API_BASE_URL = __DEV__ 
  ? 'http://192.168.1.XXX:3000/api'  // Replace with your IP
  : 'http://your-production-url.com/api';
```

Update CORS in `.env`:
```bash
CORS_ORIGIN=http://192.168.1.XXX:8081
```

Restart the API:
```powershell
docker-compose restart api
```

## Troubleshooting

### Container won't start

Check logs:
```powershell
docker-compose logs api
docker-compose logs db
```

### Database connection errors

1. Verify database is healthy:
```powershell
docker-compose ps db
```

2. Check database logs:
```powershell
docker-compose logs db
```

3. Test connection manually:
```powershell
docker-compose exec db psql -U postgres -d michigan_solar -c "SELECT 1;"
```

### API returns 500 errors

1. Check API logs:
```powershell
docker-compose logs -f api
```

2. Verify database tables exist:
```powershell
docker-compose exec db psql -U postgres -d michigan_solar -c "\dt"
```

3. Check if data is imported:
```powershell
docker-compose exec db psql -U postgres -d michigan_solar -c "SELECT COUNT(*) FROM solar_suitability;"
```

### Import is slow or hangs

This is normal. The import processes 119 million records and takes 30-45 minutes.

Monitor progress:
```powershell
docker-compose logs -f api
```

Check database size growth:
```powershell
docker-compose exec db psql -U postgres -d michigan_solar -c "SELECT pg_size_pretty(pg_database_size('michigan_solar'));"
```

### Out of disk space

The PostgreSQL data requires approximately:
- **Database**: ~25-30GB for 120 million points
- **Images**: ~1GB
- **Total**: ~35GB free space recommended

Check Docker disk usage:
```powershell
docker system df
```

Clean up unused images/containers:
```powershell
docker system prune -a
```

### Port already in use

If port 3000 or 5432 is already in use, edit `docker-compose.yml`:

```yaml
services:
  api:
    ports:
      - "3001:3000"  # Change host port
  db:
    ports:
      - "5433:5432"  # Change host port
```

Update `.env.docker`:
```bash
DB_PORT=5433  # If you changed database port
```

## Production Deployment

### Build for Production

```powershell
docker-compose -f docker-compose.yml -f docker-compose.prod.yml build
```

### Environment Variables for Production

Create `.env.production`:
```bash
DB_PASSWORD=<strong-random-password>
CORS_ORIGIN=https://your-app-domain.com
NODE_ENV=production
```

### Google Cloud Run Deployment

See `GOOGLE_CLOUD_DEPLOYMENT.md` for deploying to Google Cloud Platform.

## Performance Tuning

### Increase Database Connections

Edit `docker-compose.yml`:
```yaml
services:
  db:
    command: postgres -c max_connections=100
```

### Adjust API Worker Processes

For production, use PM2 or cluster mode. Create `ecosystem.config.js`:
```javascript
module.exports = {
  apps: [{
    name: 'solar-api',
    script: 'src/server.js',
    instances: 4,
    exec_mode: 'cluster'
  }]
};
```

Update Dockerfile CMD:
```dockerfile
CMD ["pm2-runtime", "ecosystem.config.js"]
```

## Container Architecture

```
┌─────────────────────────────────────────────┐
│           Docker Host Machine               │
│                                             │
│  ┌────────────────────────────────────┐   │
│  │  michigan-solar-api                │   │
│  │  (Node.js Express)                 │   │
│  │  Port: 3000                        │   │
│  │  Health: /health endpoint          │   │
│  └────────────────┬───────────────────┘   │
│                   │                        │
│                   │ SQL queries            │
│                   ▼                        │
│  ┌────────────────────────────────────┐   │
│  │  michigan-solar-db                 │   │
│  │  (PostgreSQL 14 + PostGIS 3.3)     │   │
│  │  Port: 5432                        │   │
│  │  Volume: postgres_data             │   │
│  └────────────────────────────────────┘   │
│                                             │
│  ┌────────────────────────────────────┐   │
│  │  michigan-solar-pgadmin (optional) │   │
│  │  Port: 5050                        │   │
│  └────────────────────────────────────┘   │
│                                             │
└─────────────────────────────────────────────┘
        ▲                        ▲
        │                        │
   HTTP requests             Database admin
   Mobile app                 Web browser
```

## Next Steps

1. **Import solar data** (30-45 min): `docker-compose exec api npm run db:import`
2. **Test API endpoints** with Invoke-WebRequest or Postman
3. **Update mobile app** to use `http://10.0.2.2:3000/api`
4. **Run mobile app**: `npm run android` in OptimizationToolRN folder
5. **Monitor logs**: `docker-compose logs -f`

## Resources

- [Docker Documentation](https://docs.docker.com/)
- [PostgreSQL Docker Hub](https://hub.docker.com/_/postgres)
- [PostGIS Docker Hub](https://hub.docker.com/r/postgis/postgis)
- [Node.js Best Practices](https://github.com/goldbergyoni/nodebestpractices)
