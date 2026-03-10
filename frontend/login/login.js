const SUPABASE_URL  = CONFIG.SUPABASE_URL;
const SUPABASE_ANON = CONFIG.SUPABASE_ANON;

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── Redirect if already logged in ─────────────────
sb.auth.getSession().then(({ data }) => {
  if (data.session) redirectToDashboard();
});

// ── Tab state ─────────────────────────────────────
let currentTab = "login";

function switchTab(tab) {
  currentTab = tab;

  document.getElementById("tab-login").classList.toggle("active", tab === "login");
  document.getElementById("tab-signup").classList.toggle("active", tab === "signup");

  // Show name field only on signup
  document.getElementById("name-group").style.display = tab === "signup" ? "block" : "none";

  // Update button label
  document.getElementById("submit-btn").textContent =
    tab === "login" ? "Sign In" : "Create Account";

  // Update hint
  document.getElementById("hint-text").innerHTML =
    tab === "login"
      ? 'Don\'t have an account? <a href="#" id="hint-link">Create one</a>'
      : 'Already have an account? <a href="#" id="hint-link">Sign in</a>';

  // Re-attach hint link listener after innerHTML swap
  document.getElementById("hint-link").addEventListener("click", (e) => {
    e.preventDefault();
    switchTab(tab === "login" ? "signup" : "login");
  });

  clearMessage();
}

// ── Submit ────────────────────────────────────────
async function handleSubmit() {
  const email    = document.getElementById("email").value.trim();
  const password = document.getElementById("password").value;
  const fullName = document.getElementById("full-name").value.trim();
  const btn      = document.getElementById("submit-btn");

  if (!email || !password) {
    showMessage("Please enter your email and password.", "error");
    return;
  }

  if (currentTab === "signup" && password.length < 6) {
    showMessage("Password must be at least 6 characters.", "error");
    return;
  }

  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span>${currentTab === "login" ? "Signing in…" : "Creating account…"}`;
  clearMessage();

  try {
    if (currentTab === "login") {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      redirectToDashboard();

    } else {
      const { data, error } = await sb.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } }
      });
      if (error) throw error;

      // Write full_name into admins table
      if (fullName && data.user) {
        await sb.from("admins").update({ full_name: fullName }).eq("id", data.user.id);
      }

      showMessage("Account created! Check your email to confirm, then sign in.", "success");
      switchTab("login");
    }

  } catch (err) {
    showMessage(err.message || "Something went wrong. Please try again.", "error");

  } finally {
    btn.disabled = false;
    btn.textContent = currentTab === "login" ? "Sign In" : "Create Account";
  }
}

// ── Enter key ─────────────────────────────────────
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleSubmit();
});

// ── Helpers ───────────────────────────────────────
function showMessage(text, type) {
  const el = document.getElementById("message");
  el.textContent = text;
  el.className = `message ${type}`;
}

function clearMessage() {
  const el = document.getElementById("message");
  el.className = "message";
  el.textContent = "";
}

function redirectToDashboard() {
  window.location.href = "../admin/dashboard.html";
}

// ── Wire up hint link on first load ───────────────
document.getElementById("hint-link")?.addEventListener("click", (e) => {
  e.preventDefault();
  switchTab("signup");
});