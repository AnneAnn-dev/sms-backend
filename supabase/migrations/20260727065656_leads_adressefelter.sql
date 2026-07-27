-- =====================================================================
-- Migration A2 — Strukturerede adressefelter på leads
-- Dit Digitale Kontor
--
-- Rent additiv. Fjerner intet, ændrer intet eksisterende.
-- Kan køres uafhængigt af migration A og B.
--
-- FORMÅL: fjerne hele fejlklassen "parse adresse ud af en tekststreng".
-- DAWA leverer felterne struktureret ved indtastning, og formularen tvinger
-- allerede kunden til at vælge fra listen. De data smides bare væk i dag.
-- Fremover gemmes begge dele, og ingen af dem udledes af den anden.
--
-- REGEL EFTER DENNE MIGRATION:
--   Ingen kode må splitte leads.address (eller kunder.adresse) på komma.
--   Skal du bruge postnummer, læser du postnr-kolonnen.
-- =====================================================================

alter table public.leads
  add column if not exists vejnavn text,
  add column if not exists husnr   text,   -- "12B" findes; aldrig integer
  add column if not exists etage   text,
  add column if not exists doer    text,
  add column if not exists postnr  text,   -- identifikator, ikke et tal
  add column if not exists by      text,
  add column if not exists dawa_id uuid;

-- leads.address bevares uændret som den formaterede visningsstreng
-- (DAWA adressebetegnelse). Den er not null i dag og skal blive ved med
-- at være det — alt eksisterende UI, PDF og SMS læser den.

-- Nyttigt når håndværkeren senere vil filtrere opgaver på område:
create index if not exists leads_postnr_idx
  on public.leads (firm_id, postnr) where postnr is not null;

notify pgrst, 'reload schema';


-- ---------------------------------------------------------------------
-- Bagudkompatibilitet
-- ---------------------------------------------------------------------
-- Eksisterende leads får NULL i de nye felter. Det er med vilje: en
-- backfill ville kræve præcis den komma-parsing vi er ved at afskaffe.
-- Hvis I vil have historikken med, er den rigtige vej et engangsscript
-- der slår hver gammel address op mod DAWA's API og skriver felterne fra
-- SVARET — ikke fra strengen. Det haster ikke og bør ikke blokere piloten.
--
-- Kode der skal opdateres for at udfylde felterne (alle steder hvor
-- initDawa() allerede kører — data er der, de kastes bare væk):
--   - kundeformularen i server.js
--   - "Ny opgave"-modalen i dashboard.html
--   - "Rediger lead"-modalen i dashboard.html
