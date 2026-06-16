// ─────────────────────────────────────────────────────────────────────────────
// SLUG — firma-slug til maskerede formular-URL'er (opgave.lommekontor.dk/{slug}/…)
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
  const base = slugify(name);
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

module.exports = { slugify, uniqueSlug };
