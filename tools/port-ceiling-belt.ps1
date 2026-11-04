param([string]$PatchFile)
$ErrorActionPreference = 'Stop'
if ($PatchFile) {
  $patch = Get-Content -LiteralPath $PatchFile -Raw
} else {
$sourceRoot = 'C:/Users/eckar/Desktop/plungee-devvit'
$targetRoot = 'C:/Users/eckar/Desktop/Repos/plungee'
$patch = "*** Begin Patch`n"
foreach ($relative in @('game/renderer.ts', 'editor/brush.ts')) {
  $diff = (& git -C $sourceRoot diff -- "src/client/plungee/$relative") -join "`n"
  if ($LASTEXITCODE -ne 0) { throw 'Cannot read source diff' }
  $start = $diff.IndexOf('@@')
  if ($start -lt 0) { throw "Missing source changes: $relative" }
  $hunks = [regex]::Replace($diff.Substring($start), '(?m)^@@[^\r\n]*', '@@')
  if ($relative -eq 'game/renderer.ts') {
    $hunks = $hunks.Replace('ghostTheme', 'baseColors').Replace('ghostLook', 'runnerLook')
  }
  $patch += "*** Update File: $targetRoot/src/$relative`n$hunks`n"
}
$pose = Get-Content -LiteralPath "$sourceRoot/src/client/plungee/game/beltPose.ts" -Raw
$patch += "*** Add File: $targetRoot/src/game/beltPose.ts`n"
$patch += (($pose.TrimEnd() -split '\r?\n' | ForEach-Object { '+' + $_ }) -join "`n") + "`n"
$tests = Get-Content -LiteralPath "$sourceRoot/tools/ceiling-belt.test.mjs" -Raw
$tests = $tests.Substring($tests.IndexOf('const { World'))
$tests = "import assert from 'node:assert/strict'`nimport { test } from 'vitest'`n" + $tests
$tests = $tests.Replace('../src/client/plungee/', '../src/').Replace(".ts')", "')")
$patch += "*** Add File: $targetRoot/tests/ceiling-belt.test.ts`n"
$patch += (($tests.TrimEnd() -split '\r?\n' | ForEach-Object { '+' + $_ }) -join "`n") + "`n*** End Patch"
}
$native = 'C:/Users/eckar/AppData/Roaming/Code/agent-host/sdk-cache/codex/0.163.0/win32-x64/node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe'
$escapedPatch = [regex]::Replace($patch, '(\\*)"', '$1$1\"')
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = $native
$info.Arguments = '--codex-run-as-apply-patch "' + $escapedPatch + '"'
$info.WorkingDirectory = $targetRoot
$info.UseShellExecute = $false
$info.RedirectStandardOutput = $true
$info.RedirectStandardError = $true
$process = [System.Diagnostics.Process]::Start($info)
$result = $process.StandardOutput.ReadToEnd()
$failure = $process.StandardError.ReadToEnd()
$process.WaitForExit()
Write-Output $result
if ($failure) { Write-Output $failure }
if ($process.ExitCode -ne 0) { throw "Patch failed: $($process.ExitCode)" }
