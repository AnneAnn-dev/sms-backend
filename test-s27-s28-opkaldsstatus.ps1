# test-s27-s28-opkaldsstatus.ps1  --  1/10-26
#
# Tre proever paa STAGING, i den raekkefoelge de skal koeres.
#
#   1) NORMAL        Virker ruten stadig, og kommer udfaldet tilbage fra Twilio?
#   2) S27           Et nummer, Twilio ACCEPTERER men ikke kan forbinde.
#                    Her maales det, vi ikke ved: kalder Twilio udfaldet
#                    "failed" (vi alarmerer) eller "no-answer" (vi goer ikke)?
#   3) S28           En fejl med et telefonnummer i teksten. Scriptet
#                    kontrollerer SELV, at nummeret er maskeret i svaret.
#
# Proeve 2 og 3 kraever, at owner_phone aendres i Supabase imellem. Scriptet
# skriver SQL'en og venter - det roerer ikke databasen selv. Det er med vilje:
# et testscript, der kan skrive i en database, er et testscript, der en dag
# goer det i det forkerte miljoe.
#
# BRUG:
#   .\test-s27-s28-opkaldsstatus.ps1 -Token "<access_token fra staging-dashboardet>"
#
# Tokenet hentes i browserkonsollen paa staging-dashboardet:
#   JSON.parse(Object.entries(localStorage).find(([k]) => k.startsWith('sb-') && k.endsWith('-auth-token'))[1]).access_token
#
# KOER KUN MOD STAGING. Standard-URL'en er staging; angiv -Url for noget andet,
# og laes to gange foer du goer det.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Url     = "https://sms-backend-staging-908c.up.railway.app",
  [string]$FirmaId = "3895cbf2-2bf1-4c7f-9999-cae583926bf6"
)

$ErrorActionPreference = "Stop"

if ($Url -notmatch "staging") {
  Write-Host "STOP: -Url peger ikke paa staging. Proeve 2 og 3 ringer rigtige opkald" -ForegroundColor Red
  Write-Host "      og aendrer et firmas nummer. Det hoerer ikke hjemme i prod."
  exit 1
}

function Kald {
  param([string]$Sti, [hashtable]$Headers)
  $svar = [pscustomobject]@{ Status = 0; Krop = "" }
  try {
    $r = Invoke-WebRequest -Uri ($Url + $Sti) -Method POST -Headers $Headers `
           -ContentType "application/json" -Body "{}" -UseBasicParsing
    $svar.Status = [int]$r.StatusCode
    $svar.Krop   = $r.Content
  } catch {
    $resp = $_.Exception.Response
    if ($resp) {
      $svar.Status = [int]$resp.StatusCode
      try {
        $laeser = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $svar.Krop = $laeser.ReadToEnd()
        $laeser.Close()
      } catch { $svar.Krop = "" }
    } else {
      $svar.Krop = $_.Exception.Message
    }
  }
  return $svar
}

$auth = @{ Authorization = "Bearer $Token" }

function Pause-Med($tekst) {
  Write-Host ""
  Write-Host $tekst -ForegroundColor Cyan
  Read-Host "Tryk ENTER naar det er gjort"
}

Write-Host ""
Write-Host "=== PROEVE 0: ruten afviser uden login ===" -ForegroundColor Yellow
$p0 = Kald "/onboarding/verificer" @{}
Write-Host ("  HTTP " + $p0.Status)
if ($p0.Status -eq 401) {
  Write-Host "  OK - og i loggen skal der staa: ikke logget ind (401)" -ForegroundColor Green
} else {
  Write-Host "  UVENTET - forventede 401" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== PROEVE 1: normalt verifikationsopkald ===" -ForegroundColor Yellow
Write-Host "Din telefon ringer. LAD VAERE med at svare, hvis du vil se no-answer;"
Write-Host "svar, hvis du vil se completed. Begge dele er et gyldigt resultat."
Pause-Med "Hold Railway-loggen aaben paa STAGING. Klar?"

$p1 = Kald "/onboarding/verificer" $auth
Write-Host ("  HTTP " + $p1.Status + "  " + $p1.Krop)
if ($p1.Status -eq 200) {
  Write-Host "  OK - nu skal loggen vise:" -ForegroundColor Green
  Write-Host "     Verifikationsopkald forsoeges ... / afsendt ... call-sid:"
  Write-Host "     og FOERST naar opkaldet er slut, udfaldet fra Twilio:"
  Write-Host "     'forbundet' (completed) eller 'ikke besvaret' (no-answer/busy)"
  Write-Host ""
  Write-Host "  KOMMER UDFALDET ALDRIG, naaede Twilios tilbagekald os ikke." -ForegroundColor DarkYellow
  Write-Host "  Tjek saa BASE_URL paa staging - den skal kunne naas udefra."
} else {
  Write-Host "  UVENTET - forventede 200" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== PROEVE 2 (S27): nummer der accepteres, men ikke kan forbindes ===" -ForegroundColor Yellow
Write-Host "SQL - koer i STAGING-projektet (hehrvdmtzokzbnbihcel):" -ForegroundColor White
Write-Host ""
Write-Host "  update firms set owner_phone = '+4500000000'"
Write-Host "  where id = '$FirmaId' returning id, owner_phone;"
Pause-Med "Koer SQL'en ovenfor."

$p2 = Kald "/onboarding/verificer" $auth
Write-Host ("  HTTP " + $p2.Status + "  " + $p2.Krop)
if ($p2.Status -eq 200) {
  Write-Host "  OK - opkaldet blev ACCEPTERET, praecis som 1/10." -ForegroundColor Green
  Write-Host "  DET, PROEVEN HANDLER OM, STAAR I LOGGEN OM LIDT:" -ForegroundColor Cyan
  Write-Host "     Kalder Twilio udfaldet 'failed'    -> vi rapporterer + alarmerer"
  Write-Host "     Kalder Twilio det 'no-answer'      -> vi logger kun"
  Write-Host "  Skriv ned hvilken af dem det blev. Er det no-answer, daekker"
  Write-Host "  alarmen ikke den her slags fejl, og S27 skal justeres."
} else {
  Write-Host "  UVENTET - forventede 200" -ForegroundColor Red
}

Write-Host ""
Write-Host "=== PROEVE 3 (S28): er nummeret maskeret i fejlen? ===" -ForegroundColor Yellow
Write-Host "SQL - koer i STAGING-projektet:" -ForegroundColor White
Write-Host ""
Write-Host "  update firms set owner_phone = '+5355512345'"
Write-Host "  where id = '$FirmaId' returning id, owner_phone;"
Pause-Med "Koer SQL'en ovenfor."

$p3 = Kald "/onboarding/verificer" $auth
Write-Host ("  HTTP " + $p3.Status + "  " + $p3.Krop)

$raat     = $p3.Krop -match "5355512345"
$maskeret = $p3.Krop -match "\+5355\*+"

if ($p3.Status -eq 500 -and $maskeret -and -not $raat) {
  Write-Host "  OK - nummeret er maskeret i svaret til browseren." -ForegroundColor Green
} elseif ($raat) {
  Write-Host "  FEJL - det RAA nummer staar i svaret. Masken virker ikke." -ForegroundColor Red
} else {
  Write-Host "  UAFKLARET - laes svaret ovenfor. Forventede 500 med +5355***" -ForegroundColor DarkYellow
}

Write-Host ""
Write-Host "  Tjek nu TO steder mere - masken gaelder tre veje ud:" -ForegroundColor Cyan
Write-Host "    1) Railway-loggen: fejllinjen skal vise +5355****** , ikke hele nummeret"
Write-Host "    2) AppSignal (staging, og vent et par MINUTTER - 1/10-laerdommen):"
Write-Host "       haendelsen skal hedde '... call +5355******'"

Write-Host ""
Write-Host "=== RYD OP - spring det ikke over ===" -ForegroundColor Yellow
Write-Host "Saet nummeret og statussen tilbage i STAGING:" -ForegroundColor White
Write-Host ""
Write-Host "  update firms set owner_phone = '<det oprindelige nummer>',"
Write-Host "                   verification_status = '<den oprindelige status>'"
Write-Host "  where id = '$FirmaId' returning id, owner_phone, verification_status;"
Write-Host ""
Write-Host "Proeve 1 satte verification_status til 'pending'. Stod firmaet som"
Write-Host "'verified' foer, skal det saettes tilbage - ellers opfoerer naeste"
Write-Host "opkald sig anderledes, end du forventer."
