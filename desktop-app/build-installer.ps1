# Сборка инсталлятора АБИЗ "в один клик".
# Запуск:  powershell -ExecutionPolicy Bypass -File build-installer.ps1
# Собирает две программы:
#   АБИЗ        -> installer\out\AbizSetup.exe       (киоск, автозапуск)
#   АБИЗ-Админ  -> installer\out\AbizAdminSetup.msi  (обычная программа)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Write-Step($number, $text) {
    Write-Host ""
    Write-Host "=== Шаг $number из 5: $text ===" -ForegroundColor Cyan
}

try {
    # Скачиваем с официальных серверов Microsoft файлы для бандла, если их ещё нет.
    $redist = Join-Path $root "installer\redist"
    New-Item -ItemType Directory -Force -Path $redist | Out-Null
    $downloads = [ordered]@{
        "MicrosoftEdgeWebview2Setup.exe"         = "https://go.microsoft.com/fwlink/p/?LinkId=2124703"
        "windowsdesktop-runtime-8.0-win-x64.exe" = "https://aka.ms/dotnet/8.0/windowsdesktop-runtime-win-x64.exe"
    }
    foreach ($name in $downloads.Keys) {
        $path = Join-Path $redist $name
        if (-not (Test-Path $path)) {
            Write-Host "Скачиваю $name ..." -ForegroundColor Cyan
            $ProgressPreference = "SilentlyContinue"
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            for ($try = 1; $try -le 5; $try++) {
                try { Invoke-WebRequest -Uri $downloads[$name] -OutFile $path -UseBasicParsing; break }
                catch {
                    Remove-Item $path -Force -ErrorAction SilentlyContinue
                    if ($try -eq 5) { throw }
                    Write-Host "  связь оборвалась, повтор $($try + 1) из 5..." -ForegroundColor Yellow
                    Start-Sleep -Seconds (5 * $try)
                }
            }
            $ProgressPreference = "Continue"
        }
    }

    # Нет .NET SDK — ставим его сами (официальный установщик Microsoft, в папку пользователя, без прав админа).
    $sdkOk = $false
    if (Get-Command dotnet -ErrorAction SilentlyContinue) {
        $sdkOk = [bool]((& dotnet --list-sdks 2>$null) -match '^(8|9|10)\.')
    }
    if (-not $sdkOk) {
        $dotnetDir = Join-Path $env:LOCALAPPDATA "Microsoft\dotnet"
        if (-not (Test-Path (Join-Path $dotnetDir "dotnet.exe")) -or -not ((& (Join-Path $dotnetDir "dotnet.exe") --list-sdks 2>$null) -match '^8\.')) {
            Write-Host "Устанавливаю .NET 8 SDK (один раз, ~200 МБ, несколько минут)..." -ForegroundColor Cyan
            [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
            $installer = Join-Path $env:TEMP "dotnet-install.ps1"
            $ProgressPreference = "SilentlyContinue"
            Invoke-WebRequest -Uri "https://dot.net/v1/dotnet-install.ps1" -OutFile $installer -UseBasicParsing
            $ProgressPreference = "Continue"
            & powershell -NoProfile -ExecutionPolicy Bypass -File $installer -Channel 8.0 -InstallDir $dotnetDir
            if ($LASTEXITCODE -ne 0) { throw "Не удалось установить .NET 8 SDK. Установите вручную: https://dotnet.microsoft.com/download/dotnet/8.0 (SDK x64)" }
        }
        $env:DOTNET_ROOT = $dotnetDir
        $env:PATH = "$dotnetDir;$env:PATH"
        $userPath = [Environment]::GetEnvironmentVariable("PATH", "User")
        if ($userPath -notlike "*$dotnetDir*") { [Environment]::SetEnvironmentVariable("PATH", "$dotnetDir;$userPath", "User") }
    }
    $env:DOTNET_CLI_TELEMETRY_OPTOUT = "1"
    $env:DOTNET_NOLOGO = "1"
    Write-Host "Используется .NET SDK $(& dotnet --version)" -ForegroundColor DarkGray

    Write-Step 1 "публикация программы"
    $publishDir = Join-Path $root "AbizShell\bin\publish"
    if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
    dotnet publish (Join-Path $root "AbizShell\AbizShell.csproj") -c Release -r win-x64 --self-contained false -o $publishDir
    if ($LASTEXITCODE -ne 0) { throw "Публикация не удалась" }
    if (-not (Test-Path (Join-Path $publishDir "Microsoft.Windows.SDK.NET.dll"))) {
        throw "В сборке нет Microsoft.Windows.SDK.NET.dll — программа не запустится. Проверь TargetFramework в AbizShell.csproj"
    }

    Write-Host "Публикация службы видеорегистратора (AbizRecorder)..." -ForegroundColor Cyan
    $recorderDir = Join-Path $root "AbizRecorder\bin\publish"
    if (Test-Path $recorderDir) { Remove-Item $recorderDir -Recurse -Force }
    dotnet publish (Join-Path $root "AbizRecorder\AbizRecorder.csproj") -c Release -r win-x64 --self-contained false -o $recorderDir
    if ($LASTEXITCODE -ne 0) { throw "Публикация службы AbizRecorder не удалась" }

    Write-Step 2 "сборка MSI-пакета"
    dotnet build (Join-Path $root "installer\msi\AbizInstaller.wixproj") -c Release
    if ($LASTEXITCODE -ne 0) { throw "Сборка MSI не удалась" }

    Write-Step 3 "сборка итогового .exe"
    dotnet build (Join-Path $root "installer\bundle\AbizBundle.wixproj") -c Release
    if ($LASTEXITCODE -ne 0) { throw "Сборка бандла не удалась" }

    Write-Step 4 "публикация АБИЗ-Админ"
    $adminDir = Join-Path $root "AbizShell\bin\publish-admin"
    if (Test-Path $adminDir) { Remove-Item $adminDir -Recurse -Force }
    dotnet publish (Join-Path $root "AbizShell\AbizShell.csproj") -c ReleaseAdmin -r win-x64 --self-contained false -o $adminDir
    if ($LASTEXITCODE -ne 0) { throw "Публикация АБИЗ-Админ не удалась" }

    Write-Step 5 "сборка установщика АБИЗ-Админ"
    dotnet build (Join-Path $root "installer\admin\AbizAdminInstaller.wixproj") -c Release
    if ($LASTEXITCODE -ne 0) { throw "Сборка установщика АБИЗ-Админ не удалась" }

    $result = Join-Path $root "installer\out\AbizSetup.exe"
    Write-Host ""
    Write-Host "ГОТОВО. Инсталлятор собран:" -ForegroundColor Green
    Write-Host "  $result" -ForegroundColor Green
    if (Test-Path $result) {
        $sizeMb = [math]::Round((Get-Item $result).Length / 1MB, 1)
        Write-Host "  Размер: $sizeMb МБ"
    }
    Write-Host ""
    Write-Host "  АБИЗ-Админ: $(Join-Path $root 'installer\out\AbizAdminSetup.msi')" -ForegroundColor Green
    Write-Host ""
    Write-Host "AbizSetup.exe — на ПК сотрудников. AbizAdminSetup.msi — на ПК директора/администратора." -ForegroundColor Yellow
}
catch {
    Write-Host ""
    Write-Host "ОШИБКА: $_" -ForegroundColor Red
    Write-Host "Подробности и решения — в файле СБОРКА-ИНСТАЛЛЯТОРА.md, часть 6." -ForegroundColor Yellow
    exit 1
}