-- 20261009070000_referater_model_og_vaern.sql
-- ---------------------------------------------------------------------------
-- Fire kolonner paa `referater`. Ingen af dem er nye oenske - hver enkelt er
-- noget, en tidligere beslutning allerede har lovet, og som ikke havde et sted
-- at staa.
--
-- 1-2) ai_model + ai_prompt_version  (D14)
--
--   D14 handler om, at modellen skifter under os. Vi laaser modelstrengen i en
--   miljoevariabel og versionerer prompten - men NAAR skiftet saa sker, er
--   spoergsmaalet man stiller: "hvad skrev DET HER referat?" Og det kunne vi
--   ikke svare paa. `ai_forbrug` har modelnavnet pr. kald, men ingen forbindelse
--   til referatet, og `referater` havde ingen af delene.
--
--   Uden dem er et gammelt udkast et udkast uden ophav. Med dem kan et
--   modelskifte maales paa rigtige referater i stedet for paa en fornemmelse.
--
--   NULL betyder "ingen model skrev det" - fx kilde='manuel'. Det er en aegte
--   tilstand og ikke manglende data, derfor nullable.
--
-- 3-4) teknik_b_markeringer + teknik_b_ord  (D36, regel c)
--
--   D36 lover ordret: "taetheden (markeringer pr. 100 ord) logges pr. referat -
--   efter tredive rigtige referater er den et maal for, hvordan modellen klarer
--   aegte stemmer, og det er gratis at samle op." Der var ingen kolonne. Gratis
--   at samle op gaelder kun, hvis det faktisk bliver samlet op.
--
--   TO tal og ikke taetheden selv: en taethed paa 0,5 % siger intet om, hvorvidt
--   det var 1 markering i 200 ord eller 5 i 1000. Gemmer man kun forholdet, kan
--   man aldrig regne noget ANDET ud af det bagefter. Gemmer man taellere og
--   naevnere, kan man regne begge veje.
--
--   Maales paa AI-UDKASTET, ikke paa haandvaerkerens rettede version: tallet er
--   et maal for MODELLEN. Retter han selv et navn ind, er det ikke modellens
--   fortjeneste eller fejl.
--
-- SIKKERT AT KOERE: fire nullable kolonner uden default. Ingen eksisterende
-- raekke aendres, ingen laesning paavirkes, og `add column if not exists` goer
-- filen koerbar oven i sig selv.
-- ---------------------------------------------------------------------------

alter table public.referater
  add column if not exists ai_model            text,
  add column if not exists ai_prompt_version   text,
  add column if not exists teknik_b_markeringer integer,
  add column if not exists teknik_b_ord         integer;

comment on column public.referater.ai_model is
  'Praecis modelstreng der skrev ai_udkast (D14). NULL = ingen model.';
comment on column public.referater.ai_prompt_version is
  'REFERAT_PROMPT_VERSION fra prompts/referat.js, da udkastet blev skrevet (D14).';
comment on column public.referater.teknik_b_markeringer is
  'Antal markeringer teknik B fandt i ai_udkast mod transskript (D36 regel c).';
comment on column public.referater.teknik_b_ord is
  'Ordtal i ai_udkast. Sammen med markeringer giver det taetheden - og alt andet man senere vil regne.';
