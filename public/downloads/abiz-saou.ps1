# ABIZ 5.0 (build 1.17.0): switch program to saou.ru + poehali.dev functions, then build installers.
# Run in PowerShell:
#   powershell -ExecutionPolicy Bypass -File abiz-saou.ps1 -Src "C:\Projects\ABIZ-source"
param([string]$Src = "C:\Projects\ABIZ-source", [switch]$NoBuild)

$ErrorActionPreference = "Stop"
$enc = New-Object System.Text.UTF8Encoding($true)
$shell = Join-Path $Src "AbizShell"
if (-not (Test-Path (Join-Path $shell "AbizShell.csproj"))) { throw "AbizShell.csproj not found in $shell. Set -Src to the folder with build-installer.ps1" }

function Edit-File([string]$rel, [scriptblock]$fn) {
    $p = Join-Path $Src $rel
    if (-not (Test-Path $p)) { Write-Host "  skip (no file): $rel" -ForegroundColor Yellow; return }
    $t = [IO.File]::ReadAllText($p)
    $n = & $fn $t
    if ($n -ne $t) { [IO.File]::WriteAllText($p, $n, $enc); Write-Host "  changed: $rel" -ForegroundColor Green }
    else { Write-Host "  ok:      $rel" -ForegroundColor DarkGray }
}

Write-Host "1/4 ServerConfig.cs" -ForegroundColor Cyan
$cfg = @'
namespace AbizShell
{
    public static class ServerConfig
    {
        public const string Site = "https://saou.ru";
        public const string HomePage = Site + "/";

        public const string DataApi = "https://functions.poehali.dev/e40aca0d-1c72-49c0-84a1-cf57b44984ec";
        public const string AuthApi = "https://functions.poehali.dev/0cc75331-123f-465b-a6da-01ba5f142bfa";
        public const string DeviceControlApi = "https://functions.poehali.dev/f01f3da3-3368-428a-919d-fe5933bc5ab8";
        public const string SkudApi = "https://functions.poehali.dev/150e30dd-bd2d-45c5-8db8-a4055bf55fd9";
        public const string CamerasApi = "https://functions.poehali.dev/246cb9d5-b997-40d1-8f46-082cafe7879e";
    }
}
'@
[IO.File]::WriteAllText((Join-Path $shell "ServerConfig.cs"), $cfg, $enc)

Write-Host "2/4 server addresses" -ForegroundColor Cyan
Edit-File "AbizShell\AnodBizClient.cs" { param($t) $t.Replace('"https://bizwor.ru/api/data-api"', 'ServerConfig.DataApi').Replace('"https://bizwor.ru/api/auth-api"', 'ServerConfig.AuthApi') }
foreach ($f in "RemoteControlClient.cs", "Updater.cs") {
    Edit-File "AbizShell\$f" { param($t) $t.Replace('"https://bizwor.ru/api/device-control"', 'ServerConfig.DeviceControlApi') }
}
foreach ($f in "RecorderService.cs", "SkudRecorder.cs", "GateBridge.cs", "CamerasClient.cs") {
    Edit-File "AbizShell\$f" { param($t) $t.Replace('"https://bizwor.ru/api/skud-api"', 'ServerConfig.SkudApi').Replace('"https://bizwor.ru/api/cameras-api"', 'ServerConfig.CamerasApi') }
}
Edit-File "AbizShell\CameraWindow.xaml.cs" { param($t) $t.Replace('$"https://bizwor.ru/cam-view', '$"{ServerConfig.Site}/cam-view') }
Edit-File "AbizShell\ShellWindow.xaml.cs" {
    param($t)
    $t = $t.Replace('public const string HomePage = "https://bizwor.ru/";', 'public const string HomePage = ServerConfig.HomePage;')
    $t = $t.Replace('"https://bizwor.ru" + path', 'ServerConfig.Site + path')
    $t = $t.Replace('$"https://bizwor.ru/', '$"{ServerConfig.Site}/')
    $t = [regex]::Replace($t, '"https://bizwor\.ru/([a-z]+)"', 'ServerConfig.Site + "/$1"')
    $t.Replace('"https://bizwor.ru/"', 'ServerConfig.HomePage')
}

Write-Host "3/4 version 5.0 / 1.17.0" -ForegroundColor Cyan
Edit-File "AbizShell\RemoteControlClient.cs" { param($t) [regex]::Replace($t, 'public const string AppVersion = "[^"]*";', 'public const string AppVersion = "5.0";') }
Edit-File "Directory.Build.props" { param($t) [regex]::Replace($t, '<AbizVersion>[^<]*</AbizVersion>', '<AbizVersion>1.17.0</AbizVersion>') }
Edit-File "AbizRecorder\AbizRecorder.csproj" {
    param($t)
    if ($t -match 'ServerConfig\.cs') { return $t }
    $t.Replace('<Compile Include="..\AbizShell\GateBridge.cs" Link="GateBridge.cs" />', "<Compile Include=`"..\AbizShell\GateBridge.cs`" Link=`"GateBridge.cs`" />`r`n`t`t<Compile Include=`"..\AbizShell\ServerConfig.cs`" Link=`"ServerConfig.cs`" />")
}

$left = Get-ChildItem $shell, (Join-Path $Src "AbizRecorder") -Filter *.cs -Recurse |
    Where-Object { $_.FullName -notmatch '\\(bin|obj)\\' -and $_.Name -ne 'ServerConfig.cs' } |
    Select-String -Pattern 'https://bizwor\.ru' -SimpleMatch:$false
if ($left) { $left | ForEach-Object { Write-Host "  STILL bizwor.ru: $($_.Path):$($_.LineNumber)" -ForegroundColor Red }; throw "Some addresses were not replaced" }
Write-Host "  all addresses -> saou.ru / functions.poehali.dev" -ForegroundColor Green

if ($NoBuild) { Write-Host "Done (without build)." -ForegroundColor Green; exit 0 }

Write-Host "4/4 build installers" -ForegroundColor Cyan
Get-ChildItem $Src -Recurse -Directory -Include bin, obj | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Src "build-installer.ps1")
if ($LASTEXITCODE -ne 0) { throw "build-installer.ps1 failed" }
Write-Host ""
Write-Host "READY: $Src\installer\out\AbizSetup.exe and AbizAdminSetup.msi (version 5.0 / 1.17.0)" -ForegroundColor Green
