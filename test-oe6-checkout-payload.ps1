# test-oe6-checkout-payload.ps1
# -----------------------------------------------------------------------------
# OE6: /checkout/start har aldrig gennemfoert et checkout. Frisbii afviser med
#      HTTP 400 {"message":"handle is required","path":"/v1/session/subscription"}
#
# Dette script kalder Frisbii DIREKTE, uden om vores egen backend, saa payloaden
# kan proeves alene. Ingen deploy, ingen roegtest, sekunder pr. forsoeg.
#
# Tre varianter:
#   A  praecis som frisbii-checkout.js bygger den i dag  -> forventet: fejler
#   B  + generate_handle paa prepare_subscription-niveau
#   C  + eksplicit handle paa prepare_subscription-niveau
#
# B og C skelner "feltet mangler et sted" fra "feltet skal vaere eksplicit".
# Den variant, der kommer retur med en url, er svaret - og den url ER beviset.
#
# OBS: KUN MOD STAGING-KONTOEN (lommekontor). Scriptet naegter prod-filer, men
#    verificer selv med:  node check-env.js --live
# OBS: Et lykkedes kald opretter en RIGTIG (test-)kunde og session i Frisbii.
#    Ingen penge bevaeger sig - kunden skal gennemfoere betalingen - men ryd op
#    i kontoen bagefter, saa listen ikke fyldes med OE6-skrald.
#
# Kraever ren ASCII (PS 5.1 fejllaeser UTF-8 uden BOM).
#   Unblock-File .\test-oe6-checkout-payload.ps1
#   powershell -ExecutionPolicy Bypass -File .\test-oe6-checkout-payload.ps1 -Email din@adresse.dk
# -----------------------------------------------------------------------------

param(
  [Parameter(Mandatory = $true)][string]$Email,
  [string]$Fil  = ".env.staging",
  [string]$Navn = "OE6 Test"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = "Stop"

# --- Vaern: aldrig prod ------------------------------------------------------
if ($Fil -match "prod") {
  Write-Host "STOP: '$Fil' ligner en prod-fil. Dette script koerer kun mod staging." -ForegroundColor Red
  exit 2
}
if (-not (Test-Path $Fil)) {
  Write-Host "STOP: finder ikke '$Fil'. Koer scriptet fra repo-roden." -ForegroundColor Red
  exit 2
}

# JSON bygges som tekst (ikke ConvertTo-Json), saa payloaden kan holdes op mod
# frisbii-checkout.js linje for linje. Derfor skal input vaere JSON-sikkert.
foreach ($v in @($Email, $Navn)) {
  if ($v -match '["\\]') {
    Write-Host "STOP: input maa ikke indeholde citationstegn eller backslash." -ForegroundColor Red
    exit 2
  }
}

# --- Laes env-filen ----------------------------------------------------------
$env2 = @{}
Get-Content $Fil | ForEach-Object {
  $linje = $_.Trim()
  if ($linje -and -not $linje.StartsWith("#") -and $linje.Contains("=")) {
    $i = $linje.IndexOf("=")
    $env2[$linje.Substring(0, $i).Trim()] = $linje.Substring($i + 1).Trim().Trim('"')
  }
}

$noegle = $env2["FRISBII_PRIVATE_KEY"]
$plan   = $env2["FRISBII_PLAN_HANDLE"]
$base   = $env2["SIMPLY_BASE_URL"]

$mangler = @()
if (-not $noegle) { $mangler += "FRISBII_PRIVATE_KEY" }
if (-not $plan)   { $mangler += "FRISBII_PLAN_HANDLE" }
if (-not $base)   { $mangler += "SIMPLY_BASE_URL" }
if ($mangler.Count) {
  Write-Host ("STOP: mangler i {0}: {1}" -f $Fil, ($mangler -join ", ")) -ForegroundColor Red
  exit 2
}

$url  = "https://checkout-api.frisbii.com/v1/session/subscription"
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$noegle`:"))

Write-Host ""
Write-Host "Fil:  $Fil"
Write-Host "Plan: $plan"
Write-Host "URL:  $url"
Write-Host "Noeglen printes ALDRIG. Verificer kontoen med: node check-env.js --live"
Write-Host ""

# --- Payload-varianter -------------------------------------------------------
$kunde = @"
      "create_customer": {
        "email": "$($Email.ToLower())",
        "first_name": "$Navn",
        "generate_handle": true
      }
"@

$handleC = "oe6-" + (Get-Date -Format "yyyyMMdd-HHmmss")

$varianter = [ordered]@{
  "A (som koden i dag)" = @"
{
  "prepare_subscription": {
    "plan": "$plan",
$kunde
  },
  "payment_methods": ["vipps_recurring"],
  "accept_url": "$base/tak",
  "cancel_url": "$base/afbrudt"
}
"@
  "B (generate_handle paa abonnementet)" = @"
{
  "prepare_subscription": {
    "plan": "$plan",
    "generate_handle": true,
$kunde
  },
  "payment_methods": ["vipps_recurring"],
  "accept_url": "$base/tak",
  "cancel_url": "$base/afbrudt"
}
"@
  "C (eksplicit handle paa abonnementet)" = @"
{
  "prepare_subscription": {
    "plan": "$plan",
    "handle": "$handleC",
$kunde
  },
  "payment_methods": ["vipps_recurring"],
  "accept_url": "$base/tak",
  "cancel_url": "$base/afbrudt"
}
"@
}

# --- Kald --------------------------------------------------------------------
# Tre udfald, ikke to: GROEN / FEJLET (maalt og forkert) / UAFKLARET (kunne
# ikke maales). Et vaerktoej, der blander de to sidste sammen, laerer en at
# ignorere roedt. Kun FEJLET taeller i exit-koden.
$fejlede = 0
$groenne = 0

foreach ($navn in $varianter.Keys) {
  $krop = $varianter[$navn]
  Write-Host "--- $navn " + ("-" * 30)

  $status = $null; $svar = $null; $uafklaret = $false
  try {
    $r = Invoke-WebRequest -Uri $url -Method Post -UseBasicParsing `
           -Headers @{ Authorization = "Basic $auth"; Accept = "application/json" } `
           -ContentType "application/json" `
           -Body ([Text.Encoding]::UTF8.GetBytes($krop))
    $status = [int]$r.StatusCode
    $svar   = $r.Content
  } catch {
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    # PS 5.1: fejlsvarets body ligger i ErrorDetails.Message - stroemmen er ofte
    # allerede opbrugt og giver tom streng.
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $svar = $_.ErrorDetails.Message }
    else { $svar = $_.Exception.Message; if (-not $status) { $uafklaret = $true } }
  }

  Write-Host "HTTP $status"
  Write-Host $svar

  if ($uafklaret) {
    Write-Host "UAFKLARET - kunne ikke maales" -ForegroundColor Yellow
  } elseif ($status -ge 200 -and $status -lt 300 -and $svar -match '"url"\s*:\s*"([^"]+)"') {
    Write-Host ("GROEN - session.url modtaget: " + $Matches[1]) -ForegroundColor Green
    $groenne++
  } else {
    Write-Host "FEJLET" -ForegroundColor Red
    $fejlede++
  }
  Write-Host ""
}

Write-Host ("Resultat: {0} groenne, {1} fejlede." -f $groenne, $fejlede)
Write-Host "Er en variant groen: den er svaret. Skriv den ind i frisbii-checkout.js,"
Write-Host "deploy til staging, og gentag testen MOD /checkout/start - ikke mod Frisbii direkte."
if ($groenne -eq 0) { exit 1 } else { exit 0 }
