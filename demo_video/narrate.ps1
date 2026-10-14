$ErrorActionPreference = 'Stop'
$demoDir = $PSScriptRoot
$scenes = Get-Content -LiteralPath (Join-Path $demoDir 'storyboard.json') -Raw | ConvertFrom-Json
$voice = New-Object -ComObject SAPI.SpVoice
$voices = $voice.GetVoices()
for ($i = 0; $i -lt $voices.Count; $i++) {
    if ($voices.Item($i).GetDescription() -like '*Zira*') { $voice.Voice = $voices.Item($i) }
}
$voice.Rate = 2
$voice.Volume = 100
foreach ($scene in $scenes) {
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Open((Join-Path $demoDir ($scene.id + '.wav')), 3, $false)
    $voice.AudioOutputStream = $stream
    [void]$voice.Speak($scene.narration)
    $stream.Close()
    Write-Output ('Narrated ' + $scene.id)
}
