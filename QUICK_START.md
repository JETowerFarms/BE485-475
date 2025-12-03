# Quick Start Guide - OptimizationToolRN

## Prerequisites Installed ✓
- React Native 0.82.1
- React 19.1.1  
- 516 npm packages
- All required native modules

## Before First Run

### Add Google Maps API Key
1. Get API key: https://console.cloud.google.com/google/maps-apis/
2. Enable "Maps SDK for Android"
3. Edit: `OptimizationToolRN/android/app/src/main/AndroidManifest.xml`
4. Replace `YOUR_GOOGLE_MAPS_API_KEY_HERE` with your key

## Run the App

```powershell
cd C:\Users\money\School\MSU\FS25\BE485\OptimizationToolRN
npm run android
```

That's it! Metro bundler will start automatically.

## Common Commands

```powershell
# Start Metro bundler only
npm start

# Clear cache and restart
npm start -- --reset-cache

# Run on Android
npm run android

# Clean Android build
cd android
.\gradlew clean
cd ..

# Check React Native setup
npx react-native doctor
```

## Project Location
`C:\Users\money\School\MSU\FS25\BE485\OptimizationToolRN`

## Documentation
- Full details: `../OptimizationTool/MIGRATION_COMPLETE.md`
- Instructions: `../OptimizationTool/MIGRATION_GUIDE.md`
