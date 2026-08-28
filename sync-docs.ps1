# sync-docs.ps1  --  rev. 3, 28/8-26
#
# Flytter dokumenter mellem repoet (master, i git) og arbejdstraeet
# (den eneste mappe, Cowork-sessioner har adgang til).
#
# DAEKKER:  docs\*.md  +  CLAUDE.md i roden.
# IKKE:     undermapper, xlsx, pdf, kode.
#
# TRE TILSTANDE. Standard er den ufarlige.
#
#   .\sync-docs.ps1              Viser kun forskelle. AENDRER INTET.
#   .\sync-docs.ps1 -Hent        Repo  -> arbejdstrae. Foer en session begynder.
#   .\sync-docs.ps1 -Aflever     Arbejdstrae -> repo. Efter en session er faerdig.
#
# HVORFOR -Hent ER VIGTIG: Claude maa hverken laese eller skrive i sms-backend.
# Arbejdstraeet er hele graensefladen. Er det bagud, arbejder sessionen paa en
# forAeldet udgave - og resultatet er en fletning, ingen bad om (13/8 og 27/8).
#
# REV. 3: CLAUDE.md er kommet med. Den ligger i roden og faldt derfor uden for
#         rev. 1 og 2 - altsaa praecis den fil, der beskriver reglerne, var den
#         eneste, reglerne ikke daekkede.
# REV. 2: vagten ved -Aflever daekker kun de filer, der ville blive overskrevet.
#
# Efter -Aflever: laes ALTID git-diffen foer du committer.
# Scriptet flytter bytes. Git er vagten. Diffen er beviset.

[CmdletBinding()]
param(
  [switch]$Hent,
  [switch]$Aflever
)

$ErrorActionPreference = "Stop"

$REPO        = "C:\Users\Bruger\sms-backend"
$ARBEJDSTRAE = "C:\Users\Bruger\claude-arbejdstrae"

# Filer i roden, der ogsaa skal med
$RODFILER = @("CLAUDE.md")

if ($Hent -and $Aflever) {
  Write-Host "STOP: vaelg enten -Hent eller -Aflever, ikke begge." -ForegroundColor Red
  exit 1
}
foreach ($m in @($REPO, $ARBEJDSTRAE, (Join-Path $REPO "docs"), (Join-Path $ARBEJDSTRAE "docs"))) {
  if (-not (Test-Path $m)) {
    Write-Host "STOP: findes ikke - $m" -ForegroundColor Red
    exit 1
  }
}

function Hash($sti) {
  if (Test-Path $sti) { (Get-FileHash $sti -Algorithm SHA256).Hash } else { $null }
}

# ---- Byg listen over relative stier, der er i spil -------------------------
$relative = @()
foreach ($side in @($REPO, $ARBEJDSTRAE)) {
  Get-ChildItem (Join-Path $side "docs") -Filter *.md -File |
    ForEach-Object { $relative += ("docs\" + $_.Name) }
}
$relative += $RODFILER
$relative = $relative | Sort-Object -Unique

# ---- Find forskellene ------------------------------------------------------
$forskelle = @()
foreach ($rel in $relative) {
  $r = Join-Path $REPO $rel
  $a = Join-Path $ARBEJDSTRAE $rel
  $hr = Hash $r
  $ha = Hash $a
  if ($hr -eq $ha) { continue }

  $tilstand =
    if     ($null -eq $hr) { "findes KUN i arbejdstraeet" }
    elseif ($null -eq $ha) { "findes KUN i repoet" }
    else {
      $tr = (Get-Item $r).LastWriteTime
      $ta = (Get-Item $a).LastWriteTime
      if ($ta -gt $tr) { "arbejdstraeet er nyest ({0:dd-MM HH:mm} mod {1:dd-MM HH:mm})" -f $ta, $tr }
      else             { "REPOET er nyest ({0:dd-MM HH:mm} mod {1:dd-MM HH:mm})" -f $tr, $ta }
    }

  $forskelle += [pscustomobject]@{ Fil = $rel; Tilstand = $tilstand }
}

Write-Host ""
Write-Host "Repo (master):  $REPO"
Write-Host "Arbejdstrae:    $ARBEJDSTRAE"
Write-Host ""

if ($forskelle.Count -eq 0) {
  Write-Host "De to sider er ens. Ingenting at goere." -ForegroundColor Green
  exit 0
}

Write-Host "FORSKELLE:" -ForegroundColor Yellow
$forskelle | Format-Table -AutoSize -Wrap

Write-Host "Laes Tilstand-kolonnen. Peger nogle filer den ene vej og andre den"
Write-Host "modsatte, saa koer IKKE en samlet retning - tag dem i haanden i stedet."
Write-Host ""

# ---- Kun visning -----------------------------------------------------------
if (-not $Hent -and -not $Aflever) {
  Write-Host "Ingenting aendret (visning)."
  Write-Host "  .\sync-docs.ps1 -Hent      henter repoets udgave ned i arbejdstraeet"
  Write-Host "  .\sync-docs.ps1 -Aflever   loefter arbejdstraeets udgave op i repoet"
  exit 0
}

# ---- Aflever: vagten daekker kun det, der er i fare -------------------------
if ($Aflever) {

  $maal = @()
  foreach ($f in $forskelle) {
    if (Test-Path (Join-Path $REPO $f.Fil)) { $maal += ($f.Fil -replace "\\", "/") }
  }

  if ($maal.Count -gt 0) {
    $ifare = & git -C $REPO status --porcelain -- $maal
    if ($ifare) {
      Write-Host "STOP: filer, der ville blive overskrevet, har ugemte aendringer:" -ForegroundColor Red
      $ifare | ForEach-Object { Write-Host "  $_" }
      Write-Host ""
      Write-Host "Commit eller forkast dem foerst. Ellers forsvinder de uden at"
      Write-Host "git nogensinde har set dem."
      exit 1
    }
  }

  $andet = & git -C $REPO status --porcelain
  if ($andet) {
    Write-Host "Bemaerk - andet ugemt i repoet, som dette script IKKE roerer:" -ForegroundColor DarkYellow
    $andet | ForEach-Object { Write-Host "  $_" }
    Write-Host ""
  }
}

$retning = if ($Hent) { "REPO -> ARBEJDSTRAE" } else { "ARBEJDSTRAE -> REPO" }
$svar = Read-Host "Kopier $retning for filerne ovenfor? (skriv JA)"
if ($svar -ne "JA") { Write-Host "Afbrudt. Intet aendret."; exit 0 }

$antal = 0
foreach ($f in $forskelle) {
  $r = Join-Path $REPO $f.Fil
  $a = Join-Path $ARBEJDSTRAE $f.Fil
  if ($Hent) {
    if (-not (Test-Path $r)) { Write-Host ("  sprunget over (findes ikke i repoet): " + $f.Fil); continue }
    Copy-Item $r $a -Force
  } else {
    if (-not (Test-Path $a)) { Write-Host ("  sprunget over (findes ikke i arbejdstraeet): " + $f.Fil); continue }
    Copy-Item $a $r -Force
  }
  Write-Host ("  kopieret: " + $f.Fil)
  $antal++
}

Write-Host ""
Write-Host "$antal fil(er) kopieret." -ForegroundColor Green

if ($Aflever) {
  Write-Host ""
  Write-Host "NAESTE SKRIDT - spring det ikke over:"
  Write-Host "  git -C $REPO status"
  Write-Host "  git -C $REPO diff"
  Write-Host "Nye filer vises som ?? og har ingen diff - dem laeser du selv igennem."
  Write-Host "Er alt som forventet, saa commit. Er det ikke:"
  Write-Host "  git -C $REPO checkout -- <fil>      (og ingen skade sket)"
}
