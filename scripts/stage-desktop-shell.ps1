$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$target = Join-Path $project '.release/shell'
New-Item -ItemType Directory -Force $target | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (!(Test-Path $vswhere)) { throw 'Windows shell integration requires Visual Studio C++ Build Tools.' }
$installation = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (!$installation) { throw 'Visual Studio C++ Build Tools were not found.' }
$environment = Join-Path $installation 'Common7/Tools/Launch-VsDevShell.ps1'
& $environment -Arch amd64 -HostArch amd64 -SkipAutomaticLocation
$source = Join-Path $project 'build/shell/vvtools-shell.cpp'
$object = Join-Path $target 'vvtools-shell.obj'
$dll = Join-Path $target 'vvtools-shell.dll'
$compilerArgs = @(
  '/nologo', '/utf-8', '/std:c++17', '/EHsc', '/W4', '/LD', '/MT',
  $source, "/Fo$object", '/link', "/OUT:$dll",
  'ole32.lib', 'shell32.lib', 'shlwapi.lib', 'advapi32.lib'
)
& cl.exe @compilerArgs
if ($LASTEXITCODE -ne 0) { throw 'Failed to compile Windows shell integration.' }
