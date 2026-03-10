/* ─────────────────────────────────────────────
   SURGE Dashboard — admin.js
───────────────────────────────────────────── */

let allZones        = {};
let currentBuilding = "";
let buildingConfig  = null;
let countdownSecs   = 30;
let sessionSecs     = 0;

/* ─────────────────────────────────────────────
   TOAST
───────────────────────────────────────────── */
function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  container.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

/* ─────────────────────────────────────────────
   CLOCK / COUNTDOWN / SESSION
───────────────────────────────────────────── */
function pad(n) { return String(n).padStart(2, "0"); }

function updateClock() {
  const now = new Date();
  const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const dateStr = now.toLocaleDateString("en-GB", {
    weekday: "short", day: "2-digit", month: "long", year: "numeric"
  });
  const clockEl = document.getElementById("live-clock");
  const dateEl  = document.getElementById("live-date");
  const lastEl  = document.getElementById("last-updated");
  if (clockEl) clockEl.textContent = timeStr;
  if (dateEl)  dateEl.textContent  = dateStr;
  if (lastEl)  lastEl.textContent  = timeStr;
}

function tickCountdown() {
  const el = document.getElementById("refresh-countdown");
  if (el) el.textContent = `${countdownSecs}s`;
  countdownSecs--;
  if (countdownSecs < 0) {
    countdownSecs = 30;
    fetchZones();
  }
}

function tickSession() {
  sessionSecs++;
  const el = document.getElementById("session-timer");
  if (el) el.textContent = `${pad(Math.floor(sessionSecs / 60))}:${pad(sessionSecs % 60)}`;
}

// Start all timers
setInterval(updateClock,    1000);
setInterval(tickCountdown,  1000);
setInterval(tickSession,    1000);
updateClock(); // immediate — no blank first second

/* ─────────────────────────────────────────────
   MANUAL REFRESH BUTTON
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
    const res  = await fetch("http://localhost:8000/buildings");
    const data = await res.json();
    const select = document.getElementById("building-select");
    select.innerHTML = "";
    data.buildings.forEach(id => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      select.appendChild(opt);
    });
    if (data.buildings.length > 0) {
      currentBuilding = data.buildings[0];
      select.value = currentBuilding;
      fetchZones();
    }
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
    const res = await fetch(`http://localhost:8000/buildings/${buildingId}/config`);
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
    const opt = document.createElement("option");
    opt.value       = floor.floor_id;
    opt.textContent = floor.floor_name;
    select.appendChild(opt);
  });
}

/* ─────────────────────────────────────────────
   FETCH CONGESTION + LATENCY
───────────────────────────────────────────── */
async function fetchZones() {
  currentBuilding = document.getElementById("building-select")?.value || currentBuilding;
  if (!currentBuilding) return;

  try {
    await loadBuildingConfig(currentBuilding);

    const t0  = performance.now();
    const res = await fetch(`http://localhost:8000/congestion/${currentBuilding}`);
    if (!res.ok) throw new Error("Bad response");
    const data      = await res.json();
    const latencyMs = Math.round(performance.now() - t0);

    // Update Avg Response Time KPI
    const rtEl = document.getElementById("kpi-rt");
    if (rtEl) rtEl.textContent = `${latencyMs} ms`;

    // Merge zone metadata from config
    const backendZones = data.zones || {};
    const merged = {};
    Object.keys(backendZones).forEach(zoneId => {
      const meta = buildingConfig?.zones?.find(z => z.zone_id === zoneId);
      merged[zoneId] = {
        ...backendZones[zoneId],
        zone_name: meta?.zone_name || zoneId,
        floor_id:  meta?.floor_id  || null
      };
    });

    allZones = merged;
    applyFilters();
    updateKPIs(allZones);

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
  Object.entries(zones).forEach(([zoneId, zone]) => {
    const card = document.createElement("div");
    card.className = `zone-tile ${(zone.congestion_level || "LOW").toLowerCase()}`;
    card.innerHTML = `
      <div class="zone-title">${(zone.zone_name || zoneId).toUpperCase()}</div>
      <p class="zone-metric">Level: <strong>${zone.congestion_level}</strong></p>
      <p class="zone-metric">Score: <strong>${zone.congestion_score}</strong></p>
      <p class="zone-metric">Active: <strong>${zone.active_passengers}</strong></p>
      <p class="zone-metric">Wait: <strong>${zone.estimated_wait_minutes} min</strong></p>
    `;
    container.appendChild(card);
  });
}

/* ─────────────────────────────────────────────
   FILTERS + SORT
───────────────────────────────────────────── */
function applyFilters() {
  let entries = Object.entries(allZones);

  // Floor
  const floor = document.getElementById("filter-floor")?.value;
  if (floor && floor !== "all") {
    entries = entries.filter(([_, z]) => z.floor_id === floor);
  }

  // Status
  const status = document.getElementById("filter-status")?.value;
  if (status && status !== "all") {
    entries = entries.filter(([_, z]) =>
      (z.congestion_level || "LOW").toLowerCase() === status
    );
  }

  // Search
  const search = document.getElementById("search-zones")?.value?.toLowerCase().trim();
  if (search) {
    entries = entries.filter(([id, z]) =>
      (z.zone_name || id).toLowerCase().includes(search)
    );
  }

  // Sort
  const sort = document.getElementById("sort-zones")?.value;
  if (sort === "name") {
    entries.sort(([_a, a], [_b, b]) =>
      (a.zone_name || _a).localeCompare(b.zone_name || _b)
    );
  } else if (sort === "load") {
    entries.sort(([_, a], [__, b]) => (b.congestion_score || 0) - (a.congestion_score || 0));
  } else if (sort === "wait") {
    entries.sort(([_, a], [__, b]) => (b.estimated_wait_minutes || 0) - (a.estimated_wait_minutes || 0));
  }

  renderZones(Object.fromEntries(entries));
}

/* ─────────────────────────────────────────────
   FILTER / SORT EVENT LISTENERS
───────────────────────────────────────────── */
document.getElementById("building-select")?.addEventListener("change", fetchZones);
document.getElementById("filter-floor")?.addEventListener("change", applyFilters);
document.getElementById("filter-status")?.addEventListener("change", applyFilters);
document.getElementById("sort-zones")?.addEventListener("change", applyFilters);
document.getElementById("search-zones")?.addEventListener("input", applyFilters);

/* ─────────────────────────────────────────────
   MANAGE BUILDING BUTTON
───────────────────────────────────────────── */
document.getElementById("manage-building-btn")?.addEventListener("click", () => {
  if (!currentBuilding) return;
  window.location.href = `../landing/landing.html?building=${encodeURIComponent(currentBuilding)}`;
});

/* ─────────────────────────────────────────────
   INIT
───────────────────────────────────────────── */
loadBuildings();