// auth.js
// -----------------------------------------------------------------------------
// Delt adgangskontrol. Udleder firmaets id fra brugerens login-token (Supabase
// session) i stedet for at stole paa et firm_id sendt i request-body'en.
//
// Bruges af baade server.js og onboarding.js, saa firma-scopede endpoints altid
// kun rammer DET firma den indloggede bruger ejer — aldrig et fremmed firma.
//
// Brug i en route:
//   const firmId = await firmIdFromToken(supabase, req);
//   if (!firmId) return res.status(401).json({ error: "Ikke logget ind" });
//   // ... brug firmId, ignorér ethvert firm_id i body'en
// -----------------------------------------------------------------------------

async function firmIdFromToken(supabase, req) {
  const token = req.headers.authorization?.replace("Bearer ", "");
  if (!token) return null;

  const { data: { user }, error } = await supabase.auth.getUser(token);
  if (error || !user) return null;

  const { data: firmUser } = await supabase
    .from("firm_users")
    .select("firm_id")
    .eq("user_id", user.id)
    .single();

  return firmUser?.firm_id || null;
}

module.exports = { firmIdFromToken };
