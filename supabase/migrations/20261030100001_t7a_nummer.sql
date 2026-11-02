-- 20261030100001_t7a_nummer.sql — Fase 3, T7a (30/10-26)
--
-- 1) firms.nummer_verificeret_at: HAR firmaets nummer vaeret verificeret?
--    Saettes af onboarding.js ved foerste verifikation og ryddes aldrig.
--    Afgoer karantaenen, naar nummeret frigives (telefon-nummer.js, D95):
--    verificeret = nummeret har vaeret kundens -> karantaene, uanset prisen.
--    verification_status kan ikke bruges: den gaar tilbage til "pending" ved
--    hvert nyt testopkald.
--
--    Udfyldes for eksisterende firmaer, der er verificeret NU, eller som har
--    mindst én raekke i calls (et opkald, ogsaa verifikationens demo-opkald,
--    betyder at nummeret har vaeret i brug). Tidspunktet er migrationens - det
--    praecise oejeblik kendes ikke, og kun "har/har ikke" bruges.
--
-- 2) Triggeren firma_faar_telefon fjernes. Koden laegger nu selv telefon-
--    raekken (sikrTelefonModul i frisbii-webhook.js og provision-test-firm.js).
--    RAEKKEFOELGE: koden skal vaere deployet, FOER denne migration koeres -
--    ellers faar et firma oprettet imellem ingen Telefonpasser.
--
-- TIDSSTEMPEL SAT I HAANDEN (Ann 30/10): et sekund efter 20261030100000_laeg_sammen_kunder
-- (D94 trin 4), som var koert i staging med et tidsstempel frem i tiden. En fil fra
-- "migration new" kl. 08:xx UTC ville lande foer den og blive afvist af db push.
--
-- Rollback: drop column nummer_verificeret_at; triggeren genskabes fra
-- 20261013120000_firma_moduler.sql (funktion + trigger, uaendret).

alter table public.firms
  add column if not exists nummer_verificeret_at timestamptz;

comment on column public.firms.nummer_verificeret_at is
  'T7a/D95: foerste gang nummeret blev verificeret. Ryddes aldrig. Ikke tom = karantaene ved frigivelse.';

update public.firms f
   set nummer_verificeret_at = now()
 where f.nummer_verificeret_at is null
   and (f.verification_status = 'verified'
        or exists (select 1 from public.calls c where c.firm_id = f.id));

drop trigger if exists firma_faar_telefon on public.firms;
drop function if exists public.firma_faar_telefon();
