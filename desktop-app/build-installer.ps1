# Сборка инсталлятора АБИЗ "в один клик".
# Запуск:  powershell -ExecutionPolicy Bypass -File build-installer.ps1
# Выполняет три шага по порядку: публикация программы -> MSI -> итоговый .exe

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot

function Write-Step($number, $text) {
    Write-Host ""
    Write-Host "=== Шаг $number из 3: $text ===" -ForegroundColor Cyan
}

try {
    # Проверяем, что инструмент wix установлен.
    $wixOk = $false
    try { wix --version | Out-Null; $wixOk = $true } catch { }
    if (-not $wixOk) {
        Write-Host "Не найден инструмент WiX. Установи его командой:" -ForegroundColor Red
        Write-Host "  dotnet tool install --global wix --version 5.0.2" -ForegroundColor Yellow
        exit 1
    }

    # Проверяем, что скачаны файлы для бандла.
    $redist = Join-Path $root "installer\redist"
    $needed = @("MicrosoftEdgeWebview2Setup.exe", "windowsdesktop-runtime-8.0-win-x64.exe")
    foreach ($f in $needed) {
        $path = Join-Path $redist $f
        if (-not (Test-Path $path)) {
            Write-Host "Не найден файл: $path" -ForegroundColor Red
            Write-Host "Скачай его — см. раздел 1.3 в СБОРКА-ИНСТАЛЛЯТОРА.md" -ForegroundColor Yellow
            exit 1
        }
    }

    Write-Step 1 "публикация программы"
    dotnet publish (Join-Path $root "AbizShell\AbizShell.csproj") -c Release -r win-x64 --self-contained false
    if ($LASTEXITCODE -ne 0) { throw "Публикация не удалась" }

    Write-Step 2 "сборка MSI-пакета"
    dotnet build (Join-Path $root "installer\msi\AbizInstaller.wixproj") -c Release
    if ($LASTEXITCODE -ne 0) { throw "Сборка MSI не удалась" }

    Write-Step 3 "сборка итогового .exe"
    dotnet build (Join-Path $root "installer\bundle\AbizBundle.wixproj") -c Release
    if ($LASTEXITCODE -ne 0) { throw "Сборка бандла не удалась" }

    $result = Join-Path $root "installer\out\AbizSetup.exe"
    Write-Host ""
    Write-Host "ГОТОВО. Инсталлятор собран:" -ForegroundColor Green
    Write-Host "  $result" -ForegroundColor Green
    if (Test-Path $result) {
        $sizeMb = [math]::Round((Get-Item $result).Length / 1MB, 1)
        Write-Host "  Размер: $sizeMb МБ"
    }
    Write-Host ""
    Write-Host "Раздавай этот файл сотрудникам. Запускать от имени администратора." -ForegroundColor Yellow
}
catch {
    Write-Host ""
    Write-Host "ОШИБКА: $_" -ForegroundColor Red
    Write-Host "Подробности и решения — в файле СБОРКА-ИНСТАЛЛЯТОРА.md, часть 6." -ForegroundColor Yellow
    exit 1
}
