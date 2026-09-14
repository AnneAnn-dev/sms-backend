-- =====================================================================
-- Migration — engangsnoegler
-- Dit Digitale Kontor · faerre logins i onboardingen, trin 2 af 4 (D60)
--
-- HVORFOR DEN FINDES
-- Kunden aabner velkomstmailen i sin mail-app og gennemfoerer onboardingen
-- i mail-appens INDBYGGEDE browser. For at laegge appen paa telefonen skal
-- hun ud i Safari (kompasset) — og Safari deler hverken session eller
-- localStorage med den indbyggede browser. Derfor skulle hun logge ind IGEN
-- med en engangskode fra mailen. Det er login nummer 2 ud af 3, og det er
-- det, denne tabel fjerner: hun faar en noegle med over i stedet.
--
-- Noeglen lever i adressens FRAGMENT (#n=...). Maalt 13/9-26: fragmentet
-- overlever kompas-springet, og det sendes ALDRIG til serveren — saa noeglen
-- kan ikke havne i Railways HTTP-log. Den byttes til en session med et POST.
--
-- Rulles tilbage med: drop table if exists public.engangsnoegler;
-- (ingen andre objekter afhaenger af den).
--
-- ⚠️ "messages-faelden" fra CLAUDE.md: create table if not exists tier
-- stille, hvis en tabel med samme navn findes med et ANDET skema. Derfor
-- stopper migrationen hellere med en tydelig fejl end at gaette.
--
-- Raekkefoelge: staging -> roegtest -> prod (via push-script, aldrig db reset).
-- Denne fil maa efter anvendelse ALDRIG omdoebes eller slettes.
-- =====================================================================

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'engangsnoegler'
  ) then
    if (select count(*) from public.engangsnoegler) > 0 then
      raise exception 'engangsnoegler findes allerede OG har data — stopper for at undgaa datatab. Undersoeg manuelt foer migrationen koeres igen.';
    end if;
    drop table public.engangsnoegler;
  end if;
end $$;

create table public.engangsnoegler (
  id           uuid primary key default gen_random_uuid(),

  -- ⚠️ KUN hash'en gemmes, aldrig noeglen selv. Serveren ser den raa noegle
  -- to gange i dens levetid: naar den udstedes, og naar den indloeses. Faar
  -- nogen laeseadgang til denne tabel, kan de stadig ikke logge ind som
  -- kunden. Samme princip som en adgangskode — og grunden til at en stjaalen
  -- databasekopi ikke er det samme som stjaalne sessioner.
  noegle_hash  text not null,

  -- Hvem noeglen logger ind som. Ingen fremmednoegle til auth.users: det
  -- skema ejes af Supabase, og ingen anden tabel her peger ind i det.
  -- Findes brugeren ikke laengere ved indloesning, fejler opslaget — og
  -- det er det rigtige svar.
  user_id      uuid not null,

  -- Firmaet er med af to grunde: oprydning naar et firma slettes, og fordi
  -- en noegle uden ejer ikke kan undersoeges bagefter.
  firm_id      uuid not null references public.firms(id) on delete cascade,

  -- Kort levetid. 10 minutter er valgt, fordi noeglen skrives i adressen,
  -- MENS kunden laeser installationsvejledningen igennem — der gaar typisk
  -- et par minutter, foer hun trykker paa kompasset. To minutter ville
  -- udloebe under naesen paa hende; en time ville vaere en noegle, der
  -- ligger og flyder i en adresselinje. Udloeber den alligevel, falder hun
  -- tilbage til kodevejen praecis som i dag — intet gaar i stykker.
  udloeber_kl  timestamptz not null,

  -- Engangsbrug. Saettes ved indloesning; anden indloesning afvises.
  -- Raekken slettes IKKE med det samme: et brugt tidsstempel er det eneste
  -- spor, der kan svare paa "hvornaar kom hun over i Safari?".
  brugt_kl     timestamptz,

  created_at   timestamptz not null default now()
);

-- Unik paa hash'en: to noegler kan ikke kollidere, og opslaget ved
-- indloesning bliver et indeksopslag i stedet for en scanning.
create unique index engangsnoegler_hash_unik
  on public.engangsnoegler (noegle_hash);

-- Bruges af oprydningen og af "slet kundens tidligere ubrugte noegler,
-- naar hun faar en ny" — ét levende noegle pr. bruger ad gangen.
create index engangsnoegler_user_id_idx
  on public.engangsnoegler (user_id);

create index engangsnoegler_udloeber_idx
  on public.engangsnoegler (udloeber_kl);

-- RLS til, ingen policies — samme moenster som `push_subscriptions` og
-- `onboarding_sidevisninger`. Klienten roerer ALDRIG denne tabel direkte;
-- den kender kun de to endpoints. Al skrivning sker server-side med
-- service-role-noeglen.
alter table public.engangsnoegler enable row level security;

revoke all on public.engangsnoegler from anon, authenticated;

-- ---------------------------------------------------------------------
-- Kontroller efter koersel (koer manuelt, gem output)
-- ---------------------------------------------------------------------
-- 1) RLS aktiv, ingen policies:
--      select relname, relrowsecurity from pg_class where relname = 'engangsnoegler';
--      select * from pg_policies where tablename = 'engangsnoegler';  -- skal give 0 raekker
--
-- 2) Skemaet er det forventede:
--      select column_name, data_type, is_nullable from information_schema.columns
--      where table_schema='public' and table_name='engangsnoegler'
--      order by ordinal_position;
--
-- 3) Anon/authenticated har ingen rettigheder:
--      select grantee, privilege_type from information_schema.role_table_grants
--      where table_name='engangsnoegler';   -- hverken anon eller authenticated
--
-- 4) PostgREST har set skemaet:
--      notify pgrst, 'reload schema';
--
-- 5) Efter foerste rigtige brug — noeglen skal vaere BRUGT og ikke ligge raa:
--      select id, left(noegle_hash, 8) as hash_start, udloeber_kl, brugt_kl
--      from public.engangsnoegler order by created_at desc limit 5;
