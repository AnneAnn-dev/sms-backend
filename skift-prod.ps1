# skift-prod.ps1
# -----------------------------------------------------------------------------
# Aktiverer PROD-profilen for lokale scripts: kopierer .env.prod ind over .env
# og verificerer med check-env-prod.js --live. Naegter at erklaere succes hvis
# verifikationen fejler - saa "jeg troede jeg var i prod" ikke kan ske.
#
# SYNLIG MARKOER: laegger filen .ENV-ER-PROD i repo-roden, saa baade Stifinder,
# VS Code og 'git status' viser roed lampe, saa laenge maskinen er i prod.
# skift-staging.ps1 fjerner den igen. (Filen skal staa i .gitignore!)
#
# Brug:  .\skift-prod.ps1
# Ritual: skift-prod -> koer prod-arbejdet -> .\skift-staging.ps1 STRAKS efter.
#
# REN ASCII (PowerShell 5.1-krav). Aendrer KUN .env + markoerfilen - roerer
# aldrig Railway eller Supabase-CLI-linket (det forvaltes af push-scriptene).
# -----------------------------------------------------------------------------

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".env.prod")) {
    Write-Host "[FEJL] .env.prod findes ikke i denne mappe. Staa i repo-roden." -ForegroundColor Red
    exit 1
}

Copy-Item ".env.prod" ".env" -Force
Write-Host "[OK] .env.prod kopieret ind over .env - verificerer..." -ForegroundColor Yellow

node check-env-prod.js --live
if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "[STOP] Verifikationen fejlede - .env er IKKE en godkendt prod-profil." -ForegroundColor Red
    Write-Host "       Ret .env.prod (masterfilen!) og koer scriptet igen." -ForegroundColor Red
    Write-Host "       Koer INTET mod prod foer dette er groent." -ForegroundColor Red
    # Ingen markoer ved fejl: .env er i udefineret tilstand - koer skift-staging.
    exit 1
}

# Synlig markoer: indhold = hvornaar og af hvem, saa en glemt markoer kan dateres.
$stempel = "PROD-tilstand aktiveret {0} af {1}" -f (Get-Date -Format "yyyy-MM-dd HH:mm"), $env:USERNAME
Set-Content -Path ".ENV-ER-PROD" -Value $stempel

Write-Host ""
Write-Host "[PROD] Du koerer nu mod PRODUKTION. Mails gaar til AEGTE modtagere." -ForegroundColor Red
Write-Host "       Markoer lagt: .ENV-ER-PROD (fjernes af skift-staging.ps1)." -ForegroundColor Red
Write-Host "       Naar arbejdet er faerdigt: .\skift-staging.ps1 med det samme." -ForegroundColor Yellow
