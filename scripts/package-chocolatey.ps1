param([string]$Installer)
# Synchronise the Chocolatey package with package.json and the exact released installer, then pack it.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$version = $package.version
if ($version -notmatch '^\d+\.\d+\.\d+$') { throw "Chocolatey releases need a stable version; package.json has $version." }
if (-not $Installer) { $Installer = Join-Path $root "release/nebula-doc-$version.exe" }
$resolvedInstaller = (Resolve-Path -LiteralPath $Installer).Path
$hash = (Get-FileHash -LiteralPath $resolvedInstaller -Algorithm SHA256).Hash.ToLowerInvariant()
$tools = Join-Path $root 'packaging/chocolatey/tools/chocolateyInstall.ps1'
$script = [System.IO.File]::ReadAllText($tools)
$script = $script -replace "checksum64\s*=\s*'[^']+'", "checksum64     = '$hash'"
$downloadUrl = "https://github.com/Porkstone/nebula-doc/releases/download/v$version/nebula-doc-$version.exe"
$script = $script -replace "url64bit\s*=\s*'[^']+'", "url64bit       = '$downloadUrl'"
[System.IO.File]::WriteAllText($tools, $script, [System.Text.UTF8Encoding]::new($false))
$nuspecPath = Join-Path $root 'packaging/chocolatey/nebula-doc.nuspec'
$nuspec = [System.IO.File]::ReadAllText($nuspecPath)
if ($nuspec -match 'ICON_COMMIT') { throw 'Pin the nuspec iconUrl to a public commit that contains build/icon.png.' }
$nuspec = $nuspec -replace '<version>[^<]+</version>', "<version>$version</version>"
$nuspec = $nuspec -replace '<projectSourceUrl>[^<]+</projectSourceUrl>', "<projectSourceUrl>https://github.com/Porkstone/nebula-doc/tree/v$version</projectSourceUrl>"
$nuspec = $nuspec -replace '<releaseNotes>[^<]+</releaseNotes>', "<releaseNotes>https://github.com/Porkstone/nebula-doc/releases/tag/v$version</releaseNotes>"
[System.IO.File]::WriteAllText($nuspecPath, $nuspec, [System.Text.UTF8Encoding]::new($false))
$release = Join-Path $root 'release'
$null = New-Item -ItemType Directory -Path $release -Force
Set-Content -LiteralPath (Join-Path $release 'SHA256SUMS.txt') -Value "$hash  $([System.IO.Path]::GetFileName($resolvedInstaller))" -Encoding ASCII
& choco pack $nuspecPath --output-directory $release --no-progress
if ($LASTEXITCODE -ne 0) { throw 'Chocolatey package creation failed.' }
Write-Output "Installer SHA-256: $hash"
