# push-prod.ps1
# -----------------------------------------------------------------------------
# Koerer 'supabase db push' mod PRODUKTION -- med vilje besvaerligt:
#  1) kraever at du skriver PROD som bekraeftelse
#  2) verificerer at linket peger paa prod (og hjaelper med at skifte hvis ikke)
#  3) minder om Del 1-tjeklisten (deploy-vindue, staging groen foerst)
#  0) FOERST: koerer rls-isolation-test.js mod STAGING og stopper, hvis den
#     ikke er groen (beslutning 13/10-26: RLS-proeven er et vaern foer prod)
# Brug:  .\push-prod.ps1     (typisk KUN som del af en release, jf. runbook Del 1)
#        .\push-prod.ps1 -IncludeAll
#           -- KUN naar 'db push --dry-run' har sagt "Found local migration files
#           to be inserted before the last migration on remote database", OG
#           'db push --dry-run --include-all' viser praecis de forventede filer.
#           Indfoert 18/10-26: Fase 1a og 1b (13/10) var aeldre end prods
#           nyeste migration (17/10), og scriptet kunne ikke sende flaget med.
# -----------------------------------------------------------------------------
param(
    [switch]$IncludeAll
)

$PROD_REF    = "glymuxqtrbpeyzmflilf"
$STAGING_REF = "hehrvdmtzokzbnbihcel"

# --- 0) RLS-isolationsproeven skal vaere groen, foer noget naar prod ----------
# Beslutning 13/10-26. RLS-politikker naar kun prod via en migration, og
# migrationer naar kun prod via dette script -- derfor staar vaernet her.
# Proeven koerer mod STAGING via .env (ikke via CLI-linket) og opretter og
# sletter to testfirmaer. Fail-closed: roed, manglende eller uafklaret proeve
# = intet pushes. Den koeres ALDRIG mod prod.
$PROEVE = "rls-isolation-test.js"
if (-not (Test-Path $PROEVE)) {
    Write-Host "[FEJL] $PROEVE findes ikke her -- koer scriptet fra repo-roden. Intet pushet." -ForegroundColor Red
    exit 1
}

# Toerkoersel: proeven printer selv den projekt-ref, den vil ramme.
$toer = (& node $PROEVE 2>&1 | Out-String)
$m = [regex]::Match($toer, 'Projekt-ref\s*:\s*([a-z0-9]+)')
if ($m.Success) { $proeveRef = $m.Groups[1].Value } else { $proeveRef = "(ukendt)" }
if ($proeveRef -ne $STAGING_REF) {
    Write-Host "[FEJL] RLS-proeven peger paa '$proeveRef', ikke staging ($STAGING_REF)." -ForegroundColor Red
    Write-Host "   Tjek SUPABASE_URL i .env. Intet pushet." -ForegroundColor Red
    exit 1
}

Write-Host "[PROEVE] RLS-isolationsproeven mod staging ($STAGING_REF)..."
& node $PROEVE --bekraeft
if ($LASTEXITCODE -ne 0) {
    Write-Host "[STOP] RLS-isolationsproeven er ROED -- intet pushet til prod." -ForegroundColor Red
    Write-Host "   Find aarsagen foer naeste forsoeg: laekage, for stram, eller proeven selv i stykker."
    exit 1
}
Write-Host "[OK] RLS-isolationsproeven er groen." -ForegroundColor Green
Write-Host ""

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
if ($IncludeAll) {
    Write-Host "[INFO]  --include-all: ogsaa migrationer, der er AELDRE end prods nyeste." -ForegroundColor Yellow
    npx supabase db push --include-all
} else {
    npx supabase db push
}
$pushKode = $LASTEXITCODE
if ($pushKode -ne 0) {
    Write-Host "[FEJL] db push sluttede med kode $pushKode -- laes outputtet ovenfor." -ForegroundColor Red
}

# Skift ALTID tilbage til staging som hviletilstand, saa naeste push er sikkert:
Write-Host "[SKIFT]  Skifter link tilbage til staging (fast hviletilstand)..."
npx supabase link --project-ref $STAGING_REF
exit $pushKode
