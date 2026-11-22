-- tilbud_fase5.sql — Fase 5 Tilbud, spor 1, trin A (én migration)
--
-- Grundlag: docs/fase5-tilbud-byggeplan.md (28.943 bytes, 21/11-26), afsnittet
-- "Databasen" og beslutning #5–#17, og docs/fase5-tilbud-kontrakt.md (udkast 9,
-- godkendt af Ann 21/11). Skemaet før migrationen er målt 20/11 (trin 0) i
-- staging og prod — de er ens. Afprøvet mod lokal Postgres 16 før levering
-- (proev-tilbud-skema.js mod staging bagefter).
--
-- IKKE KUN ADDITIV (A12). Den fjerner tilbud.referat_id, tilbud.nummer,
-- tilbud.sum_*, tilbud.besvaret_at, tilbud_linjer.linje_sum, .rabat_pct,
-- .enhedspris og .enhed, ændrer status-check og trækker rettigheder tilbage.
-- `git grep` 21/11 på origin/main (61dbd1a) og origin/staging (a9403e1): kun
-- proev-forloeb.js og rls-isolation-test.js bruger kolonnerne; de rettes i
-- samme levering. Ingen produktionskode rører tabellerne.
--
-- Derfor kører den KUN, når tilbud og tilbud_linjer er tomme (vagten herunder).
-- Rollback nederst i filen — virker, så længe tilbud er tom.
--
-- leads er en levende tabel: den får kun en ny kolonne (oprettet_via, nullable)
-- og et unikt indeks (id, firm_id), som de sammensatte fremmednøgler kræver.

-- 0. Vagt ---------------------------------------------------------------------
do $$
begin
  if exists (select 1 from public.tilbud) or exists (select 1 from public.tilbud_linjer) then
    raise exception 'STOP: tilbud eller tilbud_linjer har rækker. Migrationen omlægger kolonner og må kun køre på tomme tabeller.';
  end if;
end $$;

-- 1. Hvor opgaven kom fra (A14, kontrakt §4) ----------------------------------
alter table public.leads add column if not exists oprettet_via text;
alter table public.leads drop constraint if exists leads_oprettet_via_gyldig;
alter table public.leads add constraint leads_oprettet_via_gyldig
  check (oprettet_via is null or oprettet_via in ('kundeformular', 'ny_opgave', 'tilbud'));
-- Udfyldning (målt i prod 21/11): rigtigt opkald -> kundeformular; den
-- syntetiske opkaldsrække fra /opret-opgave (to_number = '') -> ny_opgave;
-- intet opkald (POST /api/tilbud/opgaver) -> tilbud. Ukendt behandles som
-- kundeformular i koden.
update public.leads l
   set oprettet_via = case when c.to_number = '' then 'ny_opgave' else 'kundeformular' end
  from public.calls c
 where c.id = l.call_id and l.oprettet_via is null;
update public.leads set oprettet_via = 'tilbud' where call_id is null and oprettet_via is null;
-- authenticated får IKKE skriveret på kolonnen: leads' kolonne-grants (S35) er
-- fail-closed for nye kolonner.

-- Unikke nøgler, som de sammensatte fremmednøgler peger på (A6).
create unique index if not exists leads_id_firm_unik on public.leads (id, firm_id);
alter table public.leads drop constraint if exists leads_id_firm_unik;
alter table public.leads add constraint leads_id_firm_unik unique using index leads_id_firm_unik;
create unique index if not exists referater_id_lead_unik on public.referater (id, lead_id);
alter table public.referater drop constraint if exists referater_id_lead_unik;
alter table public.referater add constraint referater_id_lead_unik unique using index referater_id_lead_unik;

-- 2. Profilen (#5, #6, #7, A8) ------------------------------------------------
alter table public.firma_profil
  add column if not exists koersel_km_sats_oere bigint,
  add column if not exists koersel_fast_oere    bigint;
alter table public.firma_profil drop constraint if exists firma_profil_koersel_positiv;
alter table public.firma_profil add constraint firma_profil_koersel_positiv
  check ((koersel_km_sats_oere is null or koersel_km_sats_oere >= 0) and (koersel_fast_oere is null or koersel_fast_oere >= 0));
alter table public.firma_profil drop constraint if exists firma_profil_naeste_nummer_graense;
alter table public.firma_profil add constraint firma_profil_naeste_nummer_graense
  check (tilbud_naeste_nummer between 1 and 999999999);
alter table public.firma_profil drop constraint if exists firma_profil_gyldighed_graense;
alter table public.firma_profil add constraint firma_profil_gyldighed_graense
  check (standard_gyldighed_dage between 1 and 365);

-- 3. Enheder (A9, #11) ---------------------------------------------------------
create table if not exists public.enheder (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid references public.firms(id) on delete cascade,     -- null = grundlisten
  navn       text not null constraint enheder_navn_laengde check (char_length(btrim(navn)) between 1 and 30),
  navn_norm  text generated always as (lower(regexp_replace(btrim(navn), '\s+', ' ', 'g'))) stored,
  aktiv      boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists enheder_navn_unik
  on public.enheder (coalesce(firm_id, '00000000-0000-0000-0000-000000000000'::uuid), navn_norm);
insert into public.enheder (firm_id, navn)
select null, v from unnest(array['stk.', 'm', 'cm', 'm²', 'm³', 'kg', 'timer', 'dag', 'sæt']) as v
on conflict do nothing;

-- 4. Opgavetyper (#11) ---------------------------------------------------------
create table if not exists public.opgavetyper (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id) on delete cascade,
  navn       text not null constraint opgavetyper_navn_laengde check (char_length(btrim(navn)) between 1 and 60),
  navn_norm  text generated always as (lower(regexp_replace(btrim(navn), '\s+', ' ', 'g'))) stored,
  enhed_id   uuid not null references public.enheder(id),
  aktiv      boolean not null default true,
  created_at timestamptz not null default now(),
  constraint opgavetyper_id_firm_unik unique (id, firm_id)
);
create unique index if not exists opgavetyper_navn_unik on public.opgavetyper (firm_id, navn_norm, enhed_id);

-- En enhed må kun bruges af sit eget firma (grundlisten af alle).
create or replace function public.tjek_enhed_firma(p_enhed uuid, p_firm uuid) returns void
language plpgsql stable set search_path = public as $$
begin
  if p_enhed is not null and not exists (
       select 1 from public.enheder e where e.id = p_enhed and (e.firm_id is null or e.firm_id = p_firm)) then
    raise exception 'enhed_ikke_firmaets' using errcode = '23503';
  end if;
end $$;
create or replace function public.opgavetyper_tjek_enhed() returns trigger
language plpgsql set search_path = public as $$
begin perform public.tjek_enhed_firma(new.enhed_id, new.firm_id); return new; end $$;
drop trigger if exists opgavetyper_tjek_enhed on public.opgavetyper;
create trigger opgavetyper_tjek_enhed before insert or update of enhed_id, firm_id on public.opgavetyper
  for each row execute function public.opgavetyper_tjek_enhed();

-- 5. tilbud omlægges (kontrakt §1) --------------------------------------------
alter table public.tilbud drop constraint if exists tilbud_referat_id_fkey;
alter table public.tilbud drop constraint if exists tilbud_lead_id_fkey;
drop index if exists public.tilbud_lead_version_unik;
drop index if exists public.tilbud_nummer_unik;
alter table public.tilbud
  drop column if exists referat_id,
  drop column if exists nummer,
  drop column if exists sum_ex_moms,
  drop column if exists sum_moms,
  drop column if exists sum_inkl_moms,
  drop column if exists besvaret_at;

alter table public.tilbud
  add column kaede_id                    uuid not null default gen_random_uuid(),
  add column rev                         integer not null default 0,
  add column tilbudsnummer               integer,
  add column titel                       text,
  add column titel_kilde                 text,
  add column titel_bekraeftet            boolean not null default false,
  add column opgave_titel_forslag        text,
  add column opgave_titel_forslag_status text,
  add column opgavetype_id               uuid,
  add column opgavetype_navn             text,
  add column opgavetype_enhed            text,
  add column opgavetype_kilde            text,
  add column opgavetype_bekraeftet       boolean not null default false,
  add column maengde                     numeric(12,3),
  add column maengde_faktorer            numeric(12,3)[],
  add column maengde_kilde               text,
  add column maengde_bekraeftet          boolean not null default false,
  add column uenige                      jsonb not null default '[]'::jsonb,
  add column gyldig_dage                 integer,
  add column timepris_oere               bigint,
  add column koersel_form                text,
  add column koersel_km                  numeric(12,3),
  add column koersel_sats_oere           bigint,
  add column koersel_beloeb_oere         bigint,
  add column rabat_form                  text,
  add column rabat_procent               numeric(5,2),
  add column rabat_beloeb_oere           bigint,
  add column firma_navn                  text,
  add column firma_cvr                   text,
  add column firma_adresse               text,
  add column firma_telefon               text,
  add column firma_email                 text,
  add column firma_bank_reg              text,
  add column firma_bank_konto            text,
  add column kunde_navn                  text,
  add column kunde_arbejdssted           text,
  add column profil_kopieret_at          timestamptz,
  add column arbejde_oere                bigint not null default 0,
  add column materialer_oere             bigint not null default 0,
  add column koersel_oere                bigint not null default 0,
  add column andet_oere                  bigint not null default 0,
  add column foer_samlet_rabat_oere      bigint not null default 0,
  add column samlet_rabat_oere           bigint not null default 0,
  add column ex_moms_oere                bigint not null default 0,
  add column moms_oere                   bigint not null default 0,
  add column inkl_moms_oere              bigint not null default 0,
  add column kilde_beskrivelse_kopi      text,
  add column kilde_noter_kopi            text,
  add column kilder_lavet_at             timestamptz,
  add column erstatter_tilbudsnummer     integer,
  add column erstatter_godkendt_at       timestamptz,
  add column godkendt_at                 timestamptz,
  add column accepteret_at               timestamptz;

alter table public.tilbud drop constraint if exists tilbud_status_gyldig;
alter table public.tilbud add constraint tilbud_status_gyldig
  check (status in ('kladde', 'godkendt', 'sendt', 'accepteret', 'erstattet', 'afvist', 'udloebet'));
alter table public.tilbud add constraint tilbud_kilde_gyldig check (
      (titel_kilde is null or titel_kilde in ('model', 'haandvaerker'))
  and (opgavetype_kilde is null or opgavetype_kilde in ('model', 'haandvaerker'))
  and (maengde_kilde is null or maengde_kilde in ('model', 'haandvaerker')));
alter table public.tilbud add constraint tilbud_opgave_titel_status_gyldig
  check (opgave_titel_forslag_status is null or opgave_titel_forslag_status in ('afventer', 'accepteret', 'afvist'));
alter table public.tilbud add constraint tilbud_oere_positiv check (
      arbejde_oere >= 0 and materialer_oere >= 0 and koersel_oere >= 0 and andet_oere >= 0
  and foer_samlet_rabat_oere >= 0 and samlet_rabat_oere >= 0 and ex_moms_oere >= 0
  and moms_oere >= 0 and inkl_moms_oere >= 0
  and (timepris_oere is null or timepris_oere >= 0)
  and (koersel_sats_oere is null or koersel_sats_oere >= 0)
  and (koersel_beloeb_oere is null or koersel_beloeb_oere >= 0)
  and (rabat_beloeb_oere is null or rabat_beloeb_oere >= 0));
alter table public.tilbud add constraint tilbud_maengde_positiv
  check ((maengde is null or maengde >= 0) and (koersel_km is null or koersel_km >= 0));
alter table public.tilbud add constraint tilbud_koersel_form check (
     (koersel_form is null)
  or (koersel_form = 'km'   and koersel_beloeb_oere is null)
  or (koersel_form = 'fast' and koersel_km is null and koersel_sats_oere is null));
alter table public.tilbud add constraint tilbud_rabat_form check (
     (rabat_form is null and rabat_procent is null and rabat_beloeb_oere is null)
  or (rabat_form = 'procent' and rabat_procent between 0 and 100 and rabat_beloeb_oere is null)
  or (rabat_form = 'kroner'  and rabat_beloeb_oere is not null and rabat_procent is null));
alter table public.tilbud add constraint tilbud_gyldig_dage_graense
  check (gyldig_dage is null or gyldig_dage between 1 and 365);
alter table public.tilbud add constraint tilbud_uenige_liste check (jsonb_typeof(uenige) = 'array');

-- Firmabinding (A6): én fremmednøgle pr. tabelpar (PostgREST).
alter table public.tilbud add constraint tilbud_id_firm_unik unique (id, firm_id);
alter table public.tilbud add constraint tilbud_lead_firm_fkey
  foreign key (lead_id, firm_id) references public.leads (id, firm_id) on delete cascade;
alter table public.tilbud add constraint tilbud_opgavetype_firm_fkey
  foreign key (opgavetype_id, firm_id) references public.opgavetyper (id, firm_id);

-- Nummer, kæde og samtidighed (A3, #7, #15).
create unique index tilbud_nummer_unik on public.tilbud (firm_id, tilbudsnummer) where tilbudsnummer is not null;
create unique index tilbud_kaede_version_unik on public.tilbud (kaede_id, version);
create unique index tilbud_en_kladde_pr_kaede on public.tilbud (kaede_id) where status = 'kladde';
-- Én kæde pr. opgave i Fase 5 (#15) — fjernes, når alternativer kommer.
create unique index tilbud_en_kaede_pr_opgave on public.tilbud (lead_id) where version = 1;

-- 6. tilbud_linjer omlægges (kontrakt §2) --------------------------------------
alter table public.tilbud_linjer drop constraint if exists tilbud_linjer_tilbud_id_fkey;
alter table public.tilbud_linjer drop constraint if exists tilbud_linjer_rabat_gyldig;
alter table public.tilbud_linjer
  drop column if exists linje_sum,
  drop column if exists rabat_pct,
  drop column if exists enhedspris,
  drop column if exists enhed;
alter table public.tilbud_linjer alter column antal drop not null, alter column antal drop default;
alter table public.tilbud_linjer
  add column enhed_id          uuid references public.enheder(id),
  add column enhed_navn        text,
  add column enhed_ny          boolean not null default false,
  add column enhedspris_oere   bigint,
  add column rabat_form        text,
  add column rabat_procent     numeric(5,2),
  add column rabat_beloeb_oere bigint,
  add column brutto_oere       bigint,
  add column rabat_oere        bigint,
  add column linje_sum_oere    bigint,
  add column kilde             text not null default 'haandvaerker',
  add column bekraeftet        boolean not null default false,
  add column ordret            boolean not null default true,
  add column uenig             jsonb,
  add column updated_at        timestamptz not null default now();
alter table public.tilbud_linjer drop constraint if exists tilbud_linjer_type_gyldig;
alter table public.tilbud_linjer add constraint tilbud_linjer_type_gyldig
  check (type in ('arbejde', 'materiale', 'koersel', 'andet'));
alter table public.tilbud_linjer add constraint tilbud_linjer_kilde_gyldig check (kilde in ('model', 'haandvaerker'));
alter table public.tilbud_linjer add constraint tilbud_linjer_tal_positiv check (
      (antal is null or antal >= 0)
  and (enhedspris_oere is null or enhedspris_oere >= 0)
  and (brutto_oere is null or brutto_oere >= 0)
  and (rabat_oere is null or rabat_oere >= 0)
  and (linje_sum_oere is null or linje_sum_oere >= 0)
  and (rabat_beloeb_oere is null or rabat_beloeb_oere >= 0));
alter table public.tilbud_linjer add constraint tilbud_linjer_rabat_form check (
     (rabat_form is null and rabat_procent is null and rabat_beloeb_oere is null)
  or (rabat_form = 'procent' and rabat_procent between 0 and 100 and rabat_beloeb_oere is null)
  or (rabat_form = 'kroner'  and rabat_beloeb_oere is not null and rabat_procent is null));
alter table public.tilbud_linjer add constraint tilbud_linjer_beskrivelse_laengde
  check (char_length(beskrivelse) between 1 and 500);
alter table public.tilbud_linjer add constraint tilbud_linjer_tilbud_firm_fkey
  foreign key (tilbud_id, firm_id) references public.tilbud (id, firm_id) on delete cascade;
drop trigger if exists tilbud_linjer_updated_at on public.tilbud_linjer;
create trigger tilbud_linjer_updated_at before update on public.tilbud_linjer
  for each row execute function public.set_updated_at();
create or replace function public.tilbud_linjer_tjek_enhed() returns trigger
language plpgsql set search_path = public as $$
begin perform public.tjek_enhed_firma(new.enhed_id, new.firm_id); return new; end $$;
drop trigger if exists tilbud_linjer_tjek_enhed on public.tilbud_linjer;
create trigger tilbud_linjer_tjek_enhed before insert or update of enhed_id, firm_id on public.tilbud_linjer
  for each row execute function public.tilbud_linjer_tjek_enhed();

-- 7. Kilderne (#10, A5) --------------------------------------------------------
create table public.tilbud_kilder (
  id         uuid primary key default gen_random_uuid(),
  tilbud_id  uuid not null,
  firm_id    uuid not null,
  lead_id    uuid not null,
  referat_id uuid,
  nr         integer not null constraint tilbud_kilder_nr_positiv check (nr >= 1),
  dato       date,
  kilde      text,
  tekst_kopi text not null,
  created_at timestamptz not null default now(),
  constraint tilbud_kilder_tilbud_firm_fkey foreign key (tilbud_id, firm_id)
    references public.tilbud (id, firm_id) on delete cascade,
  constraint tilbud_kilder_referat_fkey foreign key (referat_id, lead_id)
    references public.referater (id, lead_id) on delete set null (referat_id),
  constraint tilbud_kilder_nr_unik unique (tilbud_id, nr)
);
-- Kildens opgave og firma skal være tilbuddets.
create or replace function public.tilbud_kilder_tjek() returns trigger
language plpgsql set search_path = public as $$
begin
  if not exists (select 1 from public.tilbud t
                  where t.id = new.tilbud_id and t.firm_id = new.firm_id and t.lead_id = new.lead_id) then
    raise exception 'kilde_ikke_tilbuddets' using errcode = '23503';
  end if;
  return new;
end $$;
create trigger tilbud_kilder_tjek before insert or update of tilbud_id, firm_id, lead_id on public.tilbud_kilder
  for each row execute function public.tilbud_kilder_tjek();

-- 8. Historikken (D13, A7) -----------------------------------------------------
create table public.tilbud_historik (
  id         uuid primary key default gen_random_uuid(),
  tilbud_id  uuid not null,
  firm_id    uuid not null,
  haendelse  text not null constraint tilbud_historik_haendelse_gyldig
             check (haendelse in ('godkendt', 'sendt', 'accepteret', 'erstattet', 'fortrudt')),
  fra_status text not null,
  til_status text not null,
  kopi       jsonb not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint tilbud_historik_tilbud_firm_fkey foreign key (tilbud_id, firm_id)
    references public.tilbud (id, firm_id) on delete cascade
);
create index tilbud_historik_tilbud_idx on public.tilbud_historik (tilbud_id, created_at);

-- 9. Forslagene (A13) ------------------------------------------------------------
create table public.tilbud_forslag (
  id             uuid primary key default gen_random_uuid(),
  tilbud_id      uuid not null,
  firm_id        uuid not null,
  model          text not null,
  prompt_version text not null,
  svar           jsonb,
  retry          boolean not null default false,
  svartid_ms     integer,
  tokens_ind     integer,
  tokens_ud      integer,
  created_at     timestamptz not null default now(),
  constraint tilbud_forslag_tilbud_firm_fkey foreign key (tilbud_id, firm_id)
    references public.tilbud (id, firm_id) on delete cascade
);
create index tilbud_forslag_tilbud_idx on public.tilbud_forslag (tilbud_id, created_at);

-- 10. Lås, statusskift og slettevej (A1, A2) -------------------------------------
-- Markeringerne er transaktionslokale (set_config(..., true)) og sættes kun af
-- funktionerne herunder. PostgREST eksponerer ikke set_config.
create or replace function public.ddk_markering(p_navn text) returns boolean
language sql stable as $$ select coalesce(current_setting(p_navn, true), '') = 'on' $$;

-- Efter kladde må kun disse kolonner ændres, og kun ad de tilladte skift (kontrakt §1).
create or replace function public.tilbud_laas() returns trigger
language plpgsql set search_path = public as $$
declare
  tilladt constant text[] := array['status', 'sendt_at', 'accepteret_at', 'rev', 'updated_at'];
  ok boolean;
begin
  if tg_op = 'DELETE' then
    if old.status = 'kladde' or public.ddk_markering('ddk.slettevej') then return old; end if;
    raise exception 'tilbud_laast: et godkendt tilbud kan kun slettes gennem slettevejen' using errcode = '42501';
  end if;

  if old.status = 'kladde' then
    if new.status = 'kladde' then return new; end if;
    if new.status = 'godkendt' and public.ddk_markering('ddk.godkender') then return new; end if;
    raise exception 'tilbud_statusskift: % -> % kun gennem godkend_tilbud()', old.status, new.status using errcode = '42501';
  end if;

  if (to_jsonb(new) - tilladt) is distinct from (to_jsonb(old) - tilladt) then
    raise exception 'tilbud_laast: kun status og hændelsernes tidsstempler må ændres efter kladde' using errcode = '42501';
  end if;
  if new.status is not distinct from old.status then
    return new;
  end if;
  if not public.ddk_markering('ddk.statusskift') then
    raise exception 'tilbud_statusskift: % -> % kun gennem tilbud_haendelse()', old.status, new.status using errcode = '42501';
  end if;
  ok := (old.status = 'godkendt' and new.status in ('sendt', 'accepteret', 'erstattet'))
     or (old.status = 'sendt'    and new.status in ('accepteret', 'erstattet', 'godkendt'))
     or (old.status = 'accepteret' and new.status in ('erstattet', 'sendt', 'godkendt'));
  if not ok then
    raise exception 'tilbud_statusskift: % -> % er ikke tilladt', old.status, new.status using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists tilbud_laas on public.tilbud;
create trigger tilbud_laas before update or delete on public.tilbud
  for each row execute function public.tilbud_laas();

-- Linjer og kilder kan kun ændres, mens tilbuddet er kladde.
create or replace function public.tilbud_barn_laas() returns trigger
language plpgsql set search_path = public as $$
declare
  v_status text;
  v_tilbud uuid := coalesce(new.tilbud_id, old.tilbud_id);
begin
  if tg_op = 'DELETE' and public.ddk_markering('ddk.slettevej') then return old; end if;
  select status into v_status from public.tilbud where id = v_tilbud;
  if v_status is null and tg_op = 'DELETE' then return old; end if;   -- forælderen er væk (kaskade fra en kladde)
  if v_status is distinct from 'kladde' then
    raise exception 'tilbud_laast: % kan kun ændres, mens tilbuddet er kladde', tg_table_name using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.tilbud_id is distinct from old.tilbud_id then
    raise exception 'tilbud_laast: en række kan ikke flyttes til et andet tilbud' using errcode = '42501';
  end if;
  return coalesce(new, old);
end $$;
create trigger tilbud_linjer_laas before insert or update or delete on public.tilbud_linjer
  for each row execute function public.tilbud_barn_laas();
create trigger tilbud_kilder_laas before insert or update or delete on public.tilbud_kilder
  for each row execute function public.tilbud_barn_laas();

-- Historikken er append-only — også for serveren (A7). Kun slettevejen sletter.
create or replace function public.tilbud_historik_laas() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'DELETE' and public.ddk_markering('ddk.slettevej') then return old; end if;
  raise exception 'tilbud_historik er append-only (%)', tg_op using errcode = '42501';
end $$;
create trigger tilbud_historik_laas before update or delete on public.tilbud_historik
  for each row execute function public.tilbud_historik_laas();
-- Kun godkend_tilbud() og tilbud_haendelse() skriver historik.
create or replace function public.tilbud_historik_kun_funktioner() returns trigger
language plpgsql set search_path = public as $$
begin
  if public.ddk_markering('ddk.godkender') or public.ddk_markering('ddk.statusskift') then return new; end if;
  raise exception 'tilbud_historik skrives kun af godkend_tilbud() og tilbud_haendelse()' using errcode = '42501';
end $$;
create trigger tilbud_historik_kun_funktioner before insert on public.tilbud_historik
  for each row execute function public.tilbud_historik_kun_funktioner();

-- TRUNCATE går uden om rækketriggere — afvises på alle tilbudstabeller.
create or replace function public.tilbud_ingen_truncate() returns trigger
language plpgsql as $$
begin raise exception 'TRUNCATE er ikke tilladt på %', tg_table_name using errcode = '42501'; end $$;
create trigger tilbud_ingen_truncate before truncate on public.tilbud
  for each statement execute function public.tilbud_ingen_truncate();
create trigger tilbud_linjer_ingen_truncate before truncate on public.tilbud_linjer
  for each statement execute function public.tilbud_ingen_truncate();
create trigger tilbud_kilder_ingen_truncate before truncate on public.tilbud_kilder
  for each statement execute function public.tilbud_ingen_truncate();
create trigger tilbud_historik_ingen_truncate before truncate on public.tilbud_historik
  for each statement execute function public.tilbud_ingen_truncate();

-- Startnummeret kan ikke sættes under det højeste, der er brugt (#7, A8).
create or replace function public.firma_profil_tjek_nummer() returns trigger
language plpgsql set search_path = public as $$
declare v_hoejeste integer;
begin
  if new.tilbud_naeste_nummer is distinct from old.tilbud_naeste_nummer then
    select max(tilbudsnummer) into v_hoejeste from public.tilbud where firm_id = new.firm_id;
    if v_hoejeste is not null and new.tilbud_naeste_nummer <= v_hoejeste then
      raise exception 'startnummer_for_lavt: højeste brugte tilbudsnummer er %', v_hoejeste using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists firma_profil_tjek_nummer on public.firma_profil;
create trigger firma_profil_tjek_nummer before update of tilbud_naeste_nummer on public.firma_profil
  for each row execute function public.firma_profil_tjek_nummer();

-- 11. Beregningen genregnet i databasen (#14, B1) --------------------------------
-- Koden regner og gemmer; godkend_tilbud() regner igen og afviser, hvis et tal
-- afviger. round() på numeric runder halve væk fra nul — samme regel som #14.
create or replace function public.tilbud_genregn(p_tilbud uuid)
returns table (afvigelse text)
language plpgsql stable set search_path = public as $$
declare
  t public.tilbud%rowtype;
  l record;
  v_brutto bigint; v_rabat bigint; v_netto bigint;
  s_arbejde bigint := 0; s_mat bigint := 0; s_koersel bigint := 0; s_andet bigint := 0;
  v_foer bigint; v_samlet bigint; v_ex bigint; v_moms bigint;
begin
  select * into t from public.tilbud where id = p_tilbud;
  for l in select * from public.tilbud_linjer where tilbud_id = p_tilbud order by sortering, id loop
    if l.antal is null or l.enhedspris_oere is null then
      afvigelse := format('linje %s: antal eller pris mangler', l.sortering); return next; continue;
    end if;
    v_brutto := round(l.antal * l.enhedspris_oere)::bigint;
    v_rabat  := case l.rabat_form when 'procent' then round(v_brutto * l.rabat_procent / 100)::bigint
                                  when 'kroner'  then l.rabat_beloeb_oere else 0 end;
    v_netto  := v_brutto - v_rabat;
    if v_netto < 0 then afvigelse := format('linje %s: rabatten gør linjen negativ', l.sortering); return next; end if;
    if l.brutto_oere is distinct from v_brutto or coalesce(l.rabat_oere, 0) <> v_rabat or l.linje_sum_oere is distinct from v_netto then
      afvigelse := format('linje %s: gemt %s/%s/%s, regnet %s/%s/%s', l.sortering,
                          l.brutto_oere, l.rabat_oere, l.linje_sum_oere, v_brutto, v_rabat, v_netto);
      return next;
    end if;
    case l.type
      when 'arbejde'   then s_arbejde := s_arbejde + v_netto;
      when 'materiale' then s_mat     := s_mat + v_netto;
      when 'koersel'   then s_koersel := s_koersel + v_netto;
      else                  s_andet   := s_andet + v_netto;
    end case;
  end loop;
  v_foer   := s_arbejde + s_mat + s_koersel + s_andet;
  v_samlet := case t.rabat_form when 'procent' then round(v_foer * t.rabat_procent / 100)::bigint
                                when 'kroner'  then t.rabat_beloeb_oere else 0 end;
  v_ex     := v_foer - v_samlet;
  if v_ex < 0 then afvigelse := 'rabatten gør tilbuddet negativt'; return next; end if;
  v_moms   := round(v_ex * t.moms_sats / 100)::bigint;
  if (t.arbejde_oere, t.materialer_oere, t.koersel_oere, t.andet_oere, t.foer_samlet_rabat_oere,
      t.samlet_rabat_oere, t.ex_moms_oere, t.moms_oere, t.inkl_moms_oere)
     is distinct from (s_arbejde, s_mat, s_koersel, s_andet, v_foer, v_samlet, v_ex, v_moms, v_ex + v_moms) then
    afvigelse := format('summer: gemt %s/%s/%s, regnet %s/%s/%s', t.ex_moms_oere, t.moms_oere, t.inkl_moms_oere,
                        v_ex, v_moms, v_ex + v_moms);
    return next;
  end if;
end $$;

-- 12. Godkendelse (A3, #2, #7, #13) --------------------------------------------
create or replace function public.godkend_tilbud(p_tilbud uuid, p_firm uuid, p_bruger uuid default null)
returns table (tilbud_id uuid, tilbudsnummer integer)
language plpgsql set search_path = public as $$
#variable_conflict use_column
declare
  t public.tilbud%rowtype;
  v_lead public.leads%rowtype;
  v_mangler text[] := '{}';
  v_afv text;
  v_nummer integer;
  v_forrige public.tilbud%rowtype;
begin
  select * into t from public.tilbud where id = p_tilbud and firm_id = p_firm for update;
  if not found then raise exception 'tilbud_findes_ikke' using errcode = 'P0002'; end if;
  if t.status <> 'kladde' then raise exception 'tilbud_ikke_kladde' using errcode = '42501'; end if;
  select * into v_lead from public.leads where id = t.lead_id and firm_id = p_firm;

  -- Det, kan_godkendes også tjekker (kontrakt §1, §3) — databasen tjekker igen.
  if not exists (select 1 from public.tilbud_linjer where tilbud_id = p_tilbud) then v_mangler := v_mangler || 'ingen linjer'; end if;
  if exists (select 1 from public.tilbud_linjer where tilbud_id = p_tilbud and not bekraeftet) then v_mangler := v_mangler || 'ubekræftede linjer'; end if;
  if exists (select 1 from public.tilbud_linjer where tilbud_id = p_tilbud and enhed_ny) then v_mangler := v_mangler || 'ny enhed ikke oprettet'; end if;
  if coalesce(btrim(t.titel), '') = '' or not t.titel_bekraeftet then v_mangler := v_mangler || 'titel ikke bekræftet'; end if;
  if t.opgavetype_navn is not null and (t.opgavetype_id is null or not t.opgavetype_bekraeftet) then v_mangler := v_mangler || 'opgavetype ikke bekræftet'; end if;
  if t.maengde is not null and not t.maengde_bekraeftet then v_mangler := v_mangler || 'mængde ikke bekræftet'; end if;
  if coalesce(btrim(t.firma_navn), '') = '' then v_mangler := v_mangler || 'firmanavn mangler'; end if;
  if coalesce(btrim(t.firma_cvr), '') = '' then v_mangler := v_mangler || 'CVR mangler'; end if;
  if t.gyldig_dage is null then v_mangler := v_mangler || 'gyldighed mangler'; end if;
  if coalesce(btrim(v_lead.name), '') = '' then v_mangler := v_mangler || 'kundens navn mangler'; end if;
  if coalesce(btrim(v_lead.address), '') = '' then v_mangler := v_mangler || 'arbejdssted mangler'; end if;
  if cardinality(v_mangler) > 0 then
    raise exception 'tilbud_mangler: %', array_to_string(v_mangler, '; ') using errcode = '23514';
  end if;
  select string_agg(afvigelse, '; ') into v_afv from public.tilbud_genregn(p_tilbud);
  if v_afv is not null then
    raise exception 'summer_passer_ikke: %', v_afv using errcode = '23514';
  end if;

  update public.firma_profil set tilbud_naeste_nummer = tilbud_naeste_nummer + 1
   where firm_id = p_firm returning tilbud_naeste_nummer - 1 into v_nummer;
  if v_nummer is null then raise exception 'firma_profil_mangler' using errcode = 'P0002'; end if;

  perform set_config('ddk.godkender', 'on', true);
  perform set_config('ddk.statusskift', 'on', true);

  -- Den version, den nye erstatter (#15, B16).
  select * into v_forrige from public.tilbud
   where kaede_id = t.kaede_id and version < t.version and status in ('godkendt', 'sendt', 'accepteret')
   order by version desc limit 1 for update;
  if found then
    update public.tilbud set status = 'erstattet', rev = rev + 1 where id = v_forrige.id;
    insert into public.tilbud_historik (tilbud_id, firm_id, haendelse, fra_status, til_status, kopi, created_by)
    values (v_forrige.id, p_firm, 'erstattet', v_forrige.status, 'erstattet',
            jsonb_build_object('erstattet_af', p_tilbud), p_bruger);
  end if;

  update public.tilbud
     set status = 'godkendt', godkendt_at = now(), tilbudsnummer = v_nummer, rev = rev + 1,
         gyldig_til = current_date + gyldig_dage,
         kunde_navn = v_lead.name, kunde_arbejdssted = v_lead.address,
         erstatter_tilbudsnummer = case when v_forrige.id is not null then v_forrige.tilbudsnummer end,
         erstatter_godkendt_at   = case when v_forrige.id is not null then v_forrige.godkendt_at end
   where id = p_tilbud;

  insert into public.tilbud_historik (tilbud_id, firm_id, haendelse, fra_status, til_status, kopi, created_by)
  select p_tilbud, p_firm, 'godkendt', 'kladde', 'godkendt',
         jsonb_build_object(
           'tilbud', to_jsonb(x),
           'linjer', coalesce((select jsonb_agg(to_jsonb(l) order by l.sortering, l.id) from public.tilbud_linjer l where l.tilbud_id = p_tilbud), '[]'::jsonb),
           'kilder', coalesce((select jsonb_agg(to_jsonb(k) order by k.nr) from public.tilbud_kilder k where k.tilbud_id = p_tilbud), '[]'::jsonb)),
         p_bruger
    from public.tilbud x where x.id = p_tilbud;

  return query select p_tilbud, v_nummer;
end $$;

-- 13. Hændelser: sendt, accepteret, fortrudt (#1, #2, A2) ------------------------
create or replace function public.tilbud_haendelse(p_tilbud uuid, p_firm uuid, p_haendelse text, p_bruger uuid default null)
returns text
language plpgsql set search_path = public as $$
declare
  t public.tilbud%rowtype;
  v_til text;
  v_seneste record;
begin
  select * into t from public.tilbud where id = p_tilbud and firm_id = p_firm for update;
  if not found then raise exception 'tilbud_findes_ikke' using errcode = 'P0002'; end if;

  if p_haendelse = 'sendt' and t.status = 'godkendt' then
    v_til := 'sendt';
  elsif p_haendelse = 'accepteret' and t.status in ('godkendt', 'sendt') then
    v_til := 'accepteret';
  elsif p_haendelse = 'fortrudt' and t.status in ('sendt', 'accepteret') then
    select fra_status into v_seneste from public.tilbud_historik
     where tilbud_id = p_tilbud and til_status = t.status and haendelse in ('sendt', 'accepteret')
     order by created_at desc, id desc limit 1;
    v_til := coalesce(v_seneste.fra_status, 'godkendt');
  else
    raise exception 'haendelse_ikke_tilladt: % fra %', p_haendelse, t.status using errcode = '42501';
  end if;

  perform set_config('ddk.statusskift', 'on', true);
  update public.tilbud
     set status = v_til, rev = rev + 1,
         sendt_at      = case when v_til = 'sendt' and p_haendelse = 'sendt' then now()
                              when p_haendelse = 'fortrudt' and t.status = 'sendt' then null
                              else sendt_at end,
         accepteret_at = case when v_til = 'accepteret' then now()
                              when p_haendelse = 'fortrudt' and t.status = 'accepteret' then null
                              else accepteret_at end
   where id = p_tilbud;
  insert into public.tilbud_historik (tilbud_id, firm_id, haendelse, fra_status, til_status, kopi, created_by)
  values (p_tilbud, p_firm, p_haendelse, t.status, v_til,
          jsonb_build_object('sendt_at', t.sendt_at, 'accepteret_at', t.accepteret_at), p_bruger);
  return v_til;
end $$;

-- 14. Slettevejen (#17, A1) ------------------------------------------------------
-- delete-firma.js sletter opkaldene først (calls -> firms er NO ACTION), og
-- leads.call_id kaskaderer til opgaverne og dermed tilbuddene. Begge sletninger
-- skal derfor ske her, inden for slettevejen, i én transaktion.
create or replace function public.slet_firma(p_firm uuid) returns integer
language plpgsql set search_path = public as $$
declare n integer;
begin
  perform set_config('ddk.slettevej', 'on', true);
  delete from public.calls where firm_id = p_firm;
  delete from public.firms where id = p_firm;
  get diagnostics n = row_count;
  return n;
end $$;

-- 15. Rettigheder og RLS (A6, A7, A8, trin 0) ------------------------------------
-- Funktionerne kaldes kun af serveren.
revoke all on function public.godkend_tilbud(uuid, uuid, uuid)     from public, anon, authenticated;
revoke all on function public.tilbud_haendelse(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function public.slet_firma(uuid)                     from public, anon, authenticated;
revoke all on function public.tilbud_genregn(uuid)                 from public, anon, authenticated;
revoke all on function public.tjek_enhed_firma(uuid, uuid)         from public, anon, authenticated;
revoke all on function public.ddk_markering(text)                  from public, anon, authenticated;
grant execute on function public.godkend_tilbud(uuid, uuid, uuid)     to service_role;
grant execute on function public.tilbud_haendelse(uuid, uuid, text, uuid) to service_role;
grant execute on function public.slet_firma(uuid)                     to service_role;
grant execute on function public.tilbud_genregn(uuid)                 to service_role;
grant execute on function public.tjek_enhed_firma(uuid, uuid)         to service_role;
grant execute on function public.ddk_markering(text)                  to service_role;

-- Klienten læser kun; alt skrives af serveren. Trin 0 fandt TRUNCATE, TRIGGER,
-- MAINTAIN og REFERENCES til authenticated — de fjernes her.
revoke all on table public.tilbud, public.tilbud_linjer, public.tilbud_kilder, public.tilbud_historik,
                    public.tilbud_forslag, public.opgavetyper, public.enheder,
                    public.firma_profil, public.referater, public.standardfelter
  from anon, authenticated;
grant select on table public.tilbud, public.tilbud_linjer, public.tilbud_kilder, public.tilbud_historik,
                      public.opgavetyper, public.enheder,
                      public.firma_profil, public.referater, public.standardfelter
  to authenticated;
-- tilbud_forslag: ingen rettighed for klienten overhovedet (modelsvar, A13).

alter table public.enheder         enable row level security;
alter table public.opgavetyper     enable row level security;
alter table public.tilbud_kilder   enable row level security;
alter table public.tilbud_historik enable row level security;
alter table public.tilbud_forslag  enable row level security;
create policy enheder_select on public.enheder for select to authenticated
  using (firm_id is null or firm_id in (select mine_firmaer()));
create policy opgavetyper_select on public.opgavetyper for select to authenticated
  using (firm_id in (select mine_firmaer()));
create policy tilbud_kilder_select on public.tilbud_kilder for select to authenticated
  using (firm_id in (select mine_firmaer()));
create policy tilbud_historik_select on public.tilbud_historik for select to authenticated
  using (firm_id in (select mine_firmaer()));

-- 16. Kontrol — stopper migrationen, hvis noget ikke står, som det skal ----------
do $$
declare v text;
begin
  -- Ingen tilbudstabel må have en skrivepolitik eller skriveret for klienten.
  select string_agg(tablename || '.' || policyname, ', ') into v from pg_policies
   where schemaname = 'public'
     and tablename in ('tilbud','tilbud_linjer','tilbud_kilder','tilbud_historik','tilbud_forslag','opgavetyper','enheder','firma_profil')
     and cmd <> 'SELECT';
  if v is not null then raise exception 'KONTROL: skrivepolitik fundet: %', v; end if;

  select string_agg(table_name || ':' || privilege_type || ':' || grantee, ', ') into v
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee in ('anon', 'authenticated')
     and table_name in ('tilbud','tilbud_linjer','tilbud_kilder','tilbud_historik','tilbud_forslag','opgavetyper','enheder','firma_profil','referater','standardfelter')
     and not (grantee = 'authenticated' and privilege_type = 'SELECT' and table_name <> 'tilbud_forslag');
  if v is not null then raise exception 'KONTROL: for brede rettigheder: %', v; end if;

  select string_agg(c.relname, ', ') into v from pg_class c
   where c.relnamespace = 'public'::regnamespace
     and c.relname in ('tilbud','tilbud_linjer','tilbud_kilder','tilbud_historik','tilbud_forslag','opgavetyper','enheder')
     and not c.relrowsecurity;
  if v is not null then raise exception 'KONTROL: RLS er ikke slået til på: %', v; end if;

  if (select count(*) from public.enheder where firm_id is null) <> 9 then
    raise exception 'KONTROL: grundlisten for enheder har ikke 9 rækker';
  end if;
  if exists (select 1 from public.leads where oprettet_via is null) then
    raise exception 'KONTROL: opgaver uden oprettet_via';
  end if;
  -- Præcis én fremmednøgle mellem hvert tabelpar (PostgREST-embedding).
  select string_agg(conrelid::regclass || '->' || confrelid::regclass, ', ') into v from (
    select conrelid, confrelid from pg_constraint
     where contype = 'f' and conrelid in ('public.tilbud'::regclass, 'public.tilbud_linjer'::regclass,
           'public.tilbud_kilder'::regclass, 'public.tilbud_historik'::regclass, 'public.tilbud_forslag'::regclass)
     group by conrelid, confrelid having count(*) > 1) d;
  if v is not null then raise exception 'KONTROL: mere end én fremmednøgle mellem: %', v; end if;
end $$;

-- ROLLBACK (kun mens tilbud er tom) -------------------------------------------------
-- Kør i SQL-editoren, hvis migrationen skal fjernes igen. Vagten stopper, hvis der
-- er kommet tilbud; så er rollback ikke længere en mulighed, og flaget slukkes i
-- stedet (byggeplanens Tilbagerulning).
--
-- do $$ begin if exists (select 1 from public.tilbud) then raise exception 'STOP: tilbud har rækker'; end if; end $$;
-- drop function if exists public.slet_firma(uuid), public.tilbud_haendelse(uuid, uuid, text, uuid),
--   public.godkend_tilbud(uuid, uuid, uuid), public.tilbud_genregn(uuid), public.firma_profil_tjek_nummer() cascade;
-- drop table if exists public.tilbud_forslag, public.tilbud_historik, public.tilbud_kilder cascade;
-- drop trigger if exists tilbud_laas on public.tilbud; drop trigger if exists tilbud_ingen_truncate on public.tilbud;
-- drop trigger if exists tilbud_linjer_laas on public.tilbud_linjer; drop trigger if exists tilbud_linjer_ingen_truncate on public.tilbud_linjer;
-- drop table if exists public.tilbud_linjer, public.tilbud cascade;
-- drop table if exists public.opgavetyper, public.enheder cascade;
-- drop function if exists public.tilbud_laas(), public.tilbud_barn_laas(), public.tilbud_historik_laas(),
--   public.tilbud_historik_kun_funktioner(), public.tilbud_ingen_truncate(), public.tilbud_kilder_tjek(),
--   public.tilbud_linjer_tjek_enhed(), public.opgavetyper_tjek_enhed(), public.tjek_enhed_firma(uuid, uuid),
--   public.ddk_markering(text) cascade;
-- alter table public.firma_profil drop constraint if exists firma_profil_koersel_positiv,
--   drop constraint if exists firma_profil_naeste_nummer_graense, drop constraint if exists firma_profil_gyldighed_graense,
--   drop column if exists koersel_km_sats_oere, drop column if exists koersel_fast_oere;
-- alter table public.referater drop constraint if exists referater_id_lead_unik;
-- alter table public.leads drop constraint if exists leads_id_firm_unik, drop constraint if exists leads_oprettet_via_gyldig,
--   drop column if exists oprettet_via;
-- Derefter genskabes tilbud og tilbud_linjer, som de var: kør afsnit 2 og 3
-- (tilbud, tilbud_linjer) og RLS-, politik- og grant-linjerne for de to tabeller
-- fra 20260727065703_referater_tilbud_profil.sql igen (de bruger "if not exists"),
-- og genskab triggeren fra 20261013100000_leads_forloeb.sql:
--   create trigger tilbud_marker_handling after insert on public.tilbud
--     for each row execute function public.marker_opgave_handling();
-- De indsnævrede rettigheder på firma_profil, referater og standardfelter
-- (kun SELECT for authenticated) genskabes bevidst IKKE i den gamle, for brede form.
-- Afprøvet lokalt 21/11: rollback-linjerne kører uden fejl på en tom tilbud.
