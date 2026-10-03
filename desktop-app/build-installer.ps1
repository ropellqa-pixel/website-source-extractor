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
            Invoke-WebRequest -Uri $downloads[$name] -OutFile $path -UseBasicParsing
            $ProgressPreference = "Continue"
        }
    }

    Write-Step 1 "публикация программы"
    $publishDir = Join-Path $root "AbizShell\bin\publish"
    if (Test-Path $publishDir) { Remove-Item $publishDir -Recurse -Force }
    dotnet publish (Join-Path $root "AbizShell\AbizShell.csproj") -c Release -r win-x64 --self-contained false -o $publishDir
    if ($LASTEXITCODE -ne 0) { throw "Публикация не удалась" }
    if (-not (Test-Path (Join-Path $publishDir "Microsoft.Windows.SDK.NET.dll"))) {
        throw "В сборке нет Microsoft.Windows.SDK.NET.dll — программа не запустится. Проверь TargetFramework в AbizShell.csproj"
    }

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