/* ─────────────────────────────────────────────
   SURGE Dashboard (Multi-Building + Floors)
───────────────────────────────────────────── */

let allZones = {};
let currentBuilding = "default-building";
let buildingConfig = null;

/* ─────────────────────────────────────────────
   HELPERS
───────────────────────────────────────────── */

function getSelectedBuilding() {
  const select = document.getElementById("building-select");
  return select ? select.value : currentBuilding;
}

/* ─────────────────────────────────────────────
   LOAD BUILDINGS
───────────────────────────────────────────── */

async function loadBuildings() {
  try {
    const response = await fetch("http://localhost:8000/buildings");
    const data = await response.json();

    const select = document.getElementById("building-select");
    select.innerHTML = "";

    data.buildings.forEach(id => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      select.appendChild(opt);
    });

    if (data.buildings.length > 0) {
      select.value = data.buildings[0];
      fetchZones();
    }

  } catch (err) {
    console.error("Failed to load buildings", err);
  }
}

/* ─────────────────────────────────────────────
   LOAD BUILDING CONFIG (Floors + Zone Names)
───────────────────────────────────────────── */

async function loadBuildingConfig(buildingId) {
  try {
    const res = await fetch(
      `http://localhost:8000/buildings/${buildingId}/config`
    );

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

  if (!buildingConfig?.floors) return;

  buildingConfig.floors.forEach(floor => {
    const opt = document.createElement("option");
    opt.value = floor.floor_id;
    opt.textContent = floor.floor_name;
    select.appendChild(opt);
  });
}

/* ─────────────────────────────────────────────
   FETCH CONGESTION
───────────────────────────────────────────── */

async function fetchZones() {
  currentBuilding = getSelectedBuilding();
  if (!currentBuilding) return;

  try {
    await loadBuildingConfig(currentBuilding);

    const t0 = performance.now();
    const response = await fetch(
      `http://localhost:8000/congestion/${currentBuilding}`
    );

    if (!response.ok) {
      throw new Error("Bad response");
    }

    const data = await response.json();
    const latencyMs = Math.round(performance.now() - t0);
    const rtEl = document.getElementById("kpi-rt");
    if (rtEl) rtEl.textContent = `${latencyMs} ms`;
    const backendZones = data.zones || {};

    // 🔥 Merge metadata from building config
    const merged = {};

    Object.keys(backendZones).forEach(zoneId => {
      const meta = buildingConfig?.zones?.find(
        z => z.zone_id === zoneId
      );

      merged[zoneId] = {
        ...backendZones[zoneId],
        zone_name: meta?.zone_name || zoneId,
        floor_id: meta?.floor_id || null
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
   KPI UPDATE
───────────────────────────────────────────── */

function updateKPIs(zones) {
  const values = Object.values(zones);
  const zoneCount = values.length;

  const totalActivePassengers =
    values.reduce((sum, z) => sum + (z.active_passengers || 0), 0);

  const highZones =
    values.filter(z => z.congestion_level === "HIGH").length;

  // Avg wait time across zones that have passengers
  const activeZones = values.filter(z => (z.active_passengers || 0) > 0);
  const avgWait = activeZones.length
    ? Math.round(
        activeZones.reduce((sum, z) => sum + (z.estimated_wait_minutes || 0), 0)
        / activeZones.length
      )
    : 0;

  document.getElementById("kpi-zones").textContent = zoneCount;
  document.getElementById("kpi-users").textContent = totalActivePassengers;
  document.getElementById("kpi-incidents").textContent = highZones;
}

/* ─────────────────────────────────────────────
   RENDER ZONES
───────────────────────────────────────────── */

function renderZones(zones) {
  const container = document.getElementById("zones-container");
  container.innerHTML = "";

  for (const zoneId in zones) {
    const zone = zones[zoneId];

    const card = document.createElement("div");
    card.classList.add("zone-tile");

    const level =
      (zone.congestion_level || "LOW").toLowerCase();
    card.classList.add(level);

    card.innerHTML = `
      <div class="zone-title">
        ${(zone.zone_name || zoneId).toUpperCase()}
      </div>
      <p>Level: <strong>${zone.congestion_level}</strong></p>
      <p>Score: ${zone.congestion_score}</p>
      <p>Active: ${zone.active_passengers}</p>
      <p>Wait: ${zone.estimated_wait_minutes} min</p>
    `;

    container.appendChild(card);
  }
}

/* ─────────────────────────────────────────────
   FILTERS (NOW FLOOR-AWARE)
───────────────────────────────────────────── */

function applyFilters() {
  let entries = Object.entries(allZones);

  // ── Floor filter
  const floorFilter = document.getElementById("filter-floor")?.value;
  if (floorFilter && floorFilter !== "all") {
    entries = entries.filter(([_, z]) => z.floor_id === floorFilter);
  }

  // ── Status filter
  const statusFilter = document.getElementById("filter-status")?.value;
  if (statusFilter && statusFilter !== "all") {
    entries = entries.filter(
      ([_, z]) => (z.congestion_level || "LOW").toLowerCase() === statusFilter
    );
  }

  // ── Search filter
  const search = document.getElementById("search-zones")?.value?.toLowerCase().trim();
  if (search) {
    entries = entries.filter(([id, z]) =>
      (z.zone_name || id).toLowerCase().includes(search)
    );
  }

  // ── Sort
  const sort = document.getElementById("sort-zones")?.value;
  if (sort === "name") {
    entries.sort(([_a, a], [_b, b]) =>
      (a.zone_name || _a).localeCompare(b.zone_name || _b)
    );
  } else if (sort === "load") {
    entries.sort(([_, a], [__, b]) =>
      (b.congestion_score || 0) - (a.congestion_score || 0)
    );
  } else if (sort === "wait") {
    entries.sort(([_, a], [__, b]) =>
      (b.estimated_wait_minutes || 0) - (a.estimated_wait_minutes || 0)
    );
  }

  renderZones(Object.fromEntries(entries));
}

const manageBtn = document.getElementById("manage-building-btn");
if (manageBtn) {
  manageBtn.addEventListener("click", () => {
    const building = getSelectedBuilding();
    if (!building) return;
    window.location.href =
      `../landing/landing.html?building=${encodeURIComponent(building)}`;
  });
}

/* ─────────────────────────────────────────────
   EVENTS
───────────────────────────────────────────── */

["building-select", "filter-floor", "filter-status", "sort-zones"].forEach(id => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("change", id === "building-select" ? fetchZones : applyFilters);
});

const searchEl = document.getElementById("search-zones");
if (searchEl) searchEl.addEventListener("input", applyFilters);

window.refreshDashboard = fetchZones;

/* Initial load */
loadBuildings();

/* ─────────────────────────────────────────────
   CLOCK, DATE, COUNTDOWN & SESSION TIMER
───────────────────────────────────────────── */

let countdownSeconds = 30;
let sessionSeconds   = 0;

function padTwo(n) { return String(n).padStart(2, "0"); }

function updateClock() {
  const now = new Date();
  const h = padTwo(now.getHours());
  const m = padTwo(now.getMinutes());
  const s = padTwo(now.getSeconds());

  const clockEl = document.getElementById("live-clock");
  if (clockEl) clockEl.textContent = `${h}:${m}:${s}`;

  const dateEl = document.getElementById("live-date");
  if (dateEl) dateEl.textContent = now.toLocaleDateString("en-GB", {
    weekday: "short", day: "2-digit", month: "long", year: "numeric"
  });

  const lastEl = document.getElementById("last-updated");
  if (lastEl) lastEl.textContent = `${h}:${m}:${s}`;
}

function updateCountdown() {
  const el = document.getElementById("refresh-countdown");
  if (el) el.textContent = `${countdownSeconds}s`;
  countdownSeconds--;
  if (countdownSeconds < 0) {
    countdownSeconds = 30;
    fetchZones();
  }
}

function updateSessionTimer() {
  sessionSeconds++;
  const mm = padTwo(Math.floor(sessionSeconds / 60));
  const ss = padTwo(sessionSeconds % 60);
  const el = document.getElementById("session-timer");
  if (el) el.textContent = `${mm}:${ss}`;
}

const refreshBtn = document.getElementById("refresh-btn");
if (refreshBtn) {
  refreshBtn.addEventListener("click", () => {
    countdownSeconds = 30;
    fetchZones();
  });
}

setInterval(updateClock,         1000);
setInterval(updateCountdown,     1000);
setInterval(updateSessionTimer,  1000);

updateClock(); // run immediately — no 1s blank