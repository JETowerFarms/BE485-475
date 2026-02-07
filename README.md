# OptimizationTool

A React Native CLI mobile application.

## Prerequisites
- Node.js (18+ recommended)
- npm

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start Metro bundler:
   ```bash
   npm start
   ```

3. Start an Android emulator (Windows):

   This repo assumes your migrated Android SDK is at `O:\SDKs` and your AVDs are at `O:\.android\avd`.

   ```powershell
   .\scripts\start-emulator.ps1 -AvdName Pixel_6_API34_Medium
   ```

   If you prefer running the emulator directly (no scripts):

   ```powershell
   $env:ANDROID_SDK_ROOT = 'O:\SDKs'
   $env:ANDROID_HOME = 'O:\SDKs'
   $env:ANDROID_AVD_HOME = 'O:\.android\avd'
   $env:ANDROID_EMULATOR_HOME = 'O:\.android'

   O:\SDKs\emulator\emulator.exe -list-avds
   O:\SDKs\emulator\emulator.exe -avd Pixel_6_API34_Medium

   # If the emulator complains about adb/port 5037:
   O:\SDKs\platform-tools\adb.exe kill-server
   O:\SDKs\platform-tools\adb.exe start-server
   O:\SDKs\platform-tools\adb.exe devices
   ```

   If you hit `PANIC: Cannot find AVD system path. Please define ANDROID_SDK_ROOT`, it means `ANDROID_SDK_ROOT`/`ANDROID_HOME` weren’t set in that terminal session.

   If you hit missing system-image warnings (e.g. `system-images\android-34\google_apis_playstore\x86_64 is not a valid directory`), install the system image:

   ```powershell
   # One-time: install Android SDK command-line tools into O:\SDKs (needed for sdkmanager)
   # (If you already have O:\SDKs\cmdline-tools\latest\bin\sdkmanager.bat, skip this.)
   # Then install the required packages:
   # Ensure Android SDK "Command-line Tools" are installed (Android Studio → SDK Manager → SDK Tools),
   # so `sdkmanager.bat` exists under O:\SDKs\cmdline-tools\latest\bin.
4. Run the app on Android (device/emulator):
   ```powershell
   .\scripts\run-android.ps1
   # or (if your Android SDK is already configured)
   npm run android
   ```

5. Run the app on iOS (macOS only):
   ```bash
   npm run ios
   ```

## Backend (Docker)

```powershell
docker compose up -d --build db api
docker compose logs -f api
docker compose down
```

### Site-prep pricing snapshot (static)

The backend uses static pricing snapshots stored in the database for site preparation cost calculations. Pricing data includes:
- MSU Extension custom work rates (per-acre operations)
- MDOT weighted-average bid items (earthwork, removals, etc.)

Pricing snapshots are loaded during database initialization and remain static. The system no longer supports live pricing updates from external sources.

## Land Cover Tables (Database)

The land-cover-only datasets in `Datasets/` can be imported into PostGIS tables.

**Creates/populates these tables:**
- `landcover_nlcd_2024_raster`
- `landcover_waterbody`
- `landcover_lakes`
- `landcover_river_areas`
- `landcover_river_lines`
- `landcover_streams_mouth`
- `landcover_coastlines`

**Run import (Windows / PowerShell):**

```powershell
# Imports vectors + NLCD raster (large)
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import-landcover-datasets.ps1

# If you only want the vector land/water layers:
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\import-landcover-datasets.ps1 -SkipRaster
```

## Drive C Notes

- Docker Desktop is installed at `C:\Program Files\Docker\...` and will store Linux/WSL2 data on C: unless you relocate Docker/WSL.
- Java is currently detected at `C:\Program Files\Java\jdk-17`.
- Gradle and Android tooling default caches live under `%USERPROFILE%` (C:) unless you set `GRADLE_USER_HOME`, `ANDROID_AVD_HOME`, and `ANDROID_EMULATOR_HOME` (the provided `scripts/*.ps1` prefer `O:`).

## Project Structure

```
OptimizationTool/
├── App.js          # Main application entry point
├── app.json        # App name configuration
├── assets/         # Images, fonts, and other static files
├── index.js        # App registry entry point
└── package.json    # Project dependencies (React Native CLI)
```

## Available Scripts

- `npm run start` - Start Metro bundler
- `npm run android` - Build & run on Android device/emulator
- `npm run ios` - Build & run on iOS simulator (macOS only)
- `npm run lint` - Lint codebase
- `npm run test` - Run tests

## Learn More

- [React Native Documentation](https://reactnative.dev/)
