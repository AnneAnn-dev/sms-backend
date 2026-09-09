// ─────────────────────────────────────────────────────────────────────────────
// SLUG — firma-slug til maskerede formular-URL'er (opgave.ditdigitalekontor.dk/{slug}/…)
//
// slugify() matcher den SQL-backfill der satte slugs på eksisterende firmaer:
//   lowercase, æ/ø/å → ae/oe/aa, ikke-alfanumerisk → bindestreg, trim, max 40 tegn.
//
// uniqueSlug() tjekker mod databasen og tilføjer -2, -3 ... ved kollision, så to
// firmaer med samme navn ikke får samme slug. Vigtigt nu, hvor der allerede er
// slugs i tabellen fra backfill'en.
//
//   const { uniqueSlug } = require("./slug");
//   const slug = await uniqueSlug(supabase, firmName);
// ─────────────────────────────────────────────────────────────────────────────

// Sluggen er ren pynt i linket: ruten /:slug/:token slaar KUN tokenet op og
// ignorerer sluggen. Men den koster plads i kunde-SMS'en, hvor firmanavn og
// slug deler 46 tegn (resten er fast tekst + domaene + token). Uden loft aad
// sluggen omtrent lige saa meget som navnet — og aeoeaa bliver til to tegn
// hver, saa den var tit dyrest. Med et loft er navnets graense ét fast tal i
// stedet for "mellem 21 og 23, afhaengigt af bogstaverne".
const SLUG_MAKS = 12;

// Klipper ved en BINDESTREG, saa sluggen ender paa et helt ord: "soerensens"
// frem for "soerensens-t". Foerste ord laengere end loftet klippes haardt —
// der er ikke andet at goere, og ingen laeser det alligevel.
function kapSlug(slug) {
  if (slug.length <= SLUG_MAKS) return slug;
  const vindue = slug.slice(0, SLUG_MAKS + 1);
  const sidste = vindue.lastIndexOf("-");
  const kort = sidste > 0 ? vindue.slice(0, sidste) : slug.slice(0, SLUG_MAKS);
  return kort.replace(/-+$/, "") || slug.slice(0, SLUG_MAKS);
}

function slugify(name) {
  return (name || "")
    .toLowerCase()
    .replace(/æ/g, "ae").replace(/ø/g, "oe").replace(/å/g, "aa")
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "") // fjern resterende accenter (é → e)
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/, "") || "firma";
}

// Returnerer en slug der ikke allerede findes i firms.slug.
async function uniqueSlug(supabase, name) {
  const base = kapSlug(slugify(name));
  let slug = base;
  let n = 2;
  // Loop indtil ingen kollision. I praksis 1 forsøg; flere kun ved enslydende navne.
  while (true) {
    const { data } = await supabase
      .from("firms")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (!data) return slug;
    slug = `${base}-${n++}`;
  }
}

module.exports = { slugify, uniqueSlug, kapSlug, SLUG_MAKS };
