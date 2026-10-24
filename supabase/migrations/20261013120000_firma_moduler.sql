-- 20261013120000_firma_moduler.sql — moduler pr. firma (udviklingsplanens Fase 1b)
--
-- Beslutning (Ann og Anne 13/10-26, D80): ét fundament og syv moduler, der
-- kan købes hver for sig eller samlet. Serveren kender firmaets moduler og
-- spærrer ruterne; appen spørger GET /api/moduler.
--
-- ÉN RÆKKE PR. FIRMA OG MODUL. Hele pakken = syv rækker, så spærren kun skal
-- kende ét begreb. Fase 3 (Frisbii) oversætter køb og opsigelse til rækker:
-- et køb sætter fra, en opsigelse sætter til. Aktiv = fra <= nu og (til er tom
-- eller til > nu).
--
-- KUN SERVEREN LÆSER OG SKRIVER. RLS er slået til uden en eneste politik, og
-- authenticated/anon har ingen rettigheder: appen får sine moduler gennem
-- /api/moduler, aldrig direkte. Et firma kan altså ikke give sig selv et modul.
--
-- Modulnavnene står OGSÅ i moduler.js (MODULER). Ret begge steder.

create table if not exists public.firma_moduler (
  firm_id    uuid        not null references public.firms(id) on delete cascade,
  modul      text        not null,
  fra        timestamptz not null default now(),
  til        timestamptz,
  kilde      text        not null default 'manuel',
  created_at timestamptz not null default now(),
  primary key (firm_id, modul),
  constraint firma_moduler_modul check
    (modul in ('telefon', 'referat', 'tilbud', 'faktura', 'booking', 'svar', 'facebook')),
  constraint firma_moduler_kilde check
    (kilde in ('manuel', 'migration', 'auto', 'pakke', 'frisbii', 'proeve')),
  constraint firma_moduler_periode check (til is null or til > fra)
);

alter table public.firma_moduler enable row level security;
revoke all on table public.firma_moduler from anon, authenticated;
grant all on table public.firma_moduler to service_role;

-- Alle eksisterende firmaer har Telefonpasser i dag. Uden denne række ville
-- /api/moduler sige, at de intet har.
insert into public.firma_moduler (firm_id, modul, kilde)
select id, 'telefon', 'migration' from public.firms
on conflict (firm_id, modul) do nothing;

-- Nye firmaer får Telefonpasser automatisk, indtil Fase 3 lader Frisbii
-- bestemme det. Samme mønster som firma_profil-triggeren (D68).
create or replace function public.firma_faar_telefon()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  insert into public.firma_moduler (firm_id, modul, kilde)
  values (new.id, 'telefon', 'auto')
  on conflict (firm_id, modul) do nothing;
  return null;
end;
$$;
drop trigger if exists firma_faar_telefon on public.firms;
create trigger firma_faar_telefon
  after insert on public.firms
  for each row execute function public.firma_faar_telefon();
