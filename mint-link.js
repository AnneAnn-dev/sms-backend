// mint-link.js  →  node mint-link.js din@email.dk
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
(async () => {
  const email = process.argv[2];
  const { data, error } = await supabase.auth.admin.generateLink({ type: 'magiclink', email });
  if (error) return console.error(error);
  const t = data.properties.hashed_token;
  const base = (process.env.DASHBOARD_URL || process.env.BASE_URL || '').replace(/\/$/, '');
  console.log(`${base}/onboarding?token_hash=${t}&type=magiclink`);
})();