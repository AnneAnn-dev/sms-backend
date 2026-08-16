#requires -Version 5.1
<#
    test-s12-checkout-loft.ps1   (rev. 2 - 15/8-26)

    Formaal
    -------
    Verificerer vindueloftet paa POST /checkout/start (S12).

    Fem ting maales:
      1. Roegtest-kontrakten holder:  tomt body -> 400 invalid_email.
         Dette kald ligger FOER loftet i handleren og maa derfor ALDRIG
         forbruge en plads. Kaldes to gange netop for at bevise det.
      2. Foerste gyldige kald slipper igennem (ikke 429).
      3. Andet gyldige kald blokeres med 429 + Retry-After.
      4. Blokeringen koster ingen Frisbii-session.
      5. Efter vinduet aabner loftet IGEN. Et loft, der spaerrer men aldrig
         slipper op, ville bestaa en kortere test og vaere ubrugeligt.

    RETTET I REV. 2 - hvorfor rev. 1 loej
    -------------------------------------
    Rev. 1 meldte to falske FEJL. Aarsagen var IKKE koden under test:
    i Windows PowerShell 5.1 kaster `Invoke-WebRequest` paa 4xx/5xx, og
    svarets body kan da IKKE laeses paalideligt via
    `$_.Exception.Response.GetResponseStream()` - stroemmen er ofte allerede
    opbrugt. PS 5.1 laegger derimod body'en i `$_.ErrorDetails.Message`.
    Rev. 2 laeser der foerst og falder tilbage til stroemmen.

    Og vigtigere: hvor rev. 1 meldte FEJLET, naar en body ikke kunne laeses,
    melder rev. 2 UAFKLARET. Forskellen er ikke kosmetisk - "maalt og
    forkert" og "kunne ikke maales" er to forskellige ting, og et vaerktoej,
    der blander dem sammen, laerer en at ignorere roedt.
    Kun FEJLET taeller i exit-koden.

    !! Brug ALDRIG curl.exe til dette. PowerShell 5.1 strimler indre
    citationstegn, naar argumenter sendes til et eksternt program - uanset
    om der bruges enkelte eller dobbelte anfoerselstegn udenom. Resultatet er
    ugyldig JSON og et "400 Bad Request" i HTML fra Express, som ligner en
    fejl i handleren men aldrig naaede den. `Invoke-WebRequest -Body` gaar
    ikke gennem skallen og rammer ikke faelden.

    FORUDSAETNINGER - saet paa staging FOER koersel:
        railway variables --set CHECKOUT_LOFT_MAKS=1 --set CHECKOUT_LOFT_VINDUE_MIN=1
    og bekraeft i bootlinjen, at der staar "1 kald pr. IP pr. 1 min."

    Brug
    ----
    .\test-s12-checkout-loft.ps1 -Miljo staging

    Ryd op bagefter:
        railway variables --set CHECKOUT_LOFT_MAKS=5 --set CHECKOUT_LOFT_VINDUE_MIN=10
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("staging")]
    [string]$Miljo
)

$ErrorActionPreference = "Stop"

if ($args.Count -gt 0) {
    Write-Host "AFBRUDT: ukendte argumenter: $($args -join ', ')" -ForegroundColor Red
    exit 1
}

[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BaseUrl  = "https://sms-backend-staging-908c.up.railway.app"
$Endpoint = "$BaseUrl/checkout/start"
$Stempel  = Get-Date -Format "yyyyMMdd-HHmmss"

$script:Fejl      = 0
$script:Uafklaret = 0

function Send-Checkout {
    param([Parameter(Mandatory = $true)][string]$Json)

    $resultat = [ordered]@{ Status = 0; Body = ""; RetryAfter = ""; BodyLaest = $false }
    try {
        $svar = Invoke-WebRequest -Uri $Endpoint -Method Post `
                                  -ContentType "application/json" `
                                  -Body $Json -TimeoutSec 30 -UseBasicParsing
        $resultat.Status    = [int]$svar.StatusCode
        $resultat.Body      = $svar.Content
        $resultat.BodyLaest = $true
    }
    catch {
        $r = $_.Exception.Response
        if ($null -eq $r) {
            Write-Host "     NETVAERKSFEJL: $($_.Exception.Message)" -ForegroundColor Red
            Write-Host "     Testen er ugyldig. Stop her." -ForegroundColor Red
            exit 1
        }
        $resultat.Status = [int]$r.StatusCode
        try { $resultat.RetryAfter = $r.Headers["Retry-After"] } catch { }

        # PS 5.1: body'en ligger HER ved fejlsvar. Dette er rettelsen i rev. 2.
        if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
            $resultat.Body      = $_.ErrorDetails.Message
            $resultat.BodyLaest = $true
        }
        else {
            # Fallback - virker ikke altid, og derfor UAFKLARET og ikke FEJLET.
            try {
                $stroem = $r.GetResponseStream()
                if ($stroem -and $stroem.CanRead) {
                    $laeser = New-Object System.IO.StreamReader($stroem)
                    $tekst  = $laeser.ReadToEnd()
                    $laeser.Close()
                    if ($tekst) { $resultat.Body = $tekst; $resultat.BodyLaest = $true }
                }
            } catch { }
        }
    }
    return $resultat
}

function Tjek {
    param(
        [Parameter(Mandatory = $true)][string]$Hvad,
        [Parameter(Mandatory = $true)][bool]$Bestaaet,
        [string]$Set
    )
    if ($Bestaaet) { Write-Host "  BESTAAET   $Hvad" -ForegroundColor Green }
    else {
        Write-Host "  FEJLET     $Hvad" -ForegroundColor Red
        if ($Set) { Write-Host "             set: $Set" -ForegroundColor Red }
        $script:Fejl++
    }
}

# Tjek der kraever, at svarets body kunne laeses. Kunne den ikke, er
# resultatet UAFKLARET - ikke en fejl. Statuskoden er stadig maalt.
function Tjek-Body {
    param(
        [Parameter(Mandatory = $true)][string]$Hvad,
        [Parameter(Mandatory = $true)]$Svar,
        [Parameter(Mandatory = $true)][string]$Moenster,
        [switch]$SkalIkkeMatche
    )
    if (-not $Svar.BodyLaest) {
        Write-Host "  UAFKLARET  $Hvad" -ForegroundColor Yellow
        Write-Host "             body kunne ikke laeses - statuskoden er stadig gyldig" -ForegroundColor Yellow
        Write-Host "             aflaes i stedet: railway logs" -ForegroundColor Yellow
        $script:Uafklaret++
        return
    }
    $matcher = $Svar.Body -match $Moenster
    if ($SkalIkkeMatche) { $matcher = -not $matcher }
    Tjek -Hvad $Hvad -Bestaaet ([bool]$matcher) -Set $Svar.Body
}

Write-Host ""
Write-Host "=== S12: vindueloft paa /checkout/start (rev. 2) ===" -ForegroundColor Cyan
Write-Host "Miljoe:   $Miljo"
Write-Host "Endpoint: $Endpoint"
Write-Host ""
Write-Host "FORUDSAETNINGER:" -ForegroundColor Yellow
Write-Host "  - CHECKOUT_LOFT_MAKS=1 og CHECKOUT_LOFT_VINDUE_MIN=1 er sat OG deployet"
Write-Host "  - bootlinjen i 'railway logs' siger: 1 kald pr. IP pr. 1 min."
Write-Host "  - staging peger paa Frisbii-TESTKONTOEN, ikke den live"
Write-Host ""
$svar = Read-Host "Er alle tre forudsaetninger bekraeftet? (ja/nej)"
if ($svar -ne "ja") {
    Write-Host "AFBRUDT: bekraeft forudsaetningerne foerst." -ForegroundColor Red
    exit 1
}

# --- Trin 1: roegtest-kontrakten -------------------------------------------
Write-Host ""
Write-Host "TRIN 1 - roegtest-kontrakten (koster ingen plads i loftet)" -ForegroundColor Cyan

$a = Send-Checkout -Json "{}"
Write-Host "  kald 1 (tomt body): HTTP $($a.Status)  $($a.Body)"
Tjek -Hvad "tomt body giver 400" -Bestaaet ($a.Status -eq 400) -Set "HTTP $($a.Status)"
Tjek-Body -Hvad "fejlkoden er invalid_email" -Svar $a -Moenster "invalid_email"

$b = Send-Checkout -Json "{}"
Write-Host "  kald 2 (tomt body): HTTP $($b.Status)  $($b.Body)"
Tjek -Hvad "andet tomme kald giver STADIG 400, ikke 429 (loftet ligger efter valideringen)" `
     -Bestaaet ($b.Status -eq 400) -Set "HTTP $($b.Status) - loftet ligger for tidligt i handleren"

# --- Trin 2: foerste gyldige kald -------------------------------------------
Write-Host ""
Write-Host "TRIN 2 - foerste gyldige kald" -ForegroundColor Cyan

$c = Send-Checkout -Json ('{"email":"s12-' + $Stempel + '-1@eksempel.invalid","name":"S12 Test"}')
Write-Host "  HTTP $($c.Status)"
Write-Host "  $($c.Body)" -ForegroundColor DarkGray
Tjek -Hvad "foerste gyldige kald blev IKKE blokeret" -Bestaaet ($c.Status -ne 429) -Set "HTTP 429 - loftet spaerrer for tidligt"

if ($c.Status -eq 500) {
    Write-Host ""
    Write-Host "  HTTP 500: sandsynligvis manglende FRISBII-env vars paa staging." -ForegroundColor Yellow
    Write-Host "  requireConfig() koerer FOER loftet, saa testen kan ikke fortsaette." -ForegroundColor Yellow
    exit 1
}
if ($c.Status -eq 502) {
    Write-Host ""
    Write-Host "  BEMAERK: HTTP 502 = Frisbii afviste kaldet. Det paavirker IKKE" -ForegroundColor Yellow
    Write-Host "  loftets gyldighed (pladsen forbruges FOER Frisbii kaldes), men" -ForegroundColor Yellow
    Write-Host "  betyder, at /checkout/start ikke virker. Se OE6 i RISIKOREGISTER.md." -ForegroundColor Yellow
    Write-Host "  Aarsagen staar i loggen: railway logs" -ForegroundColor Yellow
}

# --- Trin 3: andet kald skal blokeres ---------------------------------------
Write-Host ""
Write-Host "TRIN 3 - andet gyldige kald skal blokeres" -ForegroundColor Cyan

$d = Send-Checkout -Json ('{"email":"s12-' + $Stempel + '-2@eksempel.invalid","name":"S12 Test"}')
Write-Host "  HTTP $($d.Status)  Retry-After: $($d.RetryAfter)"
Write-Host "  $($d.Body)" -ForegroundColor DarkGray
Tjek -Hvad "andet kald blokeres med 429" -Bestaaet ($d.Status -eq 429) -Set "HTTP $($d.Status) - LOFTET VIRKER IKKE"
Tjek -Hvad "Retry-After-header er sat" -Bestaaet ([string]::IsNullOrEmpty($d.RetryAfter) -eq $false) -Set "(mangler)"
Tjek-Body -Hvad "svaret naevner rate_limited" -Svar $d -Moenster "rate_limited"
Tjek-Body -Hvad "blokeringen kostede IKKE en Frisbii-session" -Svar $d -Moenster "session_id" -SkalIkkeMatche

# --- Trin 4: loftet skal aabne igen -----------------------------------------
Write-Host ""
Write-Host "TRIN 4 - aabner loftet igen efter vinduet?" -ForegroundColor Cyan
$vent = 70
for ($i = $vent; $i -gt 0; $i--) {
    Write-Host -NoNewline ("`r    {0,3} sek. tilbage " -f $i)
    Start-Sleep -Seconds 1
}
Write-Host "`r    klar               "

$e = Send-Checkout -Json ('{"email":"s12-' + $Stempel + '-3@eksempel.invalid","name":"S12 Test"}')
Write-Host "  HTTP $($e.Status)"
Write-Host "  $($e.Body)" -ForegroundColor DarkGray
Tjek -Hvad "loftet aabnede igen efter vinduet" -Bestaaet ($e.Status -ne 429) -Set "HTTP 429 - loftet slipper ALDRIG op"

# --- Opsamling ---------------------------------------------------------------
Write-Host ""
Write-Host "=== RESULTAT ===" -ForegroundColor Cyan
if ($script:Fejl -eq 0 -and $script:Uafklaret -eq 0) {
    Write-Host "  Alle tjek bestaaet." -ForegroundColor Green
} elseif ($script:Fejl -eq 0) {
    Write-Host "  Ingen fejl, men $($script:Uafklaret) tjek er UAFKLARET." -ForegroundColor Yellow
    Write-Host "  Bekraeft dem i 'railway logs', foer S12 lukkes." -ForegroundColor Yellow
} else {
    Write-Host "  $($script:Fejl) tjek FEJLEDE ($($script:Uafklaret) uafklaret)." -ForegroundColor Red
}
Write-Host ""
Write-Host "RYD OP:" -ForegroundColor Yellow
Write-Host "  railway variables --set CHECKOUT_LOFT_MAKS=5 --set CHECKOUT_LOFT_VINDUE_MIN=10"
Write-Host "Bekraeft i bootlinjen bagefter, at der igen staar 5 kald pr. 10 min."
Write-Host ""
exit $script:Fejl
