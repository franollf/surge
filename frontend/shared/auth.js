// ─────────────────────────────────────────────
// SURGE — Shared Auth Helper
// frontend/shared/auth.js
// ─────────────────────────────────────────────

const SUPABASE_URL  = CONFIG.SUPABASE_URL;
const SUPABASE_ANON = CONFIG.SUPABASE_ANON;

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

/**
 * Call this at the top of any protected page.
 * If no session exists, redirects to login immediately.
 * Returns the session object if valid.
 */
async function requireAuth() {
  const { data } = await sb.auth.getSession();
  if (!data.session) {
    window.location.href = "../login/login.html";
    return null;
  }
  return data.session;
}

/**
 * Returns the current logged-in user, or null.
 */
async function getCurrentUser() {
  const { data } = await sb.auth.getUser();
  return data?.user ?? null;
}

/**
 * Signs the admin out and redirects to login.
 */
async function signOut() {
  await sb.auth.signOut();
  window.location.href = "../login/login.html";
}

/**
 * Returns the JWT access token for the current session.
 * Pass this as Authorization: Bearer <token> to your FastAPI backend.
 */
async function getAuthToken() {
  const { data } = await sb.auth.getSession();
  return data.session?.access_token ?? null;
}