-- ─────────────────────────────────────────────────────────────────────────────
-- S34 (D88 trin 2, besluttet af Ann 19/10-26): kundeformularens link virker
-- ÉN gang.
--
-- Ny kolonne calls.formular_brugt_at: hvornaar formularen blev sendt. Serveren
-- saetter den med én betinget opdatering (`... where formular_brugt_at is
-- null`), saa to samtidige indsendelser ikke begge kommer igennem. Se
-- formular-engangs.js.
--
-- Hvorfor ikke calls.status? Den skrives af formularen ('completed') og af
-- onboardingens demo-opkald ('demo'), og formularen overskrev demo-maerket.
-- /twilio/opkaldsstatus skriver IKKE i den (maalt i koden 19/10). En kolonne
-- med én betydning.
--
-- Udfyldning: links, der ALLEREDE er brugt, lukker ogsaa. Et opkald regnes
-- som brugt, hvis det har status 'completed' ELLER har en opgave (leads.call_id)
-- — det sidste fanger indsendelser, hvor status-opdateringen fejlede (den blev
-- aldrig tjekket). Tidspunktet er den foerste opgaves oprettelse, ellers nu.
-- De syntetiske raekker fra /opret-opgave har intet lead_token og rammes ikke
-- af formularen; de faar et tidspunkt, men det betyder intet.
--
-- Additiv: ingen eksisterende kolonne aendres. Gammel kode ignorerer kolonnen.
-- Rollback: koden rulles tilbage (eller FORMULAR_ENGANGS_AKTIV slukkes);
-- kolonnen kan blive staaende. Skal den vaek: `alter table public.calls drop
-- column formular_brugt_at;` — i en SENERE release, aldrig samme deploy.
--
-- RLS: calls har sine policies i forvejen; en ny kolonne aendrer dem ikke.
-- Kun serveren (service role) skriver kolonnen.
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.calls
  add column if not exists formular_brugt_at timestamptz;

update public.calls c
   set formular_brugt_at = coalesce(
         (select min(l.created_at) from public.leads l where l.call_id = c.id),
         now())
 where c.formular_brugt_at is null
   and (c.status = 'completed'
        or exists (select 1 from public.leads l where l.call_id = c.id));

-- Opslaget sker paa lead_token; en partiel index er ikke noedvendig, men
-- lead_token SKAL vaere unik, ellers kan én indsendelse tage flere opkald.
-- Tjekket her i stedet for antaget: findes der dubletter, stopper migrationen.
do $$
declare n integer;
begin
  select count(*) into n from (
    select lead_token from public.calls
     where lead_token is not null
     group by lead_token having count(*) > 1
  ) d;
  if n > 0 then
    raise exception 'STOP: % lead_token(s) findes paa flere opkald. Ret dem, foer migrationen koeres igen.', n;
  end if;
end $$;
