# install.ps1 -- install the NJAU-CA DSH plugin set into a dedicated profile.
#
# Design notes for whoever inherits this:
#   * This file is deliberately ASCII-only. Windows PowerShell 5.1 mis-decodes
#     UTF-8 Chinese in .ps1 files that carry no BOM, which would break parsing
#     on a fresh machine. All Chinese documentation lives in ../docs/*.md.
#   * The profile is created from the shipped "web" template. We never touch the
#     user's own "desktop" profile.
#   * `--dump-config` composes the plugin tree and exits WITHOUT booting a
#     server, so this script is safe to run while another DSH is already open.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1
#   powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 -ProfileName njau

[CmdletBinding()]
param(
    [string] $ProfileName = 'njau',
    [switch] $SkipVerify
)

$ErrorActionPreference = 'Stop'

function Write-Step { param([string] $Text) Write-Host "`n==> $Text" -ForegroundColor Cyan }
function Write-Ok   { param([string] $Text) Write-Host "    OK   $Text" -ForegroundColor Green }
function Write-Warn { param([string] $Text) Write-Host "    WARN $Text" -ForegroundColor Yellow }
function Write-Bad  { param([string] $Text) Write-Host "    FAIL $Text" -ForegroundColor Red }

# --------------------------------------------------------------------------
# 0. Locate the repository root (the parent of this script's folder).
# --------------------------------------------------------------------------
$RepoRoot = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $RepoRoot 'packages'))) {
    throw "Cannot find a 'packages' folder next to $PSScriptRoot. Run this script from inside the repository."
}
Write-Step "Repository root: $RepoRoot"

# --------------------------------------------------------------------------
# 1. Locate the dsh launcher.
# --------------------------------------------------------------------------
function Resolve-Dsh {
    # a) already on PATH
    $cmd = Get-Command dsh -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }

    # b) standard per-user install locations
    $candidates = @(
        (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
        (Join-Path $env:ProgramFiles 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd'),
        (Join-Path ${env:ProgramFiles(x86)} 'DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    return $null
}

$Dsh = Resolve-Dsh
if (-not $Dsh) {
    Write-Bad 'Could not find the dsh launcher.'
    Write-Host '    Install DeepSeek Harness first, or add its cli\bin folder to PATH.'
    exit 1
}
Write-Ok "dsh launcher: $Dsh"

# --------------------------------------------------------------------------
# 2. Collect the plugin packages in this repository.
#    A plugin package is any packages/<name>/package.json that declares
#    dsh.bundle.patch. That declaration is what makes `dsh plugin add` work.
# --------------------------------------------------------------------------
$packagesDir = Join-Path $RepoRoot 'packages'
$plugins = @()
foreach ($dir in (Get-ChildItem $packagesDir -Directory | Sort-Object Name)) {
    $manifest = Join-Path $dir.FullName 'package.json'
    if (-not (Test-Path $manifest)) { continue }
    $json = Get-Content $manifest -Raw -Encoding UTF8 | ConvertFrom-Json
    if (-not $json.dsh -or -not $json.dsh.bundle -or -not $json.dsh.bundle.patch) {
        Write-Warn "$($dir.Name): no dsh.bundle.patch, skipped"
        continue
    }
    $plugins += [pscustomobject]@{ Name = $json.name; Dir = $dir.FullName }
}

if ($plugins.Count -eq 0) { throw "No installable plugin packages found under $packagesDir." }
Write-Ok ("plugins found: " + (($plugins | ForEach-Object { $_.Name }) -join ', '))

# --------------------------------------------------------------------------
# 3. Create the profile from the shipped web template if it does not exist.
#    --dump-config writes the profile then exits without booting.
# --------------------------------------------------------------------------
$ProfileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$ProfileName"
if (Test-Path (Join-Path $ProfileDir 'package.json')) {
    Write-Ok "profile '$ProfileName' already exists, reusing it"
} else {
    Write-Step "Creating profile '$ProfileName' from the shipped 'web' template"
    & $Dsh $ProfileName --from-default-profile web --dump-config | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $ProfileDir 'package.json'))) {
        throw "Failed to create profile '$ProfileName'."
    }
    Write-Ok "profile created at $ProfileDir"
}

# --------------------------------------------------------------------------
# 4. Install each plugin package into the profile.
#    `dsh plugin add` runs pnpm and appends the package to dsh.profile.bundles.
# --------------------------------------------------------------------------
Write-Step "Installing plugins into profile '$ProfileName'"
foreach ($p in $plugins) {
    # pnpm wants forward slashes in file: specs, even on Windows.
    $spec = 'file:' + ($p.Dir -replace '\\', '/')
    & $Dsh plugin --profile $ProfileName add $spec | Out-Null
    if ($LASTEXITCODE -ne 0) { Write-Bad "$($p.Name): pnpm install failed"; exit 1 }
    Write-Ok "$($p.Name) installed"
}

# --------------------------------------------------------------------------
# 5. Verify: the composed tree must contain a row for every plugin we installed.
# --------------------------------------------------------------------------
if (-not $SkipVerify) {
    Write-Step 'Verifying the composed profile tree'
    $tree = (& $Dsh $ProfileName --dump-config 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'dump-config failed; the profile does not compose.' }

    $missing = @()
    foreach ($p in $plugins) {
        if ($tree -notmatch [regex]::Escape($p.Name)) { $missing += $p.Name }
    }
    if ($missing.Count -gt 0) {
        Write-Bad ('not present in the composed tree: ' + ($missing -join ', '))
        exit 1
    }
    foreach ($p in $plugins) { Write-Ok "$($p.Name) present in composed tree" }
}

# --------------------------------------------------------------------------
# 6. Done.
# --------------------------------------------------------------------------
Write-Host ''
Write-Host '------------------------------------------------------------' -ForegroundColor Green
Write-Host ' Install complete.' -ForegroundColor Green
Write-Host '------------------------------------------------------------' -ForegroundColor Green
Write-Host ''
Write-Host ' Start the club edition with:'
Write-Host "     `"$Dsh`" $ProfileName --port 0 --no-open" -ForegroundColor White
Write-Host ''
Write-Host ' Then check the startup log for these two lines:'
Write-Host '     [njau-ca] core  loaded ...'
Write-Host '     [njau-ca] brand took over the web branding ...'
Write-Host ''
Write-Host ' Data lives in: ' -NoNewline
Write-Host (Join-Path $env:USERPROFILE '.dsh\njau-ca') -ForegroundColor White
Write-Host ' Read ../docs/install.md for the full checklist.'
Write-Host ''