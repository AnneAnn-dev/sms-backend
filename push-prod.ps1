# push-prod.ps1
# -----------------------------------------------------------------------------
# Koerer 'supabase db push' mod PRODUKTION -- med vilje besvaerligt:
#  1) kraever at du skriver PROD som bekraeftelse
#  2) verificerer at linket peger paa prod (og hjaelper med at skifte hvis ikke)
#  3) minder om Del 1-tjeklisten (deploy-vindue, staging groen foerst)
# Brug:  .\push-prod.ps1     (typisk KUN som del af en release, jf. runbook Del 1)
# -----------------------------------------------------------------------------
$PROD_REF    = "glymuxqtrbpeyzmflilf"
$STAGING_REF = "hehrvdmtzokzbnbihcel"

Write-Host "[ADVARSEL]  Du er ved at koere migrationer mod PRODUKTION." -ForegroundColor Yellow
Write-Host "   Tjekliste (runbook Del 1): migration testet paa staging? Roegtest groen?"
Write-Host "   Er vi i deploy-vinduet (uden for haandvaerkeres arbejdstid) -- eller hotfix?"
$svar = Read-Host "Skriv PROD for at fortsaette"
if ($svar -cne "PROD") {
    Write-Host "Afbrudt -- intet blev pushet." -ForegroundColor Green
    exit 0
}

$refFile = "supabase\.temp\project-ref"
$ref = ""
if (Test-Path $refFile) { $ref = (Get-Content $refFile -Raw).Trim() }

if ($ref -ne $PROD_REF) {
    Write-Host "[INFO]  CLI'en er linket til '$ref' -- skifter link til prod..."
    npx supabase link --project-ref $PROD_REF
    if ($LASTEXITCODE -ne 0) { Write-Host "[FEJL] Link fejlede -- stopper." -ForegroundColor Red; exit 1 }
}

Write-Host "[OK] Link verificeret: prod -- pusher migrationer..." -ForegroundColor Green
npx supabase db push

# Skift ALTID tilbage til staging som hviletilstand, saa naeste push er sikkert:
Write-Host "[SKIFT]  Skifter link tilbage til staging (fast hviletilstand)..."
npx supabase link --project-ref $STAGING_REF
