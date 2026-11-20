$ErrorActionPreference = 'Stop'
# 'nebula-doc *' (with the space) never matches the separate nebula-docx package.
# Get-UninstallRegistryKey returns $null when nothing matches; drop it so counts are correct.
function Get-NebulaDocUninstallKeys([switch]$Quiet) {
  $warnings = 'Continue'; if ($Quiet) { $warnings = 'SilentlyContinue' }
  @(Get-UninstallRegistryKey -SoftwareName 'nebula-doc *' -WarningAction $warnings | Where-Object { $_ })
}
$entries = @(Get-NebulaDocUninstallKeys)
if ($entries.Count -eq 0) { Write-Warning 'nebula-doc is already uninstalled.'; return }
foreach ($entry in $entries) {
  $uninstaller = $entry.UninstallString
  if ($uninstaller -match '^"([^"]+)"') { $uninstaller = $Matches[1] }
  else { $uninstaller = $uninstaller.Trim() }
  if (-not (Test-Path -LiteralPath $uninstaller)) { throw "Uninstaller not found: $uninstaller" }
  # electron-builder's per-machine uninstaller needs /allusers to remove the all-users installation silently.
  Uninstall-ChocolateyPackage -PackageName 'nebula-doc' -FileType 'exe' -SilentArgs '/S /allusers' -File $uninstaller -ValidExitCodes @(0, 1605, 1614, 1641, 3010)
}
# The NSIS uninstaller relaunches itself from %TEMP% and returns before removal finishes.
# Wait for its registration to disappear so Chocolatey's auto-uninstaller does not start a second copy.
$deadline = (Get-Date).AddMinutes(10)
while (@(Get-NebulaDocUninstallKeys -Quiet).Count -gt 0) {
  if ((Get-Date) -gt $deadline) { throw 'Timed out waiting for the nebula-doc uninstaller to finish.' }
  Start-Sleep -Seconds 2
}
