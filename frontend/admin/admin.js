/* ═══════════════════════════════════════════════════════════
   SURGE ADMIN DASHBOARD
   Real-time congestion monitoring
═══════════════════════════════════════════════════════════ */

let currentBuilding = null;
let buildingConfig  = null;
let allZones        = {};
let inactiveZoneIds = new Set();
let countdownSecs   = 30;
let sessionSecs     = 0;

/* ─────────────────────────────────────────────
   LIVE CLOCK
───────────────────────────────────────────── */
function updateClock() {
  const now = new Date();
  const h   = String(now.getHours()).padStart(2, "0");
  const m   = String(now.getMinutes()).padStart(2, "0");
  const s   = String(now.getSeconds()).padStart(2, "0");
  const el  = document.getElementById("live-clock");
  if (el) el.textContent = `${h}:${m}:${s}`;

  const dateEl = document.getElementById("live-date");
  if (dateEl) dateEl.textContent = now.toLocaleDateString("en-US", {
    weekday: "short", day: "2-digit", month: "long", year: "numeric"
  });
}

/* ─────────────────────────────────────────────
   TOAST
───────────────────────────────────────────── */
function showToast(msg, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = msg;
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("visible"));

  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 400);
  }, 3000);
}

/* ─────────────────────────────────────────────
   AUTO-REFRESH COUNTDOWN
───────────────────────────────────────────── */
function pad(n) { return String(n).padStart(2, "0"); }

function tickCountdown() {
  countdownSecs--;
  const el = document.getElementById("refresh-countdown");
  if (el) el.textContent = `${countdownSecs}s`;
  if (countdownSecs <= 0) {
    countdownSecs = 30;
    fetchZones();
  }
}

/* ─────────────────────────────────────────────
   SESSION TIMER
───────────────────────────────────────────── */
function tickSession() {
  sessionSecs++;
  const el = document.getElementById("session-timer");
  if (el) el.textContent = `${pad(Math.floor(sessionSecs / 60))}:${pad(sessionSecs % 60)}`;
}

setInterval(updateClock,   1000);
setInterval(tickCountdown, 1000);
setInterval(tickSession,   1000);
updateClock();

/* ─────────────────────────────────────────────
   MANUAL REFRESH
───────────────────────────────────────────── */
document.getElementById("refresh-btn")?.addEventListener("click", () => {
  countdownSecs = 30;
  fetchZones();
});

/* ─────────────────────────────────────────────
   LOAD BUILDINGS
───────────────────────────────────────────── */
async function loadBuildings() {
  try {
    const token = await getAuthToken();
    const res   = await fetch("http://localhost:8000/buildings", {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Failed to fetch buildings");

    const data      = await res.json();
    const buildings = data.buildings || [];

    if (buildings.length === 0) {
      showToast("No buildings found. Redirecting...", "info");
      setTimeout(() => { window.location.href = "../landing/landing.html"; }, 2000);
      return;
    }

    const select = document.getElementById("building-select");
    select.innerHTML = "";
    buildings.forEach(id => {
      const opt       = document.createElement("option");
      opt.value       = id;
      opt.textContent = id;
      select.appendChild(opt);
    });

    currentBuilding  = buildings[0];
    select.value     = currentBuilding;
    fetchZones();

  } catch (err) {
    console.error("Failed to load buildings", err);
    showToast("Failed to load buildings", "error");
  }
}

/* ─────────────────────────────────────────────
   LOAD BUILDING CONFIG
───────────────────────────────────────────── */
async function loadBuildingConfig(buildingId) {
  try {
    const token = await getAuthToken();
    const res   = await fetch(`http://localhost:8000/buildings/${buildingId}/config`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error("Failed to fetch building config");
    buildingConfig = await res.json();
    populateFloorDropdown();
  } catch (err) {
    console.error("Failed to load building config", err);
    buildingConfig = null;
  }
}

function populateFloorDropdown() {
  const select = document.getElementById("filter-floor");
  if (!select) return;
  select.innerHTML = '<option value="all">All Floors</option>';
  buildingConfig?.floors?.forEach(floor => {
    const opt       = document.createElement("option");
    opt.value       = floor.floor_id;
    opt.textContent = floor.floor_name;
    select.appendChild(opt);
  });
}

/* ─────────────────────────────────────────────
   FETCH TODAY'S INACTIVE ZONES
───────────────────────────────────────────── */
async function fetchInactiveZones(buildingId) {
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  try {
    const token = await getAuthToken();
    const res   = await fetch(
      `http://localhost:8000/buildings/${buildingId}/zones/inactive?date=${today}`,
      { headers: { "Authorization": `Bearer ${token}` } }
    );
    console.log("🔵 Inactive zones response status:", res.status);
    if (!res.ok) return;
    const data = await res.json();
    console.log("🔵 Inactive zones data:", data);
    inactiveZoneIds = new Set((data.inactive_zones || []).map(z => z.zone_id));
    console.log("🔵 inactiveZoneIds set:", [...inactiveZoneIds]);
  } catch (err) {
    console.error("Failed to fetch inactive zones", err);
    inactiveZoneIds = new Set();
  }
}

/* ─────────────────────────────────────────────
   FETCH CONGESTION + DENSITY
───────────────────────────────────────────── */
async function fetchZones() {
  currentBuilding = document.getElementById("building-select")?.value || currentBuilding;
  if (!currentBuilding) return;

  try {
    await loadBuildingConfig(currentBuilding);
    await fetchInactiveZones(currentBuilding);

    const t0  = performance.now();
    const res = await fetch(`http://localhost:8000/congestion/${currentBuilding}`);
    if (!res.ok) throw new Error("Bad response");

    const data      = await res.json();
    const latencyMs = Math.round(performance.now() - t0);

    const rtEl = document.getElementById("kpi-rt");
    if (rtEl) rtEl.textContent = `${latencyMs} ms`;

    // Merge zone metadata from config
    const backendZones = data.zones || {};
    const merged = {};
    Object.keys(backendZones).forEach(zoneId => {
      // Skip zones marked inactive for today
      if (inactiveZoneIds.has(zoneId)) return;

      const meta      = buildingConfig?.zones?.find(z => z.zone_id === zoneId);
      merged[zoneId]  = {
        ...backendZones[zoneId],
        zone_name: meta?.zone_name || zoneId,
        floor_id:  meta?.floor_id  || null,
        zone_type: meta?.zone_type || null,
      };
    });

    allZones = merged;
    applyFilters();
    updateKPIs(allZones);
    updateAlerts(allZones);

    await fetchDensity(currentBuilding);

    const luEl = document.getElementById("last-updated");
    if (luEl) luEl.textContent = new Date().toLocaleTimeString();

  } catch (err) {
    console.error(err);
    showToast("Backend connection failed", "error");
  }
}

/* ─────────────────────────────────────────────
   KPIs
───────────────────────────────────────────── */
function updateKPIs(zones) {
  const values = Object.values(zones);
  document.getElementById("kpi-zones").textContent     = values.length;
  document.getElementById("kpi-users").textContent     = values.reduce((s, z) => s + (z.active_passengers || 0), 0);
  document.getElementById("kpi-incidents").textContent = values.filter(z => z.congestion_level === "HIGH").length;
}

/* ─────────────────────────────────────────────
   RENDER ZONES
───────────────────────────────────────────── */
function renderZones(zones) {
  const container = document.getElementById("zones-container");
  container.innerHTML = "";

  if (Object.keys(zones).length === 0) {
    container.innerHTML = `<div style="color:var(--muted);font-family:'DM Mono',monospace;font-size:13px;padding:32px;text-align:center;grid-column:1/-1;">No zones match the current filters</div>`;
    return;
  }

  Object.entries(zones).forEach(([zoneId, zone]) => {
    const level = (zone.congestion_level || "LOW").toLowerCase();
    const card  = document.createElement("div");
    card.className = `zone-tile ${level}`;
    card.innerHTML = `
      <div class="zone-title">${(zone.zone_name || zoneId).toUpperCase()}</div>
      <p class="zone-metric">Level: <strong>${zone.congestion_level || "—"}</strong></p>
      <p class="zone-metric">Score: <strong>${(zone.congestion_score || 0).toFixed(1)}</strong></p>
      <p class="zone-metric">Active: <strong>${zone.active_passengers || 0}</strong></p>
      <p class="zone-metric">Wait: <strong>${zone.estimated_wait_minutes ?? 0} min</strong></p>
    `;
    container.appendChild(card);
  });
}

/* ─────────────────────────────────────────────
   FILTERS + SORT
───────────────────────────────────────────── */
function applyFilters() {
  let entries = Object.entries(allZones);

  const floor = document.getElementById("filter-floor")?.value;
  if (floor && floor !== "all") {
    entries = entries.filter(([_, z]) => z.floor_id === floor);
  }

  const status = document.getElementById("filter-status")?.value;
  if (status && status !== "all") {
    entries = entries.filter(([_, z]) =>
      (z.congestion_level || "LOW").toLowerCase() === status
    );
  }

  const search = document.getElementById("search-zones")?.value?.toLowerCase().trim();
  if (search) {
    entries = entries.filter(([id, z]) =>
      (z.zone_name || id).toLowerCase().includes(search)
    );
  }

  const sort = document.getElementById("sort-zones")?.value;
  if (sort === "name") {
    entries.sort(([_a, a], [_b, b]) => (a.zone_name || _a).localeCompare(b.zone_name || _b));
  } else if (sort === "load") {
    entries.sort(([_, a], [__, b]) => (b.congestion_score || 0) - (a.congestion_score || 0));
  } else if (sort === "wait") {
    entries.sort(([_, a], [__, b]) => (b.estimated_wait_minutes || 0) - (a.estimated_wait_minutes || 0));
  }

  renderZones(Object.fromEntries(entries));
}

/* ─────────────────────────────────────────────
   PASSENGER DENSITY ESTIMATION
───────────────────────────────────────────── */
async function fetchDensity(buildingId) {
  try {
    const res = await fetch(`http://localhost:8000/airport/${buildingId}/density`);
    if (!res.ok) return;
    const data = await res.json();
    renderDensityStrip(data);
  } catch (err) {
    console.error("fetchDensity error:", err);
  }
}

function renderDensityStrip(data) {
  const strip  = document.getElementById("density-zones");
  const metaEl = document.getElementById("density-meta");
  if (!strip) return;

  const pct = Math.round((data.participation_rate || 0.4) * 100);
  if (metaEl) {
    metaEl.textContent =
      `~${pct}% participation · ` +
      `${data.total_scans_detected} scans detected · ` +
      `~${data.total_estimated_passengers} estimated passengers`;
  }

  const zones  = data.zones || [];
  // Also hide inactive zones from the density strip
  const active = zones.filter(z => z.scans_detected > 0 && !inactiveZoneIds.has(z.zone_id));

  if (!active.length) {
    strip.innerHTML = `<div class="density-empty">No scan activity detected yet</div>`;
    return;
  }

  const maxEst = Math.max(...active.map(z => z.estimated_passengers), 1);

  strip.innerHTML = active.map(z => {
    const barPct     = Math.round((z.estimated_passengers / maxEst) * 100);
    const levelColor = z.congestion_level === "HIGH"
      ? "var(--error)"
      : z.congestion_level === "MEDIUM"
        ? "var(--warning)"
        : "var(--teal)";

    const confDots = z.confidence === "high"
      ? "●●●"
      : z.confidence === "medium"
        ? "●●○"
        : "●○○";

    return `
      <div class="density-zone-row">
        <div class="density-zone-left">
          <span class="density-dot" style="background:${levelColor}"></span>
          <span class="density-zone-name">${z.zone_name}</span>
        </div>
        <div class="density-bar-wrap">
          <div class="density-bar" style="width:${barPct}%; background:${levelColor}"></div>
        </div>
        <div class="density-zone-right">
          <span class="density-scans">${z.scans_detected} scanned</span>
          <span class="density-estimated">~${z.estimated_passengers} est.</span>
          <span class="density-conf" style="color:${levelColor}"
            title="Estimate confidence: ${z.confidence}">
            ${confDots}
          </span>
        </div>
      </div>
    `;
  }).join("");
}

/* ─────────────────────────────────────────────
   ALERT SYSTEM
───────────────────────────────────────────── */
function updateAlerts(zones) {
  const strip     = document.getElementById("alert-strip");
  const list      = document.getElementById("alert-list");
  const countEl   = document.getElementById("alert-count");
  if (!strip || !list) return;

  const highZones = Object.entries(zones).filter(
    ([_, z]) => z.congestion_level === "HIGH"
  );

  if (highZones.length === 0) {
    strip.style.display = "none";
    list.innerHTML = "";
    return;
  }

  strip.style.display = "block";
  countEl.textContent = `${highZones.length} alert${highZones.length === 1 ? "" : "s"}`;

  list.innerHTML = highZones.map(([zoneId, zone]) => {
    const name       = zone.zone_name || zoneId;
    const passengers = zone.active_passengers || 0;
    const wait       = zone.estimated_wait_minutes ?? 0;
    const score      = (zone.congestion_score || 0).toFixed(0);

    return `
      <div class="alert-card">
        <div class="alert-card-left">
          <div class="alert-card-indicator"></div>
          <div class="alert-card-body">
            <div class="alert-zone-name">${name}</div>
            <div class="alert-status">Over Capacity</div>
          </div>
        </div>
        <div class="alert-card-right">
          <div class="alert-stat">
            <span class="alert-stat-label">Passengers</span>
            <span class="alert-stat-value">${passengers}</span>
          </div>
          <div class="alert-stat">
            <span class="alert-stat-label">Est. Delay</span>
            <span class="alert-stat-value">${wait} min</span>
          </div>
          <div class="alert-stat">
            <span class="alert-stat-label">Score</span>
            <span class="alert-stat-value">${score}</span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

/* ─────────────────────────────────────────────
   EVENT LISTENERS
───────────────────────────────────────────── */
document.getElementById("building-select")?.addEventListener("change", fetchZones);
document.getElementById("filter-floor")?.addEventListener("change", applyFilters);
document.getElementById("filter-status")?.addEventListener("change", applyFilters);
document.getElementById("sort-zones")?.addEventListener("change", applyFilters);
document.getElementById("search-zones")?.addEventListener("input", applyFilters);

document.getElementById("manage-building-btn")?.addEventListener("click", () => {
  if (!currentBuilding) {
    window.location.href = "../landing/landing.html";
    return;
  }
  window.location.href = `../landing/landing.html?building=${encodeURIComponent(currentBuilding)}`;
});

/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
loadBuildings();