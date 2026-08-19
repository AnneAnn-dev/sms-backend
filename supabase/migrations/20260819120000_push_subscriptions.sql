-- =====================================================================
-- Migration — push_subscriptions
-- Dit Digitale Kontor · badge/notifikation med appen lukket (D34)
--
-- Opretter en ny tabel til web push-abonnementer.
-- Rulles tilbage med: drop table if exists public.push_subscriptions;
-- (ingen andre objekter afhænger af den, så det er en sikker rollback).
--
-- ⚠️ RETTET 19/8, første forsøg mod staging: en tabel med samme navn fandtes
-- allerede i databasen, men uden de kolonner denne migration forudsætter —
-- "messages-fælden" fra CLAUDE.md (create table if not exists tier stille,
-- selvom skemaet ikke stemmer). Sandsynlig kilde: et tidligere, opgivet
-- forsøg på push (VAPID-nøglerne har stået konfigureret og ubrugte i
-- server.js). Bekræftet TOM (0 rækker) før denne rettelse. Migrationen
-- dropper derfor den gamle tabel — men KUN hvis den stadig er tom, ellers
-- stopper den med en tydelig fejl i stedet for at risikere data.
--
-- Rækkefølge: staging → røgtest → prod (via push-script, aldrig db reset).
-- Denne fil må efter anvendelse ALDRIG omdøbes eller slettes.
-- =====================================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'push_subscriptions'
  ) then
    if (select count(*) from public.push_subscriptions) > 0 then
      raise exception 'push_subscriptions findes allerede OG har data — stopper for at undgå datatab. Undersøg manuelt før migrationen køres igen.';
    end if;
    drop table public.push_subscriptions;
  end if;
end $$;

create table public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id) on delete cascade,

  -- De tre felter fra en browser-PushSubscription (sub.toJSON()). endpoint
  -- er unikt: samme browser/enhed re-abonnerer på samme endpoint, og et nyt
  -- abonnement på samme endpoint skal ERSTATTE det gamle, ikke duplikere.
  endpoint   text not null,
  p256dh     text not null,
  auth_key   text not null,

  created_at timestamptz not null default now()
);

create unique index push_subscriptions_endpoint_unik
  on public.push_subscriptions (endpoint);

create index push_subscriptions_firm_id_idx
  on public.push_subscriptions (firm_id);

-- RLS til, ingen policies — samme mønster som `onboarding_sidevisninger`.
-- Klienten læser ALDRIG denne tabel direkte: om beskeder er slået til
-- afgøres i browseren via PushManager, ikke via et opslag i databasen.
-- Al skrivning sker server-side med service-role-nøglen, se push.js.
alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon, authenticated;

-- ---------------------------------------------------------------------
-- Kontroller efter kørsel (kør manuelt, gem output)
-- ---------------------------------------------------------------------
-- 1) RLS aktiv, ingen policies:
--      select relname, relrowsecurity from pg_class where relname = 'push_subscriptions';
--      select * from pg_policies where tablename = 'push_subscriptions';  -- skal give 0 rækker
--
-- 2) Skemaet er det forventede:
--      select column_name, data_type from information_schema.columns
--      where table_schema='public' and table_name='push_subscriptions'
--      order by ordinal_position;
--
-- 3) PostgREST har set skemaet:
--      notify pgrst, 'reload schema';
