# Michigan Solar Optimization Tool - Docker Setup

This repository contains a complete containerized setup for the Michigan Solar Optimization Tool, including database, API, and all necessary data.

## Architecture

- **Database**: PostgreSQL with PostGIS for spatial data and raster support
- **API**: Node.js/Express backend serving solar suitability calculations
- **Data**: Pre-loaded with Michigan county boundaries, substations, and raster datasets

## Quick Start

1. **Prerequisites**:
   - Docker and Docker Compose installed
   - At least 8GB RAM available for containers
   - Sufficient disk space for data (~10GB+)

2. **Clone and setup**:
   ```bash
   git clone <repository-url>
   cd michigan-solar-optimization
   cp .env.example .env  # Edit .env with your settings
   ```

3. **Start the services**:
   ```bash
   docker-compose up -d
   ```

4. **Monitor startup**:
   ```bash
   docker-compose logs -f db  # Watch database initialization
   docker-compose logs -f api # Watch API startup
   ```

The first startup will take several minutes as the database imports spatial data and creates indexes.

## Services

### Database (db)
- **Image**: Custom PostGIS image
- **Port**: 5433 (external), 5432 (internal)
- **Database**: michigan_solar
- **Data Volume**: `O:\postgres_data` (Windows path)

### API (api)
- **Port**: 3001
- **Health Check**: Available at `/health`
- **Endpoints**:
  - `POST /api/solar-suitability` - Single point calculation
  - `POST /api/farm-suitability` - Farm boundary calculation

## Data Included

- **County Boundaries**: Michigan county polygons with pre-computed bounding boxes
- **Substations**: Michigan transmission substations with county assignments
- **Land Cover**: NLCD 2024 land cover data (cropped to Michigan)
- **Slope**: Elevation-derived slope data
- **Population**: GPW v4 population density data

## API Usage

### Single Point Solar Suitability
```bash
curl -X POST http://localhost:3001/api/solar-suitability \
  -H "Content-Type: application/json" \
  -d '{"lat": 42.205, "lng": -82.806}'
```

### Farm Suitability (Fast Mode)
```bash
curl -X POST http://localhost:3001/api/farm-suitability \
  -H "Content-Type: application/json" \
  -d '{"boundary": {"type": "Polygon", "coordinates": [[[-82.8, 42.2], [-82.8, 42.25], [-82.75, 42.25], [-82.75, 42.2], [-82.8, 42.2]]]}, "fastMode": true}'
```

## Development

### Rebuilding Containers
```bash
docker-compose build --no-cache
docker-compose up -d
```

### Database Access
```bash
# Connect to database
docker-compose exec db psql -U postgres -d michigan_solar

# View logs
docker-compose logs db
```

### Testing Performance
```bash
# Run performance tests
docker-compose exec db psql -U postgres -d michigan_solar -f /sql/test_performance.sql
```

## Configuration

Edit `.env` file to customize:
- `DB_PASSWORD`: Database password
- `CORS_ORIGIN`: Allowed CORS origins
- `PORT`: API server port

## Troubleshooting

### Database Won't Start
- Check available RAM (needs ~4GB)
- Check disk space
- View logs: `docker-compose logs db`

### API Returns Errors
- Ensure database is healthy: `docker-compose ps`
- Check API logs: `docker-compose logs api`
- Verify CORS settings in `.env`

### Slow Performance
- First run includes data import and index creation
- Subsequent runs should be faster
- Check database indexes: `docker-compose exec db psql -U postgres -d michigan_solar -c "\di"`

## Data Updates

To update datasets:
1. Replace files in `Datasets/` directory
2. Rebuild database: `docker-compose down -v && docker-compose up -d db`
3. Wait for data import to complete

## Production Deployment

For production:
1. Update `.env` with production settings
2. Use external database volume
3. Configure proper CORS origins
4. Set up monitoring and backups
5. Use reverse proxy (nginx) for SSL termination