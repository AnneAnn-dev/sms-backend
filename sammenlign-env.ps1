function Read-EnvFile($path) {
    $vars = @{}
    Get-Content $path | ForEach-Object {
        $line = $_.Trim()
        if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
            $idx = $line.IndexOf("=")
            $name = $line.Substring(0, $idx).Trim()
            $value = $line.Substring($idx + 1).Trim()
            $vars[$name] = $value
        }
    }
    return $vars
}

$staging = Read-EnvFile ".env.staging"
$prod    = Read-EnvFile ".env.prod"

Write-Host ""
Write-Host "=== DELTE VAERDIER (samme noegle i begge miljoeer - roter i BEGGE) ===" -ForegroundColor Yellow
$staging.Keys | Where-Object { $prod.ContainsKey($_) -and $staging[$_] -eq $prod[$_] -and $staging[$_] -ne "" } | Sort-Object | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "=== FORSKELLIGE (adskilte pr. miljoe - kun staging skal roteres) ===" -ForegroundColor Green
$staging.Keys | Where-Object { $prod.ContainsKey($_) -and $staging[$_] -ne $prod[$_] } | Sort-Object | ForEach-Object { Write-Host "  $_" }

Write-Host ""
Write-Host "=== KUN I DEN ENE FIL ===" -ForegroundColor Cyan
$staging.Keys | Where-Object { -not $prod.ContainsKey($_) } | Sort-Object | ForEach-Object { Write-Host "  $_  (kun staging)" }
$prod.Keys | Where-Object { -not $staging.ContainsKey($_) } | Sort-Object | ForEach-Object { Write-Host "  $_  (kun prod)" }
Write-Host ""