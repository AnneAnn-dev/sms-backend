# `tilbud/` — denne mappe er OFFENTLIG

`server.js` serverer hele denne mappe på `/tilbud` med `express.static`.
**Alt, hvad der lægges her, kan hentes af enhver, der gætter filnavnet.**
Der er ingen login, ingen token, ingen RLS foran.

## Reglen

> Her ligger kun det, browseren skal bruge: HTML, CSS, klient-JS, ikoner og billeder.
> Alt andet bor uden for mappen og hentes gennem et endpoint.

## Hvad der ALDRIG må ligge her

- **Promptskabeloner og systemprompt-fragmenter.** Tilbudsmodulets første invariant er,
  at prompten konstrueres server-side. En promptfil i denne mappe bryder den — uden at
  nogen har skrevet en linje forkert kode. Filen ligger bare det forkerte sted.
- **Priser, marginer, prislogik.** Kunden må ikke kunne læse, hvordan tallet bliver til.
- **Kvote- og budgetlogik** (Ø2). Den, der kan læse loftet, kan planlægge rundt om det.
- **Valideringsregler for modeloutput.** Afslører, hvad der slipper igennem.
- **Serverkode.** Alt med `require(`, `process.env` eller adgang til Supabase.
- **Nøgler af enhver art.** Også dem, der "kun" er til test.

## Hvorfor filen findes

En byte-identisk kopi af `onboarding-link.js` blev fundet i `static/` den 8/8-2026 —
serverkode i en offentlig mappe, lagt der ved et uheld. Ingen skrev forkert kode;
en fil landede bare det forkerte sted.

Denne mappe fandtes ikke, da reglen blev skrevet — den blev oprettet TIL reglen.
Det var meningen: en regel er gratis at indføre, før den første fil findes, og dyr,
når der ligger tredive filer, der skal sorteres.

Reglen står her og ikke i et dokument, fordi det er her, fejlen ville blive begået.

Se **S17** i `docs/RISIKOREGISTER.md`.
