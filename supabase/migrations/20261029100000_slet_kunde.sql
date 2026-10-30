-- 20261029100000_slet_kunde.sql — Slet kunde (D94 trin 3b, plan godkendt af
-- Ann 29/10-26). TILFOEJENDE: én ny tabel og to nye funktioner. Intet
-- eksisterende roeres, og ingen data aendres af migrationen.
--
-- HVAD "SLET KUNDE" SLETTER (Ann 28–29/10, valg (b)) — ALT om kunden, saa
-- funktionen kan bruges, naar en kunde beder om at blive slettet (GDPR art. 17):
--   * kundens opgaver (`leads.kunde_id`) — billedraekker og referater foelger
--     med CASCADE; billedFILERNE i Storage slettes af serveren BAGEFTER
--     (Storage er ikke i transaktionen), derfor returneres opgave-id'erne
--   * SMS'er paa kundens opgaver, og SMS'er uden opgave til kundens numre
--   * opkald, kundens opgaver kom fra, og opkald FRA kundens numre i firmaet
--     (valg b) — men KUN de opkald, ingen opgave peger paa, naar kundens
--     opgaver er slettet. `leads.call_id -> calls` er CASCADE (maalt 29/10):
--     et slettet opkald ville tage en ANDEN kundes opgave med. Maalt i prod
--     29/10: 1 opkald fra en kundes nummer har netop en andens opgave.
--   * kunden selv — numrene (`kunde_telefoner`) foelger med CASCADE
--
-- SPAERRINGER (intet slettes, fejlen siger hvorfor):
--   ikke_fundet   kunden findes ikke i firmaet (fremmed og ukendt ens)
--   aaben_opgave  kunden har en opgave med status 'open'
--   tilbud        en af kundens opgaver har et tilbud (Ann 28/10: indtil J4)
--   nyt_opkald    der er kommet et opkald fra kundens nummer inden for 7
--                 dage, som endnu ingen opgave har — kunden kan stadig vaere
--                 ved at udfylde formularen (Ann 29/10: en uge)
--   proev_igen    kundens numre aendrede sig, mens vi ventede paa laasen
--
-- LAASE (fundet af fire linser hver for sig 28/10): samme advisory-laas pr.
-- (firma, nummer) som find_eller_opret_kunde(), taget i fast (sorteret)
-- raekkefoelge, og derefter raekkelaase paa kunden, opgaverne og opkaldene.
-- Et opkald under sletningen venter derfor paa laasen og ser bagefter en
-- kunde, der ikke findes: det bliver en ny kunde — aldrig en opgave, der
-- slettes med den gamle. En opgave, der knyttes til kunden imens (Flyt, Ny
-- opgave), venter paa raekkelaasen og fejler bagefter paa fremmednoeglen.
--
-- LOG: `kunde_sletninger` faar én raekke pr. sletning med id'er og antal —
-- aldrig navne eller numre. RLS til, ingen politikker, ingen rettigheder for
-- anon/authenticated: kun serveren.
--
-- KAN RULLES TILBAGE (koden foerst, saa databasen):
--   drop function public.slet_kunde(uuid, uuid);
--   drop function public.slet_kunde_oversigt(uuid, uuid);
--   drop table public.kunde_sletninger;   -- kun hvis loggen ikke skal gemmes

create table if not exists public.kunde_sletninger (
  id             uuid primary key default gen_random_uuid(),
  firm_id        uuid not null references public.firms(id) on delete cascade,
  kunde_id       uuid not null,              -- bevidst uden fremmednoegle: kunden er slettet
  slettet_at     timestamptz not null default now(),
  opgaver        integer not null,
  billeder       integer not null,
  referater      integer not null,
  sms            integer not null,
  opkald         integer not null,
  numre          integer not null,
  opgave_ider    uuid[] not null default '{}'
);
alter table public.kunde_sletninger enable row level security;
revoke all on table public.kunde_sletninger from public, anon, authenticated;
grant select, insert on table public.kunde_sletninger to service_role;

-- ── Oversigt: hvad ville blive slettet, og er der en spaerring? ──────────
-- Kun laesning, ingen laase. Bruges til tallene foer bekraeftelsen. Selve
-- sletningen tjekker alt igen under laas.
create or replace function public.slet_kunde_oversigt(p_firm uuid, p_kunde uuid)
returns table (
  findes boolean, opgaver integer, aabne integer, billeder integer, referater integer,
  sms integer, opkald integer, numre integer, tilbud integer, nye_opkald integer
)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_numre  text[];
  v_leads  uuid[];
  v_calls  uuid[];
begin
  if not exists (select 1 from public.kunder k where k.id = p_kunde and k.firm_id = p_firm) then
    return query select false, 0, 0, 0, 0, 0, 0, 0, 0, 0;
    return;
  end if;
  select coalesce(array_agg(kt.telefon order by kt.telefon), '{}') into v_numre
    from public.kunde_telefoner kt where kt.firm_id = p_firm and kt.kunde_id = p_kunde;
  select coalesce(array_agg(l.id), '{}') into v_leads
    from public.leads l where l.firm_id = p_firm and l.kunde_id = p_kunde;
  select coalesce(array_agg(c.id), '{}') into v_calls
    from public.calls c
   where c.firm_id = p_firm
     and (c.id in (select l.call_id from public.leads l where l.id = any (v_leads))
          or c.from_number = any (v_numre))
     and not exists (select 1 from public.leads l2
                      where l2.call_id = c.id and not (l2.id = any (v_leads)));
  return query select
    true,
    cardinality(v_leads),
    (select count(*)::int from public.leads l where l.id = any (v_leads) and l.status = 'open'),
    (select count(*)::int from public.lead_images i where i.lead_id = any (v_leads)),
    (select count(*)::int from public.referater r where r.lead_id = any (v_leads)),
    (select count(*)::int from public.messages m where m.firm_id = p_firm
        and (m.lead_id = any (v_leads) or (m.lead_id is null and m.to_number = any (v_numre)))),
    cardinality(v_calls),
    cardinality(v_numre),
    (select count(*)::int from public.tilbud t where t.lead_id = any (v_leads)),
    (select count(*)::int from public.calls c where c.firm_id = p_firm
        and c.from_number = any (v_numre)
        and c.created_at > now() - interval '7 days'
        and not exists (select 1 from public.leads l where l.call_id = c.id));
end;
$$;

-- ── Selve sletningen — én transaktion ───────────────────────────────────
create or replace function public.slet_kunde(p_firm uuid, p_kunde uuid)
returns table (
  opgave_ider uuid[], opgaver integer, billeder integer, referater integer,
  sms integer, opkald integer, numre integer
)
language plpgsql
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_numre    text[];
  v_numre2   text[];
  v_nr       text;
  v_leads    uuid[];
  v_calls    uuid[];
  v_billeder integer;
  v_ref      integer;
  v_sms      integer;
  v_opkald   integer;
begin
  if p_firm is null or p_kunde is null then
    raise exception 'ikke_fundet';
  end if;

  -- 1. Laas kundens numre — samme laas som find_eller_opret_kunde(), sorteret.
  select coalesce(array_agg(kt.telefon order by kt.telefon), '{}') into v_numre
    from public.kunde_telefoner kt where kt.firm_id = p_firm and kt.kunde_id = p_kunde;
  foreach v_nr in array v_numre loop
    perform pg_advisory_xact_lock(hashtextextended(p_firm::text || '|' || v_nr, 0));
  end loop;

  -- 2. Laas kunden. Findes hun ikke (eller er hun et andet firmas): stop.
  perform 1 from public.kunder k where k.id = p_kunde and k.firm_id = p_firm for update;
  if not found then
    raise exception 'ikke_fundet';
  end if;

  -- Numrene igen, nu under laas. Er der kommet et til eller gaaet et, er det
  -- ikke laast: proev forfra (sjaeldent — kun ved en samtidig "Ret kunde").
  select coalesce(array_agg(kt.telefon order by kt.telefon), '{}') into v_numre2
    from public.kunde_telefoner kt where kt.firm_id = p_firm and kt.kunde_id = p_kunde;
  if v_numre2 is distinct from v_numre then
    raise exception 'proev_igen';
  end if;

  -- 3. Laas opgaverne og tjek spaerringerne.
  select coalesce(array_agg(l.id), '{}') into v_leads from (
    select l.id from public.leads l
     where l.firm_id = p_firm and l.kunde_id = p_kunde
     order by l.id for update) l;

  if exists (select 1 from public.leads l where l.id = any (v_leads) and l.status = 'open') then
    raise exception 'aaben_opgave';
  end if;
  if exists (select 1 from public.tilbud t where t.lead_id = any (v_leads)) then
    raise exception 'tilbud';
  end if;

  -- 4. Laas opkaldene (kundens opgavers + dem fra kundens numre). Laasen
  --    goer, at en opgave, der oprettes paa et af dem imens (kundeformularen),
  --    enten er committet, foer vi ser efter, eller venter og fejler bagefter.
  select coalesce(array_agg(c.id), '{}') into v_calls from (
    select c.id from public.calls c
     where c.firm_id = p_firm
       and (c.id in (select l.call_id from public.leads l where l.id = any (v_leads))
            or c.from_number = any (v_numre))
     order by c.id for update) c;

  if exists (select 1 from public.calls c
              where c.id = any (v_calls)
                and c.from_number = any (v_numre)
                and c.created_at > now() - interval '7 days'
                and not exists (select 1 from public.leads l where l.call_id = c.id)) then
    raise exception 'nyt_opkald';
  end if;

  -- 5. Slet. SMS'erne foerst — bagefter er koblingen til opgaven nulstillet.
  select count(*)::int into v_billeder from public.lead_images i where i.lead_id = any (v_leads);
  select count(*)::int into v_ref from public.referater r where r.lead_id = any (v_leads);

  with d as (
    delete from public.messages m
     where m.firm_id = p_firm
       and (m.lead_id = any (v_leads) or (m.lead_id is null and m.to_number = any (v_numre)))
    returning 1)
  select count(*)::int into v_sms from d;

  delete from public.leads l where l.id = any (v_leads);

  -- Kun opkald, INGEN opgave peger paa nu (CASCADE, se oeverst).
  with d as (
    delete from public.calls c
     where c.id = any (v_calls)
       and not exists (select 1 from public.leads l where l.call_id = c.id)
    returning 1)
  select count(*)::int into v_opkald from d;

  delete from public.kunder k where k.id = p_kunde and k.firm_id = p_firm;

  insert into public.kunde_sletninger
    (firm_id, kunde_id, opgaver, billeder, referater, sms, opkald, numre, opgave_ider)
  values
    (p_firm, p_kunde, cardinality(v_leads), v_billeder, v_ref, v_sms, v_opkald, cardinality(v_numre), v_leads);

  return query select v_leads, cardinality(v_leads), v_billeder, v_ref, v_sms, v_opkald, cardinality(v_numre);
end;
$$;

revoke all on function public.slet_kunde_oversigt(uuid, uuid) from public, anon, authenticated;
revoke all on function public.slet_kunde(uuid, uuid) from public, anon, authenticated;
grant execute on function public.slet_kunde_oversigt(uuid, uuid) to service_role;
grant execute on function public.slet_kunde(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------
-- Kontroller efter koersel (SQL-editoren, kun laesning):
--   select has_function_privilege('authenticated', 'public.slet_kunde(uuid,uuid)', 'execute')           -- false
--        , has_function_privilege('authenticated', 'public.slet_kunde_oversigt(uuid,uuid)', 'execute')  -- false
--        , has_table_privilege('authenticated', 'public.kunde_sletninger', 'select')                    -- false
--        , (select relrowsecurity from pg_class where oid = 'public.kunde_sletninger'::regclass);        -- true
-- Resten bevises af proev-slet-kunde.js --bekraeft mod staging.
