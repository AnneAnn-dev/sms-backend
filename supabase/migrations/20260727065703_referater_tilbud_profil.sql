-- =====================================================================
-- Migration B — Referater, tilbud, firmaprofil, standardfelter
-- Dit Digitale Kontor · tilbudsmodul
--
-- Kun NYE tabeller. Rører ingen eksisterende data og kan derfor køres
-- uden risiko for pilotdata. Forudsætter Migration A.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. referater — barn af opgaven (leads)
-- ---------------------------------------------------------------------

create table if not exists public.referater (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms(id) on delete cascade,
  lead_id       uuid not null references public.leads(id) on delete cascade,

  titel         text,
  moede_dato    date not null default current_date,

  -- Tre adskilte tekstfelter. Det er ikke overflod, det er sikkerhed:
  --   transskript = råteksten fra tale-til-tekst (leverandørens output)
  --   ai_udkast   = AI'ens forslag, gemt uændret så det kan sammenlignes
  --   indhold     = håndværkerens redigerede version = SANDHEDEN
  -- Uden adskillelsen vil en "generér igen"-knap overskrive rettelser.
  transskript   text,
  ai_udkast     text,
  indhold       text,

  -- Svarene på firmaets standardfelter. jsonb, fordi skemaet er
  -- brugerdefineret pr. branche og aldrig skal søges på tværs af.
  felter        jsonb not null default '{}'::jsonb,

  status        text not null default 'kladde',
  kilde         text not null default 'optagelse',
  varighed_sek  integer,

  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint referater_status_gyldig check (status in ('kladde','faerdig')),
  constraint referater_kilde_gyldig  check (kilde in ('optagelse','upload','manuel'))
);

-- BEVIDST FRAVÆR: ingen lyd_url / audio_path.
-- Lyd persisteres aldrig efter transskription (dataminimering).
-- Hvis en kolonne til lyd nogensinde tilføjes, skal det være en
-- eksplicit beslutning med sletterutine — ikke et sidefald.

create index if not exists referater_lead_idx on public.referater (lead_id, created_at desc);
create index if not exists referater_firm_idx on public.referater (firm_id, created_at desc);

drop trigger if exists referater_updated_at on public.referater;
create trigger referater_updated_at
  before update on public.referater
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 2. tilbud — barn af opgaven, versioneret
-- ---------------------------------------------------------------------

create table if not exists public.tilbud (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references public.firms(id) on delete cascade,
  lead_id        uuid not null references public.leads(id) on delete cascade,
  referat_id     uuid references public.referater(id) on delete set null,

  nummer         text,                 -- tilbudsnummer, synligt for kunden
  version        integer not null default 1,
  status         text not null default 'kladde',

  gyldig_til     date,
  indledning     text,
  betingelser    text,

  -- Alle beløb er numeric. Aldrig float — 0.1 + 0.2 må ikke kunne koste
  -- en håndværker en diskussion med sin kunde.
  moms_sats      numeric(5,2)  not null default 25.00,
  sum_ex_moms    numeric(12,2) not null default 0,
  sum_moms       numeric(12,2) not null default 0,
  sum_inkl_moms  numeric(12,2) not null default 0,

  pdf_sti        text,                 -- Storage-sti, ikke offentlig URL
  sendt_at       timestamptz,
  besvaret_at    timestamptz,

  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint tilbud_status_gyldig
    check (status in ('kladde','sendt','accepteret','afvist','udloebet'))
);

-- Summerne ligger på tilbuddet og beregnes IKKE på visningstidspunktet.
-- Et afsendt tilbud er et dokument kunden har set: det skal fryses.
-- Regel i koden: status <> 'kladde' => linjer er låst. Ændring = ny
-- række med version + 1, ikke en redigering af den gamle.

create unique index if not exists tilbud_nummer_unik
  on public.tilbud (firm_id, nummer) where nummer is not null;

create unique index if not exists tilbud_lead_version_unik
  on public.tilbud (lead_id, version);

create index if not exists tilbud_firm_status_idx on public.tilbud (firm_id, status, created_at desc);

drop trigger if exists tilbud_updated_at on public.tilbud;
create trigger tilbud_updated_at
  before update on public.tilbud
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 3. tilbud_linjer
-- ---------------------------------------------------------------------

create table if not exists public.tilbud_linjer (
  id           uuid primary key default gen_random_uuid(),
  tilbud_id    uuid not null references public.tilbud(id) on delete cascade,
  firm_id      uuid not null references public.firms(id) on delete cascade,

  sortering    integer not null default 0,
  type         text not null default 'arbejde',
  beskrivelse  text not null,
  antal        numeric(12,3) not null default 1,
  enhed        text not null default 'stk',
  enhedspris   numeric(12,2) not null default 0,
  rabat_pct    numeric(5,2)  not null default 0,

  linje_sum    numeric(12,2)
                 generated always as
                 (round(antal * enhedspris * (1 - rabat_pct / 100), 2)) stored,

  created_at   timestamptz not null default now(),

  constraint tilbud_linjer_type_gyldig check (type in ('arbejde','materiale','andet')),
  constraint tilbud_linjer_rabat_gyldig check (rabat_pct >= 0 and rabat_pct <= 100)
);

-- firm_id gentages her, selvom det kan udledes via tilbud_id.
-- Bevidst denormalisering: så bliver RLS-politikken ordret den samme
-- på alle seks tabeller, og et fejlskrevet join kan ikke lække data.

create index if not exists tilbud_linjer_tilbud_idx on public.tilbud_linjer (tilbud_id, sortering);


-- ---------------------------------------------------------------------
-- 4. firma_profil — én række pr. firma
-- ---------------------------------------------------------------------

create table if not exists public.firma_profil (
  firm_id                 uuid primary key references public.firms(id) on delete cascade,

  cvr                     text,
  adresse                 text,
  telefon                 text,
  email                   text,
  hjemmeside              text,
  logo_sti                text,

  bank_reg                text,
  bank_konto              text,

  timepris                numeric(12,2),
  moms_sats               numeric(5,2) not null default 25.00,
  standard_betingelser    text,
  standard_gyldighed_dage integer not null default 30,
  tilbud_naeste_nummer    integer not null default 1,

  -- Fritekst der lægges ind i prompten, så tilbudsudkast lyder som firmaet.
  ai_tone                 text,

  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

drop trigger if exists firma_profil_updated_at on public.firma_profil;
create trigger firma_profil_updated_at
  before update on public.firma_profil
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 5. standardfelter — pr. firma, ikke globalt
-- ---------------------------------------------------------------------

-- Skabelonerne pr. branche bor i koden (JSON i repoet) og KOPIERES ind
-- som rækker her, når firmaet oprettes. Alternativet — globale rækker med
-- firma-overrides — kræver flettelogik, og flettelogik der ikke kan ses
-- i UI'et er en fejlkilde. Her ejer hvert firma sine egne rækker og kan
-- rette dem frit uden at påvirke andre.

create table if not exists public.standardfelter (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references public.firms(id) on delete cascade,

  gruppe         text,                    -- fx "Badeværelse", "Tag"
  navn           text not null,           -- fx "Antal m² gulv"
  felttype       text not null default 'tekst',
  valgmuligheder jsonb,                   -- kun ved felttype = 'valg'
  sortering      integer not null default 0,
  aktiv          boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  constraint standardfelter_type_gyldig
    check (felttype in ('tekst','tal','ja_nej','valg'))
);

create index if not exists standardfelter_firm_idx
  on public.standardfelter (firm_id, sortering) where aktiv;

drop trigger if exists standardfelter_updated_at on public.standardfelter;
create trigger standardfelter_updated_at
  before update on public.standardfelter
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 6. RLS — samme mønster på alle fem tabeller
-- ---------------------------------------------------------------------

alter table public.referater      enable row level security;
alter table public.tilbud         enable row level security;
alter table public.tilbud_linjer  enable row level security;
alter table public.firma_profil   enable row level security;
alter table public.standardfelter enable row level security;

drop policy if exists referater_select on public.referater;
create policy referater_select on public.referater for select to authenticated
  using (firm_id in (select public.mine_firmaer()));

drop policy if exists tilbud_select on public.tilbud;
create policy tilbud_select on public.tilbud for select to authenticated
  using (firm_id in (select public.mine_firmaer()));

drop policy if exists tilbud_linjer_select on public.tilbud_linjer;
create policy tilbud_linjer_select on public.tilbud_linjer for select to authenticated
  using (firm_id in (select public.mine_firmaer()));

drop policy if exists firma_profil_select on public.firma_profil;
create policy firma_profil_select on public.firma_profil for select to authenticated
  using (firm_id in (select public.mine_firmaer()));

drop policy if exists standardfelter_select on public.standardfelter;
create policy standardfelter_select on public.standardfelter for select to authenticated
  using (firm_id in (select public.mine_firmaer()));

-- Al skrivning server-side med service-role. Ingen write-politikker.
revoke insert, update, delete
  on public.referater, public.tilbud, public.tilbud_linjer,
     public.firma_profil, public.standardfelter
  from anon, authenticated;

revoke all
  on public.referater, public.tilbud, public.tilbud_linjer,
     public.firma_profil, public.standardfelter
  from anon;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Kontroller efter kørsel
-- ---------------------------------------------------------------------
--   select relname, relrowsecurity
--   from pg_class
--   where relname in ('kunder','referater','tilbud','tilbud_linjer',
--                     'firma_profil','standardfelter');
--   -- alle skal vise true
--
-- Kør derefter rls-isolation-test.js udvidet med de nye tabeller,
-- før noget af dette går i prod.
