# skift-staging.ps1
# -----------------------------------------------------------------------------
# Aktiverer STAGING-profilen (hverdagstilstanden) for lokale scripts: kopierer
# .env.staging ind over .env og verificerer med check-env.js. Fjerner den roede
# .ENV-ER-PROD-markoer, som skift-prod.ps1 lagde.
#
# Brug:  .\skift-staging.ps1
# Koeres ALTID som sidste skridt efter prod-arbejde - maskinen skal aldrig
# efterlades i prod-tilstand.
#
# REN ASCII (PowerShell 5.1-krav). Aendrer KUN .env + markoerfilen.
# -----------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env.staging")) {
    Write-Host "[FEJL] .env.staging findes ikke i denne mappe. Staa i repo-roden." -ForegroundColor Red
    exit 1
}

Copy-Item ".env.staging" ".env" -Force
Write-Host "[OK] .env.staging kopieret ind over .env - verificerer..." -ForegroundColor Yellow

node check-env.js
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[STOP] check-env.js afviste profilen - .env er IKKE godkendt staging." -ForegroundColor Red
    Write-Host "       Ret .env.staging (masterfilen!) og koer scriptet igen." -ForegroundColor Red
    Write-Host "       (.ENV-ER-PROD-markoeren beholdes indtil skiftet lykkes.)" -ForegroundColor Red
    exit 1
}

# Fjern den roede lampe - foerst NU er skiftet reelt gennemfoert.
if (Test-Path ".ENV-ER-PROD") {
    Remove-Item ".ENV-ER-PROD" -Force
    Write-Host "[OK] .ENV-ER-PROD-markoeren fjernet." -ForegroundColor Green
}

Write-Host ""
Write-Host "[STAGING] Hverdagstilstand genoprettet - alt koerer mod staging." -ForegroundColor Green
