-- 20261030100000_laeg_sammen_kunder.sql — Læg to kunder sammen (D94 trin 4,
-- besluttet af Ann 27/10 og 30/10-26). TILFOEJENDE: én ny tabel og to nye
-- funktioner. Intet eksisterende roeres, og ingen data aendres af migrationen.
--
-- HVAD DER SKER (Ann 27/10, beslutning 4; 30/10):
--   * kunden, man staar paa (BEHOLD), beholder navn og adresse
--   * den andens (FJERN) numre flyttes til BEHOLD (`kunde_telefoner`)
--   * den andens opgaver flyttes til BEHOLD (`leads.kunde_id`) — opgavernes
--     SMS-nummer roeres ikke (D88 "let b": en opgave skriver til det nummer,
--     den kom fra)
--   * TOMME felter hos BEHOLD fyldes fra FJERN (Ann 30/10): e-mail, CVR (og
--     er_erhverv med den), og adressen som HEL blok (adresse, vejnavn, husnr,
--     etage, doer, postnr, by, dawa_id) — kun hvis BEHOLD slet ingen adresse
--     har, saa en adresse aldrig blandes af to. Et udfyldt felt roeres aldrig.
--     Noter: har begge, saettes FJERNs under BEHOLDs, saa intet gaar tabt.
--   * FJERN slettes. Inaktiv/aktiv: BEHOLD beholder sin egen tilstand.
--   * SMS'er og opkald roeres ikke — de peger paa opgaver og numre, ikke paa
--     kunden (FK-kort maalt 29–30/10: kun `leads` og `kunde_telefoner` peger
--     paa `kunder`).
-- Kan ikke fortrydes i appen. Loggen siger, hvad der blev flyttet.
--
-- SPAERRINGER (intet aendres):
--   samme_kunde   de to id'er er ens
--   ikke_fundet   en af kunderne findes ikke i firmaet (fremmed og ukendt ens)
--   proev_igen    numrene aendrede sig, mens vi ventede paa laasen
--
-- LAASE (seks-linse 28/10, betingelse 2): samme advisory-laas pr. (firma,
-- nummer) som find_eller_opret_kunde() og slet_kunde(), for BEGGE kunders
-- numre i fast (sorteret) raekkefoelge; derefter begge kunderaekker (sorteret
-- paa id) og FJERNs opgaver. Et opkald fra FJERNs nummer midt i
-- sammenlaegningen venter og finder bagefter nummeret hos BEHOLD.
--
-- LOG: `kunde_sammenlaegninger` — id'er, antal og navnene paa de FELTER, der
-- blev fyldt; aldrig vaerdierne, navne eller numre. RLS til, ingen politikker,
-- ingen rettigheder for anon/authenticated.
--
-- KAN RULLES TILBAGE (koden foerst, saa databasen):
--   drop function public.laeg_sammen_kunder(uuid, uuid, uuid);
--   drop function public.laeg_sammen_oversigt(uuid, uuid, uuid);
--   drop table public.kunde_sammenlaegninger;   -- kun hvis loggen ikke skal gemmes

create table if not exists public.kunde_sammenlaegninger (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references public.firms(id) on delete cascade,
  behold_id      uuid not null,              -- bevidst uden fremmednoegle: kan slettes senere
  fjern_id       uuid not null,              -- er slettet
  lagt_sammen_at timestamptz not null default now(),
  numre          integer not null,
  opgaver        integer not null,
  felter         text[] not null default '{}',
  opgave_ider    uuid[] not null default '{}'
);
alter table public.kunde_sammenlaegninger enable row level security;
revoke all on table public.kunde_sammenlaegninger from public, anon, authenticated;
grant select, insert on table public.kunde_sammenlaegninger to service_role;

-- Hvilke felter ville blive fyldt? Faelles for oversigten og sammenlaegningen.
create or replace function public._laeg_sammen_felter(b public.kunder, f public.kunder)
returns text[]
language sql
immutable
set search_path = public
as $$
  select array_remove(array[
    case when nullif(btrim(b.email), '') is null and nullif(btrim(f.email), '') is not null then 'email' end,
    case when nullif(btrim(b.cvr), '') is null and nullif(btrim(f.cvr), '') is not null then 'cvr' end,
    case when nullif(btrim(b.adresse), '') is null and nullif(btrim(b.postnr), '') is null and b.dawa_id is null
          and (nullif(btrim(f.adresse), '') is not null or nullif(btrim(f.postnr), '') is not null or f.dawa_id is not null)
         then 'adresse' end,
    case when nullif(btrim(f.noter), '') is not null then 'noter' end
  ], null);
$$;

-- ── Oversigt: hvad flyttes? Kun laesning, ingen laase. ───────────────────
create or replace function public.laeg_sammen_oversigt(p_firm uuid, p_behold uuid, p_fjern uuid)
returns table (findes boolean, numre integer, opgaver integer, aabne integer, felter text[], fjern_inaktiv boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  b public.kunder;
  f public.kunder;
begin
  if p_behold is null or p_fjern is null or p_behold = p_fjern then
    return query select false, 0, 0, 0, '{}'::text[], false; return;
  end if;
  select * into b from public.kunder k where k.id = p_behold and k.firm_id = p_firm;
  select * into f from public.kunder k where k.id = p_fjern and k.firm_id = p_firm;
  if b.id is null or f.id is null then
    return query select false, 0, 0, 0, '{}'::text[], false; return;
  end if;
  return query select
    true,
    (select count(*)::int from public.kunde_telefoner kt where kt.firm_id = p_firm and kt.kunde_id = p_fjern),
    (select count(*)::int from public.leads l where l.firm_id = p_firm and l.kunde_id = p_fjern),
    (select count(*)::int from public.leads l where l.firm_id = p_firm and l.kunde_id = p_fjern and l.status = 'open'),
    public._laeg_sammen_felter(b, f),
    f.arkiveret_at is not null;
end;
$$;

-- ── Selve sammenlaegningen — én transaktion ─────────────────────────────
create or replace function public.laeg_sammen_kunder(p_firm uuid, p_behold uuid, p_fjern uuid)
returns table (numre integer, opgaver integer, felter text[], opgave_ider uuid[])
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_numre   text[];
  v_numre2  text[];
  v_nr      text;
  v_leads   uuid[];
  v_felter  text[];
  v_antal_n integer;
  b public.kunder;
  f public.kunder;
begin
  if p_firm is null or p_behold is null or p_fjern is null then
    raise exception 'ikke_fundet';
  end if;
  if p_behold = p_fjern then
    raise exception 'samme_kunde';
  end if;

  -- 1. Laas begge kunders numre — samme laas som find_eller_opret_kunde(), sorteret.
  select coalesce(array_agg(kt.telefon order by kt.telefon), '{}') into v_numre
    from public.kunde_telefoner kt
   where kt.firm_id = p_firm and kt.kunde_id in (p_behold, p_fjern);
  foreach v_nr in array v_numre loop
    perform pg_advisory_xact_lock(hashtextextended(p_firm::text || '|' || v_nr, 0));
  end loop;

  -- 2. Laas begge kunder (sorteret paa id). Mangler én: stop.
  perform 1 from public.kunder k
   where k.firm_id = p_firm and k.id in (p_behold, p_fjern)
   order by k.id for update;
  select * into b from public.kunder k where k.id = p_behold and k.firm_id = p_firm;
  select * into f from public.kunder k where k.id = p_fjern and k.firm_id = p_firm;
  if b.id is null or f.id is null then
    raise exception 'ikke_fundet';
  end if;

  select coalesce(array_agg(kt.telefon order by kt.telefon), '{}') into v_numre2
    from public.kunde_telefoner kt
   where kt.firm_id = p_firm and kt.kunde_id in (p_behold, p_fjern);
  if v_numre2 is distinct from v_numre then
    raise exception 'proev_igen';
  end if;

  -- 3. Laas FJERNs opgaver.
  select coalesce(array_agg(l.id), '{}') into v_leads from (
    select l.id from public.leads l
     where l.firm_id = p_firm and l.kunde_id = p_fjern
     order by l.id for update) l;

  -- 4. Fyld BEHOLDs tomme felter (aldrig et udfyldt felt).
  v_felter := public._laeg_sammen_felter(b, f);
  update public.kunder k set
    email = case when 'email' = any (v_felter) then f.email else k.email end,
    cvr = case when 'cvr' = any (v_felter) then f.cvr else k.cvr end,
    er_erhverv = case when 'cvr' = any (v_felter) then (k.er_erhverv or f.er_erhverv) else k.er_erhverv end,
    adresse = case when 'adresse' = any (v_felter) then f.adresse else k.adresse end,
    vejnavn = case when 'adresse' = any (v_felter) then f.vejnavn else k.vejnavn end,
    husnr   = case when 'adresse' = any (v_felter) then f.husnr   else k.husnr   end,
    etage   = case when 'adresse' = any (v_felter) then f.etage   else k.etage   end,
    doer    = case when 'adresse' = any (v_felter) then f.doer    else k.doer    end,
    postnr  = case when 'adresse' = any (v_felter) then f.postnr  else k.postnr  end,
    "by"    = case when 'adresse' = any (v_felter) then f."by"    else k."by"    end,
    dawa_id = case when 'adresse' = any (v_felter) then f.dawa_id else k.dawa_id end,
    noter = case when 'noter' = any (v_felter)
                 then coalesce(nullif(btrim(k.noter), '') || E'\n\n', '') || f.noter
                 else k.noter end
   where k.id = p_behold and k.firm_id = p_firm;

  -- 5. Flyt numre og opgaver, og slet FJERN.
  with u as (
    update public.kunde_telefoner kt set kunde_id = p_behold
     where kt.firm_id = p_firm and kt.kunde_id = p_fjern
    returning 1)
  select count(*)::int into v_antal_n from u;

  update public.leads l set kunde_id = p_behold where l.id = any (v_leads);

  delete from public.kunder k where k.id = p_fjern and k.firm_id = p_firm;

  insert into public.kunde_sammenlaegninger (firm_id, behold_id, fjern_id, numre, opgaver, felter, opgave_ider)
  values (p_firm, p_behold, p_fjern, v_antal_n, cardinality(v_leads), v_felter, v_leads);

  return query select v_antal_n, cardinality(v_leads), v_felter, v_leads;
end;
$$;

revoke all on function public._laeg_sammen_felter(public.kunder, public.kunder) from public, anon, authenticated;
revoke all on function public.laeg_sammen_oversigt(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.laeg_sammen_kunder(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public._laeg_sammen_felter(public.kunder, public.kunder) to service_role;
grant execute on function public.laeg_sammen_oversigt(uuid, uuid, uuid) to service_role;
grant execute on function public.laeg_sammen_kunder(uuid, uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- Kontroller efter koersel (SQL-editoren, kun laesning):
--   select has_function_privilege('authenticated', 'public.laeg_sammen_kunder(uuid,uuid,uuid)', 'execute')   -- false
--        , has_function_privilege('authenticated', 'public.laeg_sammen_oversigt(uuid,uuid,uuid)', 'execute') -- false
--        , has_table_privilege('authenticated', 'public.kunde_sammenlaegninger', 'select')                    -- false
--        , (select relrowsecurity from pg_class where oid = 'public.kunde_sammenlaegninger'::regclass);        -- true
-- Resten bevises af proev-laeg-sammen.js --bekraeft mod staging.
