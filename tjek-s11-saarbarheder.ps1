# tjek-s11-saarbarheder.ps1
#
# Laeser npm audit og skriver de HIGH og CRITICAL fund ud i en laesbar tabel,
# sorteret efter alvorlighed. Read-only: aendrer intet, installerer intet.
#
# Koeres i repo-roden. Ren ASCII, jf. projektets regel for .ps1.
#
# Baggrund: S11. Railways build-log 22/8 viste
#   33 vulnerabilities (1 low, 25 moderate, 6 high, 1 critical)
# Dette script viser, HVILKE 7 der er de alvorlige, og om der findes et fix.

$ErrorActionPreference = "Stop"

if (-not (Test-Path ".\package-lock.json")) {
  Write-Host "FEJL: ingen package-lock.json her. Staa i repo-roden." -ForegroundColor Red
  exit 1
}

Write-Host ""
Write-Host "Kilde:" (Get-Location).Path
Write-Host "Laasefil aendret:" (Get-Item ".\package-lock.json").LastWriteTime
Write-Host ""

# npm audit returnerer exit-kode 1 naar der ER fund. Det er ikke en fejl her.
$raw = & npm audit --omit=dev --json 2>$null

try {
  $rapport = $raw | ConvertFrom-Json
} catch {
  Write-Host "UAFKLARET: kunne ikke laese npm audit's JSON." -ForegroundColor Yellow
  Write-Host "Koer 'npm audit --omit=dev' manuelt og laes med oejnene."
  exit 2
}

$m = $rapport.metadata.vulnerabilities
Write-Host ("I ALT: {0} fund - {1} critical, {2} high, {3} moderate, {4} low" -f `
  $m.total, $m.critical, $m.high, $m.moderate, $m.low)
Write-Host ""

$alvorlige = $rapport.vulnerabilities.PSObject.Properties.Value |
  Where-Object { $_.severity -eq "high" -or $_.severity -eq "critical" }

if (-not $alvorlige) {
  Write-Host "Ingen high eller critical. CI-tjekket ville vaere GROENT." -ForegroundColor Green
  exit 0
}

Write-Host "DISSE BLOKERER CI (--audit-level=high):" -ForegroundColor Yellow
Write-Host ""

$alvorlige |
  Sort-Object @{Expression={ if ($_.severity -eq "critical") {0} else {1} }}, name |
  Select-Object `
    @{n="Pakke";       e={ $_.name }}, `
    @{n="Alvor";       e={ $_.severity }}, `
    @{n="Ramte ver.";  e={ $_.range }}, `
    @{n="Direkte?";    e={ if ($_.isDirect) { "ja" } else { "transitiv" } }}, `
    @{n="Fix";         e={
        if ($_.fixAvailable -eq $true) { "npm audit fix" }
        elseif ($_.fixAvailable -eq $false) { "INTET FIX" }
        elseif ($_.fixAvailable.isSemVerMajor) {
          "MAJOR: " + $_.fixAvailable.name + "@" + $_.fixAvailable.version
        }
        else { $_.fixAvailable.name + "@" + $_.fixAvailable.version }
      }} |
  Format-Table -AutoSize -Wrap

Write-Host ""
Write-Host "Hvem traekker dem ind (kaeden op til en pakke, du selv har valgt):"
Write-Host ""
foreach ($v in $alvorlige) {
  $via = ($v.via | ForEach-Object { if ($_ -is [string]) { $_ } else { $_.title } }) -join " | "
  Write-Host ("  " + $v.name)
  if ($via) { Write-Host ("      via:    " + $via) }
  if ($v.effects) { Write-Host ("      rammer: " + ($v.effects -join ", ")) }
}

Write-Host ""
Write-Host "Naeste skridt:"
Write-Host "  1) 'npm ls <pakke>' viser den fulde kaede for en enkelt pakke."
Write-Host "  2) 'npm audit fix' tager dem, der kan klares uden major-spring."
Write-Host "  3) Resten tages EN ad gangen med roegtest imellem - eller"
Write-Host "     vurderes bevidst som 'rammer os ikke' og skrives i registret."
Write-Host ""
Write-Host "Koer INTET fix ud fra dette script. Det er en aflaesning, ikke en handling."
