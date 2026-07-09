# push-staging.ps1
# -----------------------------------------------------------------------------
# Koerer 'supabase db push' -- men KUN hvis CLI'en er linket til STAGING.
# Beskytter mod link-faelden: CLI'ens maal er usynlig tilstand gemt i
# supabase\.temp\project-ref, og et push mod det forkerte projekt er lydloest.
# Brug:  .\push-staging.ps1
# -----------------------------------------------------------------------------
$STAGING_REF = "hehrvdmtzokzbnbihcel"

$refFile = "supabase\.temp\project-ref"
if (-not (Test-Path $refFile)) {
    Write-Host "[FEJL] Ingen link fundet ($refFile mangler). Koer foerst:" -ForegroundColor Red
    Write-Host "   npx supabase link --project-ref $STAGING_REF"
    exit 1
}

$ref = (Get-Content $refFile -Raw).Trim()
if ($ref -ne $STAGING_REF) {
    Write-Host "[FEJL] STOP: CLI'en er linket til '$ref' -- IKKE staging ($STAGING_REF)." -ForegroundColor Red
    Write-Host "   Skift link foerst:  npx supabase link --project-ref $STAGING_REF"
    exit 1
}

Write-Host "[OK] Link verificeret: staging ($ref) -- pusher migrationer..." -ForegroundColor Green
npx supabase db push
