[CmdletBinding()]
param(
    [string]$EmulatorName,
    [int]$BackendPort,
    [switch]$SkipEmulator
)

$ErrorActionPreference = 'Stop'

function Write-Section {
    param([string]$Message)
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}

function Start-ExternalProcess {
    param(
        [Parameter(Mandatory)] [string]$Title,
        [Parameter(Mandatory)] [string]$WorkingDirectory,
        [Parameter(Mandatory)] [string]$Command
    )

    if (-not (Test-Path $WorkingDirectory)) {
        throw "Working directory '$WorkingDirectory' does not exist."
    }

    $psScript = @"
`$Host.UI.RawUI.WindowTitle = '$Title';
Set-Location -Path '$WorkingDirectory';
$Command
"@

    Write-Host "Launching $Title in a new PowerShell window..." -ForegroundColor Green
    Start-Process -FilePath "powershell.exe" -ArgumentList "-NoExit", "-Command", $psScript | Out-Null
}

function Get-AndroidToolPath {
    param(
        [Parameter(Mandatory)] [string]$RelativePath,
        [Parameter(Mandatory)] [string]$ToolDescription
    )

    $candidateRoots = @(
        $env:ANDROID_SDK_ROOT,
        $env:ANDROID_HOME,
        (Join-Path $env:LOCALAPPDATA 'Android\Sdk')
    ) | Where-Object { $_ -and (Test-Path $_) }

    foreach ($root in $candidateRoots) {
        $fullPath = Join-Path $root $RelativePath
        if (Test-Path $fullPath) {
            return $fullPath
        }
    }

    throw "Unable to find $ToolDescription. Please ensure ANDROID_SDK_ROOT or ANDROID_HOME is set."
}

function Start-AndroidEmulator {
    param(
        [string]$AvdName
    )

    $emulatorExe = Get-AndroidToolPath -RelativePath 'emulator\emulator.exe' -ToolDescription 'Android Emulator executable'
    $adbExe = Get-AndroidToolPath -RelativePath 'platform-tools\adb.exe' -ToolDescription 'ADB executable'

    if (-not $AvdName) {
        $available = & $emulatorExe -list-avds | Where-Object { $_.Trim() }
        if (-not $available) {
            throw 'No Android Virtual Devices (AVDs) are configured. Create one via Android Studio first.'
        }
        $AvdName = $available[0].Trim()
        Write-Host "No emulator name supplied. Using first available AVD: $AvdName" -ForegroundColor Yellow
    }

    $alreadyRunning = (& $adbExe devices) -match 'emulator-'
    if ($alreadyRunning) {
        Write-Host 'An Android emulator is already running. Skipping launch.' -ForegroundColor Yellow
        return
    }

    Write-Host "Starting Android emulator '$AvdName'..." -ForegroundColor Green
    Start-Process -FilePath $emulatorExe -ArgumentList @('-avd', $AvdName, '-netdelay', 'none', '-netspeed', 'full') | Out-Null
}

function Resolve-BackendPort {
    param(
        [string]$RepoRoot,
        [int]$ExplicitPort
    )

    if ($ExplicitPort) {
        return $ExplicitPort
    }

    $envFile = Join-Path $RepoRoot '.env'
    if (Test-Path $envFile) {
        $match = Select-String -Path $envFile -Pattern '^\s*PORT\s*=\s*(\d+)' -CaseSensitive -AllMatches | Select-Object -First 1
        if ($match) {
            return [int]$match.Matches[0].Groups[1].Value
        }
    }

    return 3001
}

function Test-ServicePort {
    param(
        [string]$Label,
        [int]$Port
    )

    $result = Test-NetConnection -ComputerName 'localhost' -Port $Port -WarningAction SilentlyContinue
    if ($result.TcpTestSucceeded) {
        Write-Host "[$Label] Port $Port is accepting connections." -ForegroundColor Green
        return $true
    }

    Write-Host "[$Label] Unable to reach port $Port." -ForegroundColor Red
    return $false
}

function Test-HttpEndpoint {
    param(
        [string]$Label,
        [string]$Url
    )

    try {
        $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 5
        if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
            Write-Host "[$Label] HTTP $($response.StatusCode) from $Url" -ForegroundColor Green
            return $true
        }
    } catch {
        Write-Host "[$Label] Request to $Url failed: $($_.Exception.Message)" -ForegroundColor Red
    }

    return $false
}

# Main execution
$repoRoot = Split-Path $PSScriptRoot -Parent
$backendDir = Join-Path $repoRoot 'backend'
$metroDir = $repoRoot
$backendPortToUse = Resolve-BackendPort -RepoRoot $repoRoot -ExplicitPort $BackendPort

Write-Section 'Launching Metro Bundler'
Start-ExternalProcess -Title 'Metro Bundler' -WorkingDirectory $metroDir -Command 'npm start'

Write-Section 'Launching Backend API'
Start-ExternalProcess -Title 'Solar Backend API' -WorkingDirectory $backendDir -Command 'npm start'

if (-not $SkipEmulator) {
    Write-Section 'Starting Android Emulator'
    try {
        Start-AndroidEmulator -AvdName $EmulatorName
    } catch {
        Write-Host $_.Exception.Message -ForegroundColor Red
    }
} else {
    Write-Host 'Emulator start skipped by user request.' -ForegroundColor Yellow
}

Write-Section 'Verifying Services'
Start-Sleep -Seconds 8
$metroOk = Test-ServicePort -Label 'Metro' -Port 8085
$backendPortOk = Test-ServicePort -Label 'Backend' -Port $backendPortToUse
$backendHealthOk = Test-HttpEndpoint -Label 'Backend Health' -Url "http://localhost:$backendPortToUse/health"

if ($metroOk -and $backendPortOk -and $backendHealthOk) {
    Write-Host "All services appear to be running." -ForegroundColor Green
} else {
    Write-Host "One or more services failed verification. Check the external windows for logs." -ForegroundColor Red
}
