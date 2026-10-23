// formular-engangs.js
// -----------------------------------------------------------------------------
// S34 (besluttet af Ann 19/10-26): linket til kundeformularen virker ÉN gang.
//
// Foer: POST /formular/:token slog kun tokenet op, saa hver indsendelse lavede
// en ny opgave — alle med linket (videresendt SMS, browserhistorik) kunne
// oprette opgaver hos firmaet. Genbrug med tilfoejelser paa samme opgave blev
// overvejet og fravalgt 19/10.
//
// Nu: `calls.formular_brugt_at` saettes med ÉN betinget opdatering
//   update calls set formular_brugt_at = now where lead_token = $1
//                                            and formular_brugt_at is null
// To samtidige indsendelser kan ikke begge komme igennem: Postgres laaser
// raekken, og den anden genlaeser WHERE og finder intet. Fejler gemningen
// bagefter, gives linket tilbage (frigivFormular), saa kunden ikke mister sin
// eneste chance til en 500-fejl.
//
// Hvorfor ikke `calls.status`? Den blev kun skrevet af formularen ('completed')
// og af onboardingens demo-opkald ('demo') — og formularen overskrev demo-
// maerket. En kolonne med én betydning er lettere at stole paa. status skrives
// fortsat som foer, saa intet andet aendrer sig.
//
// Bag flaget FORMULAR_ENGANGS_AKTIV: slukket markeres linket stadig som brugt
// (saa data er ens i begge tilstande), men det afvises ikke. Det er
// rollback-haandtaget — et flag i Railway, ikke et deploy.
// -----------------------------------------------------------------------------
"use strict";

const { sendError } = require("@appsignal/nodejs");

function rapporter(besked) {
  console.error("❌ formular-engangs: " + besked);
  try { sendError(new Error("formular-engangs: " + besked)); } catch (_) { /* maa aldrig vaelte kaldet */ }
}

// Tager linket i brug. Returnerer
//   { status: "ok",       call, stempel }   — denne indsendelse maa gemmes
//   { status: "brugt",    call }            — linket er brugt (kun med flaget)
//   { status: "ukendt" }                    — intet opkald har det token
//   { status: "fejl" }                      — databasen svarede ikke
// `call` har id, firm_id, from_number.
async function brugFormular(supabase, token, { aktiv }) {
  const stempel = new Date().toISOString();
  const kolonner = "id, firm_id, from_number";
  try {
    if (!aktiv) {
      // Flaget slukket: opfoer dig som foer, men skriv tidspunktet for FOERSTE
      // brug, hvis det mangler (is null), og brug opkaldet uanset hvad.
      const { data: call, error } = await supabase
        .from("calls").select(kolonner).eq("lead_token", token).maybeSingle();
      if (error) throw error;
      if (!call) return { status: "ukendt" };
      await supabase.from("calls").update({ formular_brugt_at: stempel })
        .eq("id", call.id).is("formular_brugt_at", null);
      return { status: "ok", call, stempel: null };   // intet at give tilbage
    }

    const { data: taget, error } = await supabase
      .from("calls")
      .update({ formular_brugt_at: stempel })
      .eq("lead_token", token)
      .is("formular_brugt_at", null)
      .select(kolonner);
    if (error) throw error;
    if (taget && taget.length) return { status: "ok", call: taget[0], stempel };

    // Ingen raekke opdateret: enten findes tokenet ikke, eller det er brugt.
    const { data: call, error: lFejl } = await supabase
      .from("calls").select(kolonner).eq("lead_token", token).maybeSingle();
    if (lFejl) throw lFejl;
    return call ? { status: "brugt", call } : { status: "ukendt" };
  } catch (e) {
    rapporter(`brug: ${(e && e.code) || ""} ${(e && e.message) || e}`.trim());
    return { status: "fejl" };
  }
}

// Giver linket tilbage, efter at gemningen fejlede. Kun hvis det stadig er
// VORES stempel — en anden indsendelse maa ikke kunne frigive vores.
async function frigivFormular(supabase, callId, stempel) {
  if (!stempel) return;
  try {
    const { error } = await supabase
      .from("calls")
      .update({ formular_brugt_at: null })
      .eq("id", callId)
      .eq("formular_brugt_at", stempel);
    if (error) throw error;
  } catch (e) {
    // Larmer: kunden har nu et brugt link uden en opgave.
    rapporter(`frigiv call ${callId}: ${(e && e.code) || ""} ${(e && e.message) || e}`.trim());
  }
}

// ─── Siderne ────────────────────────────────────────────────────────────────
// Rene funktioner (ingen database), saa proev-formular-graenser.js kan teste
// escaping og det tomme nummer uden netvaerk.

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// "+4512345678" -> "12 34 56 78". Andre numre vises, som de staar.
function visNummer(tlf) {
  const s = String(tlf || "").replace(/\s+/g, "");
  const m = /^(?:\+45|0045)?(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(s);
  return m ? `${m[1]} ${m[2]} ${m[3]} ${m[4]}` : s;
}

// tel:-link maa kun indeholde + og cifre.
function telHref(tlf) {
  const s = String(tlf || "").replace(/[^\d+]/g, "");
  return /^\+?\d{6,15}$/.test(s) ? s : "";
}

const SIDE_STIL = `
    body { font-family: 'Source Sans 3', system-ui, sans-serif; background: #F4F7FA; color: #1C2A38; padding: 24px 16px; text-align: center; }
    .card { background: #fff; border: 1px solid #DDE4EC; border-radius: 16px; padding: 40px 24px; max-width: 480px; margin: 40px auto; box-shadow: 0 12px 40px rgba(26,58,92,.08); }
    h1 { font-family: 'Nunito', sans-serif; font-size: 23px; font-weight: 800; color: #1A3A5C; margin-bottom: 10px; }
    p { color: #4A5D6E; font-size: 16px; line-height: 1.6; margin: 0 0 8px; }
    a.ring { display: inline-block; margin-top: 18px; background: #2C6B9E; color: #fff; text-decoration: none; border-radius: 10px; padding: 14px 22px; font-size: 17px; font-weight: 800; font-family: 'Nunito', sans-serif; }`;

function side(titel, krop) {
  return `<!DOCTYPE html>
<html lang="da">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(titel)}</title>
  <link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Nunito:wght@800&family=Source+Sans+3:wght@400;600&display=swap" rel="stylesheet">
  <style>${SIDE_STIL}
  </style>
</head>
<body>
  <div class="card">
${krop}
  </div>
</body>
</html>`;
}

// Siden, kunden ser, naar linket er brugt. Kun firmanavn og haandvaerkerens
// eget nummer (firms.owner_phone) — ingen kundedata, intet id.
// Ordlyd (tekst 3, Ann 23/10-26): overskriften "Linket er brugt", derunder
// knappen "Ring til [firma]" og under den nummeret. Mangler firmaets eget
// nummer, kan knappen ikke ringe: saa staar kun "Ring til [firma]." som tekst.
function linkBrugtSide({ firmanavn, telefon }) {
  const navn = escapeHtml(firmanavn || "os");
  const href = telHref(telefon);
  const ring = href
    ? `    <a class="ring" href="tel:${escapeHtml(href)}">Ring til ${navn}</a>
    <p><strong>${escapeHtml(visNummer(telefon))}</strong></p>`
    : `    <p>Ring til ${navn}.</p>`;
  return side("Linket er brugt", `    <h1>Linket er brugt</h1>
${ring}`);
}

// Siden ved for store eller for mange billeder. Linket er IKKE taget i brug
// (multer afviser foer brugFormular), saa kunden kan gaa tilbage og sende igen.
// Annes ordlyd (tekst 4, 23/10-26). En ukendt fejl ved modtagelsen siger ikke
// noget om graenserne — den ville vildlede.
function forMangeBillederSide(kode, { maxAntal, maxMb }) {
  const hvad = kode === "for_mange" || kode === "for_stor"
    ? `Du kan højst sende ${maxAntal} billeder og hvert billede må højst fylde ${maxMb} MB.`
    : "Billederne kunne ikke modtages.";
  return side("Prøv igen", `    <h1>Din besked er endnu ikke sendt</h1>
    <p>${escapeHtml(hvad)}</p>
    <p>Gå tilbage, og send igen med færre eller mindre billeder.</p>
    <a class="ring" href="javascript:history.back()">Gå tilbage</a>`);
}

module.exports = {
  brugFormular,
  frigivFormular,
  linkBrugtSide,
  forMangeBillederSide,
  visNummer,
  telHref,
};
