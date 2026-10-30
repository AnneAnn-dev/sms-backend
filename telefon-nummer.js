// telefon-nummer.js
// -----------------------------------------------------------------------------
// Fase 3, T7a (30/10-26): telefonnummerets egne funktioner. Telefonpasser
// bliver et tilkoeb som de andre moduler (D25), saa nummeret skal kunne
// tildeles og frigives for sig - ikke kun ved oprettelse og udloeb.
//
//   sikrTelefonModul  - giver et nyt firma telefon-raekken (kilde 'auto'), som
//                       triggeren firma_faar_telefon gjorde. Triggeren fjernes
//                       i samme udgivelse (migrationen t7a).
//   tildelNummer      - giver et firma et nummer fra puljen. Idempotent: har
//                       firmaet et, sker intet. Tom pulje -> { status: "tom" },
//                       aldrig en undtagelse (kalderen beslutter, T7b).
//   frigivNummer      - laegger firmaets nummer tilbage i puljen, med karantaene
//                       hvis nummeret har vaeret VERIFICERET (Ann 30/10, D95).
//   karantaeneTil     - ren regel: hvornaar maa nummeret genbruges.
//
// KARANTAENE (D95, Ann 30/10): har nummeret vaeret verificeret, har det vaeret
// kundens - det staar paa bilen og i kundernes telefoner - og det faar
// karantaene, uanset hvad kunden har betalt. Foer afgjordes det af, om Frisbii
// havde en betalt faktura, og en 0-kr.-pris (DB Toemrer) blev dermed doemt
// "proevekunde" og nummeret frigivet straks. firms.nummer_verificeret_at saettes
// ved foerste verifikation og ryddes aldrig (verification_status gaar tilbage
// til "pending" ved hvert nyt testopkald, saa den kan ikke bruges til det).
//
// Ingen afhaengigheder ud over phone.js. Klienterne sendes ind som argumenter.
// -----------------------------------------------------------------------------
"use strict";

const { vaelgLedigtNummer } = require("./phone");

const KARANTAENE_DAGE = () => Number(process.env.QUARANTINE_DAYS_PAID) || 30;

// Ren regel. firma: { nummer_verificeret_at }. Returnerer ISO-tid eller null
// (null = maa genbruges straks).
function karantaeneTil(firma, nu = new Date().toISOString(), dage = KARANTAENE_DAGE()) {
  if (!firma || !firma.nummer_verificeret_at) return null;
  if (!(dage > 0)) return null;
  return new Date(new Date(nu).getTime() + dage * 24 * 60 * 60 * 1000).toISOString();
}

async function sikrTelefonModul(supabase, firmId) {
  const { error } = await supabase
    .from("firma_moduler")
    .upsert({ firm_id: firmId, modul: "telefon", kilde: "auto" }, { onConflict: "firm_id,modul", ignoreDuplicates: true });
  if (error) throw new Error(`sikrTelefonModul: ${error.message}`);
}

async function hentFirma(supabase, firmId) {
  const { data, error } = await supabase
    .from("firms").select("id, phone_number, nummer_verificeret_at").eq("id", firmId).maybeSingle();
  if (error) throw new Error(`firms: ${error.message}`);
  if (!data) throw new Error(`firma ${String(firmId).slice(0, 8)} findes ikke`);
  return data;
}

// Returnerer { status: "har" | "tildelt" | "tom", nummer, spoegelser, ledigeVerificeret }.
// Race-sikker: puljeraekken tages kun, hvis den stadig er ledig (firm_id null),
// og firmaet faar kun nummeret, hvis det stadig ikke har et. Taber vi et kaploeb
// om puljeraekken, proeves naeste (hoejst 3 gange).
async function tildelNummer({ supabase, twilioClient, firmId }) {
  const firma = await hentFirma(supabase, firmId);
  if (firma.phone_number) return { status: "har", nummer: firma.phone_number, spoegelser: [], ledigeVerificeret: null };

  let spoegelser = [], ledigeVerificeret = 0;
  for (let forsoeg = 1; forsoeg <= 3; forsoeg++) {
    const v = await vaelgLedigtNummer({ supabase, twilioClient }); // kaster, hvis Twilio ikke kan spoerges
    spoegelser = v.spoegelser; ledigeVerificeret = v.ledigeVerificeret;
    if (!v.valgt) return { status: "tom", nummer: null, spoegelser, ledigeVerificeret };

    // 1) Tag puljeraekken - kun hvis den stadig er ledig.
    const { data: taget, error: tErr } = await supabase
      .from("phone_numbers").update({ firm_id: firmId })
      .eq("id", v.valgt.id).is("firm_id", null).select("id");
    if (tErr) throw new Error(`phone_numbers: ${tErr.message}`);
    if (!taget || !taget.length) continue; // en anden naaede det foerst

    // 2) Giv firmaet nummeret - kun hvis det stadig ikke har et.
    const { data: sat, error: sErr } = await supabase
      .from("firms").update({ phone_number: v.valgt.number })
      .eq("id", firmId).is("phone_number", null).select("id");
    if (sErr || !sat || !sat.length) {
      // Laeg puljeraekken tilbage, saa den ikke bliver haengende uden firma-kobling.
      await supabase.from("phone_numbers").update({ firm_id: null }).eq("id", v.valgt.id).eq("firm_id", firmId);
      if (sErr) throw new Error(`firms: ${sErr.message}`);
      const nu = await hentFirma(supabase, firmId);
      return { status: "har", nummer: nu.phone_number, spoegelser, ledigeVerificeret };
    }
    return { status: "tildelt", nummer: v.valgt.number, spoegelser, ledigeVerificeret: ledigeVerificeret - 1 };
  }
  throw new Error("tildelNummer: tabte kaploebet om puljen tre gange - proev igen");
}

// Returnerer { status: "intet" | "frigivet", nummer, karantaeneTil }.
// Rydder BEGGE registreringer: puljeraekkens firm_id og firms.phone_number.
// Idempotent: anden koersel finder intet og returnerer "intet".
async function frigivNummer({ supabase, firmId, nu = new Date().toISOString() }) {
  const firma = await hentFirma(supabase, firmId);
  const til = karantaeneTil(firma, nu);

  const { data: frigivne, error: pErr } = await supabase
    .from("phone_numbers")
    .update({ firm_id: null, quarantined_until: til, last_firm_id: firmId })
    .eq("firm_id", firmId).select("number");
  if (pErr) throw new Error(`phone_numbers: ${pErr.message}`);

  if (firma.phone_number) {
    const { error: fErr } = await supabase.from("firms").update({ phone_number: null }).eq("id", firmId);
    if (fErr) throw new Error(`firms: ${fErr.message}`);
  }
  const nummer = firma.phone_number || (frigivne && frigivne[0] && frigivne[0].number) || null;
  if (!nummer && !(frigivne && frigivne.length)) return { status: "intet", nummer: null, karantaeneTil: null };
  return { status: "frigivet", nummer, karantaeneTil: til };
}

module.exports = { karantaeneTil, sikrTelefonModul, tildelNummer, frigivNummer };
