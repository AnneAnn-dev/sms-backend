-- =====================================================================
-- Migration C — AI-forbrug og kvoteloft (Ø2)
-- Dit Digitale Kontor · tilbudsmodul
--
-- Én NY tabel + én NY kolonne. Rører ingen eksisterende data.
-- Forudsætter Migration B (firma_profil, mine_firmaer(), set_updated_at()).
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. ai_forbrug — én række pr. BETALT kald
-- ---------------------------------------------------------------------

-- BESLUTTET 29/9 (Ann): loftet er ikke en mur midt i et kald. Et kald, der
-- er sat i gang, køres færdigt; DEREFTER spærres firmaet, indtil loftet
-- hæves. Begrundelsen er brugeren: lyden findes kun i hans browser, og et
-- afslag midt i en diktering koster ham hans arbejde. Overskridelsen er
-- bundet af ét kalds pris, og den binding holdes af AI_KALD_LOFT_DKK —
-- intet enkelt kald må kunne koste mere end det.
--
-- Konsekvensen for denne tabel: kvoten kan afgøres alene ud fra de
-- FAKTISKE priser, der allerede står her. Ingen forhåndsskøn af lydens
-- længde, ingen tillid til klienten, intet at kalibrere.

create table if not exists public.ai_forbrug (
  id           uuid primary key default gen_random_uuid(),
  firm_id      uuid not null references public.firms(id) on delete cascade,

  formaal      text not null,           -- hvilket af S6's fire endpoints
  leverandoer  text not null,           -- som adapteren rapporterer den
  model        text not null,           -- eksplicit version, aldrig et alias (D14)

  -- Mængden i leverandørens EGEN enhed, ikke omregnet. Scaleway afregner
  -- pr. lydminut, syv.ai pr. lydtime, en tredje kan afregne pr. kald.
  -- Gemmes råt, så et forbrug fra i går stadig kan efterregnes i morgen.
  enhed        text not null,
  maengde      numeric(14,3) not null,

  -- Den FAKTISKE pris, som adapteren beregnede den. Øre, ikke kroner:
  -- et kald koster 6 øre, og kroner med to decimaler taber det.
  pris_oere    numeric(12,2) not null,

  created_at   timestamptz not null default now(),

  constraint ai_forbrug_formaal_gyldig
    check (formaal in ('transskription','referat','tilbud','notefoto')),
  constraint ai_forbrug_enhed_gyldig
    check (enhed in ('lydsekund','lydminut','lydtime','token','kald')),
  constraint ai_forbrug_pris_positiv check (pris_oere >= 0),
  constraint ai_forbrug_maengde_positiv check (maengde >= 0)
);

-- BEVIDST FRAVÆR: ingen transskript, intet referat, ingen prompt, intet
-- filnavn, intet lead_id. En forbrugstabel er præcis den slags, man senere
-- eksporterer til et regneark uden at tænke over det — rækken skal kunne
-- ligge på en projektor. Persondata hører til i referater, bag RLS.
--
-- BEVIDST FRAVÆR nr. 2: ingen updated_at og ingen trigger. En forbrugsrække
-- er en hændelse, ikke en tilstand. Den rettes aldrig. Er den forkert,
-- skrives en ny række — så kan det ses, at der blev rettet.

-- Indekserne er skrevet til de to forespørgsler, kvote.js laver: firmaets
-- forbrug i denne måned, og hele platformens forbrug i denne måned/dette døgn.
create index if not exists ai_forbrug_firma_tid_idx
  on public.ai_forbrug (firm_id, created_at desc);

create index if not exists ai_forbrug_tid_idx
  on public.ai_forbrug (created_at desc);

-- ⚠️ MÅNEDSGRÆNSEN BEREGNES I kvote.js, IKKE HER.
-- Besluttet 29/9: månedsskiftet følger DANSK TID (Europe/Copenhagen), ikke
-- UTC — et regnskab, der skifter måned klokken to om natten, kan ikke
-- forklares. kvote.js regner grænsen ud og sender et absolut tidspunkt med
-- i forespørgslen. Gør man det modsatte — date_trunc(... at time zone ...)
-- inde i where-klausulen — kan indekset ovenfor ikke bruges, og
-- forespørgslen bliver langsommere, hver gang tabellen vokser.


-- ---------------------------------------------------------------------
-- 2. firma_profil — månedsloftet
-- ---------------------------------------------------------------------

alter table public.firma_profil
  add column if not exists ai_maanedsloft_dkk numeric(12,2);

alter table public.firma_profil
  add column if not exists ai_dagsloft_dkk numeric(12,2);

comment on column public.firma_profil.ai_maanedsloft_dkk is
  'Firmaets AI-månedsloft i kroner. NULL = brug standardloftet fra miljøet '
  '(AI_FIRMA_MAANEDSLOFT_DKK). Sættes pr. række, når et firma skal have et '
  'andet loft end standarden. Loftet er den grænse, hvorefter NÆSTE kald '
  'afvises — det kald, der passerer grænsen, køres færdigt.';

comment on column public.firma_profil.ai_dagsloft_dkk is
  'Firmaets AI-dagsloft i kroner. NULL = AI_FIRMA_DAGSLOFT_DKK fra miljøet. '
  'Besluttet 29/9 at dagsloftet er PR. FIRMA og ikke globalt: et globalt '
  'dagsloft ville lukke for alle firmaer, fordi ét havde en dårlig dag. '
  'Dagsloftets formål er at beskytte firmaet mod, at en enkelt dags fejl '
  'bruger hele månedens budget og spærrer dem i tredive dage.';

-- Tallet står med vilje IKKE som en default her. Primeren: "pris pr.
-- kald/minut læses fra én central konfiguration, aldrig hardcodet".
-- Samme gælder loftet: en default i skemaet er et tal, der kun kan ændres
-- med en migration, og som ikke kan være forskelligt i staging og prod.


-- ---------------------------------------------------------------------
-- 3. RLS — samme mønster som de øvrige seks tabeller
-- ---------------------------------------------------------------------

alter table public.ai_forbrug enable row level security;

drop policy if exists ai_forbrug_select on public.ai_forbrug;
create policy ai_forbrug_select on public.ai_forbrug for select to authenticated
  using (firm_id in (select public.mine_firmaer()));

-- Al skrivning server-side med service-role. Ingen write-politikker.
-- Her er det skarpere end på de øvrige tabeller: kunne en klient skrive i
-- ai_forbrug, kunne den skrive sit eget forbrug ned.
revoke insert, update, delete on public.ai_forbrug from anon, authenticated;
revoke all                     on public.ai_forbrug from anon;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Kontroller efter kørsel
-- ---------------------------------------------------------------------
--   select relname, relrowsecurity from pg_class where relname = 'ai_forbrug';
--   -- skal vise true
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_name = 'firma_profil' and column_name = 'ai_maanedsloft_dkk';
--   -- skal vise numeric, YES
--
-- Kør derefter rls-isolation-test.js udvidet med ai_forbrug, før prod.
