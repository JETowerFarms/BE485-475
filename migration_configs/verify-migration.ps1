# Migration Verification Script
# Run this from OptimizationToolRN directory

Write-Host "================================" -ForegroundColor Cyan
Write-Host "React Native CLI Migration Check" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# Check if in correct directory
$currentDir = Split-Path -Leaf (Get-Location)
if ($currentDir -ne "OptimizationToolRN") {
    Write-Host "ERROR: Please run this script from OptimizationToolRN directory" -ForegroundColor Red
    exit 1
}

# Check package.json
Write-Host "Checking package.json..." -ForegroundColor Yellow
if (Test-Path "package.json") {
    $packageJson = Get-Content "package.json" | ConvertFrom-Json
    Write-Host "  Name: $($packageJson.name)" -ForegroundColor Green
    Write-Host "  React: $($packageJson.dependencies.react)" -ForegroundColor Green
    Write-Host "  React Native: $($packageJson.dependencies.'react-native')" -ForegroundColor Green
} else {
    Write-Host "  MISSING package.json" -ForegroundColor Red
}

# Check node_modules
Write-Host "`nChecking node_modules..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    $moduleCount = (Get-ChildItem "node_modules" -Directory).Count
    Write-Host "  $moduleCount packages installed" -ForegroundColor Green
} else {
    Write-Host "  MISSING node_modules" -ForegroundColor Red
}

# Check critical dependencies
Write-Host "`nChecking critical dependencies..." -ForegroundColor Yellow
$criticalDeps = @(
    "react-native-maps",
    "react-native-svg",
    "@react-navigation/native",
    "@react-navigation/stack",
    "react-native-gesture-handler",
    "react-native-reanimated"
)

foreach ($dep in $criticalDeps) {
    if (Test-Path "node_modules\$dep") {
        Write-Host "  ✓ $dep" -ForegroundColor Green
    } else {
        Write-Host "  ✗ $dep MISSING" -ForegroundColor Red
    }
}

# Check App.tsx
Write-Host "`nChecking App.tsx..." -ForegroundColor Yellow
if (Test-Path "App.tsx") {
    $appContent = Get-Content "App.tsx" -Raw
    if ($appContent -match "NavigationContainer" -and $appContent -match "HomeScreen") {
        Write-Host "  ✓ Navigation configured" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Navigation may not be configured correctly" -ForegroundColor Yellow
    }
} else {
    Write-Host "  MISSING App.tsx" -ForegroundColor Red
}

# Check src directory
Write-Host "`nChecking src directory structure..." -ForegroundColor Yellow
$srcDirs = @("screens", "components", "data", "utils")
foreach ($dir in $srcDirs) {
    if (Test-Path "src\$dir") {
        $fileCount = (Get-ChildItem "src\$dir" -File -Recurse).Count
        Write-Host "  ✓ src\$dir ($fileCount files)" -ForegroundColor Green
    } else {
        Write-Host "  ✗ src\$dir MISSING" -ForegroundColor Red
    }
}

# Check Android configuration
Write-Host "`nChecking Android configuration..." -ForegroundColor Yellow
if (Test-Path "android\app\build.gradle") {
    $buildGradle = Get-Content "android\app\build.gradle" -Raw
    if ($buildGradle -match "react-native-maps") {
        Write-Host "  ✓ react-native-maps configured" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ react-native-maps may not be configured" -ForegroundColor Yellow
    }
} else {
    Write-Host "  MISSING android\app\build.gradle" -ForegroundColor Red
}

if (Test-Path "android\app\src\main\AndroidManifest.xml") {
    $manifest = Get-Content "android\app\src\main\AndroidManifest.xml" -Raw
    if ($manifest -match "com.google.android.geo.API_KEY") {
        Write-Host "  ✓ Google Maps API key placeholder found" -ForegroundColor Green
        if ($manifest -match "YOUR_GOOGLE_MAPS_API_KEY_HERE") {
            Write-Host "  ⚠ Remember to replace with actual API key!" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  ⚠ Google Maps API key not configured" -ForegroundColor Yellow
    }
} else {
    Write-Host "  MISSING AndroidManifest.xml" -ForegroundColor Red
}

# Check metro.config.js
Write-Host "`nChecking metro.config.js..." -ForegroundColor Yellow
if (Test-Path "metro.config.js") {
    $metroConfig = Get-Content "metro.config.js" -Raw
    if ($metroConfig -match "geojson" -and $metroConfig -match "json") {
        Write-Host "  ✓ Asset extensions configured" -ForegroundColor Green
    } else {
        Write-Host "  ⚠ Asset extensions may not be configured" -ForegroundColor Yellow
    }
} else {
    Write-Host "  MISSING metro.config.js" -ForegroundColor Red
}

# Summary
Write-Host "`n================================" -ForegroundColor Cyan
Write-Host "Migration Status Summary" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "1. Add Google Maps API key to android\app\src\main\AndroidManifest.xml" -ForegroundColor White
Write-Host "2. Test Android build: npm run android" -ForegroundColor White
Write-Host "3. (Optional for iOS) Run: cd ios && pod install && cd .." -ForegroundColor White
Write-Host ""
Write-Host "To start development:" -ForegroundColor Yellow
Write-Host "  Terminal 1: npm start" -ForegroundColor White
Write-Host "  Terminal 2: npm run android (or npm run ios)" -ForegroundColor White
Write-Host ""
