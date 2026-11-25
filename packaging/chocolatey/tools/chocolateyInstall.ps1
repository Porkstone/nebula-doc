$ErrorActionPreference = 'Stop'
$packageArgs = @{
  packageName    = 'nebula-doc'
  fileType       = 'exe'
  url64bit       = 'https://github.com/Porkstone/nebula-doc/releases/download/v1.0.1/nebula-doc-1.0.1.exe'
  checksum64     = 'ad04fb887ccc4a2891c472ab882f6d6e25872244ffe3a6922888d5bab15a59b5'
  checksumType64 = 'sha256'
  silentArgs     = '/S /allusers'
  validExitCodes = @(0, 1641, 3010)
  # 'nebula-doc *' (with the space) never matches the separate nebula-docx package.
  softwareName   = 'nebula-doc *'
}
if (-not (Get-OSArchitectureWidth -Compare 64)) { throw 'nebula-doc requires 64-bit Windows.' }
Install-ChocolateyPackage @packageArgs
