# Overdragelse: Fase 4 Skrivehjælp (Kundehenvendelser og SoMe)

Skrevet 5/11-26, omskrevet 9/11-26 (rettet sidst på dagen: "Andet", P5 udskudt, registerlevering) af den chat, der lavede plan, T1-målingerne, modelvalget, to blindtests og hele T2's kode. **En ny chat starter her.**

## Start her (9/11)

T2's kode er færdig på grenen **`fase4/t2`** (seneste commit `725c389`, pushet; 37 af 37 prøver grønne). Drejebogen ligger committet på staging: **`docs/fase4-skrivehjaelp-staging-drejebog.md`**. Næste skridt er at følge den:

1. Migrationerne `20261105120000_ai_forbrug_skrivehjaelp.sql` og `20261108120000_firma_profil_skrivehjaelp.sql` i staging-databasen (ingen af dem er kørt nogen steder).
2. Railway staging: `SKRIVEHJAELP_AKTIV=false`, `SKRIVEHJAELP_MODEL=mistral-medium-3.5-128b`, `AI_SVAR_MAANEDSLOFT_DKK=10`, `AI_SVAR_DAGSLOFT_DKK=2`, `AI_FACEBOOK_MAANEDSLOFT_DKK=10`, `AI_FACEBOOK_DAGSLOFT_DKK=2`.
3. Flet `fase4/t2` ind i staging (tjek `CACHE_NAME` i `static/sw.js`: T2 har `dashboard-v73`; bump, hvis staging har brugt v73 eller højere), deploy, se "Skrivehjaelp: SLUKKET" i loggen.
4. Tænd flaget, giv ét testfirma `svar` og `facebook` (kilde `manuel`), røgtest på iPhone (19 punkter i drejebogen).
5. Annes QA. Derefter Fase 4's port (udviklingsplanen): **udkast på 10 rigtige beskeder, læst af Anne**.
6. Registret (se nedenfor). Først derefter prod, med sin egen drejebog.

Railway var nede 8/11. Drejebogen køres fra 9/11 i en anden chat; spørg Ann, hvor langt den er nået.

**Planen:** claude.ai-dokumentet "Fase 4: Skrivehjælp – planudkast", https://claude.ai/artifact/5aQaxpE8FFVANLdwwnJZLP (fra 3-5/11; denne note er nyere).

## Grenen `fase4/t2` (bygget fra staging 8/11)

| Commit | Indhold |
|---|---|
| `f706263` | T1-grenen (`fase4/t1-maaling`, `edb80b9`) flettet ind. Konflikten i `tekst-adapter.js`/`maal-skrivehjaelp.js` skyldtes, at en tidlig levering ved en fejl var committet på staging (`ab73b96`); T1-udgaven blev taget |
| `b54c7e0` | Kataloget: pakken `svar-some`, handle **`modul-svar-some`** (Ann 8/11), navn "Kundehenvendelser og SoMe", 200 kr., giver `svar` og `facebook`, `saelges: false, kommer: true`. `svar`/`facebook` beholder egne handles til senere enkeltsalg, men vises ikke for sig. Rettet i katalog, Din pakke, checkout, mail (`modulTekst`), afstemning. Ændringen til salg = `saelges: true` + `opret-frisbii-produkter.js` (staging, så `--prod`) |
| `5740a2a` | `tekst-adapter.js`: `skriv({system, bruger, ...})` + `prisOereSkrivehjaelp`, egen låst model `SKRIVEHJAELP_MODEL` (D14). `prompts/skrivehjaelp.js`: `AFGOERENDE` (Annes bilag A) — `bygSvar` afviser uden det afgørende felt (lag 2). `proev-skrivehjaelp.js` 20/20. T1a-sættets fjendtlige cases har fået det afgørende felt |
| `ba9866c`, `b2b36b5` | `skrivehjaelp-ruter.js` (svar/opslag/kommentar/profil/kvote), flag `SKRIVEHJAELP_AKTIV` i `flags.js`, montering i `server.js` (svar kræver `svar`, opslag/kommentar kræver `facebook`), migration `20261108120000` (`branche`, `afsender_navn`, `afsender_telefon`), `proev-skrivehjaelp-ruter.js` |
| `725c389` | Værktøjer-fanen i `static/dashboard.html` (skitse 4, godkendt af Ann 8/11), `sw.js` v73, Profil-punkt "Skrivehjælp", 90 %-besked, telefonforslag med betegnelse. `proev-skrivehjaelp-ruter.js` 39/39 |

**Ruternes rækkefølge:** firm_id fra token → profil skal findes (409) → prompt bygges, ugyldigt input/manglende afgørende felt 400 → `kvote.tjek` med pulje (svar+kommentar = `svar`, opslag = `facebook`), værste fald for to kald → 402/503 → `skriv()` → hvert kald bogføres (også betalt fejl) → `skrivehjaelp-format.js`, ét nyt forsøg ved forkert form → 502 med dansk besked. Ingen kundetekst i logs.

**Skærmen (Ann 8/11):** bundbjælken hedder **Værktøjer** (skruenøgle; der kan komme andre værktøjer). Første gang: "Hvordan ser afsenderen på dine smser ud? Du kan altid ændre det under Profil." → navn → telefonnummer (forslag "Firmaets nummer" fra `firma_profil.telefon` og "Dit nummer" fra `firms.owner_phone`, slået sammen hvis ens, + "Et andet nummer" + "Intet nummer") → "Dine svar slutter sådan:" → **branche nederst**. Underskrift: "Peter, Hansens VVS, tlf. …". Forsiden viser ikke forbrug. "Du har nu brugt 90 % af din dagsrate." vises i det udkast, der krydser 90 % af dagsloftet (`varsel: "dag90"`, intet gemmes). Tone er fast "venlig" (intet felt). Stilen følger `docs/DASHBOARD-STIL.md` og dashboardets egne variabler (`--steel` osv.).

## Model og prompt

- **`mistral-medium-3.5-128b` hos Scaleway** (PREVIEW hos Scaleway; også referatets model i prod). Ca. 3,5 øre pr. svar, 2,7 pr. opslag, 1,3 pr. kommentarsvar.
- Blindtest 1 (7/11): Anne foretrak gpt-oss-120b's stil, men den lavede fejl i fakta. Blindtest 2 (8/11): mistral bedst 11, gpt-oss 5, lige gode 10; "ville ikke sende" gpt-oss 9, mistral 4. Gemma 4 udelukket (ræsonnerende, ignorerer `enable_thinking`).
- **Promptversion `2026-11-08c` er låst** (Ann 8/11). Historikken står øverst i `prompts/skrivehjaelp.js`.
- **Eksempler i prompten lækker ind i teksterne** ("to uger med takeaway", "dit tag"). Brug pladsholdere eller abstrakte eksempler.
- Fjendtlige tests på `2026-11-08c` (×10): injektion 0/40 slap igennem.

## P5 — det vigtigste at vide

- Uden fakta (T1a "-tom"): læst i hånden lovede/afviste/indrømmede **ca. 15-20 af 34** noget, firmaet ikke har sagt. Det automatiske flag fandt 3. **"3 af 33" i registrets P5 er forkert** (også kun flaget) og skal rettes.
- Med kun det afgørende felt (`maalinger\skrivehjaelp\2026-11-08-09-06-30`, 31 cases): **ca. 6/31 med reelt opdigtet indhold** (værst: "Det er ikke farligt for katten"; en opdigtet indrømmelse; "Vi tager haveaffald med"; "tilbud med det samme") og ca. 5 med et "jeg ringer dig op" uden tidspunkt.
- Lag 1-2 er derfor det egentlige værn; resten tages indtil videre af lag 4-5 ("Tjek før du sender", "Læs udkastet, før du sender det. Det er dit svar.", firmaet sender selv).
- **Ann 9/11: P5 løses senere.** Den står åben i registret; restrisikoen er ikke accepteret. Foreslået: én målrettet regel ("sig aldrig, at noget er ufarligt; indrøm aldrig en fejl, der ikke står i fakta") i samme promptrunde som Annes noter fra blindtest 2. Det kræver en ny promptversion efter `2026-11-08c` og en ny hånd-læst måling. Staging og Annes QA venter ikke på det.

## Registret

Committet `9db15da` på staging 8/11. **Levering 9/11:** `_til-repo\fase4-register-3\RISIKOREGISTER-fase4-2026-11-09.md`, 763.099 bytes, base `ede98352`, resultat `93aff7c0` (P5 "3 af 33" rettet til de hånd-læste tal og lag 1-2 bygget; S6 ruterne bygget; Ø2 kvoten koblet på ruterne; D14 låsen bygget; J9 Scaleways svar indført). Tjek, at den er committet (`git log -1 -- docs/RISIKOREGISTER.md`).

**Mangler bagefter:** P5, Ø2 og D14 "bevist på staging" efter drejebogens røgtest; J9 lukkes, når `fase4/t2` er flettet ind i staging (PDF'en `docs/databehandleraftaler/svar_scaleway_dataretention_ai.pdf` og gdpr-arket ligger kun på grenen); P5 afgøres senere (se ovenfor). Regler: `sync-docs.ps1` først, sig det højt, "Redigeres nu"-linjen, lever i `_til-repo\<emne>\`.

## Åbne punkter

- **Anne, den generelle branchepakke:** indtil da kører ukendte fag på Håndværk; Annes Generel 1 afvises, fordi valget "Ja, men jeg vil gerne høre mere først" kun findes dér.
- **Anne, bilag C** (i `til-anne\fase4-t1b\Skrivehjaelp - naeste skridt til Anne.docx`): de juridiske tekster. (1) Linjen på siden og i vilkårene: "Kundehenvendelser og SoMe skriver forslag. Læs altid teksten igennem. Du står selv inde for det, du sender eller poster." (2) Afsnittet i privatlivspolitikken ("… behandles i EU og gemmes ikke hos os …"). (3) Linjen i gdpr-arket (Ann 8/11: arket nævner allerede Scaleways 14-dages-undtagelse). Anne godkender ordlyden; Ann sætter (1) og (2) ind før prod. Bilagets andet forbehold, at databehandleraftalen med kunderne dækker beskeder fra deres kunder, er ikke bekræftet i denne chat.
- **Anne, staging:** QA med egne beskeder, derefter Fase 4's port (10 rigtige beskeder).
- **Annes noter fra blindtest 2** til en senere promptrunde: "så vi kan blive enige" (Generel 8), "Jeg skriver, når vi kan komme" uden tidspunkt (Grøn 3); valgfrie felter "Hvornår hører kunden fra dig?" og "Hvorfor?" foreslået til appen. Annes egne eksempler: `maalinger\skrivehjaelp\blindtest-2026-11-07\Anne - gode og daarlige svar 2026-11-07.docx` (to færdige sætninger i stedet for [ja/nej]; begrundelser må ikke opdigtes).
- **Annes `betaling.html`** viser to SoMe-varianter til 200 kr.; rettes til den samlede pakke.
- `check-env.js` er bevidst IKKE udvidet (den tjekker kun miljø-identitet, ikke AI-variabler); kvote og adapter er fail-closed.

- **Databehandleraftale med kunderne (J1, J14 punkt 3):** registret har J1 åben siden 4/8. Udkast skrevet 9/11 i claude.ai: "Databehandleraftale – udkast", https://claude.ai/artifact/998LSVqcoc9Q6DeV4dFzoW (én aftale, ét bilag pr. modul, underdatabehandlere, åbne punkter). Ann læser det.

## Beslutninger (Ann)

- Teksten under 90 %-beskeden, "Du kan stadig lave et par udkast i dag. I morgen starter du forfra.", er godkendt (Ann 9/11). Den står allerede i `dashboard.html`.
- Der kommer ingen "Samlet vurdering" fra Anne. Modelvalget (mistral) står, indtil vi vælger en anden (Ann 9/11).
- "Andet" kræver fritekst ("Skriv, hvad kunden skal vide"), Ann 9/11. Allerede bygget; intet at ændre.
- Sælges samlet som "Kundehenvendelser og SoMe", 200 kr./md., handle `modul-svar-some`; modulerne `svar` og `facebook`, så de kan deles senere.
- Model: europæisk, gerne dansk, aldrig kinesisk.
- Loft: 10 kr./md. og 2 kr./dag pr. del; globalt loft 500 kr./md.; re-trigger for globalt dagsloft ved 12 firmaer.
- Fem lag mod opdigtede løfter. Ingen tankestreg eller bindestreg som tegnsætning. Kommentarsvar på dansk. "Begge" = 4 kort; Instagram aldrig "klik på linket", "link i bio" er i orden.
- Underskrift = navn, firmanavn og det telefonnummer, firmaet selv vælger første gang.

## Fælder

- **Læs hver levering tilbage fra Anns maskine** før hash og bytes gives; kopiér til en ny sti under `/mnt/user-data/outputs/<ny-mappe>/` (genbrug af samme kildesti har lagt en ÆLDRE udgave).
- CRLF i arbejdstræet; `git hash-object` normaliserer. Giv base og resultat som `git hash-object`.
- Ann står nogle gange på den forkerte gren (staging i stedet for `fase4/*`): bed om `git status -sb` først.
- PowerShell 5.1: `>` skriver UTF-16 — brug `cmd /c "git show X:fil > sti"`. `"` i argumenter til node skal skrives `\"`.
- `maal-skrivehjaelp.js` kræver `node --env-file=.env`; "fetch failed" efter 0 ms = Anns net er nede.
- Prøvernes sandkasse her bruger en attrap af `auth.js`; den rigtige afgørelse er Anns `node kor-proever.js`.
- `dashboard.html` er 270 KB og fælles med andre faner: hold ændringer til `vk-`-klasserne og `#page-skriv`.
- Anne godkender af og til tekster, der bryder hendes egne "må ikke". Læs selv svarene; et flag er ikke en måling.
