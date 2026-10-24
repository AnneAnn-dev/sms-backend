-- 20261018120000_kunde_telefoner.sql — kunder kendes på telefonnummer (D88, trin 1a)
--
-- Beslutning (Ann 18/10-26, D88): en opgave knyttes til sin kunde via
-- telefonnummeret. En kunde kan have FLERE numre — typisk en privatperson med
-- en ekstra arbejdstelefon. Ukendt nummer = ny kunde. Seks-linse-gennemgangen
-- 18/10 satte betingelserne; denne migration dækker (2) og (3):
--
--   (2) `kunde_telefoner` bliver ENESTE kilde til kundens numre. `kunder.telefon`
--       og dens unik-indeks bliver stående (expand/contract) og fjernes i en
--       senere release, når ingen kode skriver dem. Ingen udfyldning her:
--       numrene i `kunder.telefon` er tastet råt i Kunder-fanen og skal
--       normaliseres med SAMME funktion som alt andet (`kundeNoegle` i
--       phone.js). Det gør engangsscriptet i trin 1b — én normalisering, ikke
--       én i JS og en kopi i SQL.
--
--   (3) Find-eller-opret er ÉN databasefunktion, så samtidige kald med samme
--       nye nummer giver præcis én kunde. Og databasen sikrer selv, at en
--       kunde, dens numre og dens opgaver altid hører til SAMME firma
--       (sammensatte fremmednøgler) — ikke kun ruternes ejerskabstjek.
--
-- KUN TILFØJELSER. Intet eksisterende skifter betydning, og intet kalder
-- funktionen endnu: `/formular` og `/opret-opgave` kobles på i trin 1b bag
-- flaget KUNDE_MATCH_AKTIV.
--
-- KAN RULLES TILBAGE, så længe trin 1b ikke har skrevet data:
--   drop function if exists public.find_eller_opret_kunde(uuid, text, text, text);
--   alter table public.leads drop constraint if exists leads_kunde_samme_firma;
--   drop table if exists public.kunde_telefoner;
--   alter table public.kunder drop constraint if exists kunder_id_firm_unik;
-- Efter trin 1b ligger der rækker i `kunde_telefoner`; så skal de tages med
-- åbne øjne.
--
-- KRÆVER Postgres 15+ (`on delete set null (kunde_id)` med kolonneliste).
-- Fejler migrationen på den linje, er projektet ældre — stop og spørg.


-- 1. Mål for de sammensatte fremmednøgler ------------------------------------
-- (id, firm_id) er allerede entydigt, fordi id er primærnøgle. Begrænsningen
-- findes kun, for at andre tabeller kan pege på PARRET.
-- Tilføjes kun, hvis den mangler: den kan ikke droppes og genskabes, når
-- fremmednøglerne nedenfor først peger på den.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'kunder_id_firm_unik') then
    alter table public.kunder add constraint kunder_id_firm_unik unique (id, firm_id);
  end if;
end $$;


-- 2. Kundens telefonnumre ---------------------------------------------------
create table if not exists public.kunde_telefoner (
  id          uuid        primary key default gen_random_uuid(),
  firm_id     uuid        not null references public.firms(id) on delete cascade,
  kunde_id    uuid        not null,
  telefon     text        not null,   -- E.164, ALTID fra kundeNoegle() i phone.js
  created_at  timestamptz not null default now(),

  -- Nummeret hører til en kunde i SAMME firma. Slettes kunden, går numrene
  -- med (en hård sletning skal være hård — J4).
  constraint kunde_telefoner_kunde_fk
    foreign key (kunde_id, firm_id) references public.kunder (id, firm_id)
    on delete cascade,

  -- Kun et rigtigt E.164-nummer. Fanger markører som "Manuel oprettelse",
  -- hvis en kalder nogensinde glemmer kundeNoegle().
  constraint kunde_telefoner_format check (telefon ~ '^\+[1-9][0-9]{6,14}$'),

  -- Ét nummer = én kunde pr. firma. Dette er reglen, matchningen hviler på.
  constraint kunde_telefoner_firma_telefon_unik unique (firm_id, telefon)
);

create index if not exists kunde_telefoner_kunde_idx on public.kunde_telefoner (kunde_id);


-- 3. RLS — samme form som `kunder`: læsning for brugeren, skrivning kun serveren
alter table public.kunde_telefoner enable row level security;

drop policy if exists kunde_telefoner_select on public.kunde_telefoner;
create policy kunde_telefoner_select
  on public.kunde_telefoner for select
  to authenticated
  using (firm_id in (select public.mine_firmaer()));

revoke insert, update, delete on public.kunde_telefoner from anon, authenticated;
revoke all on public.kunde_telefoner from anon;
grant all on public.kunde_telefoner to service_role;


-- 4. En opgaves kunde hører til opgavens firma -------------------------------
-- Den eksisterende fremmednøgle (leads.kunde_id -> kunder.id) bliver stående.
-- Denne tilføjer, at PARRET skal passe. `set null (kunde_id)`: slettes kunden,
-- mister opgaven sin kunde — men ALDRIG sit firm_id (en almindelig sammensat
-- `set null` ville også nulstille firm_id og gøre opgaven usynlig).
-- Opgaver med firm_id null tjekkes ikke (MATCH SIMPLE) — de findes ikke i nye
-- rækker, og firm_id NOT NULL er sit eget punkt.
do $$
declare n integer;
begin
  select count(*) into n
    from public.leads l
    join public.kunder k on k.id = l.kunde_id
   where l.firm_id is not null
     and l.firm_id <> k.firm_id;
  if n > 0 then
    raise exception 'STOP: % opgave(r) peger på en kunde i et ANDET firma. Ret dem, før migrationen køres igen.', n;
  end if;
end $$;

alter table public.leads drop constraint if exists leads_kunde_samme_firma;
alter table public.leads add constraint leads_kunde_samme_firma
  foreign key (kunde_id, firm_id) references public.kunder (id, firm_id)
  on delete set null (kunde_id);


-- 5. Find eller opret kunde ---------------------------------------------------
-- Kaldes KUN af serveren (service_role). Klienten kan ikke kalde den.
--
--   p_telefon = resultatet af kundeNoegle() — E.164 eller NULL. Funktionen
--               normaliserer IKKE selv; det gør phone.js, ét sted.
--
-- Regler (D88):
--   * kendt nummer hos en AKTIV kunde  -> den kunde (ny = false). Navn og
--     adresse røres IKKE — det, en fremmed taster i formularen, må aldrig
--     overskrive en eksisterende kundes stamdata (betingelse 6).
--   * kendt nummer hos en ARKIVERET kunde -> nummeret flyttes til en ny kunde.
--     Kun aktive kunder matches.
--   * ukendt nummer -> ny kunde med nummeret.
--   * intet nummer  -> altid ny kunde (dubletter accepteres indtil "læg sammen").
--
-- Samtidighed: en advisory-lås pr. (firma, nummer) for resten af transaktionen.
-- To samtidige kald med samme nye nummer venter på hinanden; den anden finder
-- den første kundes nummer. Ingen forældreløs kunde, intet genforsøg i JS.
create or replace function public.find_eller_opret_kunde(
  p_firm    uuid,
  p_telefon text,
  p_navn    text,
  p_adresse text
)
returns table (kunde_id uuid, ny boolean)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_kunde  uuid;
  v_arkiv  timestamptz;
  v_navn   text := coalesce(nullif(btrim(p_navn), ''), 'Ukendt kunde');
  v_adr    text := nullif(btrim(p_adresse), '');
begin
  if p_firm is null then
    raise exception 'find_eller_opret_kunde: p_firm mangler' using errcode = '22004';
  end if;

  if p_telefon is null then
    insert into public.kunder (firm_id, navn, adresse)
    values (p_firm, v_navn, v_adr)
    returning id into v_kunde;
    return query select v_kunde, true;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_firm::text || '|' || p_telefon, 0));

  select kt.kunde_id, k.arkiveret_at
    into v_kunde, v_arkiv
    from public.kunde_telefoner kt
    join public.kunder k on k.id = kt.kunde_id
   where kt.firm_id = p_firm
     and kt.telefon = p_telefon;

  if v_kunde is not null and v_arkiv is null then
    return query select v_kunde, false;
    return;
  end if;

  if v_kunde is not null then
    delete from public.kunde_telefoner
     where firm_id = p_firm and telefon = p_telefon;
  end if;

  insert into public.kunder (firm_id, navn, adresse)
  values (p_firm, v_navn, v_adr)
  returning id into v_kunde;

  insert into public.kunde_telefoner (firm_id, kunde_id, telefon)
  values (p_firm, v_kunde, p_telefon);

  return query select v_kunde, true;
end;
$$;

revoke all on function public.find_eller_opret_kunde(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.find_eller_opret_kunde(uuid, text, text, text) to service_role;


-- ---------------------------------------------------------------------
-- Kontroller efter kørsel (kør manuelt i SQL-editoren, gem output)
-- ---------------------------------------------------------------------
-- 1) RLS aktiv:
--      select relname, relrowsecurity from pg_class where relname = 'kunde_telefoner';
-- 2) Begrænsningerne findes:
--      select conname from pg_constraint
--       where conname in ('kunder_id_firm_unik','kunde_telefoner_kunde_fk',
--                         'kunde_telefoner_format','kunde_telefoner_firma_telefon_unik',
--                         'leads_kunde_samme_firma');
-- 3) Kun serveren kan kalde funktionen:
--      select has_function_privilege('authenticated',
--        'public.find_eller_opret_kunde(uuid,text,text,text)', 'execute');   -- false
-- 4) PostgREST har set skemaet:
--      notify pgrst, 'reload schema';
-- Resten bevises af proev-kunde-telefoner.js.
