# find-otp-6.ps1
# Finder steder hvor tallet 6 kan vaere bagt ind i OTP-haandteringen,
# saa et skift fra 6- til 8-cifret kode braekker login tavst. Se S15.
#
# REN ASCII med vilje (PS 5.1 fejllaeser UTF-8 uden BOM) - ingen aeoeaa, ingen emoji.
# Skriver intet. Laeser kun. Koeres fra repo-roden:  .\find-otp-6.ps1

$ErrorActionPreference = 'Stop'

$filtyper = @('*.js', '*.html', '*.mjs', '*.cjs')
$undtag   = '\\node_modules\\|\\\.git\\|\\dist\\|\\build\\|\\coverage\\'

# Hvert moenster har et navn, saa et fund kan laeses uden at gaette hvorfor det er der.
$moenstre = @(
    @{ Navn = 'maxlength=6      (afkorter TAVST)'; Regex = 'maxlength\s*=\s*.?\s*6\b' },
    @{ Navn = 'regex {6}        (\d{6}, [0-9]{6})'; Regex = '\{\s*6\s*\}' },
    @{ Navn = 'length-tjek paa 6'                 ; Regex = 'length\s*[=!]=+\s*6\b' },
    @{ Navn = 'afkortning til 6 tegn'             ; Regex = '(slice|substr|substring)\s*\(\s*0\s*,\s*6' },
    @{ Navn = 'pattern-attribut med 6'            ; Regex = 'pattern\s*=\s*.{0,20}6' },
    @{ Navn = 'max=999999 / min=100000'           ; Regex = '(999999|100000)' },
    @{ Navn = 'tekst der lover seks cifre'        ; Regex = 'sekscifr|6-cifr|6 cifre|seks cifre|6 tal' },
    @{ Navn = 'navngiven konstant = 6'            ; Regex = '(kode|code|otp|token|pin)\w*\s*=\s*6\b' }
)

$filer = Get-ChildItem -Path . -Recurse -Include $filtyper -File |
         Where-Object { $_.FullName -notmatch $undtag }

Write-Host ""
Write-Host ("Gennemsoeger {0} filer." -f $filer.Count) -ForegroundColor Cyan
Write-Host ""

$antalIalt = 0

foreach ($m in $moenstre) {
    $fund = $filer | Select-String -Pattern $m.Regex -CaseSensitive:$false

    if ($fund) {
        Write-Host ("--- {0}  ({1} fund)" -f $m.Navn, $fund.Count) -ForegroundColor Yellow
        foreach ($f in $fund) {
            $sti = Resolve-Path -Relative $f.Path
            $tekst = $f.Line.Trim()
            if ($tekst.Length -gt 120) { $tekst = $tekst.Substring(0, 120) + ' ...' }
            Write-Host ("  {0}:{1}" -f $sti, $f.LineNumber) -ForegroundColor Gray
            Write-Host ("      {0}" -f $tekst)
        }
        Write-Host ""
        $antalIalt = $antalIalt + $fund.Count
    }
}

# Hvem ejer flowet? Grep kan vaere tom og koden alligevel braekke
# (fx seks separate input-felter uden tallet 6 nogen steder).
Write-Host "--- Filer der roerer OTP-verifikationen (laes dem med oejnene)" -ForegroundColor Yellow
$ejere = $filer | Select-String -Pattern 'verifyOtp|token_hash|nyt-link' -CaseSensitive:$false |
         Select-Object -ExpandProperty Path -Unique
if ($ejere) {
    foreach ($e in $ejere) { Write-Host ("  {0}" -f (Resolve-Path -Relative $e)) }
} else {
    Write-Host "  Ingen fundet - tjek om du staar i repo-roden." -ForegroundColor Red
}

Write-Host ""
if ($antalIalt -eq 0) {
    Write-Host "INGEN moensterfund." -ForegroundColor Green
    Write-Host "Det er IKKE et bevis. Laes filerne ovenfor med oejnene, og lav" -ForegroundColor Green
    Write-Host "den rigtige test: skift indstillingen paa STAGING og log ind" -ForegroundColor Green
    Write-Host "med en aegte ottecifret kode." -ForegroundColor Green
} else {
    Write-Host ("{0} fund i alt. Ret dem FOER indstillingen skiftes." -f $antalIalt) -ForegroundColor Red
}
Write-Host ""
