param([string]$Sample)
# Verify the silent all-users installer on a clean machine. With -Sample, also run the
# Electron UI test against the installed nebula-doc.exe using that .doc document.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$version = (Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json).version
$installer = Join-Path $root "release/nebula-doc-$version.exe"
$target = Join-Path $root 'release/install-smoke'
$uninstallKeys = 'HKLM:/Software/Microsoft/Windows/CurrentVersion/Uninstall/*'
# 'nebula-doc *' (with the space) never matches the separate nebula-docx application.
$installed = { Get-ItemProperty $uninstallKeys -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName -like 'nebula-doc *' } }
if (& $installed) { throw 'nebula-doc is already installed. Run installer verification on a clean machine.' }
$process = Start-Process -FilePath $installer -ArgumentList @('/S', '/allusers', "/D=$target") -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "Silent install failed: $($process.ExitCode)" }
$executable = Join-Path $target 'nebula-doc.exe'
$uninstaller = Join-Path $target 'Uninstall nebula-doc.exe'
try {
  if (-not (Test-Path -LiteralPath $executable)) { throw 'Installed executable nebula-doc.exe is missing.' }
  foreach ($notice in 'licenses/Nebula-Doc-MIT.txt', 'licenses/THIRD_PARTY_NOTICES.txt', 'libreoffice/license.txt', 'libreoffice/program/soffice.exe') {
    if (-not (Test-Path -LiteralPath (Join-Path $target "resources/$notice"))) { throw "Installed file missing: resources/$notice" }
  }
  $entry = & $installed
  if (-not $entry) { throw 'Machine-wide uninstall registration missing.' }
  if ($entry.DisplayVersion -ne $version) { throw "Registered version $($entry.DisplayVersion) does not match $version." }
  $shortcut = Join-Path ([Environment]::GetFolderPath('CommonPrograms')) 'nebula-doc.lnk'
  if (-not (Test-Path -LiteralPath $shortcut)) { throw 'All-users Start menu shortcut missing.' }
  if ($Sample) {
    $env:NEBULA_TEST_EXECUTABLE = $executable
    & pnpm --dir $root test:electron $Sample
    if ($LASTEXITCODE -ne 0) { throw 'Installed application UI test failed.' }
  }
} finally {
  Remove-Item Env:NEBULA_TEST_EXECUTABLE -ErrorAction SilentlyContinue
  if (Test-Path -LiteralPath $uninstaller) {
    $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('/S', '/allusers') -WindowStyle Hidden -Wait -PassThru
    if ($uninstall.ExitCode -ne 0) { throw "Silent uninstall failed: $($uninstall.ExitCode)" }
  }
}
Start-Sleep -Seconds 2
if (& $installed) { throw 'Uninstall registry entry was not removed.' }
if (Test-Path -LiteralPath $executable) { throw 'Installed executable was not removed.' }
Write-Output 'PASS: silent all-users install, nebula-doc.exe, licence notices, uninstall registration, Start menu shortcut, silent uninstall and registry cleanup.'
