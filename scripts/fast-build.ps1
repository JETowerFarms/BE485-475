# Fast Android Build Script for Powerful Systems
# Run this for the fastest possible build

Write-Host "Starting optimized Android build..." -ForegroundColor Green

# Set environment variables for maximum performance
$env:GRADLE_OPTS = "-Xmx32g -XX:MaxMetaspaceSize=4g -XX:+HeapDumpOnOutOfMemoryError -Dfile.encoding=UTF-8"

# Prefer migrated Android SDK location (avoid hard-coding C:\ paths)
if (-not $env:ANDROID_SDK_ROOT) {
    if ($env:ANDROID_HOME) {
        $env:ANDROID_SDK_ROOT = $env:ANDROID_HOME
    } elseif (Test-Path "O:\SDKs\platform-tools\adb.exe") {
        $env:ANDROID_SDK_ROOT = "O:\SDKs"
        $env:ANDROID_HOME = "O:\SDKs"
    }
}

# Optional: move Gradle cache off C:\ (comment out if you prefer default)
if (-not $env:GRADLE_USER_HOME -and (Test-Path "O:\")) {
    $env:GRADLE_USER_HOME = "O:\.gradle"
    if (-not (Test-Path $env:GRADLE_USER_HOME)) {
        New-Item -ItemType Directory -Path $env:GRADLE_USER_HOME -Force | Out-Null
    }
}

# Define log file path
$logFile = "$PSScriptRoot\build-output.log"
Write-Host "Build output will be saved to: $logFile" -ForegroundColor Cyan

# Navigate to android directory
Set-Location -Path "$PSScriptRoot\android"

Write-Host "Building with maximum parallelization..." -ForegroundColor Cyan

# Check if this is first build (check if gradle cache has dependencies)
$gradleCache = "$env:USERPROFILE\.gradle\caches\modules-2\files-2.1"
$hasGradleCache = Test-Path $gradleCache

if (-not $hasGradleCache) {
    Write-Host "First build detected - downloading dependencies..." -ForegroundColor Yellow
    # First build: download dependencies and assemble
    & .\gradlew.bat assembleDebug --parallel --max-workers=16 --build-cache --configure-on-demand --daemon 2>&1 | Tee-Object -FilePath $logFile
    $buildSuccess = $LASTEXITCODE -eq 0
} else {
    Write-Host "Building with cached dependencies..." -ForegroundColor Yellow
    # Subsequent builds
    & .\gradlew.bat assembleDebug --parallel --max-workers=16 --build-cache --configure-on-demand --daemon 2>&1 | Tee-Object -FilePath $logFile
    $buildSuccess = $LASTEXITCODE -eq 0
}

if ($buildSuccess) {
    Write-Host "`nBuild complete! APK location:" -ForegroundColor Green
    Write-Host "android\app\build\outputs\apk\debug\app-debug.apk" -ForegroundColor Yellow
    Write-Host "Build log saved to: $logFile" -ForegroundColor Cyan
} else {
    Write-Host "`nBuild FAILED! Check errors above or in log file." -ForegroundColor Red
    Write-Host "Build log: $logFile" -ForegroundColor Cyan
    Set-Location -Path $PSScriptRoot
    exit 1
}

# Return to root
Set-Location -Path $PSScriptRoot
