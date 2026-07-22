-- Tidsmåling på onboarding-siderne.
-- Hver række er ét "ophold" på én side (der kan være flere pr. side pr. kunde,
-- fx hvis telefonen låses og låses op igen) — summér pr. (firm_id, side) i analysen.
--
-- Skrives KUN af serveren (service role) via POST /onboarding/sidevisning.
-- RLS er slået til uden policies: anon- og bruger-nøgler kan hverken læse
-- eller skrive — service role går udenom RLS, præcis som på de øvrige tabeller.
--
-- OVERSÆTTELSE af side-navnene (skærm-id'erne har huller: s-4 og s-12 blev
-- nedlagt ved side-sammenlægninger 16-17/7 og er BEVIDST ikke genbrugt —
-- stabile navne slår pæne navne, ellers knækker statistikken ved omdøbning):
--
--   s-1        Velkommen + "Hvilket nummer skal vi passe på?"
--   s-2        Adgangskode
--   s-3        Stemme + besked (sammenlagt side)
--   s-5        Viderestilling
--   s-6        Test (viderestillings-verifikation)
--   s-7        "Alt virker." (succes)
--   s-8        "Sidste trin" (læg appen på telefonen)
--   s-9        Installations-guide, trin 1 af 2 (Del-ikonet / ⋮-menuen)
--   s-10       Installations-guide, trin 2 af 2 (Føj til hjemmeskærm)
--   s-11       "Færdig." (åbn appen fra ikonet)
--   s-expired  "Linket er udløbet"-skærmen
--
-- Analyse (antal kunder, gennemsnit og median pr. side):
--   SELECT side,
--          count(DISTINCT firm_id)                                              AS kunder,
--          round(avg(sum_sek), 1)                                               AS gns_sekunder,
--          round(percentile_cont(0.5) WITHIN GROUP (ORDER BY sum_sek)::numeric, 1) AS median_sekunder
--   FROM (SELECT firm_id, side, sum(sekunder) AS sum_sek
--         FROM onboarding_sidevisninger GROUP BY firm_id, side) t
--   GROUP BY side ORDER BY side;

create table public.onboarding_sidevisninger (
  id        bigint generated always as identity primary key,
  firm_id   uuid references public.firms(id) on delete set null,
  side      text not null,
  sekunder  numeric(8,1) not null check (sekunder >= 0 and sekunder <= 3600),
  oprettet  timestamptz not null default now()
);

comment on table public.onboarding_sidevisninger is
  'Analyse: hvor lang tid kunder bruger på hver onboarding-side. Kun serverskriv.';

create index onboarding_sidevisninger_side_idx    on public.onboarding_sidevisninger (side);
create index onboarding_sidevisninger_firm_idx    on public.onboarding_sidevisninger (firm_id);
create index onboarding_sidevisninger_oprettet_idx on public.onboarding_sidevisninger (oprettet);

alter table public.onboarding_sidevisninger enable row level security;
-- Ingen policies med vilje: tabellen er lukket for alt andet end service role.
