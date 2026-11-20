$ErrorActionPreference = 'Stop'
$packageArgs = @{
  packageName    = 'nebula-doc'
  fileType       = 'exe'
  url64bit       = 'https://github.com/Porkstone/nebula-doc/releases/download/v1.0.0/nebula-doc-1.0.0.exe'
  checksum64     = '572737dbf6806d6668831ef2c5a58d9bc414a354ff2a723f03d1d9bcaa5c1a05'
  checksumType64 = 'sha256'
  silentArgs     = '/S /allusers'
  validExitCodes = @(0, 1641, 3010)
  # 'nebula-doc *' (with the space) never matches the separate nebula-docx package.
  softwareName   = 'nebula-doc *'
}
if (-not (Get-OSArchitectureWidth -Compare 64)) { throw 'nebula-doc requires 64-bit Windows.' }
Install-ChocolateyPackage @packageArgs
