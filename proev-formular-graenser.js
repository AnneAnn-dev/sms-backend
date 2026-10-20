// proev-formular-graenser.js
// -----------------------------------------------------------------------------
// D88 trin 2 / S34 (19/10-26): graenserne paa billeder og siderne for et brugt
// link. INGEN database, INGEN .env — koerer i CI (KOERES i kor-proever.js).
//
//   node proev-formular-graenser.js
//
// Hvad den maaler, og hvorfor:
//   * filsti(): kundens filnavn kommer ALDRIG med i stien; endelsen kommer fra
//     hvidlisten; svg og ikke-billeder afvises (S33-klassen: et ' eller ../ i
//     filnavnet maa ikke kunne bryde ud).
//   * medUpload(): en RIGTIG multipart-forespoergsel mod en lille Express-app
//     paa en tilfaeldig port — 6 filer = for_mange, 11 MB = for_stor, en pdf
//     springes over, mens billedet ved siden af kommer igennem.
//   * gemBilleder(): loftet paa 20 pr. opgave, en fejlet upload vaelter ikke de
//     andre, og kan billederne ikke taelles, gemmes intet.
//   * linkBrugtSide(): firmanavnet escapes, et tomt nummer giver ingen
//     ring-knap, og tel:-linket indeholder kun + og cifre.
// Sidste linje er "bestaaet/i alt", som kor-proever.js laeser.
// -----------------------------------------------------------------------------
"use strict";

const http = require("http");
const express = require("express");
const b = require("./billeder");
const { linkBrugtSide, forMangeBillederSide, visNummer, telHref } = require("./formular-engangs");

let ok = 0, alle = 0;
function tjek(navn, betingelse, detalje) {
  alle++;
  if (betingelse) { ok++; console.log("OK    " + navn); }
  else console.log("FEJL  " + navn + (detalje !== undefined ? "  -> " + JSON.stringify(detalje) : ""));
}
function kaster(f) { try { f(); return false; } catch (_) { return true; } }

const LEAD = "11111111-2222-3333-4444-555555555555";

async function main() {
  // ── filsti og typer ─────────────────────────────────────────────────────
  const sti = b.filsti(LEAD, "image/jpeg");
  tjek("filsti: under opgavens mappe", sti.startsWith(LEAD + "/"), sti);
  tjek("filsti: kun tid, uuid og endelse fra hvidlisten",
    /^[0-9a-f-]{36}\/\d+-[0-9a-f-]{36}\.jpg$/.test(sti), sti);
  tjek("filsti: PNG giver .png", b.filsti(LEAD, "IMAGE/PNG").endsWith(".png"));
  tjek("filsti: svg afvises", kaster(() => b.filsti(LEAD, "image/svg+xml")));
  tjek("filsti: pdf afvises", kaster(() => b.filsti(LEAD, "application/pdf")));
  tjek("filsti: ugyldigt lead-id afvises", kaster(() => b.filsti("../x", "image/jpeg")));
  tjek("erTilladtType: heic ja, svg nej, tom nej",
    b.erTilladtType("image/heic") && !b.erTilladtType("image/svg+xml") && !b.erTilladtType(""));
  tjek("graenser: 5 pr. indsendelse, 10 MB, 20 pr. opgave",
    b.MAX_BILLEDER_PR_INDSENDELSE === 5 && b.MAX_BYTES_PR_BILLEDE === 10 * 1024 * 1024 && b.MAX_BILLEDER_PR_OPGAVE === 20);

  // ── medUpload mod en rigtig multipart-forespoergsel ─────────────────────
  const app = express();
  app.post("/u", b.medUpload("billeder", (req, res, kode) => res.status(413).json({ kode })),
    (req, res) => res.json({
      antal: (req.files || []).length,
      afvist: req.afvisteFiler || 0,
      navne: (req.files || []).map((f) => f.originalname),
      felt: req.body && req.body.navn,
    }));
  const server = http.createServer(app);
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = `http://127.0.0.1:${server.address().port}/u`;

  async function send(filer) {
    const fd = new FormData();
    fd.append("navn", "Anders");
    for (const [navn, type, bytes] of filer) fd.append("billeder", new Blob([Buffer.alloc(bytes, 1)], { type }), navn);
    const r = await fetch(url, { method: "POST", body: fd });
    return { status: r.status, krop: await r.json() };
  }

  try {
    const en = await send([["a.jpg", "image/jpeg", 1000]]);
    tjek("upload: ét billede kommer igennem", en.status === 200 && en.krop.antal === 1, en);

    const fem = await send(Array.from({ length: 5 }, (_, i) => [`${i}.jpg`, "image/jpeg", 100]));
    tjek("upload: 5 billeder er tilladt", fem.status === 200 && fem.krop.antal === 5, fem);

    const seks = await send(Array.from({ length: 6 }, (_, i) => [`${i}.jpg`, "image/jpeg", 100]));
    tjek("upload: 6 billeder = for_mange", seks.status === 413 && seks.krop.kode === "for_mange", seks);

    const stor = await send([["stor.jpg", "image/jpeg", 11 * 1024 * 1024]]);
    tjek("upload: 11 MB = for_stor", stor.status === 413 && stor.krop.kode === "for_stor", stor);

    const blandet = await send([["faktura.pdf", "application/pdf", 100], ["b.png", "image/png", 100], ["x.svg", "image/svg+xml", 100]]);
    tjek("upload: pdf og svg springes over, billedet og teksten kommer igennem",
      blandet.status === 200 && blandet.krop.antal === 1 && blandet.krop.afvist === 2 && blandet.krop.felt === "Anders", blandet);
  } finally {
    server.close();
  }

  // ── gemBilleder med en falsk Supabase ────────────────────────────────────
  function falskSupabase({ antal = 0, taelleFejl = false, fejlPaaUpload = [] } = {}) {
    const log = { uploads: [], raekker: [] };
    let n = 0;
    return {
      log,
      from(tabel) {
        return {
          select() { return { eq: async () => (taelleFejl ? { error: { code: "X", message: "nede" } } : { count: antal, error: null }) }; },
          insert: async (r) => { log.raekker.push(r); return { error: null }; },
        };
      },
      storage: {
        from() {
          return {
            upload: async (s) => {
              const i = n++;
              if (fejlPaaUpload.includes(i)) return { error: { statusCode: 500, message: "storage nede" } };
              log.uploads.push(s); return { error: null };
            },
            getPublicUrl: (s) => ({ data: { publicUrl: "https://x.supabase.co/storage/v1/object/public/lead-images/" + s } }),
          };
        },
      },
    };
  }
  const fil = (navn) => ({ mimetype: "image/jpeg", buffer: Buffer.from("x"), originalname: navn });

  const s1 = falskSupabase({ antal: 18 });
  const r1 = await b.gemBilleder(s1, LEAD, [fil("1"), fil("2"), fil("3"), fil("4"), fil("5")]);
  tjek("loft: 18 i forvejen + 5 = 2 gemt, 3 over loftet",
    r1.gemt === 2 && r1.oversteg === 3 && s1.log.uploads.length === 2, r1);

  const s2 = falskSupabase({ antal: 0, fejlPaaUpload: [1] });
  const r2 = await b.gemBilleder(s2, LEAD, [fil("1"), fil("2"), fil("3")]);
  tjek("fejl: én fejlet upload vaelter ikke de andre", r2.gemt === 2 && r2.fejlede === 1, r2);
  tjek("fejl: kundens filnavn staar hverken i sti eller raekke",
    !JSON.stringify(s2.log).includes("1\"") && s2.log.raekker.every((r) => !/\/[123]$/.test(r.image_url)), s2.log);

  const s3 = falskSupabase({ taelleFejl: true });
  const r3 = await b.gemBilleder(s3, LEAD, [fil("1"), fil("2")]);
  tjek("loft: kan der ikke taelles, gemmes intet", r3.gemt === 0 && r3.fejlede === 2 && s3.log.uploads.length === 0, r3);

  const r4 = await b.gemBilleder(falskSupabase(), LEAD, undefined);
  tjek("ingen filer = intet at goere", r4.gemt === 0 && r4.fejlede === 0 && r4.oversteg === 0, r4);

  // ── siderne ──────────────────────────────────────────────────────────────
  const side1 = linkBrugtSide({ firmanavn: "<b>Bent's VVS</b>", telefon: "+4512345678" });
  tjek("brugt-side: firmanavnet escapes", side1.includes("&lt;b&gt;Bent&#39;s VVS&lt;/b&gt;") && !side1.includes("<b>Bent"));
  tjek("brugt-side: nummeret vises og kan ringes op",
    side1.includes("12 34 56 78") && side1.includes('href="tel:+4512345678"'));
  const side2 = linkBrugtSide({ firmanavn: "Bent VVS", telefon: null });
  tjek("brugt-side: tomt nummer = ingen ring-knap, men firmanavnet staar", !side2.includes("tel:") && side2.includes("Ring til Bent VVS"));
  tjek("brugt-side: intet navn = 'os'", linkBrugtSide({}).includes("Ring til os"));
  tjek("tel-link: kun + og cifre", telHref("+45 12-34 56 78") === "+4512345678" && telHref("javascript:alert(1)") === "");
  tjek("visNummer: dansk nummer grupperes", visNummer("+4587654321") === "87 65 43 21" && visNummer("004587654321") === "87 65 43 21");
  tjek("for-mange-side: siger graensen",
    forMangeBillederSide("for_mange", { maxAntal: 5, maxMb: 10 }).includes("højst 5 billeder") &&
    forMangeBillederSide("for_stor", { maxAntal: 5, maxMb: 10 }).includes("10 MB"));

  console.log(`\n${ok}/${alle}`);
  process.exit(ok === alle ? 0 : 1);
}

main().catch((e) => { console.error(e); console.log(`\n${ok}/${alle + 1}`); process.exit(1); });
