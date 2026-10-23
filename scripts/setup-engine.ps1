$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$cachePath = Join-Path $projectRoot '.cache'
$enginePath = Join-Path $cachePath 'libreoffice'
if (Test-Path -LiteralPath (Join-Path $enginePath 'program\python.exe')) {
    Write-Output 'The project-local LibreOffice engine is already available.'
    exit 0
}
New-Item -ItemType Directory -Force -Path $cachePath | Out-Null
$installerPath = Join-Path $cachePath 'LibreOffice.msi'
$downloadUrl = 'https://download.documentfoundation.org/libreoffice/stable/26.8.1/win/x86_64/LibreOffice_26.8.1_Win_x86-64.msi'
Write-Output 'Downloading LibreOffice 26.8.1 (Windows x64, approximately 358 MB)…'
& curl.exe -L --fail --silent --show-error $downloadUrl -o $installerPath
if ($LASTEXITCODE -ne 0) { throw 'LibreOffice download failed.' }
$expectedHash = 'C6298B10CFA1748BCBEDAD94C62CE771E240E5021BFD6D7A967CD571B04B5312'
if ((Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash -ne $expectedHash) { throw 'Installer SHA-256 verification failed.' }
Write-Output 'Extracting a private document engine. No system-wide Office installation is changed.'
$extractLog = Join-Path $cachePath 'extract.log'
$arguments = @('/a', ('"' + $installerPath + '"'), '/qn', ('TARGETDIR="' + $enginePath + '"'), '/L*v', ('"' + $extractLog + '"'))
$process = Start-Process -FilePath 'msiexec.exe' -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
if ($process.ExitCode -ne 0) { throw "LibreOffice extraction failed ($($process.ExitCode)); see $extractLog" }
if (-not (Test-Path -LiteralPath (Join-Path $enginePath 'program\python.exe'))) { throw 'The LibreOffice Python/UNO runtime was not extracted.' }
Write-Output 'Local document engine ready. Run pnpm dev to start Nebula Doc.'
