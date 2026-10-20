# uninstall.ps1 -- remove the NJAU-CA plugins from the club profile.
#
# This script is intentionally conservative:
#   * It removes the plugin packages from the profile's dependencies.
#   * It renames the profile folder aside (timestamped) instead of deleting it.
#   * It NEVER touches your data directory. Club ledgers are not disposable.
#
# ASCII-only on purpose; see install.ps1 for why.

[CmdletBinding()]
param(
    [string] $ProfileName = 'njau'
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string] $Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Text) Write-Host "    OK   $Text" -ForegroundColor Green }
function Write-Warn { param([string] $Text) Write-Host "    WARN $Text" -ForegroundColor Yellow }

$RepoRoot = Split-Path -Parent $PSScriptRoot

function Resolve-Dsh {
    $cmd = Get-Command dsh -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
        (Join-Path $env:ProgramFiles 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
    )
    foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return $c } }
    return $null
}

$Dsh = Resolve-Dsh
$ProfileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$ProfileName"

if (-not (Test-Path $ProfileDir)) {
    Write-Warn "profile '$ProfileName' does not exist; nothing to uninstall."
    exit 0
}

# Collect the package names this repository owns.
$names = @()
foreach ($dir in (Get-ChildItem (Join-Path $RepoRoot 'packages') -Directory -ErrorAction SilentlyContinue)) {
    $manifest = Join-Path $dir.FullName 'package.json'
    if (Test-Path $manifest) {
        $json = Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($json.name) { $names += $json.name }
    }
}

if ($Dsh) {
    Write-Step "Removing plugins from profile '$ProfileName'"
    foreach ($n in $names) {
        & $Dsh plugin --profile $ProfileName remove $n 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { Write-Ok "$n removed" }
        else { Write-Warn "$n was not installed (or removal failed)" }
    }
} else {
    Write-Warn 'dsh launcher not found; only the folder will be moved aside.'
}

# Move the profile aside rather than deleting it, so a failed experiment is
# always recoverable.
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backup = Join-Path (Split-Path -Parent $ProfileDir) "$ProfileName.removed-$stamp"
Write-Step "Moving the profile aside"
Move-Item -LiteralPath $ProfileDir -Destination $backup -Force
Write-Ok "moved to $backup"

Write-Host ''
Write-Host 'Uninstall complete. Your data was NOT touched.' -ForegroundColor Green
Write-Host ('  data directory: ' + (Join-Path $env:USERPROFILE '.dsh\njau-ca')) -ForegroundColor White
Write-Host '  delete it by hand only if you really mean to.' -ForegroundColor Yellow
Write-Host ''