import { chmodSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const binDir = join(webRoot, "node_modules", ".bin");
const loader = pathToFileURL(join(webRoot, "scripts", "register-inteiro-loader.mjs")).href;
const cli = join(webRoot, "node_modules", "@inteiro", "cli", "src", "cli.ts");

writeFileSync(join(binDir, "inteiro.cmd"), `@ECHO off
GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start
SETLOCAL
CALL :find_dp0

IF EXIST "%dp0%\\node.exe" (
  SET "_prog=%dp0%\\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%" --import "${loader}" "${cli}" %*
`);

writeFileSync(join(binDir, "inteiro.ps1"), `#!/usr/bin/env pwsh
$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent
$loader="${loader}"
$cli="${cli}"
$exe=""
if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) { $exe=".exe" }
$ret=0
if (Test-Path "$basedir/node$exe") {
  if ($MyInvocation.ExpectingInput) { $input | & "$basedir/node$exe" --import $loader $cli $args }
  else { & "$basedir/node$exe" --import $loader $cli $args }
  $ret=$LASTEXITCODE
} else {
  if ($MyInvocation.ExpectingInput) { $input | & "node$exe" --import $loader $cli $args }
  else { & "node$exe" --import $loader $cli $args }
  $ret=$LASTEXITCODE
}
exit $ret
`);

const sh = `#!/bin/sh
exec node --import "${loader}" "${cli}" "$@"
`;
writeFileSync(join(binDir, "inteiro"), sh);
try { chmodSync(join(binDir, "inteiro"), 0o755); } catch { /* Windows */ }

