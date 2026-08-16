#requires -Version 5.1
<#
    test-s16-ip-loft.ps1

    Form aal
    --------
    Verificerer S16: kan IP-cooldownen i /onboarding/nyt-link omgaas ved at
    forfalske X-Forwarded-For?

    Koden paa onboarding-link.js:83 laeser FOERSTE led af x-forwarded-for.
    Bevarer Railway klientens egen header og foejer sin observation bagpaa,
    saetter klienten selv noeglen, og loftet findes ikke.

    Metode
    ------
    Fase 1 (positiv kontrol): to kald, forskellige e-mails, INGEN forfalsket
        header. Virker IP-loftet, skal kun det FOERSTE naa frem til
        firmaopslaget.
    Fase 2 (selve testen): to kald, forskellige e-mails, forskellige
        forfalskede X-Forwarded-For. Naar BEGGE frem, er hullet reelt.

    Forskellige e-mails i hvert kald er noedvendigt: rammer email-cooldownen
    foerst, kortslutter || og IP-tjekket koeres aldrig. Saa beviser testen intet.

    Signalet
    --------
    HTTP-svaret er identisk i alle udfald (anti-enumeration, med vilje) og kan
    IKKE bruges. Signalet er log-linjen "anmodet for ukendt email", som kun
    skrives, hvis kaldet naaede FORBI cooldownen til firmaopslaget.

    Adresserne ligger paa .invalid (reserveret domaene) og findes ikke som
    firmaer. Der sendes derfor ingen mail i nogen af faserne.

    Brug
    ----
    .\test-s16-ip-loft.ps1 -Miljo staging

    Kun staging accepteres. Prod afvises af ValidateSet, ikke af en advarsel.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("staging")]
    [string]$Miljo
)

$ErrorActionPreference = "Stop"

# Afvis ukendte argumenter frem for at ignorere dem.
if ($args.Count -gt 0) {
    Write-Host "AFBRUDT: ukendte argumenter: $($args -join ', ')" -ForegroundColor Red
    exit 1
}

# TLS 1.2 er ikke standard i Windows PowerShell 5.1.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$BaseUrl  = "https://sms-backend-staging-908c.up.railway.app"
$Endpoint = "$BaseUrl/onboarding/nyt-link"
$Stempel  = Get-Date -Format "yyyyMMdd-HHmmss"

function Send-Kald {
    param(
        [Parameter(Mandatory = $true)][string]$Email,
        [string]$ForfalsketIp
    )

    $headers = @{ "Content-Type" = "application/json" }
    if ($ForfalsketIp) { $headers["X-Forwarded-For"] = $ForfalsketIp }

    $body = @{ email = $Email } | ConvertTo-Json -Compress

    $vist = if ($ForfalsketIp) { $ForfalsketIp } else { "(ingen - din egen IP)" }
    Write-Host ("  -> {0,-44} XFF: {1}" -f $Email, $vist)

    try {
        $svar = Invoke-RestMethod -Uri $Endpoint -Method Post -Headers $headers -Body $body -TimeoutSec 20
        Write-Host ("     svar: {0}" -f $svar.message) -ForegroundColor DarkGray
    }
    catch {
        Write-Host ("     KALDET FEJLEDE: {0}" -f $_.Exception.Message) -ForegroundColor Red
        Write-Host "     Testen er ugyldig. Stop her." -ForegroundColor Red
        exit 1
    }
}

function Vent-Cooldown {
    param([int]$Sekunder = 70)
    Write-Host ""
    Write-Host "Venter $Sekunder sek., saa cooldownen er udloebet mellem faserne." -ForegroundColor Yellow
    for ($i = $Sekunder; $i -gt 0; $i--) {
        Write-Host -NoNewline ("`r  {0,3} sek. tilbage " -f $i)
        Start-Sleep -Seconds 1
    }
    Write-Host "`r  klar               "
    Write-Host ""
}

Write-Host ""
Write-Host "=== S16: kan IP-loftet omgaas med en forfalsket X-Forwarded-For? ===" -ForegroundColor Cyan
Write-Host "Miljoe:   $Miljo"
Write-Host "Endpoint: $Endpoint"
Write-Host "Stempel:  $Stempel"
Write-Host ""
Write-Host "FOER DU FORTSAETTER: aabn staging-loggen i et andet vindue." -ForegroundColor Yellow
Write-Host "  railway status     <- bekraeft miljoeet FOERST (D20: CLI-linket og .env er uafhaengige)"
Write-Host "  railway logs"
Write-Host ""
$svar = Read-Host "Er staging-loggen aaben? (ja/nej)"
if ($svar -ne "ja") {
    Write-Host "AFBRUDT: uden loggen findes der intet signal at aflaese." -ForegroundColor Red
    exit 1
}

# --- Fase 1: positiv kontrol ------------------------------------------------
Write-Host ""
Write-Host "FASE 1 - positiv kontrol (ingen forfalsket header)" -ForegroundColor Cyan
Write-Host "Virker IP-loftet overhovedet? Uden dette svar beviser fase 2 intet."
Write-Host ""

Send-Kald -Email "s16-$Stempel-k1@eksempel.invalid"
Send-Kald -Email "s16-$Stempel-k2@eksempel.invalid"

Write-Host ""
Write-Host "FORVENTET i loggen: praecis EN linje med 'anmodet for ukendt email'" -ForegroundColor Green
Write-Host "  (k1 slipper igennem, k2 blokeres af ip-noeglen)"
Write-Host ""
Write-Host "Ser du TO linjer allerede her, er IP-loftet ikke-fungerende af en" -ForegroundColor Yellow
Write-Host "anden grund end S16, og fase 2 kan ikke skelne noget. Stop og undersoeg." -ForegroundColor Yellow

Vent-Cooldown -Sekunder 70

# --- Fase 2: selve testen ---------------------------------------------------
Write-Host "FASE 2 - forfalsket X-Forwarded-For" -ForegroundColor Cyan
Write-Host ""

Send-Kald -Email "s16-$Stempel-t1@eksempel.invalid" -ForfalsketIp "203.0.113.11"
Send-Kald -Email "s16-$Stempel-t2@eksempel.invalid" -ForfalsketIp "203.0.113.22"

Write-Host ""
Write-Host "=== AFLAESNING ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Tael linjer med 'anmodet for ukendt email' fra FASE 2 alene:"
Write-Host ""
Write-Host "  TO linjer (t1 og t2)  -> HULLET ER REELT." -ForegroundColor Red
Write-Host "     Klienten satte noeglen. S16 bekraeftes."
Write-Host "     Rettelse: app.set('trust proxy', 1) i server.js + req.ip alene."
Write-Host "     Egen commit, intet andet i den."
Write-Host ""
Write-Host "  EN linje (kun t1)     -> INTET HUL." -ForegroundColor Green
Write-Host "     Railway erstatter headeren i stedet for at foeje til."
Write-Host "     S16 kan lukkes UDEN kode - noter beviset i registret."
Write-Host ""
Write-Host "  NUL linjer            -> testen er ugyldig." -ForegroundColor Yellow
Write-Host "     Enten er log-teksten en anden, eller cooldownen fra fase 1"
Write-Host "     var ikke udloebet. Tjek med:"
Write-Host "       Select-String -Path .\onboarding-link.js -Pattern 'console\.(log|warn|error)'"
Write-Host ""
Write-Host "Bemaerk: de fire adresser ligger paa .invalid og findes ikke som"
Write-Host "firmaer. Der er ikke sendt mail i nogen af faserne."
Write-Host ""
