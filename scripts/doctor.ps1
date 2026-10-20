# doctor.ps1 -- self-check for the club DSH installation.
#
# Run this after installing, after a DSH upgrade, and at handover time.
# It answers one question: "is this installation still healthy?"
#
# ASCII-only on purpose; see install.ps1 for why.

[CmdletBinding()]
param(
    [string] $ProfileName = 'njau'
)

$ErrorActionPreference = 'Continue'

$script:Pass = 0
$script:Fail = 0
$script:Warn = 0

function Check-Ok   { param([string] $Text) $script:Pass++; Write-Host "  [ OK ] $Text" -ForegroundColor Green }
function Check-Bad  { param([string] $Text) $script:Fail++; Write-Host "  [FAIL] $Text" -ForegroundColor Red }
function Check-Warn { param([string] $Text) $script:Warn++; Write-Host "  [WARN] $Text" -ForegroundColor Yellow }
function Section    { param([string] $Text) Write-Host "`n$Text" -ForegroundColor Cyan }

$RepoRoot = Split-Path -Parent $PSScriptRoot

Write-Host ''
Write-Host 'NJAU-CA DSH doctor' -ForegroundColor White
Write-Host ('repo: ' + $RepoRoot)

# --------------------------------------------------------------------------
Section '1. Repository layout'
# --------------------------------------------------------------------------
foreach ($f in @('README.md', 'HANDOVER.md', 'docs\vision.md', 'docs\architecture.md',
                 'docs\install.md', 'scripts\install.ps1', 'packages\core', 'packages\brand')) {
    if (Test-Path (Join-Path $RepoRoot $f)) { Check-Ok "$f present" }
    else { Check-Bad "$f MISSING" }
}

# Every package must carry an OWNER.md -- that is what makes handover work.
foreach ($dir in (Get-ChildItem (Join-Path $RepoRoot 'packages') -Directory -ErrorAction SilentlyContinue)) {
    if (Test-Path (Join-Path $dir.FullName 'OWNER.md')) { Check-Ok "$($dir.Name)/OWNER.md present" }
    else { Check-Bad "$($dir.Name)/OWNER.md MISSING (handover requirement)" }
}

# --------------------------------------------------------------------------
Section '2. dsh launcher'
# --------------------------------------------------------------------------
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
if ($Dsh) { Check-Ok "launcher: $Dsh" } else { Check-Bad 'dsh launcher not found (is DeepSeek Harness installed?)' }

# --------------------------------------------------------------------------
Section '3. Profile'
# --------------------------------------------------------------------------
$ProfileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$ProfileName"
$ProfileJson = Join-Path $ProfileDir 'package.json'
if (Test-Path $ProfileJson) {
    Check-Ok "profile '$ProfileName' exists"
    $pj = Get-Content $ProfileJson -Raw -Encoding UTF8 | ConvertFrom-Json
    $bundles = @($pj.dsh.profile.bundles)
    Check-Ok ('bundles: ' + ($bundles -join ', '))

    # Every plugin package in the repo must be listed in bundles.
    foreach ($dir in (Get-ChildItem (Join-Path $RepoRoot 'packages') -Directory -ErrorAction SilentlyContinue)) {
        $m = Join-Path $dir.FullName 'package.json'
        if (-not (Test-Path $m)) { continue }
        $name = (Get-Content $m -Raw -Encoding UTF8 | ConvertFrom-Json).name
        if ($bundles -contains $name) { Check-Ok "$name in bundles" }
        else { Check-Bad "$name NOT in bundles (run scripts\install.ps1)" }
    }
} else {
    Check-Bad "profile '$ProfileName' not found -- run scripts\install.ps1"
}

# --------------------------------------------------------------------------
Section '4. Composed plugin tree'
# --------------------------------------------------------------------------
if ($Dsh -and (Test-Path $ProfileJson)) {
    $tree = (& $Dsh $ProfileName --dump-config 2>&1 | Out-String)
    if ($LASTEXITCODE -ne 0) {
        Check-Bad 'dump-config failed: the profile does not compose'
    } else {
        Check-Ok 'profile composes'
        foreach ($id in @('njau-ca-core', 'njau-ca-brand')) {
            if ($tree -match [regex]::Escape($id)) { Check-Ok "row '$id' present in composed tree" }
            else { Check-Bad "row '$id' MISSING from composed tree" }
        }
        # A quick sanity check that the base bundles are still there.
        if ($tree -match 'dsh-web-app') { Check-Ok 'base web bundle present' }
        else { Check-Warn 'dsh-web-app not found in composed tree' }
    }
}

# --------------------------------------------------------------------------
Section '5. Data directory'
# --------------------------------------------------------------------------
$DataDir = if ($env:NJAU_CA_DATA) { $env:NJAU_CA_DATA } else { Join-Path $env:USERPROFILE '.dsh\njau-ca' }
if (Test-Path $DataDir) {
    $count = (Get-ChildItem $DataDir -Recurse -File -ErrorAction SilentlyContinue).Count
    Check-Ok "data directory exists: $DataDir ($count files)"
    if ($count -eq 0) { Check-Warn 'data directory is empty -- expected on a fresh install' }
} else {
    Check-Warn "data directory not created yet: $DataDir (it appears on first run)"
}

# --------------------------------------------------------------------------
Section '6. Client bundle (browser half)'
# --------------------------------------------------------------------------
$clientJs = Join-Path $RepoRoot 'packages\brand\lib\client.js'
if (Test-Path $clientJs) {
    $c = Get-Content $clientJs -Raw -Encoding UTF8
    if ($c -match '__ModuleLoader__') { Check-Ok 'client.js uses window.__ModuleLoader__.load' }
    else { Check-Bad 'client.js does not use __ModuleLoader__ (browser half will not load)' }
    foreach ($slot in @('sidebar.brand.mark', 'sidebar.brand.name')) {
        if ($c -match [regex]::Escape($slot)) { Check-Ok "occupies slot $slot" }
        else { Check-Bad "does not occupy $slot" }
    }
    if ($c -match 'priority:\s*-1') { Check-Ok 'uses priority -1 to shadow the official brand' }
    else { Check-Warn 'no negative priority: the official brand mark may win' }
    $manifest = Get-Content (Join-Path $RepoRoot 'packages\brand\package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.exports.'./client') { Check-Ok 'package.json exports "./client"' }
    else { Check-Bad 'package.json does not export "./client" (browser half will 404)' }
    if ($manifest.dsh.client) { Check-Ok 'package.json declares dsh.client' }
    else { Check-Bad 'package.json missing dsh.client' }
} else {
    Check-Bad 'packages\brand\lib\client.js MISSING'
}

# --------------------------------------------------------------------------
Section '7. Smoke tests'
# --------------------------------------------------------------------------
$node = $null
foreach ($p in @(
    (Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness\resources\runtime\cli\bin\dsh.cmd')
)) { }
$nodeCandidates = @(
    (Join-Path $env:USERPROFILE '.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe'),
    'node'
)
foreach ($n in $nodeCandidates) {
    if ($n -eq 'node') { $c = Get-Command node -ErrorAction SilentlyContinue; if ($c) { $node = $c.Source; break } }
    elseif (Test-Path $n) { $node = $n; break }
}
if ($node) {
    Check-Ok "node: $node"
    foreach ($t in (Get-ChildItem (Join-Path $RepoRoot 'tests') -Filter 'smoke-*.mjs' -ErrorAction SilentlyContinue)) {
        $out = (& $node $t.FullName 2>&1 | Out-String)
        if ($LASTEXITCODE -eq 0) { Check-Ok "$($t.Name) passed" }
        else { Check-Bad "$($t.Name) FAILED"; Write-Host $out -ForegroundColor DarkGray }
    }
} else {
    Check-Warn 'node not found; skipped smoke tests'
}

# --------------------------------------------------------------------------
Write-Host ''
Write-Host '------------------------------------------------------------'
Write-Host (" doctor: " + $script:Pass + " ok, " + $script:Warn + " warn, " + $script:Fail + " fail")
Write-Host '------------------------------------------------------------'
if ($script:Fail -gt 0) {
    Write-Host ' Something is broken. See docs\install.md section 5 (after a DSH upgrade).' -ForegroundColor Red
    exit 1
}
Write-Host ' Installation looks healthy.' -ForegroundColor Green
exit 0