// proev-billedoprydning.js — billedoprydning.js mod en falsk Storage (D94 3b).
// Koeres i CI (KOERES). Ingen net, ingen noegler.
"use strict";
const { sletOpgaveBilleder } = require("./billedoprydning");
let ok = 0, fejl = 0;
const t = (n, b) => { if (b) ok++; else { fejl++; console.log("  FEJL:", n); } };
const A = "11111111-1111-4111-8111-111111111111", B = "22222222-2222-4222-8222-222222222222", C = "33333333-3333-4333-8333-333333333333";
function lav({ fejlPaa } = {}) {
  const filer = { [A]: [], [B]: ["b.jpg"], [C]: ["c.jpg"] };
  for (let i = 0; i < 230; i++) filer[A].push(`f${String(i).padStart(3, "0")}.jpg`);
  const kald = [];
  return { filer, kald, storage: { from: (b) => ({
    list: async (p, { limit, offset }) => {
      kald.push(["list", b, p]);
      if (p === fejlPaa) return { data: null, error: { message: "nede" } };
      return { data: (filer[p] || []).slice(offset, offset + limit).map((n) => ({ name: n, id: "x" })), error: null };
    },
    remove: async (st) => { kald.push(["remove", b, st.length]); st.forEach((s) => { const [m, n] = s.split("/"); filer[m] = filer[m].filter((x) => x !== n); }); return { error: null }; },
  }) } };
}
(async () => {
  let sb = lav();
  let r = await sletOpgaveBilleder(sb, [A, B]);
  t("230 + 1 filer slettet", r.filer === 231 && r.fejl.length === 0);
  t("over flere sider (list) og i bidder af hoejst 100 (remove)", sb.kald.filter((k) => k[0] === "remove").every((k) => k[2] <= 100) && sb.kald.filter((k) => k[0] === "list" && k[2] === A).length === 3);
  t("kun bucket lead-images", sb.kald.every((k) => k[1] === "lead-images"));
  t("andre opgavers filer uroert", sb.filer[C].length === 1);
  sb = lav({ fejlPaa: B });
  r = await sletOpgaveBilleder(sb, [B, C]);
  t("fejl paa én opgave stopper ikke de andre", r.filer === 1 && r.fejl.length === 1 && r.fejl[0].opgaveId === B && sb.filer[C].length === 0);
  r = await sletOpgaveBilleder(lav(), ["../" + A, "", null]);
  t("ikke-id'er afvises uden at kalde Storage", r.filer === 0 && r.fejl.length === 3);
  r = await sletOpgaveBilleder(lav(), []);
  t("tom liste: intet", r.filer === 0 && r.fejl.length === 0);
  console.log(`${ok}/${ok + fejl}`); process.exit(fejl ? 1 : 0);
})();
