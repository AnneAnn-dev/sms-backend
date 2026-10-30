// proev-formular-udloeb.js — D97 (30/10-26): kundeformularens link udloeber
// 7 dage efter opkaldet. Rene funktioner og brugFormular() mod en falsk
// database — intet net, ingen noegler. Koeres i CI (KOERES).
"use strict";
const { brugFormular, erUdloebet, linkUdloebetSide, FORMULAR_LEVETID_MS } = require("./formular-engangs");
let ok = 0, fejl = 0;
const t = (n, b) => { if (b) ok++; else { fejl++; console.log("  FEJL:", n); } };

const NU = Date.parse("2026-10-30T12:00:00Z");
const DAG = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

// Falsk Supabase: én tabel `calls`, nok af PostgREST-kaedeformen til brugFormular.
function falsk(rows) {
  const opdateret = [];
  const from = () => {
    const q = { _f: [], _upd: null, _is: [] };
    q.select = () => q;
    q.eq = (k, v) => { q._f.push([k, v]); return q; };
    q.is = (k, v) => { q._is.push([k, v]); return q; };
    q.update = (o) => { q._upd = o; return q; };
    const match = () => rows.filter((r) => q._f.every(([k, v]) => r[k] === v) && q._is.every(([k, v]) => (r[k] ?? null) === v));
    q.maybeSingle = async () => ({ data: match()[0] ? { ...match()[0] } : null, error: null });
    q.then = (res) => {
      if (q._upd) { const m = match(); m.forEach((r) => Object.assign(r, q._upd)); opdateret.push(...m.map((r) => r.id)); return res({ data: m.map((r) => ({ ...r })), error: null }); }
      return res({ data: match(), error: null });
    };
    return q;
  };
  return { from, opdateret };
}
const kald = (id, token, alderDage, brugt = null) => ({ id, lead_token: token, firm_id: "F", from_number: "+4590000001", created_at: iso(NU - alderDage * DAG), formular_brugt_at: brugt });

(async () => {
  t("levetid er 7 døgn", FORMULAR_LEVETID_MS === 7 * DAG);
  t("6 dage: ikke udløbet", !erUdloebet(iso(NU - 6 * DAG), NU));
  t("præcis 7 døgn: ikke udløbet", !erUdloebet(iso(NU - 7 * DAG), NU));
  t("7 døgn og 1 sekund: udløbet", erUdloebet(iso(NU - 7 * DAG - 1000), NU));
  t("ulæselig dato: ikke udløbet (kunden mister ikke formularen)", !erUdloebet("ikke en dato", NU) && !erUdloebet(null, NU));

  let db = falsk([kald("c1", "gammel", 8)]);
  let r = await brugFormular(db, "gammel", { aktiv: true, udloeb: true, nu: NU });
  t("udløbet + flag: status udloebet med firm_id", r.status === "udloebet" && r.call.firm_id === "F" && !("created_at" in r.call));
  t("udløbet link tages IKKE i brug (intet stempel)", db.opdateret.length === 0);

  db = falsk([kald("c2", "frisk", 2)]);
  r = await brugFormular(db, "frisk", { aktiv: true, udloeb: true, nu: NU });
  t("frisk link: ok og stemplet", r.status === "ok" && db.opdateret[0] === "c2");

  db = falsk([kald("c3", "gammel", 30)]);
  r = await brugFormular(db, "gammel", { aktiv: true, udloeb: false, nu: NU });
  t("flag slukket: gammelt link virker som før", r.status === "ok");

  db = falsk([]);
  r = await brugFormular(db, "findes-ikke", { aktiv: true, udloeb: true, nu: NU });
  t("ukendt token: ukendt", r.status === "ukendt");

  db = falsk([kald("c4", "brugt-og-gammel", 9, iso(NU - 8 * DAG))]);
  r = await brugFormular(db, "brugt-og-gammel", { aktiv: true, udloeb: true, nu: NU });
  t("brugt og gammel: udloebet (før stemplet)", r.status === "udloebet" && db.opdateret.length === 0);

  db = falsk([kald("c5", "gammel", 8)]);
  r = await brugFormular(db, "gammel", { aktiv: false, udloeb: true, nu: NU });
  t("udløb virker også uden engangsflaget", r.status === "udloebet");

  const side = linkUdloebetSide({ firmanavn: "Dortes <b>Dukker</b>", telefon: "+4526841720" });
  t("siden: overskrift", /<h1>Linket er udløbet\.<\/h1>/.test(side));
  t("siden: Ring til [firma] på [nummer]. med tel-link", /<p>Ring til Dortes &lt;b&gt;Dukker&lt;\/b&gt; på <a href="tel:\+4526841720"><strong>26 84 17 20<\/strong><\/a>\.<\/p>/.test(side));
  t("siden: firmanavnet escapes", !side.includes("<b>Dukker</b>"));
  const uden = linkUdloebetSide({ firmanavn: "Dortes Dukker", telefon: "" });
  t("uden nummer: Ring til [firma].", /<p>Ring til Dortes Dukker\.<\/p>/.test(uden) && !uden.includes("tel:"));
  const ukendt = linkUdloebetSide({});
  t("uden firma: Ring til os.", /Ring til os\./.test(ukendt));

  console.log(`${ok}/${ok + fejl}`); process.exit(fejl ? 1 : 0);
})();
