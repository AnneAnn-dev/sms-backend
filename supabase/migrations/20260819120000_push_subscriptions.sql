-- =====================================================================
-- Migration — push_subscriptions
-- Dit Digitale Kontor · badge/notifikation med appen lukket (D34)
--
-- Tilfojer KUN en ny tabel. Rorer ingen eksisterende data eller kolonner.
-- Rulles tilbage med: drop table if exists public.push_subscriptions;
-- (ingen andre objekter afhaenger af den, sa det er en sikker rollback).
--
-- Raekkefolge: staging -> rogtest -> prod (via push-script, aldrig db reset).
-- Denne fil ma efter anvendelse ALDRIG omdobes eller slettes.
-- =====================================================================

create table if not exists public.push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  firm_id    uuid not null references public.firms(id) on delete cascade,

  -- De tre felter fra en browser-PushSubscription (sub.toJSON()). endpoint
  -- er unikt: samme browser/enhed re-abonnerer pa samme endpoint, og et nyt
  -- abonnement pa samme endpoint skal ERSTATTE det gamle, ikke duplikere.
  endpoint   text not null,
  p256dh     text not null,
  auth_key   text not null,

  created_at timestamptz not null default now()
);

create unique index if not exists push_subscriptions_endpoint_unik
  on public.push_subscriptions (endpoint);

create index if not exists push_subscriptions_firm_id_idx
  on public.push_subscriptions (firm_id);

-- RLS til, ingen policies — samme monster som `onboarding_sidevisninger`.
-- Klienten laeser ALDRIG denne tabel direkte: om beskeder er slaet til
-- afgores i browseren via PushManager, ikke via et opslag i databasen.
-- Al skrivning sker server-side med service-role-noglen, se push.js.
alter table public.push_subscriptions enable row level security;

revoke all on public.push_subscriptions from anon, authenticated;

-- ---------------------------------------------------------------------
-- Kontroller efter korsel (kor manuelt, gem output)
-- ---------------------------------------------------------------------
-- 1) RLS aktiv, ingen policies:
--      select relname, relrowsecurity from pg_class where relname = 'push_subscriptions';
--      select * from pg_policies where tablename = 'push_subscriptions';  -- skal give 0 raekker
--
-- 2) PostgREST har set skemaet:
--      notify pgrst, 'reload schema';
