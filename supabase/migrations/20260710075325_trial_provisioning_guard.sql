-- Migration: trial_provisioning_guard
-- Formaal: race-sikkert vaern mod dobbelt-provisionering af samme Frisbii-abonnement.
--
-- Baggrund: provisionering trigges fremover af BAADE subscription_created (trial-planer)
-- og invoice_settled (betalte planer + trialens udloeb). To asynkrone webhook-handlere
-- kan i teorien behandle samme abonnement samtidigt (fx trial-plan med oprettelsesgebyr).
-- App-lagets "findes firmaet allerede?"-tjek er ikke race-taet alene; denne index goer
-- databasen til sidste dommer. Taberen af et race faar en unique-violation (23505),
-- eventet bogfoeres som dead-letter, og Frisbiis retry genbehandler det korrekt som no-op.
--
-- Partial (where not null): legacy-firmaer og testfirmaer uden Frisbii-abonnement
-- (provision-test-firm.js) beroeres ikke -- NULL'er konflikter aldrig.
--
-- FOER koersel paa prod: verificer at ingen dubletter findes (skal returnere 0 raekker):
--   select frisbii_subscription, count(*)
--   from firms
--   where frisbii_subscription is not null
--   group by frisbii_subscription
--   having count(*) > 1;

create unique index if not exists firms_frisbii_subscription_uniq
  on public.firms (frisbii_subscription)
  where frisbii_subscription is not null;
