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

qs("buildingId").addEventListener("input", () => {
  updateLinks();
  // refresh scheduler if a date is selected
  if (calSelectedDate) {
    renderZoneScheduleList(getBuildingId(), calSelectedDate);
    scanMonthForInactive(getBuildingId());
  }
});

updateLinks();

/* ═══════════════════════════════════════════════════════════
   FLOOR SELECTS
═══════════════════════════════════════════════════════════ */

function refreshFloorSelects() {
  const zoneFloor = qs("zoneFloor");
  const defaultFloor = qs("defaultFloor");

  zoneFloor.innerHTML = "";
  defaultFloor.innerHTML = "";

  state.floors.forEach(floor => {
    const opt1 = document.createElement("option");
    opt1.value = floor.floor_id;
    opt1.textContent = floor.floor_name;
    zoneFloor.appendChild(opt1);

    const opt2 = document.createElement("option");
    opt2.value = floor.floor_id;
    opt2.textContent = floor.floor_name;
    defaultFloor.appendChild(opt2);
  });

  if (state.floors.length > 0) {
    zoneFloor.value = state.floors[0].floor_id;
    defaultFloor.value = state.default_floor_id || state.floors[0].floor_id;
  }
}

/* ═══════════════════════════════════════════════════════════
   DELETE
═══════════════════════════════════════════════════════════ */

function deleteZone(zoneId) {
  state.zones = state.zones.filter(z => z.zone_id !== zoneId);
  renderPreview();
}

function deleteFloor(floorId) {
  state.floors = state.floors.filter(f => f.floor_id !== floorId);
  state.zones = state.zones.filter(z => z.floor_id !== floorId);

  if (state.default_floor_id === floorId) {
    state.default_floor_id = state.floors[0]?.floor_id || "";
  }

  refreshFloorSelects();
  renderPreview();
}

/* ═══════════════════════════════════════════════════════════
   PREVIEW
═══════════════════════════════════════════════════════════ */

function renderPreview() {
  const preview = qs("preview");
  preview.innerHTML = "";

  state.floors.forEach(floor => {
    const wrapper = document.createElement("div");
    wrapper.className = "floor";

    const header = document.createElement("div");
    header.className = "zone";
    header.innerHTML = `
      <strong>${floor.floor_name}</strong>
      <button onclick="deleteFloor('${floor.floor_id}')">Delete Floor</button>
    `;
    wrapper.appendChild(header);

    const zonesForFloor = state.zones.filter(z => z.floor_id === floor.floor_id);
    zonesForFloor.forEach(zone => {
      const z = document.createElement("div");
      z.className = "zone";
      z.innerHTML = `
        ${zone.zone_name}
        <button onclick="deleteZone('${zone.zone_id}')">Delete</button>
      `;
      wrapper.appendChild(z);
    });

    preview.appendChild(wrapper);
  });

  // Refresh scheduler zone list if a date is already selected
  if (calSelectedDate) {
    renderZoneScheduleList(getBuildingId(), calSelectedDate);
  }
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
   SAVE TO BACKEND
═══════════════════════════════════════════════════════════ */

qs("btnSave").addEventListener("click", async () => {
  const buildingId = getBuildingId();

  state.building_id = buildingId;
  state.building_name = qs("buildingName").value.trim() || buildingId;
  state.default_floor_id = qs("defaultFloor").value;

  try {
    const response = await fetch(`${API}/buildings/${buildingId}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state)
    });

    if (!response.ok) throw new Error("Save failed");
    toast("Saved to backend ✔");
  } catch (err) {
    console.error(err);
    toast("Backend save failed");
  }
});

/* ═══════════════════════════════════════════════════════════
   LOAD BUTTON
═══════════════════════════════════════════════════════════ */

qs("btnLoad").addEventListener("click", async () => {
  const buildingId = getBuildingId();
  try {
    const response = await fetch(`${API}/buildings/${buildingId}/config`);
    if (!response.ok) throw new Error("Not found");
    state = await response.json();
    qs("buildingName").value = state.building_name || "";
    refreshFloorSelects();
    renderPreview();
    updateLinks();
    toast("Building loaded ✔");
    if (calSelectedDate) renderZoneScheduleList(buildingId, calSelectedDate);
    scanMonthForInactive(buildingId);
  } catch (err) {
    toast("No config found for that Building ID");
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
   AUTO-LOAD FROM URL
═══════════════════════════════════════════════════════════ */

async function autoLoadBuilding() {
  const buildingFromURL = getBuildingFromURL();

  if (buildingFromURL) {
    qs("buildingId").value = buildingFromURL;
    updateLinks();

    try {
      const response = await fetch(`${API}/buildings/${buildingFromURL}/config`);
      if (!response.ok) throw new Error("Not found");

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

function todayISO() {
  const n = new Date();
  return toISO(n.getFullYear(), n.getMonth(), n.getDate());
}

function formatDisplayDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long", year: "numeric", month: "long", day: "numeric"
  });
}

/* ── Fetch inactive zones for a date ── */
async function fetchInactiveZones(buildingId, date) {
  try {
    const res = await fetch(`${API}/buildings/${buildingId}/zones/inactive?date=${date}`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.inactive_zones || [];
  } catch { return []; }
}

/* ── Scan month for any days with inactive zones (for red dots) ── */
async function scanMonthForInactive(buildingId) {
  inactiveDatesForMonth = new Set();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();

  const promises = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = toISO(calYear, calMonth, d);
    promises.push(
      fetch(`${API}/buildings/${buildingId}/zones/inactive?date=${iso}`)
        .then(r => r.ok ? r.json() : { inactive_zones: [] })
        .then(data => ({ iso, count: (data.inactive_zones || []).length }))
        .catch(() => ({ iso, count: 0 }))
    );
  }

  const results = await Promise.all(promises);
  results.forEach(({ iso, count }) => {
    if (count > 0) inactiveDatesForMonth.add(iso);
  });

  renderCalendar();
}

/* ── Render calendar ── */
function renderCalendar() {
  const grid  = qs("calGrid");
  const label = qs("calMonthLabel");
  if (!grid || !label) return;

  const monthNames = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];
  label.textContent = `${monthNames[calMonth]} ${calYear}`;

  grid.innerHTML = "";

  const firstDay = new Date(calYear, calMonth, 1).getDay();
  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = todayISO();

  // Empty leading cells
  for (let i = 0; i < firstDay; i++) {
    const empty = document.createElement("div");
    empty.className = "cal-day cal-empty";
    grid.appendChild(empty);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const iso = toISO(calYear, calMonth, d);
    const cell = document.createElement("div");
    cell.className = "cal-day";
    cell.textContent = d;

    if (iso < today) cell.classList.add("cal-past");
    if (iso === today) cell.classList.add("cal-today");
    if (iso === calSelectedDate) cell.classList.add("cal-selected");
    if (inactiveDatesForMonth.has(iso)) cell.classList.add("cal-has-inactive");

    if (iso >= today) {
      cell.addEventListener("click", () => selectDate(iso));
    }

    grid.appendChild(cell);
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

/* ── Render zone toggle list for selected date ── */
async function renderZoneScheduleList(buildingId, date) {
  const list = qs("zoneScheduleList");
  list.innerHTML = '<div class="sched-empty">Loading…</div>';

  if (!state.zones || state.zones.length === 0) {
    list.innerHTML = '<div class="sched-empty">No zones configured yet. Add zones above first.</div>';
    return;
  }

  const inactiveZones = await fetchInactiveZones(buildingId, date);
  const inactiveIds = new Set(inactiveZones.map(z => z.zone_id));

  // Floor name lookup
  const floorMap = {};
  (state.floors || []).forEach(f => { floorMap[f.floor_id] = f.floor_name; });

  list.innerHTML = "";

  state.zones.forEach(zone => {
    const isInactive = inactiveIds.has(zone.zone_id);
    const floorName = floorMap[zone.floor_id] || zone.floor_id || "—";

    const row = document.createElement("div");
    row.className = "zone-sched-row" + (isInactive ? " inactive-today" : "");
    row.innerHTML = `
      <div class="zone-sched-info">
        <div class="zone-sched-name">${zone.zone_name}</div>
        <div class="zone-sched-floor">${floorName}</div>
      </div>
      <div class="toggle-wrap">
        <span class="toggle-label">${isInactive ? "Inactive" : "Active"}</span>
        <label class="toggle">
          <input type="checkbox" ${isInactive ? "" : "checked"}
            data-zone-id="${zone.zone_id}" />
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;

    const checkbox = row.querySelector("input[type='checkbox']");
    checkbox.addEventListener("change", async () => {
      const isNowActive = checkbox.checked;
      const label = row.querySelector(".toggle-label");
      checkbox.disabled = true;

      try {
        const res = await fetch(`${API}/buildings/${buildingId}/zones/schedule-inactive`, {
          method: isNowActive ? "DELETE" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ building_id: buildingId, zone_id: zone.zone_id, date })
        });

        if (!res.ok) throw new Error();

        label.textContent = isNowActive ? "Active" : "Inactive";
        row.classList.toggle("inactive-today", !isNowActive);
        toast(`${zone.zone_name} → ${isNowActive ? "Active" : "Inactive"} on ${date}`);

        // Refresh month dots
        await scanMonthForInactive(buildingId);
      } catch {
        toast("Failed to update zone schedule");
        checkbox.checked = !checkbox.checked; // revert
      } finally {
        checkbox.disabled = false;
      }
    });

    list.appendChild(row);
  });
}

/* ── Calendar navigation ── */
qs("calPrev").addEventListener("click", () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
  scanMonthForInactive(getBuildingId());
});

qs("calNext").addEventListener("click", () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
  scanMonthForInactive(getBuildingId());
});

/* ═══════════════════════════════════════════════════════════
   BOOT
═══════════════════════════════════════════════════════════ */

autoLoadBuilding();