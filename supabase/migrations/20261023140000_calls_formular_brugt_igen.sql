-- D88 trin 2 / S34, release-dagen (23/10-26): udfyld calls.formular_brugt_at igen.
--
-- HVORFOR: kolonnen kom i prod 21/10 (20261019140000_calls_formular_brugt) og
-- blev udfyldt dengang. Men prods kode fra FOER trin 2 saetter kun
-- calls.status = 'completed' — ikke formular_brugt_at. Links, der er brugt
-- mellem 21/10 og deployet af trin 2's kode, staar derfor som ubrugte og ville
-- kunne bruges igen, saa snart FORMULAR_ENGANGS_AKTIV taendes.
--
-- Koeres FOER koden. Samme regel som den oprindelige migration: et link er
-- brugt, naar opkaldet er 'completed' eller har en opgave. Tidspunktet er den
-- foerste opgaves created_at, ellers nu.
--
-- Ufarlig at koere igen: kun raekker med formular_brugt_at IS NULL roeres.
-- Ingen skemaaendring. Kan ikke rulles tilbage raekke for raekke (vi ved ikke
-- bagefter, hvilke raekker DENNE migration satte), men der er intet at rulle
-- tilbage: et link, der allerede er brugt, skal staa som brugt.

update public.calls c
set formular_brugt_at = coalesce(
      (select min(l.created_at) from public.leads l where l.call_id = c.id),
      now())
where c.formular_brugt_at is null
  and (c.status = 'completed'
       or exists (select 1 from public.leads l where l.call_id = c.id));
