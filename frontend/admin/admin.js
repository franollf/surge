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

    const response = await fetch(
      `http://localhost:8000/congestion/${currentBuilding}`
    );

    if (!response.ok) {
      throw new Error("Bad response");
    }

    const data = await response.json();
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
  const zoneCount = Object.keys(zones).length;

  const totalActivePassengers =
    Object.values(zones)
      .reduce((sum, z) => sum + (z.active_passengers || 0), 0);

  const highZones =
    Object.values(zones)
      .filter(z => z.congestion_level === "HIGH").length;

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
  let filtered = { ...allZones };

  const floorFilter =
    document.getElementById("filter-floor")?.value;

  if (floorFilter && floorFilter !== "all") {
    filtered = Object.fromEntries(
      Object.entries(filtered).filter(
        ([_, zone]) => zone.floor_id === floorFilter
      )
    );
  }

  renderZones(filtered);
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

if (document.getElementById("building-select")) {
  document
    .getElementById("building-select")
    .addEventListener("change", fetchZones);
}

if (document.getElementById("filter-floor")) {
  document
    .getElementById("filter-floor")
    .addEventListener("change", applyFilters);
}

setInterval(fetchZones, 3000);

window.refreshDashboard = fetchZones;

/* Initial load */
loadBuildings();