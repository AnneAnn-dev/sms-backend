-- 20261007060000_leads_firma_politik.sql
-- ---------------------------------------------------------------------------
-- HVORFOR: alle politikker paa `leads` gaar gennem `call_id`, og `call_id` er
-- nullable. En opgave, der oprettes i tilbudsmodulet, har intet opkald bag sig,
-- saa `call_id` er NULL - og `NULL IN (...)` er ikke falsk, det er NULL, altsaa
-- ikke sandt. Raekken bliver skrevet, faar sit id, og er derefter USYNLIG for
-- enhver klient. Ingen fejl, ingen besked, ingen tom liste at undre sig over -
-- bare en opgave, der ikke er der.
--
-- Hullet var forudset. Runbookens skema-status skriver om `leads.firm_id`:
--   "Uden den skal enhver RLS-politik og ethvert unikt indeks pr. firma joine
--    via `calls` - og den sti broed for manuelt oprettede opgaver, hvor
--    `call_id` er nullable."
-- Kolonnen kom 27/7-2026. Politikken blev aldrig skrevet. Halvdelen af
-- rettelsen har ligget i databasen i ti uger uden at goere noget.
--
-- SIKKERT AT KOERE: politikker laegges sammen med OR. Ingen raekke mister
-- synlighed - de fire eksisterende politikker virker uaendret gennem
-- `call_id`. Denne tilfoejer en vej mere, for de raekker der ikke har et opkald.
--
-- `with check` er skrevet eksplicit, selvom PostgreSQL ville bruge `using` til
-- begge dele. Et udtryk, man skal kende en regel for at laese, er et udtryk,
-- den naeste laeser forkert.
--
-- STATUS: de to politikker blev koert direkte i staging 6/10-2026. Denne fil er
-- den samme aendring som migration, saa PROD ogsaa faar den - og saa den
-- overlever, at et miljoe bygges fra `supabase/migrations/` forfra.
-- `drop policy if exists` goer filen koerbar i begge miljoeer.
-- ---------------------------------------------------------------------------

drop policy if exists leads_select_firma on public.leads;
create policy leads_select_firma on public.leads
  for select
  using (firm_id in (select mine_firmaer()));

drop policy if exists leads_update_firma on public.leads;
create policy leads_update_firma on public.leads
  for update
  using      (firm_id in (select mine_firmaer()))
  with check (firm_id in (select mine_firmaer()));
