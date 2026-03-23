// ─── Config ───────────────────────────────────────────────
const API = "http://localhost:8000";

// ─── State ────────────────────────────────────────────────
let currentBuilding  = null;
let selectedZoneId   = null;
let selectedZoneName = null;
let allZones         = [];

// ─── Auth guard ───────────────────────────────────────────
requireAuth();

// ─── Init ─────────────────────────────────────────────────
window.addEventListener("DOMContentLoaded", () => {
  loadBuildings();
  setupHeadcountControls();

  document.getElementById("building-select")
    .addEventListener("change", onBuildingChange);

  document.getElementById("submit-btn")
    .addEventListener("click", submitScan);
});

// ─── Load buildings ───────────────────────────────────────
async function loadBuildings() {
  try {
    const token = await getAuthToken();
    const res   = await fetch(`${API}/buildings`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();

    const data      = await res.json();
    const buildings = data.buildings || [];
    const select    = document.getElementById("building-select");

    if (!buildings.length) {
      select.innerHTML = '<option value="" disabled selected>No buildings found</option>';
      return;
    }

    select.innerHTML = buildings.map(id =>
      `<option value="${id}">${id}</option>`
    ).join("");

    currentBuilding = buildings[0];
    select.value    = currentBuilding;
    loadZones(currentBuilding);

  } catch (e) {
    console.error("loadBuildings error:", e);
    toast("Failed to load buildings", "error");
  }
}

// ─── Building change ──────────────────────────────────────
async function onBuildingChange() {
  currentBuilding  = document.getElementById("building-select").value;
  selectedZoneId   = null;
  selectedZoneName = null;
  resetScanCard();
  await loadZones(currentBuilding);
}

// ─── Load zones ───────────────────────────────────────────
async function loadZones(buildingId) {
  const grid = document.getElementById("zone-grid");
  grid.innerHTML = `<p class="empty-hint">Loading zones…</p>`;

  try {
    const token = await getAuthToken();
    const res   = await fetch(`${API}/staff/zones/${buildingId}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!res.ok) throw new Error();

    const data = await res.json();
    allZones   = data.zones || [];
    renderZoneGrid(allZones);

  } catch (e) {
    console.error("loadZones error:", e);
    grid.innerHTML = `<p class="empty-hint">Failed to load zones</p>`;
  }
}

// ─── Render zone grid ─────────────────────────────────────
function renderZoneGrid(zones) {
  const grid = document.getElementById("zone-grid");

  if (!zones.length) {
    grid.innerHTML = `<p class="empty-hint">No zones in this building</p>`;
    return;
  }

  grid.innerHTML = zones.map(z => {
    const level     = z.congestion_level || "LOW";
    const levelLow  = level.toLowerCase();
    const isActive  = z.zone_id === selectedZoneId;

    return `
      <button
        class="zone-btn ${levelLow} ${isActive ? "selected" : ""}"
        data-zone-id="${z.zone_id}"
        data-zone-name="${z.zone_name}"
        data-level="${level}"
        data-active="${z.active_passengers}"
        onclick="selectZone('${z.zone_id}', '${z.zone_name}', '${level}', ${z.active_passengers})"
      >
        <span class="zone-btn-name">${z.zone_name}</span>
        <span class="zone-btn-meta">${z.active_passengers} active · ${level}</span>
      </button>
    `;
  }).join("");
}

// ─── Select zone ──────────────────────────────────────────
function selectZone(zoneId, zoneName, level, activePassengers) {
  selectedZoneId   = zoneId;
  selectedZoneName = zoneName;

  // Update zone grid selection highlight
  document.querySelectorAll(".zone-btn").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.zoneId === zoneId);
  });

  // Show selected zone banner
  const banner   = document.getElementById("selected-zone-banner");
  const dot      = document.getElementById("selected-zone-dot");
  const nameEl   = document.getElementById("selected-zone-name");
  const levelEl  = document.getElementById("selected-zone-level");
  const noHint   = document.getElementById("no-zone-hint");
  const hcWrap   = document.getElementById("headcount-wrap");
  const submitBtn = document.getElementById("submit-btn");

  banner.style.display  = "flex";
  noHint.style.display  = "none";
  hcWrap.style.display  = "block";
  submitBtn.disabled    = false;

  nameEl.textContent  = zoneName;
  levelEl.textContent = `${level} congestion · ${activePassengers} active passengers`;

  const dotColor = level === "HIGH"
    ? "var(--error)"
    : level === "MEDIUM"
      ? "var(--warning)"
      : "var(--teal)";
  dot.style.background = dotColor;

  // Reset headcount to 0 on new zone select
  document.getElementById("headcount-input").value = 0;

  // Hide previous result
  document.getElementById("result-card").style.display = "none";
  document.getElementById("stats-card").style.display  = "none";
}

// ─── Headcount +/− controls ───────────────────────────────
function setupHeadcountControls() {
  const input = document.getElementById("headcount-input");

  document.getElementById("hc-minus").addEventListener("click", () => {
    const val = Math.max(0, parseInt(input.value || 0) - 1);
    input.value = val;
  });

  document.getElementById("hc-plus").addEventListener("click", () => {
    const val = Math.min(5000, parseInt(input.value || 0) + 1);
    input.value = val;
  });
}

// ─── Submit scan ──────────────────────────────────────────
async function submitScan() {
  if (!selectedZoneId || !currentBuilding) return;

  const count     = parseInt(document.getElementById("headcount-input").value || 0);
  const submitBtn = document.getElementById("submit-btn");
  const label     = document.getElementById("submit-label");
  const spinner   = document.getElementById("submit-spinner");

  // Loading state
  submitBtn.disabled   = true;
  label.style.display  = "none";
  spinner.style.display = "inline-block";

  try {
    const token = await getAuthToken();
    const res   = await fetch(`${API}/staff/scan`, {
      method:  "POST",
      headers: {
        "Content-Type":  "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({
        building_id:     currentBuilding,
        zone_id:         selectedZoneId,
        passenger_count: count,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => null);
      throw new Error(err?.detail || "Scan failed");
    }

    const data = await res.json();
    showResult(data, count);
    toast(`✅ ${count} passengers recorded in ${selectedZoneName}`);

    // Refresh zones to show updated congestion
    await loadZones(currentBuilding);

    // Show updated zone stats
    await loadZoneStats(currentBuilding, selectedZoneId);

  } catch (e) {
    console.error("submitScan error:", e);
    toast(e.message || "Failed to submit scan", "error");
  } finally {
    submitBtn.disabled    = false;
    label.style.display   = "inline";
    spinner.style.display = "none";
  }
}

// ─── Show result ──────────────────────────────────────────
function showResult(data, count) {
  const card = document.getElementById("result-card");
  const body = document.getElementById("result-body");

  card.style.display = "block";
  body.innerHTML = `
    <div class="result-row">
      <span class="result-label">Zone</span>
      <span class="result-value">${data.zone_name}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Passengers Reported</span>
      <span class="result-value">${count}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Recorded At</span>
      <span class="result-value">${new Date(data.timestamp).toLocaleTimeString()}</span>
    </div>
    <div class="result-row">
      <span class="result-label">Status</span>
      <span class="result-value result-success">✅ Congestion map updated</span>
    </div>
  `;
}

// ─── Load zone stats after scan ───────────────────────────
async function loadZoneStats(buildingId, zoneId) {
  try {
    const res = await fetch(`${API}/congestion/${buildingId}`);
    if (!res.ok) return;

    const data  = await res.json();
    const zone  = data.zones?.[zoneId];
    if (!zone) return;

    const card  = document.getElementById("stats-card");
    const grid  = document.getElementById("stats-grid");
    card.style.display = "block";

    const level      = zone.congestion_level || "LOW";
    const levelColor = level === "HIGH"
      ? "var(--error)"
      : level === "MEDIUM"
        ? "var(--warning)"
        : "var(--teal)";

    grid.innerHTML = `
      <div class="stat-item">
        <p class="stat-label">Congestion</p>
        <p class="stat-value" style="color:${levelColor}">${level}</p>
      </div>
      <div class="stat-item">
        <p class="stat-label">Active</p>
        <p class="stat-value">${zone.active_passengers ?? 0}</p>
      </div>
      <div class="stat-item">
        <p class="stat-label">Score</p>
        <p class="stat-value">${(zone.congestion_score || 0).toFixed(1)}</p>
      </div>
      <div class="stat-item">
        <p class="stat-label">Est. Wait</p>
        <p class="stat-value">${zone.estimated_wait_minutes ?? 0} min</p>
      </div>
    `;
  } catch (e) {
    console.error("loadZoneStats error:", e);
  }
}

// ─── Reset scan card ──────────────────────────────────────
function resetScanCard() {
  document.getElementById("selected-zone-banner").style.display = "none";
  document.getElementById("no-zone-hint").style.display         = "block";
  document.getElementById("headcount-wrap").style.display       = "none";
  document.getElementById("submit-btn").disabled                = true;
  document.getElementById("result-card").style.display          = "none";
  document.getElementById("stats-card").style.display           = "none";
  document.getElementById("headcount-input").value              = 0;
}

// ─── Toast ────────────────────────────────────────────────
function toast(msg, type = "success") {
  const el = document.getElementById("toast");
  el.textContent  = msg;
  el.className    = `toast ${type} show`;
  setTimeout(() => el.classList.remove("show"), 3000);
}