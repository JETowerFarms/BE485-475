# MIGRATION INSTRUCTIONS FOR REACT NATIVE CLI

## Overview
Complete migration from Expo to React Native CLI for the Michigan Solar Optimization Tool.

## Prerequisites
- Node.js 18+
- Android Studio (for Android development)
- Xcode (for iOS development on macOS)
- Google Maps API Key

## Step-by-Step Migration Process

### 1. Copy Configuration Files
Navigate to the `OptimizationToolRN` directory and replace/update the following files:

```powershell
cd C:\Users\money\School\MSU\FS25\BE485\OptimizationToolRN

# Copy package.json
Copy-Item -Path "..\OptimizationTool\migration_configs\package.json" -Destination "." -Force

# Copy App.tsx
Copy-Item -Path "..\OptimizationTool\migration_configs\App.tsx" -Destination "." -Force

# Copy Metro config
Copy-Item -Path "..\OptimizationTool\migration_configs\metro.config.js" -Destination "." -Force

# Copy Android build.gradle (root)
Copy-Item -Path "..\OptimizationTool\migration_configs\build.gradle" -Destination "android\" -Force

# Copy Android app build.gradle
Copy-Item -Path "..\OptimizationTool\migration_configs\app_build.gradle" -Destination "android\app\build.gradle" -Force

# Copy AndroidManifest.xml
Copy-Item -Path "..\OptimizationTool\migration_configs\AndroidManifest.xml" -Destination "android\app\src\main\AndroidManifest.xml" -Force

# Copy iOS AppDelegate (if on macOS)
# Copy-Item -Path "..\OptimizationTool\migration_configs\AppDelegate.swift" -Destination "ios\OptimizationToolRN\AppDelegate.swift" -Force
```

### 2. Install Dependencies

```powershell
# Remove existing node_modules if needed
Remove-Item -Path "node_modules" -Recurse -Force -ErrorAction SilentlyContinue

# Install all dependencies
npm install

# Link native modules (iOS only - requires macOS)
# cd ios
# pod install
# cd ..
```

### 3. Configure Google Maps API Key

#### Android:
1. Open `android\app\src\main\AndroidManifest.xml`
2. Replace `YOUR_GOOGLE_MAPS_API_KEY_HERE` with your actual Google Maps API key
3. Get a key from: https://console.cloud.google.com/google/maps-apis/

#### iOS (if on macOS):
1. Open `ios\OptimizationToolRN\AppDelegate.swift`
2. Add Google Maps initialization in `didFinishLaunchingWithOptions`

### 4. Update Android Settings (for react-native-maps)

Add to `android/settings.gradle` if not already present:
```gradle
include ':react-native-maps'
project(':react-native-maps').projectDir = new File(rootProject.projectDir, '../node_modules/react-native-maps/lib/android')
```

### 5. Verify Source Files

Ensure the following directories exist with proper content:
- `src/screens/` - HomeScreen.js, CitySelectionScreen.js, MapScreen.js, FarmDescriptionScreen.js
- `src/components/` - CrossPlatformMap components, MichiganMap.js
- `src/data/` - All JSON data files
- `src/utils/` - farmStorage.js
- `assets/` - Any image or static assets

### 6. Build and Run

#### Android:
```powershell
# Start Metro bundler
npm start

# In a new terminal, run Android
npm run android
```

#### iOS (macOS only):
```bash
npm run ios
```

## Troubleshooting

### Common Issues:

1. **Metro bundler can't find modules**
   - Clear cache: `npm start -- --reset-cache`
   - Delete `node_modules` and reinstall

2. **Android build fails**
   - Clean build: `cd android && .\gradlew clean && cd ..`
   - Check Google Maps API key is set

3. **Native module linking issues**
   - For Android: Verify `settings.gradle` and `build.gradle` files
   - For iOS: Run `pod install` in ios directory (macOS only)

4. **react-native-maps not displaying**
   - Verify API key in AndroidManifest.xml
   - Check location permissions are enabled
   - Enable Google Maps API in Google Cloud Console

5. **Large JSON files causing issues**
   - Consider implementing the API server approach for michiganSolarSuitability_30x30.json
   - Keep smaller datasets bundled with the app

## Configuration Files Created

All configuration files are in `OptimizationTool/migration_configs/`:
- `package.json` - Updated dependencies for React Native CLI
- `App.tsx` - Main app with React Navigation
- `metro.config.js` - Metro bundler configuration
- `build.gradle` - Root Android build file
- `app_build.gradle` - App-level Android build file
- `AndroidManifest.xml` - Android permissions and Google Maps key
- `AppDelegate.swift` - iOS app delegate

## Next Steps

1. Complete the configuration file copying
2. Install dependencies
3. Add Google Maps API key
4. Test on Android emulator or device
5. (Optional) Implement API server for large datasets

## Dependencies Added

### Core Navigation:
- @react-navigation/native
- @react-navigation/stack
- react-native-safe-area-context
- react-native-screens

### Existing from Expo:
- react-native-maps
- react-native-svg
- react-native-gesture-handler
- react-native-reanimated
- @turf/boolean-point-in-polygon
- @turf/helpers
- d3-contour
- @react-native-async-storage/async-storage
- @react-native-community/slider

All Expo-specific dependencies have been removed.
