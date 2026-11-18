param(
  [Parameter(Mandatory)][string]$PreviousInstaller,
  [Parameter(Mandatory)][string]$CandidateInstaller
)

$ErrorActionPreference = 'Stop'
$workspace = Join-Path ([System.IO.Path]::GetTempPath()) ("folio-install-" + [guid]::NewGuid().ToString('N'))
$install = Join-Path $workspace 'app'
New-Item -ItemType Directory -Path $workspace | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)

function Install-Folio([string]$installer) {
  $setup = (Resolve-Path -LiteralPath $installer).Path
  # NSIS consumes the rest of the command line as the /D path.
  $process = Start-Process -FilePath $setup -ArgumentList "/S /D=$install" -WindowStyle Hidden -Wait -PassThru
  if ($process.ExitCode -ne 0) { throw "Installer exited with code $($process.ExitCode)" }
  foreach ($file in 'folio.exe','folio-cli.exe','skills/folio-data-entry/SKILL.md') {
    if (-not (Test-Path -LiteralPath (Join-Path $install $file) -PathType Leaf)) { throw "Missing installed file $file" }
  }
}

function Invoke-Folio([string[]]$CliArgs) {
  $response = & (Join-Path $install 'folio-cli.exe') @CliArgs
  if ($LASTEXITCODE -ne 0) { throw "Installed CLI failed during $($CliArgs[0])" }
  return ($response | ConvertFrom-Json).data
}

Install-Folio $PreviousInstaller
$recordId = [guid]::NewGuid().ToString()
$recordFile = Join-Path $workspace 'record.json'
$record = @{ id=$recordId; title='Synthetic upgrade record'; category='identity'; fields=@() }
[System.IO.File]::WriteAllText($recordFile, ($record | ConvertTo-Json), $utf8)
$null = Invoke-Folio @('create','--input',$recordFile)
$source = Join-Path $workspace 'synthetic.txt'
[System.IO.File]::WriteAllText($source, 'Synthetic attachment for upgrade verification.', $utf8)
$inputFile = Join-Path $workspace 'files.json'
[System.IO.File]::WriteAllText($inputFile, (ConvertTo-Json -InputObject @($source)), $utf8)
$null = Invoke-Folio @('attach','--record-id',$recordId,'--input',$inputFile)
$before = Invoke-Folio @('get','--id',$recordId)
$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $before.attachments[0].absolutePath).Hash
Install-Folio $CandidateInstaller
$after = Invoke-Folio @('get','--id',$recordId)
$version = (Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot '../package.json') | ConvertFrom-Json).version
if ((Invoke-Folio @('info')).version -ne $version -or $after.record.updatedAt -ne $before.record.updatedAt -or
    $after.attachments[0].absolutePath -ne $before.attachments[0].absolutePath -or
    (Get-FileHash -Algorithm SHA256 -LiteralPath $after.attachments[0].absolutePath).Hash -ne $hash) {
  throw 'Upgrade changed the record, path or bytes, or installed the wrong CLI.'
}
Write-Output 'Verified the installed version, record revision, managed path and attachment bytes after upgrade.'
