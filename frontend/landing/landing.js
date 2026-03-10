/* ═══════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════ */

const API = "http://localhost:8000";

function uid(prefix) {
  return prefix + "_" + Math.random().toString(16).slice(2, 6);
}

function qs(id) {
  return document.getElementById(id);
}

function getBuildingFromURL() {
  const params = new URLSearchParams(window.location.search);
  return params.get("building");
}

function toast(msg) {
  const t = qs("toast");
  t.textContent = msg;
  t.classList.add("show");
  setTimeout(() => t.classList.remove("show"), 2000);
}

function getBuildingId() {
  return qs("buildingId").value.trim() || "default-building";
}

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */

let state = {
  building_id: "default-building",
  building_name: "",
  default_floor_id: "",
  floors: [],
  zones: []
};

/* ═══════════════════════════════════════════════════════════
   LINKS
═══════════════════════════════════════════════════════════ */

function updateLinks() {
  const id = qs("buildingId").value.trim();
  const passenger = qs("openPassenger");
  const admin = qs("openAdmin");

  passenger.href = id ? `../passenger/index.html?building=${encodeURIComponent(id)}` : "#";
  admin.href = id ? `../admin/dashboard.html?building=${encodeURIComponent(id)}` : "../admin/dashboard.html";
}

/* ══════════════════════════════════════════════════════��════
   FLOOR SELECTS
═══════════════════════════════════════════════════════════ */

function refreshFloorSelects() {
  const defaultFloorSelect = qs("defaultFloor");
  const zoneFloorSelect = qs("zoneFloor");

  defaultFloorSelect.innerHTML = "";
  zoneFloorSelect.innerHTML = "";

  state.floors.forEach(floor => {
    const opt1 = document.createElement("option");
    opt1.value = floor.floor_id;
    opt1.textContent = floor.floor_name;
    defaultFloorSelect.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = floor.floor_id;
    opt2.textContent = floor.floor_name;
    zoneFloorSelect.appendChild(opt2);
  });

  if (state.default_floor_id) {
    defaultFloorSelect.value = state.default_floor_id;
  }
}

/* ═══════════════════════════════════════════════════════════
   PREVIEW
═══════════════════════════════════════════════════════════ */

function renderPreview() {
  const preview = qs("preview");
  preview.innerHTML = "";

  if (state.floors.length === 0) {
    preview.innerHTML = '<div class="empty">No floors yet</div>';
    return;
  }

  state.floors.forEach(floor => {
    const floorDiv = document.createElement("div");
    floorDiv.className = "floor-group";

    const floorTitle = document.createElement("div");
    floorTitle.className = "floor-title";
    floorTitle.textContent = floor.floor_name;
    floorDiv.appendChild(floorTitle);

    const zonesForFloor = state.zones.filter(z => z.floor_id === floor.floor_id);

    if (zonesForFloor.length === 0) {
      const empty = document.createElement("div");
      empty.className = "zone-item empty";
      empty.textContent = "No zones";
      floorDiv.appendChild(empty);
    } else {
      zonesForFloor.forEach(zone => {
        const zoneDiv = document.createElement("div");
        zoneDiv.className = "zone-item";
        zoneDiv.textContent = `${zone.zone_name} (${zone.zone_type})`;
        floorDiv.appendChild(zoneDiv);
      });
    }

    preview.appendChild(floorDiv);
  });
}

/* ═══════════════════════════════════════════════════════════
   ADD FLOOR
═══════════════════════════════════════════════════════════ */

qs("btnAddFloor").addEventListener("click", () => {
  const name = qs("floorName").value.trim();
  if (!name) return toast("Enter floor name");

  const floor = { floor_id: uid("floor"), floor_name: name };
  state.floors.push(floor);

  if (!state.default_floor_id) state.default_floor_id = floor.floor_id;

  qs("floorName").value = "";
  refreshFloorSelects();
  renderPreview();
});

/* ═══════════════════════════════════════════════════════════
   ADD ZONE
═══════════════════════════════════════════════════════════ */

qs("btnAddZone").addEventListener("click", () => {
  const name = qs("zoneName").value.trim();
  const floorId = qs("zoneFloor").value;

  if (!name) return toast("Enter zone name");
  if (!floorId) return toast("Select a floor");

  const zone = {
    zone_id: uid("zone"),
    floor_id: floorId,
    zone_name: name,
    zone_type: qs("zoneType").value
  };

  state.zones.push(zone);
  qs("zoneName").value = "";
  renderPreview();
});

/* ═══════════════════════════════════════════════════════════
   SAVE TO BACKEND (AUTHENTICATED)
═══════════════════════════════════════════════════════════ */

/* Save function - add back authentication */
qs("btnSave").addEventListener("click", async () => {
  const buildingId = getBuildingId();

  state.building_id = buildingId;
  state.building_name = qs("buildingName").value.trim() || buildingId;
  state.default_floor_id = qs("defaultFloor").value;

  console.log("🔵 Attempting to save building:", buildingId);

  try {
    const token = await getAuthToken();
    
    if (!token) {
      toast("Please log in first");
      return;
    }

    const response = await fetch(`${API}/buildings/${buildingId}/config`, {
      method: "POST",
      headers: { 
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify(state)
    });

    console.log("🔵 Response status:", response.status);

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      console.error("🔴 Save failed:", errorData);
      throw new Error(errorData?.detail || `HTTP ${response.status}`);
    }

    const result = await response.json();
    console.log("🟢 Save successful:", result);
    toast("Saved to backend ✔");
    
  } catch (err) {
    console.error("🔴 Save error:", err);
    toast(err.message || "Backend save failed");
  }
});

/* Load function - add back authentication */
qs("btnLoad").addEventListener("click", async () => {
  const buildingId = getBuildingId();
  console.log("🔵 Attempting to load building:", buildingId);

  try {
    const token = await getAuthToken();
    
    if (!token) {
      toast("Please log in first");
      return;
    }

    const response = await fetch(`${API}/buildings/${buildingId}/config`, {
      headers: {
        "Authorization": `Bearer ${token}`
      }
    });

    console.log("🔵 Load response status:", response.status);

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("Access denied: You don't own this building");
      }
      if (response.status === 404) {
        throw new Error("Building not found");
      }
      throw new Error(`HTTP ${response.status}`);
    }

    state = await response.json();
    console.log("🟢 Loaded state:", state);
    
    qs("buildingName").value = state.building_name || "";
    refreshFloorSelects();
    renderPreview();
    updateLinks();
    toast("Building loaded ✔");
    
    if (calSelectedDate) renderZoneScheduleList(buildingId, calSelectedDate);
    scanMonthForInactive(buildingId);
    
  } catch (err) {
    console.error("🔴 Load error:", err);
    toast(err.message || "Failed to load building");
  }
});

/* ═══════════════════════════════════════════════════════════
   CLEAR BUTTON
═══════════════════════════════════════════════════════════ */

qs("btnClear").addEventListener("click", () => {
  state = {
    building_id: getBuildingId(),
    building_name: "",
    default_floor_id: "",
    floors: [],
    zones: []
  };
  qs("buildingName").value = "";
  refreshFloorSelects();
  renderPreview();
  toast("Cleared");
});

/* ═══════════════════════════════════════════════════════════
   AUTO-LOAD FROM URL (AUTHENTICATED)
═══════════════════════════════════════════════════════════ */

async function autoLoadBuilding() {
  const buildingFromURL = getBuildingFromURL();

  if (buildingFromURL) {
    qs("buildingId").value = buildingFromURL;
    updateLinks();

    try {
      const token = await getAuthToken();
      
      if (!token) {
        console.warn("No auth token available");
        renderPreview();
        refreshFloorSelects();
        return;
      }

      const response = await fetch(`${API}/buildings/${buildingFromURL}/config`, {
        headers: {
          "Authorization": `Bearer ${token}`
        }
      });

      if (!response.ok) {
        if (response.status === 403) {
          toast("Access denied: You don't own this building");
          return;
        }
        throw new Error("Not found");
      }

      state = await response.json();
      qs("buildingName").value = state.building_name || "";
      toast("Building loaded ✔");
    } catch (err) {
      console.warn("No backend config found for", buildingFromURL);
    }
  }

  renderPreview();
  refreshFloorSelects();

  // Init calendar after state is ready
  renderCalendar();
  const bid = getBuildingId();
  if (bid) scanMonthForInactive(bid);
}

/* ═══════════════════════════════════════════════════════════
   ZONE INACTIVITY SCHEDULER
═══════════════════════════════════════════════════════════ */

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth(); // 0-indexed
let calSelectedDate = null;           // "YYYY-MM-DD"
let inactiveDatesForMonth = new Set();

/* ── Helpers ── */
function toISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function formatDisplayDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("en-US", { weekday: "short", year: "numeric", month: "short", day: "numeric" });
}

/* ── Fetch inactive zones for the current month ── */
async function scanMonthForInactive(buildingId) {
  const firstDay = toISO(calYear, calMonth, 1);
  const lastDay = toISO(calYear, calMonth, new Date(calYear, calMonth + 1, 0).getDate());

  try {
    const response = await fetch(`${API}/buildings/${buildingId}/zones/inactive`);
    if (!response.ok) return;

    const data = await response.json();
    const zones = data.inactive_zones || [];

    inactiveDatesForMonth.clear();
    zones.forEach(z => {
      if (z.date >= firstDay && z.date <= lastDay) {
        inactiveDatesForMonth.add(z.date);
      }
    });

    renderCalendar();
  } catch (err) {
    console.error("Error fetching inactive zones", err);
  }
}

/* ── Render calendar ── */
function renderCalendar() {
  const container = qs("calendar");
  container.innerHTML = "";

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDate = new Date(calYear, calMonth + 1, 0).getDate();
  const startDay = firstDay.getDay();

  qs("calMonthYear").textContent = firstDay.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  for (let i = 0; i < startDay; i++) {
    const blank = document.createElement("div");
    blank.className = "cal-day blank";
    container.appendChild(blank);
  }

  for (let d = 1; d <= lastDate; d++) {
    const dayDiv = document.createElement("div");
    dayDiv.className = "cal-day";
    dayDiv.textContent = d;

    const iso = toISO(calYear, calMonth, d);

    if (inactiveDatesForMonth.has(iso)) {
      dayDiv.classList.add("has-inactive");
    }

    if (iso === calSelectedDate) {
      dayDiv.classList.add("selected");
    }

    dayDiv.addEventListener("click", () => selectDate(iso));
    container.appendChild(dayDiv);
  }
}

/* ── Select date and load zones ── */
async function selectDate(iso) {
  calSelectedDate = iso;
  renderCalendar();

  qs("calSelectedDisplay").textContent = formatDisplayDate(iso);
  qs("schedHint").textContent = formatDisplayDate(iso);

  await renderZoneScheduleList(getBuildingId(), iso);
}

/* ── Render zone schedule toggles ── */
async function renderZoneScheduleList(buildingId, date) {
  const container = qs("zoneScheduleList");
  container.innerHTML = "";

  if (!state.zones || state.zones.length === 0) {
    container.innerHTML = '<div class="sched-empty">No zones in this building.</div>';
    return;
  }

  try {
    const response = await fetch(`${API}/buildings/${buildingId}/zones/inactive?date=${date}`);
    const data = await response.json();
    const inactiveZones = new Set((data.inactive_zones || []).map(z => z.zone_id));

    state.zones.forEach(zone => {
      const isInactive = inactiveZones.has(zone.zone_id);

      const row = document.createElement("div");
      row.className = "zone-sched-row";

      const floorName = state.floors.find(f => f.floor_id === zone.floor_id)?.floor_name || "Unknown Floor";

      row.innerHTML = `
        <div class="zone-sched-info">
          <div class="zone-sched-name">${zone.zone_name}</div>
          <div class="zone-sched-floor">${floorName}</div>
        </div>
        <div class="toggle-wrap">
          <span class="toggle-label">${isInactive ? "Inactive" : "Active"}</span>
          <label class="toggle">
            <input type="checkbox" ${isInactive ? "checked" : ""} data-zone-id="${zone.zone_id}">
            <span class="toggle-slider"></span>
          </label>
        </div>
      `;

      const checkbox = row.querySelector("input[type='checkbox']");
      checkbox.addEventListener("change", async (e) => {
        const shouldBeInactive = e.target.checked;
        await toggleZoneInactive(buildingId, zone.zone_id, date, shouldBeInactive);
      });

      container.appendChild(row);
    });

  } catch (err) {
    console.error("Error loading zone schedules", err);
    container.innerHTML = '<div class="sched-empty">Failed to load zone schedules.</div>';
  }
}

/* ── Toggle zone inactive status ── */
async function toggleZoneInactive(buildingId, zoneId, date, inactive) {
  try {
    if (inactive) {
      const response = await fetch(`${API}/buildings/${buildingId}/zones/schedule-inactive`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ building_id: buildingId, zone_id: zoneId, date })
      });

      if (!response.ok) throw new Error("Failed to schedule inactive");
      toast("Zone marked inactive ✔");

    } else {
      const response = await fetch(
        `${API}/buildings/${buildingId}/zones/schedule-inactive?zone_id=${zoneId}&date=${date}`,
        { method: "DELETE" }
      );

      if (!response.ok) throw new Error("Failed to remove inactive schedule");
      toast("Zone marked active ✔");
    }

    scanMonthForInactive(buildingId);

  } catch (err) {
    console.error(err);
    toast("Failed to update zone status");
  }
}

/* ── Calendar navigation ── */
qs("calPrev").addEventListener("click", () => {
  calMonth--;
  if (calMonth < 0) {
    calMonth = 11;
    calYear--;
  }
  renderCalendar();
  const bid = getBuildingId();
  if (bid) scanMonthForInactive(bid);
});

qs("calNext").addEventListener("click", () => {
  calMonth++;
  if (calMonth > 11) {
    calMonth = 0;
    calYear++;
  }
  renderCalendar();
  const bid = getBuildingId();
  if (bid) scanMonthForInactive(bid);
});

/* ── Init ── */
qs("buildingId").addEventListener("input", updateLinks);
autoLoadBuilding();