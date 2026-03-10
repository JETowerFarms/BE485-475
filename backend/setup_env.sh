#!/bin/bash
set -e

# Generate a strong JWT secret
JWT_SECRET=$(openssl rand -hex 48)
echo "Generated JWT_SECRET: ${JWT_SECRET:0:20}..."

# Write production .env
cat > /home/money/backend/.env << ENVEOF
# Production environment - generated $(date)
NODE_ENV=production
PORT=3001
TRUST_PROXY=1

# JWT
JWT_SECRET=${JWT_SECRET}

# Database (Cloud SQL)
DB_HOST=34.136.113.79
DB_PORT=5432
DB_NAME=michigan_solar
DB_USER=postgres
DB_PASSWORD=Solar2026!
PGSSLMODE=disable

# CORS
CORS_ORIGIN=https://besolarfarms.com

# NREL PVWatts API key
NREL_API_KEY=SP99xSHv1O1gGQjQFtXfJ2QuUzRILBOnPDo2HZTe

# Rate limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=200

# Body parser limit
BODY_LIMIT=10mb
ENVEOF

chown money:money /home/money/backend/.env
chmod 600 /home/money/backend/.env
echo ".env written to /home/money/backend/.env"

# Restart pm2 so it picks up the new env
sudo -u money pm2 restart solar-api --update-env
sleep 3
sudo -u money pm2 list
