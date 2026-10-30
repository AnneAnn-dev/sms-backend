// billedoprydning.js — sletter en opgaves billedfiler i Storage.
//
// D94 trin 3b / D96 (29/10-26). Stien er `lead-images/<opgave-id>/<fil>`
// (billeder.js er eneste skriver, grep 29/10). `lead_images`-raekkerne
// foelger opgaven med CASCADE, men FILERNE goer ikke — det var saadan, 36
// filer i prod og 22 i staging blev liggende uden opgave (D96).
//
// Kaldes EFTER databasens commit (Storage er ikke i transaktionen og ikke i
// PITR). En fejl stopper ikke de andre opgaver; den returneres med
// opgave-id'et, saa kalderen kan logge den og en ny koersel af
// ryd-forladte-billeder.js kan tage resten. Fælles for Slet kunde og, paa
// sigt, delete-firma.js.
//
// INGEN PERSONDATA: kun opgave-id'er og antal — aldrig filnavne.
"use strict";

const BUCKET = "lead-images";
const SIDE = 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function listOpgavensFiler(supabase, opgaveId) {
  const ud = [];
  for (let offset = 0; ; offset += SIDE) {
    const { data, error } = await supabase.storage.from(BUCKET)
      .list(opgaveId, { limit: SIDE, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error(error.message);
    const side = data || [];
    side.filter((f) => f.id).forEach((f) => ud.push(`${opgaveId}/${f.name}`));
    if (side.length < SIDE) return ud;
  }
}

// → { filer: <antal slettet>, fejl: [{ opgaveId, besked }] }
async function sletOpgaveBilleder(supabase, opgaveIder) {
  let filer = 0;
  const fejl = [];
  for (const opgaveId of opgaveIder || []) {
    if (!UUID.test(String(opgaveId))) { fejl.push({ opgaveId: String(opgaveId), besked: "ikke et opgave-id" }); continue; }
    try {
      const stier = await listOpgavensFiler(supabase, opgaveId);
      for (let i = 0; i < stier.length; i += SIDE) {
        const del = stier.slice(i, i + SIDE);
        const { error } = await supabase.storage.from(BUCKET).remove(del);
        if (error) throw new Error(error.message);
        filer += del.length;
      }
    } catch (e) {
      fejl.push({ opgaveId, besked: (e && e.message) || String(e) });
    }
  }
  return { filer, fejl };
}

module.exports = { sletOpgaveBilleder };
