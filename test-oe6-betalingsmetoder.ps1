# test-oe6-betalingsmetoder.ps1
# -----------------------------------------------------------------------------
# OE6, runde 2. Runde 1 bekraeftede handle-hypotesen: generate_handle paa
# prepare_subscription-niveau kommer forbi "handle is required". Naeste fejl er
#   code 601 "No payment methods found"  <- payment_methods: ["vipps_recurring"]
#
# To mulige aarsager, og de kraever hver sin rettelse:
#   1) navnet "vipps_recurring" er forkert
#   2) kontoen HAR ikke Vipps/MobilePay (kraever indloesningsaftale + MSN)
#
# Discriminatoren er D: udelad feltet helt. Frisbii bruger da alle metoder, der
# er slaaet til paa kontoen.
#   D groen  -> kontoen har metoder, men ikke den vi bad om     = aarsag 2
#   D roed   -> kontoen har INGEN metoder overhovedet           = kontoopsaetning
#   E groen  -> kort virker, saa det er kun Vipps der mangler
#
# Alle varianter bygger paa B fra runde 1 (generate_handle paa abonnementet).
#
# OBS: KUN MOD STAGING. Et groent kald opretter en rigtig (test-)kunde og
#      session i Frisbii - ryd op bagefter.
# OBS: Ren ASCII. Koeres fra repo-roden.
#   powershell -ExecutionPolicy Bypass -File .\test-oe6-betalingsmetoder.ps1 -Email din@adresse.dk
# -----------------------------------------------------------------------------

param(
  [Parameter(Mandatory = $true)][string]$Email,
  [string]$Fil  = ".env.staging",
  [string]$Navn = "OE6 Test"
)

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$ErrorActionPreference = "Stop"

if ($Fil -match "prod") {
  Write-Host "STOP: '$Fil' ligner en prod-fil. Kun staging." -ForegroundColor Red; exit 2
}
if (-not (Test-Path $Fil)) {
  Write-Host "STOP: finder ikke '$Fil'. Koer fra repo-roden." -ForegroundColor Red; exit 2
}
foreach ($v in @($Email, $Navn)) {
  if ($v -match '["\\]') {
    Write-Host "STOP: input maa ikke indeholde citationstegn eller backslash." -ForegroundColor Red; exit 2
  }
}

$env2 = @{}
Get-Content $Fil | ForEach-Object {
  $l = $_.Trim()
  if ($l -and -not $l.StartsWith("#") -and $l.Contains("=")) {
    $i = $l.IndexOf("="); $env2[$l.Substring(0,$i).Trim()] = $l.Substring($i+1).Trim().Trim('"')
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
  Write-Host ("STOP: mangler i {0}: {1}" -f $Fil, ($mangler -join ", ")) -ForegroundColor Red; exit 2
}

$url  = "https://checkout-api.frisbii.com/v1/session/subscription"
$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("$noegle`:"))

Write-Host ""
Write-Host "Fil:  $Fil        <-- LAES DENNE"
Write-Host "Plan: $plan       <-- OG DENNE"
Write-Host ""

$abonnement = @"
  "prepare_subscription": {
    "plan": "$plan",
    "generate_handle": true,
    "create_customer": {
      "email": "$($Email.ToLower())",
      "first_name": "$Navn",
      "generate_handle": true
    }
  },
"@

function Byg($metodeLinje) {
@"
{
$abonnement
$metodeLinje
  "accept_url": "$base/tak",
  "cancel_url": "$base/afbrudt"
}
"@
}

$varianter = [ordered]@{
  "D (uden payment_methods - DISCRIMINATOREN)" = Byg ""
  "E (kort)"                                   = Byg '  "payment_methods": ["card"],'
  "F (som koden i dag, til sammenligning)"     = Byg '  "payment_methods": ["vipps_recurring"],'
}

$fejlede = 0; $groenne = 0; $uafklarede = 0
$svarKoder = @{}

foreach ($navn in $varianter.Keys) {
  Write-Host ("--- " + $navn + " " + ("-" * 20))
  $status = $null; $svar = $null; $uaf = $false
  try {
    $r = Invoke-WebRequest -Uri $url -Method Post -UseBasicParsing `
           -Headers @{ Authorization = "Basic $auth"; Accept = "application/json" } `
           -ContentType "application/json" `
           -Body ([Text.Encoding]::UTF8.GetBytes($varianter[$navn]))
    $status = [int]$r.StatusCode; $svar = $r.Content
  } catch {
    if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
    if ($_.ErrorDetails -and $_.ErrorDetails.Message) { $svar = $_.ErrorDetails.Message }
    else { $svar = $_.Exception.Message; if (-not $status) { $uaf = $true } }
  }

  Write-Host "HTTP $status"
  Write-Host $svar
  $svarKoder[$navn] = "$status|$svar"

  if ($uaf) {
    Write-Host "UAFKLARET - kunne ikke maales" -ForegroundColor Yellow; $uafklarede++
  } elseif ($status -ge 200 -and $status -lt 300 -and $svar -match '"url"\s*:\s*"([^"]+)"') {
    Write-Host ("GROEN - session.url: " + $Matches[1]) -ForegroundColor Green; $groenne++
  } else {
    Write-Host "FEJLET" -ForegroundColor Red; $fejlede++
  }
  Write-Host ""
}

# Vaern mod runde 1's fejlslutning: tre identiske svar betyder, at forskellen
# mellem varianterne aldrig blev naaet - altsaa UAFKLARET, ikke FEJLET.
$unikke = ($svarKoder.Values | Sort-Object -Unique).Count
if ($unikke -eq 1 -and $groenne -eq 0) {
  Write-Host "OBS: alle varianter gav SAMME svar." -ForegroundColor Yellow
  Write-Host "Forskellen mellem dem blev aldrig naaet - noget tidligere i valideringen"
  Write-Host "stopper kaldet. Testen er UAFKLARET paa betalingsmetoder, ikke besvaret."
  Write-Host ""
}

Write-Host ("Resultat: {0} groenne, {1} fejlede, {2} uafklarede." -f $groenne, $fejlede, $uafklarede)
Write-Host ""
Write-Host "TOLKNING:"
Write-Host "  D groen -> kontoen har metoder, bare ikke vipps_recurring. Udelad feltet i koden."
Write-Host "  D roed  -> kontoen har INGEN betalingsmetoder slaaet til. Det er kontoopsaetning,"
Write-Host "             ikke payload. Aabn Frisbii-kontoen og se efter."
if ($groenne -eq 0) { exit 1 } else { exit 0 }
