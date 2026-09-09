-- rollback-sikker: ja — begge kolonner er additive, nullable/med default.
-- Gammel kode kender dem ikke og roerer dem ikke, saa en tilbagerulning af
-- appen kan leve med skemaet (jf. D10 og "tilfoej foerst, fjern senere").
--
-- HVORFOR
-- Firmanavnet og det navn, kundens SMS baerer, er to forskellige ting.
-- Telefonsvareren laeser navnet op og har ingen laengdegraense. Kunde-SMS'en
-- skal derimod blive i ÉT GSM-segment (160 tegn): sprænges den, deler
-- telefonnettet beskeden MIDT i linket, og kunden faar "Cannot GET" — fejlen
-- fra 12/7-26. Fast tekst + domaene + token koster 114 tegn, saa firmanavn og
-- slug deler de sidste 46.
--
-- Foer denne migration loeste vi det ved at forkorte SELVE firmanavnet. Det
-- gjorde produktets egen forklaring usand ("navnet er det, dine kunder hoerer")
-- og bad haandvaerkeren om at aendre sit firmanavn af en grund, der kun
-- gaelder SMS'en. Nu baerer `sms_navn` kortformen, og `name` er urort.
--
--   sms_navn = NULL  ->  brug `name` (det normale; navnet passer)
--   sms_navn = tekst ->  brug den i kunde-SMS'en, kun dér
--
-- `navn_er_gaettet` markerer, at Frisbii ikke havde noget firmanavn, og at
-- provisioneringen faldt tilbage paa personens navn eller e-mailen. Uden
-- flaget viser onboardingen et gaet, som kunden bare trykker videre paa.
-- Saettes til false, saa snart et menneske har set navnet paa side 1.

alter table public.firms
  add column if not exists sms_navn        text,
  add column if not exists navn_er_gaettet boolean not null default false;

comment on column public.firms.sms_navn is
  'Kortform af firmanavnet, brugt KUN i kunde-SMS''en (ét GSM-segment). NULL = brug name.';
comment on column public.firms.navn_er_gaettet is
  'True naar firmanavnet blev udledt ved provisionering, fordi Frisbii ikke havde et.';
