-- =====================================================================
-- Migration A — Kundelag + opgavelag
-- Dit Digitale Kontor · tilbudsmodul
--
-- Denne migration RØRER eksisterende data (leads). Den skal køres FØR
-- pilotkunder sættes på, mens leads-tabellen stadig er lille.
--
-- Rækkefølge: staging → røgtest → prod (via push-script, aldrig db reset).
-- Denne fil må efter anvendelse ALDRIG omdøbes eller slettes.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 0. Fælles hjælpere
-- ---------------------------------------------------------------------

-- Returnerer de firmaer den aktuelle bruger tilhører.
-- SECURITY DEFINER, så opslaget i firm_users ikke selv rammer RLS
-- (samme grund som den eksisterende leads-traversal-helper).
-- STABLE + set search_path = fast praksis mod search_path-angreb.
create or replace function public.mine_firmaer()
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select fu.firm_id
  from public.firm_users fu
  where fu.user_id = auth.uid()
$$;

revoke all on function public.mine_firmaer() from public, anon;
grant execute on function public.mine_firmaer() to authenticated;


-- Fælles updated_at-trigger. Bruges af alle nye tabeller.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 1. kunder — den varige identitet
-- ---------------------------------------------------------------------

create table if not exists public.kunder (
  id            uuid primary key default gen_random_uuid(),
  firm_id       uuid not null references public.firms(id) on delete cascade,

  navn          text not null,
  telefon       text,            -- E.164, normaliseret med normalizePhone
  email         text,
  noter         text,

  -- Adresse: visningsstreng OG strukturerede felter, begge skrevet direkte
  -- fra DAWA-svaret. Ingen af dem udledes af den anden.
  -- Regel: koden må ALDRIG splitte adresse på komma. Det var kilden til
  -- postnr/by-fejlene i dashboardet.
  adresse       text,            -- DAWA adressebetegnelse, til visning og PDF
  vejnavn       text,
  husnr         text,            -- text, ikke integer: "12B" findes
  etage         text,
  doer          text,
  postnr        text,            -- text: identifikator, ikke et tal
  by            text,            -- DAWA postnrnavn
  dawa_id       uuid,            -- så den kanoniske adresse altid kan hentes igen

  cvr           text,            -- erhvervskunder; valgfrit
  er_erhverv    boolean not null default false,

  arkiveret_at  timestamptz,     -- soft delete; rækken slettes aldrig hårdt
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- Unikt telefonnummer pr. firma — men kun for AKTIVE kunder med et nummer.
-- Partial index: NULL-numre tillades i ubegrænset antal, og en arkiveret
-- kunde blokerer ikke for at nummeret genbruges.
-- Dette er den constraint der lukker opkaldsmatchings-spøgelset.
create unique index if not exists kunder_firma_telefon_unik
  on public.kunder (firm_id, telefon)
  where telefon is not null and arkiveret_at is null;

create index if not exists kunder_firm_id_idx on public.kunder (firm_id);
create index if not exists kunder_navn_idx    on public.kunder (firm_id, lower(navn));

drop trigger if exists kunder_updated_at on public.kunder;
create trigger kunder_updated_at
  before update on public.kunder
  for each row execute function public.set_updated_at();


-- ---------------------------------------------------------------------
-- 2. leads bliver opgavelaget (expand — intet fjernes, intet ændres)
-- ---------------------------------------------------------------------

alter table public.leads
  add column if not exists firm_id    uuid references public.firms(id) on delete cascade,
  add column if not exists kunde_id   uuid references public.kunder(id) on delete set null,
  add column if not exists titel      text,
  add column if not exists updated_at timestamptz not null default now();

-- Hvorfor firm_id direkte på leads:
--   I dag udledes firmaet via leads.call_id -> calls.firm_id. Det bryder for
--   manuelt oprettede opgaver (call_id er nullable), og det gør enhver
--   RLS-politik og ethvert unikt indeks pr. firma til en join.
--   Bagefter er alle nye tabeller ensartede: firm_id direkte, én politik-form.
--
-- Hvorfor kunde_id er ON DELETE SET NULL (ikke CASCADE):
--   At slette en kunde må aldrig slette firmaets opgavehistorik.

-- Backfill fra calls. Dækker kun leads MED et opkald.
update public.leads l
set    firm_id = c.firm_id
from   public.calls c
where  l.call_id = c.id
  and  l.firm_id is null;

create index if not exists leads_firm_id_idx  on public.leads (firm_id);
create index if not exists leads_kunde_id_idx on public.leads (kunde_id);

drop trigger if exists leads_updated_at on public.leads;
create trigger leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- BEMÆRK: firm_id gøres IKKE not null her. Det sker i en senere migration,
-- efter at al kode skriver kolonnen. Se kontroller nederst i filen.


-- ---------------------------------------------------------------------
-- 3. RLS på kunder — læsning for brugeren, skrivning kun server-side
-- ---------------------------------------------------------------------

alter table public.kunder enable row level security;

drop policy if exists kunder_select on public.kunder;
create policy kunder_select
  on public.kunder for select
  to authenticated
  using (firm_id in (select public.mine_firmaer()));

-- Ingen insert/update/delete-politik: al skrivning går gennem backenden
-- med service-role-nøglen, præcis som messages i dag.
revoke insert, update, delete on public.kunder from anon, authenticated;
revoke all on public.kunder from anon;


-- ---------------------------------------------------------------------
-- Kontroller efter kørsel (kør manuelt, gem output)
-- ---------------------------------------------------------------------
-- 1) Leads uden firma efter backfill — skal være manuelt oprettede opgaver:
--      select count(*) from public.leads where firm_id is null;
--      select id, call_id, name, created_at from public.leads where firm_id is null;
--    Sæt firm_id manuelt på dem, ellers bliver de usynlige når politikken
--    senere skifter til firm_id.
--
-- 2) RLS aktiv:
--      select relname, relrowsecurity from pg_class where relname = 'kunder';
--
-- 3) PostgREST har set skemaet:
--      notify pgrst, 'reload schema';
