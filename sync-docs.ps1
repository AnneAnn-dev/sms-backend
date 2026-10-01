# sync-docs.ps1  --  rev. 4, 1/10-26
#
# Flytter dokumenter mellem repoet (master, i git) og arbejdstraeet
# (den eneste mappe, Cowork-sessioner har adgang til).
#
# DAEKKER:  docs\*.md  +  CLAUDE.md i roden.
# IKKE:     undermapper, xlsx, pdf, kode.
#
# FIRE TILSTANDE. Standard er den ufarlige.
#
#   .\sync-docs.ps1                          Viser kun forskelle. AENDRER INTET.
#   .\sync-docs.ps1 -Hent                    Repo  -> arbejdstrae. Foer en session.
#   .\sync-docs.ps1 -Aflever                 Arbejdstrae -> repo. Efter en session.
#   .\sync-docs.ps1 -Aflever -Fil docs\X.md  Kun EEN fil. Se nedenfor.
#
# HVORFOR -Hent ER VIGTIG: Claude maa hverken laese eller skrive i sms-backend.
# Arbejdstraeet er hele graensefladen. Er det bagud, arbejder sessionen paa en
# forAeldet udgave - og resultatet er en fletning, ingen bad om (13/8 og 27/8).
#
# REV. 4 (S29, efter 1/10-26). Tre huller lukket, alle tre ramte samme dag:
#
#   (1) -Hent havde INGEN vagt. En anden chats -Hent lagde repoets udgave hen
#       over et aabent arbejde i arbejdstraeet - tre gange paa en dag. Nu
#       stopper -Hent, naar arbejdstraeets side er nyest, og den tager en
#       sikkerhedskopi, foer den overskriver noget som helst.
#
#   (2) Ingen kontrol af, om dokumenterne er COMMITTET. Registret stod
#       ucommittet i TI DAGE; et enkelt "git checkout -- docs/..." gendannede
#       udgaven fra 22/9 og slettede alt siden. Scriptet siger nu hoejt til,
#       naar docs\ har ugemte aendringer - uanset tilstand.
#
#   (3) Alt eller intet. Peger ti filer hver sin vej, og man kun vil flytte
#       een, var der ingen vej udenom haandkopiering. -Fil loeser det.
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
  [switch]$Aflever,
  [string]$Fil,
  [switch]$Tving
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

# ---- Oprydning: sikkerhedskopier har en holdbarhed (rev. 4) --------------
# En kopi er kun vaerd at have, saa laenge man kan huske, hvad den hoerer til.
# Fjorten dage. Uden den her linje vokser mappen i det uendelige, og saa er
# den ikke et sikkerhedsnet men en bunke.
$SIKKERHEDSROD = Join-Path $ARBEJDSTRAE "_sikkerhedskopi"
if (Test-Path $SIKKERHEDSROD) {
  $graense = (Get-Date).AddDays(-14)
  $gamle = @(Get-ChildItem $SIKKERHEDSROD -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.LastWriteTime -lt $graense })
  if ($gamle.Count -gt 0) {
    $gamle | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Host ("Ryddet op: " + $gamle.Count + " sikkerhedskopi(er) aeldre end 14 dage slettet.") -ForegroundColor DarkGray
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

# ---- -Fil: begraens til een fil, foer noget andet sker ---------------------
if ($Fil) {
  $Fil = $Fil.Trim().Replace("/", "\")
  if ($relative -notcontains $Fil) {
    Write-Host "STOP: -Fil skal vaere en af de filer, scriptet daekker." -ForegroundColor Red
    Write-Host "Skriv stien som den staar herunder, fx: -Fil docs\RISIKOREGISTER.md"
    Write-Host ""
    $relative | ForEach-Object { Write-Host "  $_" }
    exit 1
  }
  $relative = @($Fil)
}

# ---- Find forskellene ------------------------------------------------------
$forskelle = @()
foreach ($rel in $relative) {
  $r = Join-Path $REPO $rel
  $a = Join-Path $ARBEJDSTRAE $rel
  $hr = Hash $r
  $ha = Hash $a
  if ($hr -eq $ha) { continue }

  $arbejdsNyest = $false
  $tilstand =
    if     ($null -eq $hr) { $arbejdsNyest = $true; "findes KUN i arbejdstraeet" }
    elseif ($null -eq $ha) { "findes KUN i repoet" }
    else {
      $tr = (Get-Item $r).LastWriteTime
      $ta = (Get-Item $a).LastWriteTime
      if ($ta -gt $tr) { $arbejdsNyest = $true; "arbejdstraeet er nyest ({0:dd-MM HH:mm} mod {1:dd-MM HH:mm})" -f $ta, $tr }
      else             { "REPOET er nyest ({0:dd-MM HH:mm} mod {1:dd-MM HH:mm})" -f $tr, $ta }
    }

  $forskelle += [pscustomobject]@{ Fil = $rel; Tilstand = $tilstand; ArbejdsNyest = $arbejdsNyest }
}

Write-Host ""
Write-Host "Repo (master):  $REPO"
Write-Host "Arbejdstrae:    $ARBEJDSTRAE"
if ($Fil) { Write-Host "Begraenset til: $Fil" -ForegroundColor Cyan }
Write-Host ""

# ---- Er dokumenterne overhovedet committet? (rev. 4, hul 2) ---------------
# Staar de ucommitteret, findes der ingen historik at falde tilbage paa, og
# saa goer ETHVERT uheld i resten af scriptet ondt. Derfor foerst, og hver gang.
$ugemt = & git -C $REPO status --porcelain -- "docs" "CLAUDE.md"
if ($ugemt) {
  Write-Host "ADVARSEL: dokumenter i repoet er IKKE committet:" -ForegroundColor Yellow
  $ugemt | ForEach-Object { Write-Host "  $_" }
  Write-Host ""
  Write-Host "Et 'git checkout -- <fil>' sletter dem uden at spoerge, og de findes"
  Write-Host "ikke andre steder. Commit dem, naar du er faerdig - ikke 'senere'."
  Write-Host ""
}

if ($forskelle.Count -eq 0) {
  Write-Host "De to sider er ens. Ingenting at goere." -ForegroundColor Green
  exit 0
}

Write-Host "FORSKELLE:" -ForegroundColor Yellow
$forskelle | Select-Object Fil, Tilstand | Format-Table -AutoSize -Wrap

Write-Host "Laes Tilstand-kolonnen. Peger nogle filer den ene vej og andre den"
Write-Host "modsatte, saa koer IKKE en samlet retning - brug -Fil og tag dem"
Write-Host "een ad gangen i stedet."
Write-Host ""

# ---- Kun visning -----------------------------------------------------------
if (-not $Hent -and -not $Aflever) {
  Write-Host "Ingenting aendret (visning)."
  Write-Host "  .\sync-docs.ps1 -Hent      henter repoets udgave ned i arbejdstraeet"
  Write-Host "  .\sync-docs.ps1 -Aflever   loefter arbejdstraeets udgave op i repoet"
  Write-Host "  tilfoej -Fil docs\NAVN.md  for kun een fil"
  exit 0
}

# ---- Hent: vagt mod at skrive hen over et aabent arbejde (rev. 4, hul 1) ---
if ($Hent) {
  $ifare = @($forskelle | Where-Object { $_.ArbejdsNyest })
  if ($ifare.Count -gt 0 -and -not $Tving) {
    Write-Host "STOP: arbejdstraeets udgave er nyest for disse filer:" -ForegroundColor Red
    $ifare | ForEach-Object { Write-Host ("  " + $_.Fil + "  --  " + $_.Tilstand) }
    Write-Host ""
    Write-Host "En -Hent ville skrive repoets AELDRE udgave hen over dem. Er det"
    Write-Host "en anden chats uafleverede arbejde, er det vaek."
    Write-Host ""
    Write-Host "Aflever dem foerst:   .\sync-docs.ps1 -Aflever -Fil <sti>"
    Write-Host "Eller tving, hvis du VED, de kan undvaeres:  -Hent -Tving"
    exit 1
  }
}

# ---- Aflever: vagten daekker kun det, der er i fare -------------------------
if ($Aflever) {

  $maal = @()
  foreach ($f in $forskelle) {
    if (Test-Path (Join-Path $REPO $f.Fil)) { $maal += ($f.Fil -replace "\\", "/") }
  }

  if ($maal.Count -gt 0) {
    $ifare2 = & git -C $REPO status --porcelain -- $maal
    if ($ifare2) {
      Write-Host "STOP: filer, der ville blive overskrevet, har ugemte aendringer:" -ForegroundColor Red
      $ifare2 | ForEach-Object { Write-Host "  $_" }
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

# Sikkerhedskopi foer -Hent overskriver noget i arbejdstraeet. Git daekker
# repo-siden; arbejdstraeet har ingen historik overhovedet.
$sikkerhed = Join-Path $SIKKERHEDSROD (Get-Date -Format "yyyyMMdd-HHmmss")

$antal = 0
foreach ($f in $forskelle) {
  $r = Join-Path $REPO $f.Fil
  $a = Join-Path $ARBEJDSTRAE $f.Fil
  if ($Hent) {
    if (-not (Test-Path $r)) { Write-Host ("  sprunget over (findes ikke i repoet): " + $f.Fil); continue }
    if (Test-Path $a) {
      $kopiMaal = Join-Path $sikkerhed $f.Fil
      New-Item -ItemType Directory -Force -Path (Split-Path $kopiMaal) | Out-Null
      Copy-Item $a $kopiMaal -Force
    }
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

if ($Hent -and (Test-Path $sikkerhed)) {
  Write-Host "Sikkerhedskopi af det overskrevne: $sikkerhed" -ForegroundColor DarkYellow
  Write-Host "  (slettes automatisk efter 14 dage)" -ForegroundColor DarkGray
}

if ($Aflever) {
  Write-Host ""
  Write-Host "NAESTE SKRIDT - spring det ikke over:"
  Write-Host "  git -C $REPO status"
  Write-Host "  git -C $REPO diff"
  Write-Host "Nye filer vises som ?? og har ingen diff - dem laeser du selv igennem."
  Write-Host "Er alt som forventet, saa COMMIT MED DET SAMME. Er det ikke:"
  Write-Host "  git -C $REPO checkout -- <fil>      (og ingen skade sket)"
  Write-Host ""
  Write-Host "Ucommitteret arbejde har ingen historik. Registret stod ucommitteret"
  Write-Host "i ti dage (S29) - det blev kun reddet af en tilfaeldig kopi."
}
