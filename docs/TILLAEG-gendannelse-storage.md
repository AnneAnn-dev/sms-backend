# Tillæg til gendannelsesøvelsen — Storage

*Indsættes i `ditdigitalekontor-drift-runbook.md` i afsnittet "Gendannelses-øvelse (step-by-step)", efter punkt om verifikation. Skrevet 1/8-26.*

---

## Hullet, som øvelsen 3/7-26 ikke dækkede

Gendannelsen bestod for `public`-skemaet og auth-brugere. **Storage var ikke med** — og der er reelt to huller, ikke ét:

**1. Selve filerne.** Greeting-lyd og lead-billeder ligger i Supabase Storage (S3-backed), altså uden for Postgres. `pg_dump` rører dem ikke uanset flag.

**2. Metadata-rækkerne.** `storage.objects` og `storage.buckets` ligger i `storage`-skemaet, ikke i `public`. Dumpene bruger `--schema=public` og springer dem derfor også over.

Det andet hul er det farlige, fordi det er usynligt: gendanner man filerne uden metadata-rækkerne (eller omvendt), ser alt rigtigt ud i dashboardet, men appen kan ikke finde noget. **Filer og metadata skal altid gendannes sammen.**

## Prioritering — de to filtyper er ikke lige vigtige

| Type | Kan genskabes uden backup? | Prioritet |
|---|---|---|
| **Lead-billeder** | **Nej.** Uploadet af håndværkerens kunder. Væk er væk | **Højest** |
| Greeting-lyd | Ja — kan genrenderes fra ElevenLabs med regenereringsscriptet | Lavere |

Er tiden knap under en ægte katastrofe: red lead-billederne først, genrender lyden bagefter.

## Udvidet procedure

### A. Metadata med i dumpet

Tilføj en fjerde `pg_dump`-kommando til snapshot-trinnet:

```
pg_dump "postgresql://postgres.<PROD_REF>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres" --data-only --table=storage.buckets --table=storage.objects -f storage-metadata.sql
```

Gendannes i rækkefølgen: skema → auth-brugere → data → **storage-metadata** → filer.

### B. Filerne ud

Der findes ikke en `supabase db dump`-ækvivalent til Storage. Skriv et lille Node-script, `dump-storage.js`, der bruger service_role-nøglen og:

1. Lister alle buckets
2. Går rekursivt gennem objekter i hver bucket (husk paginering — `list()` returnerer højst 100 ad gangen som standard)
3. Downloader hver fil til `./storage-backup/<bucket>/<sti>`
4. **Skriver en manifest-fil** `storage-manifest.json` med bucket, sti, størrelse og samlet antal pr. bucket

Manifestet er det, der gør verifikationen mulig — uden det ved man ikke, om gendannelsen er komplet.

Modstykket, `restore-storage.js`, læser manifestet og uploader til målprojektet. Kør det **efter** `storage-metadata.sql`, så rækkerne findes først.

⚠️ **Buckets' politikker følger ikke med.** Er buckets private (det bør de være), skal adgangspolitikkerne oprettes på ny i målprojektet. Notér de gældende politikker i runbogen, så de ikke skal genopfindes under pres.

### C. Verifikation — det nye beståelseskriterie

Den hidtidige verifikation talte rækker i `public`. Udvid den med:

```sql
-- kør i målprojektet efter gendannelse
select b.name as bucket, count(o.id) as antal_filer
from storage.buckets b
left join storage.objects o on o.bucket_id = b.id
group by b.name order by b.name;
```

**Øvelsen er først bestået, når:**

- [ ] Rækketallene i `public` stemmer (som hidtil)
- [ ] Et kendt firma kan slås op (som hidtil)
- [ ] **Antal filer pr. bucket stemmer med `storage-manifest.json`**
- [ ] **Én lead-billedfil og én greeting-lydfil er hentet ned fra målprojektet og åbnet — de skal kunne vises og afspilles, ikke bare findes**
- [ ] **Dato for øvelsen er skrevet ind i runbogen**

De tre sidste punkter er tilføjet, netop fordi de blev sprunget over sidste gang. Er de ikke afkrydset, er øvelsen ikke gennemført — uanset hvor godt resten gik.

## Så øvelsen ikke ryger igen

- **Manifest-filen er beviset.** Ingen manifest = ingen bestået øvelse.
- **Sæt en dato.** Gentag hvert kvartal, samme kadence som rollback-øvelsen (D4).
- **Skriv resultatet i runbogen hver gang**, med dato og antal filer. To målinger på række gør det synligt, hvis noget er holdt op med at blive gemt.
- **Storage er en del af rutinen, ikke et tillæg.** Når proceduren næste gang redigeres, skal Storage-trinene stå på deres rigtige plads i rækkefølgen — ikke i et appendiks, som dette dokument er.

---

## Andre rettelser til drift-runbogen (1/8-26)

**1. Supabase er på Pro.** Følgende steder er forældede og skal rettes:
- Master-rækkefølgen punkt 8: opgraderingen er gennemført, ikke udestående
- Del 0.E: "VIRKELIGHEDEN LIGE NU (Free-plan)" gælder ikke længere
- Infrastruktur/indkøb punkt 1: "Supabase prod er FREE-tier" er forkert
- Go-live-gates punkt 1: kan markeres ✅

Verificér samtidig i dashboardet, **om PITR faktisk er slået til** — Pro alene giver det ikke automatisk, og det kræver mindst et Small compute-add-on.

**2. Roller-afsnittet har forkerte navne.** Skal rettes til:
- **Ann** — backend, infra, migrationer, prod-deploys og rollback
- **Anne** — kundevendt site, onboarding-UI, indhold. Kan trigge deploys, ikke prod-secrets

**3. Nyt: tre dokumenter er kommet til** og bør stå i referencelisten:
- `RISIKOREGISTER.md` — risici, principper, "færdig"-tjekliste, plan og kapacitet
- `HAENDELSESLOG.md` — append-only log over sikkerhedshændelser
- `gdpr.xlsx` — fortegnelse, leverandører, slettepolitik

**4. Udestående punkt 25(b)** — manifest `short_name`-tjekket — er nu planlagt som opvarmningsopgave for Claude Code (dag 1½ i planen).
