$ErrorActionPreference = "Stop"

$AppDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $AppDir

$VenvPythonw = Join-Path $AppDir ".venv\Scripts\pythonw.exe"
$VenvPython = Join-Path $AppDir ".venv\Scripts\python.exe"
$SharedVenvPythonw = "D:\QUANTUM_TRACKER\.venv\Scripts\pythonw.exe"
$SharedVenvPython = "D:\QUANTUM_TRACKER\.venv\Scripts\python.exe"
$BundledPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
$BundledPythonw = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\pythonw.exe"
$RunPython = $null
$CheckPython = $null

if (Test-Path $VenvPythonw) {
    $RunPython = $VenvPythonw
    $CheckPython = $VenvPython
} elseif (Test-Path $VenvPython) {
    $RunPython = $VenvPython
    $CheckPython = $VenvPython
} elseif (Test-Path $SharedVenvPython) {
    $RunPython = if (Test-Path $SharedVenvPythonw) { $SharedVenvPythonw } else { $SharedVenvPython }
    $CheckPython = $SharedVenvPython
} else {
    $SystemPython = $null
    $SystemPythonw = $null
    $PythonPaths = where.exe python 2>$null
    if ($LASTEXITCODE -eq 0 -and $PythonPaths) {
        $SystemPython = ($PythonPaths | Select-Object -First 1)
    }
    $PythonwPaths = where.exe pythonw 2>$null
    if ($LASTEXITCODE -eq 0 -and $PythonwPaths) {
        $SystemPythonw = ($PythonwPaths | Select-Object -First 1)
    }
    if ($SystemPython) {
        $CheckPython = $SystemPython
        $RunPython = if ($SystemPythonw) { $SystemPythonw } else { $SystemPython }
    } elseif (Test-Path $BundledPython) {
        $CheckPython = $BundledPython
        $RunPython = if (Test-Path $BundledPythonw) { $BundledPythonw } else { $BundledPython }
    }
}

if (-not $CheckPython) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        "Python nao foi encontrado. Instale Python 3.12+ e depois execute Instalar_Dependencias.bat.",
        "QUANTUM TRACKER",
        "OK",
        "Warning"
    ) | Out-Null
    exit 1
}

try {
    & $CheckPython -c "import PySide6, cv2, numpy" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Add-Type -AssemblyName PresentationFramework
        [System.Windows.MessageBox]::Show(
            "Dependencias do app ainda nao foram instaladas.`n`nAbra D:\QUANTUM_TRACKER e execute Instalar_Dependencias.bat.",
            "QUANTUM TRACKER",
            "OK",
            "Warning"
        ) | Out-Null
        exit 1
    }
    Start-Process -FilePath $RunPython -ArgumentList "`"$AppDir\main.py`"" -WorkingDirectory $AppDir
} catch {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        "Nao foi possivel iniciar o QUANTUM TRACKER.`n`n$($_.Exception.Message)",
        "QUANTUM TRACKER",
        "OK",
        "Error"
    ) | Out-Null
    exit 1
}
