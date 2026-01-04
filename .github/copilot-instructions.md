# React Native Project

This is a pure React Native project (not Expo).

## High-level Architecture

This repo is a React Native CLI mobile app plus a Node/Express backend API.

- Mobile app: `App.js` coordinates screen navigation and local persistence.
- Backend API: `backend/src/server.js` exposes `/api/*` endpoints consumed by the app.
- Data imports: large geospatial datasets live under `Datasets/` and can be imported into PostGIS.

## Performance / Compute Usage

When working in this repo (builds, tests, data processing, analysis), prefer using the full computational capabilities of the current machine.

- Prefer parallel/concurrent execution where safe (e.g., run independent checks in parallel; avoid unnecessary serialization).
- Prefer native build/test tooling that already parallelizes well (e.g., Gradle/Metro/Jest defaults) and avoid adding artificial throttles.
- When collecting diagnostics, prefer faster, higher-signal commands first; only fall back to expensive, full-repo scans when needed.

### Runtime Data Flow (typical)

1. App loads saved farms and last location from AsyncStorage.
	- Farms: `src/utils/farmStorage.js`
	- Location: `src/utils/locationStorage.js`
2. App calls backend endpoints using `src/config/apiConfig.js` (`buildApiUrl`).
	- Android emulator uses `http://10.0.2.2:3001` (host machine localhost).
3. Backend reads from Postgres/PostGIS (when configured) and/or serves static geojson.
	- DB access helpers: `backend/src/database.js`
	- Landcover + pricing logic: `backend/src/landcover.js`, `backend/src/pricing.js`

### Map Rendering Approach

- Native (Android/iOS): `src/components/CrossPlatformMap.native.js` uses a `react-native-webview` that loads Leaflet (CDN) and ESRI imagery tiles.
- Web: `src/components/CrossPlatformMap.web.js` uses `react-leaflet` + Leaflet.

If CDNs/tiles are blocked, maps may fail to render; logs from the WebView map will help diagnose.

## Getting Started

- Run `npm start` to start the Metro bundler
- Run `npm run android` to build and run on Android device/emulator
- Run `npm run ios` to build and run on iOS simulator (if an `ios/` project exists in your checkout)

### Common Ports

- Metro bundler: `8081`
- Backend API (expected by app in dev): `3001` (see `src/config/apiConfig.js`)

## Project Structure

Top-level app files

- `App.js` - Main application entry point; basic navigation + storage + fetches MCD geo.
- `index.js` - React Native registry entrypoint (`AppRegistry.registerComponent`).
- `app.json` - App name/displayName used by React Native.

Mobile app source

- `src/screens/` - The main UI screens (navigation is manual via state in `App.js`).
- `src/components/` - Reusable components (maps, SVG Michigan map, etc.).
- `src/config/` - Config helpers (API base URL selection).
- `src/data/` - Static data blobs (e.g., Michigan counties SVG paths).
- `src/utils/` - Local persistence and helper utilities.

Native Android

- `android/` - Native Android project (Gradle, manifest, Kotlin entrypoints).

Backend

- `backend/` - Node.js Express API server + Postgres/PostGIS support + import scripts.

Data & deployment

- `Datasets/` - Large raw datasets (zips/geojson) used for landcover and geo analysis.
- `deploy/nginx/` - Nginx config (deployment proxy/static hosting).
- `scripts/` - PowerShell helpers to start emulator, run Android, import datasets.

## Scripts

- `npm start` - Start the Metro bundler
- `npm run android` - Build and run on Android
- `npm run ios` - Build and run on iOS
- `npm test` - Run tests

- VS Code tasks live in `.vscode/tasks.json`.

## Build Commands

### Android
```bash
cd android
./gradlew clean
./gradlew assembleDebug
```

### iOS
```bash
cd ios
pod install
```

## Repository Map (human-readable)

This map is intended to help editors quickly find the right place to make a change.

### Scope / Exclusions

For readability, this map intentionally excludes dependency/generated folders:

- `node_modules/`, `backend/node_modules/`, `.git/`, `.venv/`
- Android build/cache dirs like `android/build/`, `android/app/build/`, `android/app/.cxx/`, `android/.gradle/`, `android/.kotlin/`

### Root Files

- `.dockerignore` - Docker build context exclusions.
- `.env` - Local environment variables.
- `.env.docker` - Docker-specific environment variables.
- `.eslintrc.js` - ESLint config.
- `.gitignore` - Git ignore rules.
- `.prettierrc.js` - Prettier config.
- `.watchmanconfig` - Watchman config for file watching.
- `App.js` - Main RN component; screen navigation state + loads/saves farms + fetches MCD GeoJSON.
- `app.json` - App name/displayName.
- `babel.config.js` - Babel config (`@react-native/babel-preset`, reanimated plugin).
- `DATA_SOURCES.md` - Documentation for data sources.
- `dem_catalog.json` - Catalog/manifest for DEM/elevation assets (used by backend tooling).
- `docker-compose.yml` - Docker Compose for backend DB/API.
- `fast-build.ps1` - Helper PowerShell build script.
- `Gemfile` - Ruby dependencies (typically iOS-related tooling).
- `generate-icons.js` - Icon generation script.
- `index.js` - RN entrypoint; registers `App`.
- `jest.config.js` - Jest config.
- `metro.config.js` - Metro config (asset extensions + blockList for huge folders).
- `package.json` - App dependencies and scripts.
- `package-lock.json` - Locked dependency tree.
- `Power_Plants_20250824_025710_chunk0000.geojson.gz` - Compressed power plants dataset.
- `README.md` - Project docs.
- `tsconfig.json` - TypeScript config.

### GitHub / VS Code

- `.github/copilot-instructions.md` - This file.
- `.vscode/settings.json` - Workspace editor settings.
- `.vscode/tasks.json` - Workspace tasks (Metro + backend helpers).

### Tests

- `__tests__/App.test.tsx` - Jest test(s) for app.

### Mobile App Source (`src/`)

Config

- `src/config/apiConfig.js` - API base URL + `buildApiUrl()`.

Data

- `src/data/michiganCounties.js` - Michigan counties SVG paths + `isTargetCounty` + district mapping.

Storage utils

- `src/utils/farmStorage.js` - AsyncStorage for farms; strips heavy analysis grids.
- `src/utils/locationStorage.js` - AsyncStorage for saved county/city.

Components

- `src/components/CrossPlatformMap.js` - Platform-specific export.
- `src/components/CrossPlatformMap.native.js` - WebView + Leaflet map for native.
- `src/components/CrossPlatformMap.web.js` - react-leaflet map for web.
- `src/components/MichiganMap.js` - SVG Michigan county selector with hit testing.

Screens

- `src/screens/HomeScreen.js` - County selection landing screen; auto-navigate to saved location.
- `src/screens/CitySelectionScreen.js` - City/MCD selection UI with search/selection.
- `src/screens/MapScreen.js` - Pin placement + polygon math; calls backend for analysis.
- `src/screens/FarmDescriptionScreen.js` - Farm details/analysis UI; consumes backend results.

### PowerShell Helpers (`scripts/`)

- `scripts/android-env.ps1` - Sets Android SDK/AVD env vars.
- `scripts/docker-up.ps1` - Starts Docker services.
- `scripts/import-landcover-datasets.ps1` - Imports datasets into PostGIS.
- `scripts/run-android.ps1` - Runs Android build + app.
- `scripts/start-emulator.ps1` - Starts a named Android emulator.
- `scripts/start-from-scratch.ps1` - Clean slate helper (reinstall/rebuild workflow).

### Android (`android/`)

- `android/build.gradle` - Top-level Gradle config.
- `android/gradle.properties` - Gradle properties.
- `android/settings.gradle` - Gradle settings.
- `android/gradlew`, `android/gradlew.bat` - Gradle wrapper.
- `android/app/build.gradle` - Android app module config.
- `android/app/src/main/AndroidManifest.xml` - Android manifest.
- `android/app/src/main/java/com/anonymous/OptimizationTool/MainActivity.kt` - Android entry activity.
- `android/app/src/main/java/com/anonymous/OptimizationTool/MainApplication.kt` - Android application initialization.
- `android/app/src/main/res/**` - Android resources (icons, styles, network security config).

### Assets (`assets/`)

- `assets/*` - Images/icons used by the app (launcher/splash/logo/etc.).

### Backend (`backend/`)

Top-level

- `backend/Dockerfile` - Backend API container build.
- `backend/package.json` - Backend deps/scripts.
- `backend/DATABASE_SCHEMA.sql` - DB schema.
- `backend/test-setup.js` - Backend test setup.

Backend source

- `backend/src/server.js` - Express server wiring (middleware, routes, health, rate limit).
- `backend/src/database.js` - DB access helpers and query wrappers.
- `backend/src/landcover.js` - Landcover analysis + site prep estimation.
- `backend/src/pricing.js` - Pricing snapshot logic.
- `backend/src/routes/solar.js` - Solar endpoints.
- `backend/src/routes/farms.js` - Farm CRUD/analyze endpoints.
- `backend/src/routes/geo.js` - Geo endpoints (MCD/cities/boundaries).
- `backend/src/routes/crops.js` - Crop endpoints.

Backend data

- `backend/data/michiganCitiesByCounty.json` - City lookup data.
- `backend/data/michiganMCDFull.json` - MCD geo dataset served to the app.

Backend scripts

- `backend/scripts/*` - Data import and pricing snapshot tooling.

Backend SQL

- `backend/sql/landcover_schema.sql` - Landcover table/index definitions.

Backend DB image helpers

- `backend/db/import_nlcd_raster.sh` - Raster import.
- `backend/db/import_vector_zip.sh` - Vector ZIP import.

### Deploy (`deploy/`)

- `deploy/nginx/default.conf` - Nginx config.

### Datasets (`Datasets/`)

- `Datasets/MISubstations.geojson` - Michigan substations.
- `Datasets/*.zip` - Raw vector/raster archives used for PostGIS imports (landcover, roads, hydro, etc.).

### Recovery (`recovery/`)

- `recovery/michigan_mcd_full.geojson` - Backup/export of MCD geojson.
- `recovery/mcd_shp/*` - Shapefile components for MCD boundaries.

### Notes (`notes/`)

- `notes/data_sources.md` - Data sources notes.
- `notes/project_understanding.md` - Project understanding + planning notes.
- `notes/site_prep_pricing_equations_probabilistic.md` - Pricing math notes.
- `notes/*.pdf` - Reference documents.
