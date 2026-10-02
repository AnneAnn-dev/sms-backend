// prompts/referat.js — systemprompten til referatet. ÉN kilde, ét sted.
//
// ⚠️ ORDRET KOPI af prøvebænkens `03-referat.ps1`. Den er MÅLT, ikke skrevet.
// Hvert ord i den har kostet en kørsel, og to af reglerne er resultatet af en
// måling, der ændrede en beslutning:
//
//   "BRUG DE ORD, DER STAAR I TEKSTEN"  — besluttet 27/9. Modellen må IKKE
//   rette whispers fejl. Håndværkerne er ikke trænede læsere: en pæn tekst
//   bliver læst hurtigt og godkendt, mens "bosvand" bliver set, og han ved
//   selv, hvad der skulle have stået. Prisen er taget med: referaterne bliver
//   længere og indeholder volapyk. Tallene i RESULTAT-06.
//
//   "SAML DET, DER HOERER SAMMEN" + "HOEJST 15 PUNKTER" — besluttet 2/10 af
//   Anne ud fra to eksempler side om side. Anledningen: 3 af 7 referater blev
//   afvist på "for mange punkter" (24-25 mod grænsen 20), fordi modellen delte
//   ét emne op i fem linjer. Efter ændringen: 7 af 7 bestod, 12-15 punkter.
//
// ⚠️ ÆNDRER DU ÉN LINJE HER, ER MÅLINGERNE IKKE LÆNGERE OM DENNE PROMPT.
// Så skal prøvebænkens syv køres om (`03-referat.ps1 -Variant <navn>`) og
// teknik B måles på de nye referater. Begge dele tager tre kvarter og koster
// en halv krone. Det er billigt; det at tro på et gammelt tal er ikke.
//
// ASCII som i prøvebænken — teksten er transskriberet med ae/oe/aa, og
// modellen svarer alligevel på rigtigt dansk. Rør det ikke uden at måle.
//
// S6: systemprompten og brugerteksten holdes adskilt hele vejen til kaldet og
// sættes ALDRIG sammen til én streng. Transskriptionen er data, ikke
// instruktion.

"use strict";

const REFERAT_SYSTEMPROMPT = `Du laver et referat af en haandvaerkers egen indtaling.

Teksten er en raa transskription af noget, brugeren selv har talt ind. Den kan
indeholde gentagelser, afbrudte saetninger og fejl fra tale-til-tekst.

Regler:
- Referer KUN hvad der staar i teksten. Find aldrig paa detaljer, navne, datoer,
  maal eller aftaler, der ikke er der.
- BRUG DE ORD, DER STAAR I TEKSTEN. Skriv ikke et andet ord for det samme.
- Materialer, fagudtryk, navne, maal og maengder gengives ORDRET -- ogsaa hvis de
  ser forkerte ud. Ret dem ikke, og glat dem ikke ud.
- Du MAA forkorte, udelade gentagelser og samle indholdet i punkter.
  Du maa IKKE bytte de enkelte ord ud med paenere ord.
- SAML DET, DER HOERER SAMMEN, I ET ENKELT PUNKT. Hoerer flere saetninger til
  samme emne -- fx en membran, en slags fliser, en revne -- bliver de ET punkt,
  ikke fem. Del ikke et emne op paa flere linjer.
- HOEJST 15 PUNKTER. Er der flere, hoerer noget af det sammen og skal samles.
- Gengiv alle tal, maal og maengder noejagtigt som de staar.
- Er noget uklart i teksten, skal det staa uklart i referatet. Gaet ikke.
- Skriv paa dansk, kort og konkret, som en haandvaerker ville skrive til sig selv.
- Skriv ikke en dato. Systemet saetter selv datoen.

Svar KUN med JSON i praecis denne form, uden kodeblok-hegn og uden tekst udenom:

{"overskrift": "kort titel, under 100 tegn",
 "punkter": ["kort punkt", "kort punkt"],
 "fritekst": "sammenhaengende referat i prosa"}

Ingen andre felter.`;

// Versionen følger med i loggen og i ai_forbrug-rækkens model-felt, så et
// forbrug fra i går kan forklares, når prompten er ændret. Hæv den HVER gang
// teksten ovenfor ændres.
const REFERAT_PROMPT_VERSION = "2026-10-02";

module.exports = { REFERAT_SYSTEMPROMPT, REFERAT_PROMPT_VERSION };
