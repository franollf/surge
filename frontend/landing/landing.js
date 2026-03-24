/* ═══════════════════════════════════════════════════════════
   UTILITIES
═══════════════════════════════════════════════════════════ */

const API = "http://localhost:8000";

function uid(prefix) {
  return prefix + "_" + Math.random().toString(16).slice(2, 6);
}
function qs(id) { return document.getElementById(id); }
function getBuildingFromURL() {
  return new URLSearchParams(window.location.search).get("building");
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
   AIRPORT ZONE CONSTANTS
═══════════════════════════════════════════════════════════ */

const AIRPORT_ZONES = [
  { zone_type: "terminal_entry", label: "Terminal Entry",    icon: "🏛️" },
  { zone_type: "security",       label: "Security Access",   icon: "🛡️" },
  { zone_type: "customs",        label: "Customs Corridors", icon: "🛂" },
  { zone_type: "gate",           label: "Boarding Gates",    icon: "✈️" },
  { zone_type: "transfer",       label: "Transfer Points",   icon: "🔄" },
  { zone_type: "amenity",        label: "Amenity Access",    icon: "🛍️" },
];

const VALID_ZONE_TYPES = new Set(AIRPORT_ZONES.map(z => z.zone_type));

function getZoneLabel(zone_type) {
  const z = AIRPORT_ZONES.find(z => z.zone_type === zone_type);
  return z ? `${z.icon} ${z.label}` : zone_type;
}

function populateZoneTypeSelect() {
  const select = qs("zoneType");
  if (!select) return;
  select.innerHTML = AIRPORT_ZONES.map(z =>
    `<option value="${z.zone_type}">${z.icon}  ${z.label}</option>`
  ).join("");
}

/* ═══════════════════════════════════════════════════════════
   INCENTIVE MODULES
═══════════════════════════════════════════════════════════ */

const INCENTIVE_MODULES = [
  {
    key:         "queue_priority",
    label:       "Digital Queue Access",
    icon:        "🎟",
    description: "Passengers can join virtual queues from their phone",
  },
  {
    key:         "retail_discount",
    label:       "Retail Discounts",
    icon:        "🛍",
    description: "Offer retail vouchers to passengers in high-wait zones",
  },
  {
    key:         "lounge_offer",
    label:       "Lounge Offers",
    icon:        "🛋",
    description: "Offer lounge access to passengers during delays",
  },
  {
    key:         "wifi_priority",
    label:       "WiFi Priority Access",
    icon:        "📶",
    description: "Grant priority WiFi to passengers in congested zones",
  },
];

const DEFAULT_INCENTIVES = {
  queue_priority:  false,
  retail_discount: false,
  lounge_offer:    false,
  wifi_priority:   false,
};

function renderIncentiveToggles() {
  const container = qs("incentive-toggles");
  if (!container) return;

  container.innerHTML = INCENTIVE_MODULES.map(m => {
    const enabled = state.incentives?.[m.key] || false;
    return `
      <div class="incentive-row">
        <div class="incentive-info">
          <span class="incentive-icon">${m.icon}</span>
          <div>
            <p class="incentive-label">${m.label}</p>
            <p class="incentive-desc">${m.description}</p>
          </div>
        </div>
        <label class="toggle">
          <input
            type="checkbox"
            data-key="${m.key}"
            ${enabled ? "checked" : ""}
            onchange="toggleIncentive('${m.key}', this.checked)"
          />
          <span class="toggle-slider"></span>
        </label>
      </div>
    `;
  }).join("");
}

function toggleIncentive(key, enabled) {
  if (!state.incentives) state.incentives = { ...DEFAULT_INCENTIVES };
  state.incentives[key] = enabled;
}

/* ═══════════════════════════════════════════════════════════
   STATE
═══════════════════════════════════════════════════════════ */

let state = {
  building_id:      "default-building",
  building_name:    "",
  default_floor_id: "",
  floors:           [],
  zones:            [],
  incentives:       { ...DEFAULT_INCENTIVES },
};

/* ═══════════════════════════════════════════════════════════
   LINKS
═══════════════════════════════════════════════════════════ */

function updateLinks() {
  const id = qs("buildingId").value.trim();
  qs("openPassenger").href = id ? `../passenger/index.html?building=${encodeURIComponent(id)}` : "#";
  qs("openAdmin").href     = id ? `../admin/dashboard.html?building=${encodeURIComponent(id)}` : "../admin/dashboard.html";
}

/* ═══════════════════════════════════════════════════════════
   FLOOR SELECTS
═══════════════════════════════════════════════════════════ */

function refreshFloorSelects() {
  const defaultFloorSelect = qs("defaultFloor");
  const zoneFloorSelect    = qs("zoneFloor");

  defaultFloorSelect.innerHTML = "";
  zoneFloorSelect.innerHTML    = "";

  state.floors.forEach(floor => {
    [defaultFloorSelect, zoneFloorSelect].forEach(sel => {
      const opt = document.createElement("option");
      opt.value = floor.floor_id;
      opt.textContent = floor.floor_name;
      sel.appendChild(opt);
    });
  });

  if (state.default_floor_id) defaultFloorSelect.value = state.default_floor_id;
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
        zoneDiv.textContent = `${zone.zone_name} (${getZoneLabel(zone.zone_type)})`;
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
  const name     = qs("zoneName").value.trim();
  const floorId  = qs("zoneFloor").value;
  const zoneType = qs("zoneType").value;

  if (!name)    return toast("Enter zone name (e.g. Gate B21)");
  if (!floorId) return toast("Select a floor");

  if (!VALID_ZONE_TYPES.has(zoneType)) {
    return toast("Invalid zone type. Select an airport zone.");
  }

  const zone = {
    zone_id:   uid("zone"),
    floor_id:  floorId,
    zone_name: name,
    zone_type: zoneType
  };

  state.zones.push(zone);
  qs("zoneName").value = "";
  renderPreview();
  toast(`"${name}" added`);
});

/* ═══════════════════════════════════════════════════════════
   SAVE
═══════════════════════════════════════════════════════════ */

qs("btnSave").addEventListener("click", async () => {
  const buildingId = getBuildingId();

  state.building_id      = buildingId;
  state.building_name    = qs("buildingName").value.trim() || buildingId;
  state.default_floor_id = qs("defaultFloor").value;

  const invalid = state.zones.filter(z => !VALID_ZONE_TYPES.has(z.zone_type));
  if (invalid.length) return toast(`Invalid zone types: ${invalid.map(z => z.zone_name).join(", ")}`);

  try {
    const token = await getAuthToken();
    if (!token) return toast("Please log in first");

    const response = await fetch(`${API}/buildings/${buildingId}/config`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
      body: JSON.stringify(state)
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      const msg = errorData?.detail?.message || errorData?.detail || `HTTP ${response.status}`;
      throw new Error(msg);
    }

    toast("Saved ✔");

  } catch (err) {
    console.error("🔴 Save error:", err);
    toast(err.message || "Backend save failed");
  }
});

/* ═══════════════════════════════════════════════════════════
   LOAD
═══════════════════════════════════════════════════════════ */

qs("btnLoad").addEventListener("click", async () => {
  const buildingId = getBuildingId();

  try {
    const token = await getAuthToken();
    if (!token) return toast("Please log in first");

    const response = await fetch(`${API}/buildings/${buildingId}/config`, {
      headers: { "Authorization": `Bearer ${token}` }
    });

    if (!response.ok) {
      if (response.status === 403) throw new Error("Access denied: You don't own this building");
      if (response.status === 404) throw new Error("Building not found");
      throw new Error(`HTTP ${response.status}`);
    }

    const loaded  = await response.json();
    const all     = loaded.zones || [];
    const valid   = all.filter(z => VALID_ZONE_TYPES.has(z.zone_type));
    const skipped = all.length - valid.length;

    state = {
      ...loaded,
      zones:      valid,
      incentives: { ...DEFAULT_INCENTIVES, ...(loaded.incentives || {}) },
    };

    qs("buildingName").value = state.building_name || "";

    refreshFloorSelects();
    renderPreview();
    renderIncentiveToggles();
    updateLinks();

    toast(skipped > 0 ? `Loaded ✔ (${skipped} old zone type(s) removed)` : "Loaded ✔");

    if (calSelectedDate) renderZoneScheduleList(buildingId, calSelectedDate);
    scanMonthForInactive(buildingId);

  } catch (err) {
    console.error("🔴 Load error:", err);
    toast(err.message || "Failed to load building");
  }
});

/* ═══════════════════════════════════════════════════════════
   CLEAR
═══════════════════════════════════════════════════════════ */

qs("btnClear").addEventListener("click", () => {
  state = {
    building_id:      getBuildingId(),
    building_name:    "",
    default_floor_id: "",
    floors:           [],
    zones:            [],
    incentives:       { ...DEFAULT_INCENTIVES },
  };
  qs("buildingName").value = "";
  refreshFloorSelects();
  renderPreview();
  renderIncentiveToggles();
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
      const token = await getAuthToken();
      if (!token) { renderPreview(); refreshFloorSelects(); return; }

      const response = await fetch(`${API}/buildings/${buildingFromURL}/config`, {
        headers: { "Authorization": `Bearer ${token}` }
      });

      if (!response.ok) {
        if (response.status === 403) { toast("Access denied: You don't own this building"); return; }
        throw new Error("Not found");
      }

      const loaded  = await response.json();
      const all     = loaded.zones || [];
      const valid   = all.filter(z => VALID_ZONE_TYPES.has(z.zone_type));
      const skipped = all.length - valid.length;

      state = {
        ...loaded,
        zones:      valid,
        incentives: { ...DEFAULT_INCENTIVES, ...(loaded.incentives || {}) },
      };

      qs("buildingName").value = state.building_name || "";

      if (skipped > 0) toast(`Loaded ✔ (${skipped} old zone type(s) removed)`);
      else             toast("Building loaded ✔");

    } catch (err) {
      console.warn("No backend config found for", buildingFromURL);
    }
  }

  renderPreview();
  renderIncentiveToggles();
  refreshFloorSelects();
  renderCalendar();

  const bid = getBuildingId();
  if (bid) scanMonthForInactive(bid);
}

/* ═══════════════════════════════════════════════════════════
   ZONE INACTIVITY SCHEDULER
═══════════════════════════════════════════════════════════ */

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();
let calSelectedDate       = null;
let inactiveDatesForMonth = new Set();

function toISO(y, m, d) {
  return `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
}

function formatDisplayDate(iso) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    weekday: "short", year: "numeric", month: "short", day: "numeric"
  });
}

async function scanMonthForInactive(buildingId) {
  const firstDay = toISO(calYear, calMonth, 1);
  const lastDay  = toISO(calYear, calMonth, new Date(calYear, calMonth+1, 0).getDate());

  try {
    const token    = await getAuthToken();
    const response = await fetch(`${API}/buildings/${buildingId}/zones/inactive`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    if (!response.ok) return;

    const data = await response.json();
    inactiveDatesForMonth.clear();
    (data.inactive_zones || []).forEach(z => {
      if (z.date >= firstDay && z.date <= lastDay) inactiveDatesForMonth.add(z.date);
    });
    renderCalendar();
  } catch (err) {
    console.error("Error fetching inactive zones", err);
  }
}

function renderCalendar() {
  const container = qs("calendar");
  container.innerHTML = "";

  const firstDay = new Date(calYear, calMonth, 1);
  const lastDate = new Date(calYear, calMonth+1, 0).getDate();
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
    if (inactiveDatesForMonth.has(iso)) dayDiv.classList.add("has-inactive");
    if (iso === calSelectedDate)        dayDiv.classList.add("selected");

    dayDiv.addEventListener("click", () => selectDate(iso));
    container.appendChild(dayDiv);
  }
}

async function selectDate(iso) {
  calSelectedDate = iso;
  renderCalendar();
  qs("calSelectedDisplay").textContent = formatDisplayDate(iso);
  qs("schedHint").textContent          = formatDisplayDate(iso);
  await renderZoneScheduleList(getBuildingId(), iso);
}

async function renderZoneScheduleList(buildingId, date) {
  const container = qs("zoneScheduleList");
  container.innerHTML = "";

  if (!state.zones || state.zones.length === 0) {
    container.innerHTML = '<div class="sched-empty">No zones in this building.</div>';
    return;
  }

  try {
    const token    = await getAuthToken();
    const response = await fetch(`${API}/buildings/${buildingId}/zones/inactive?date=${date}`, {
      headers: { "Authorization": `Bearer ${token}` }
    });
    const data        = await response.json();
    const inactiveSet = new Set((data.inactive_zones || []).map(z => z.zone_id));

    state.zones.forEach(zone => {
      const isInactive = inactiveSet.has(zone.zone_id);

      // FIX: checked = ACTIVE (green), unchecked = INACTIVE (red)
      const isChecked = !isInactive;

      const row = document.createElement("div");
      row.className = `zone-sched-row${isInactive ? " inactive-today" : ""}`;

      const floorName = state.floors.find(f => f.floor_id === zone.floor_id)?.floor_name || "";

      row.innerHTML = `
        <div class="zone-sched-info">
          <div class="zone-sched-name">${zone.zone_name}</div>
          <div class="zone-sched-floor">${getZoneLabel(zone.zone_type)}${floorName ? " · " + floorName : ""}</div>
        </div>
        <div class="toggle-wrap">
          <span class="toggle-label">${isInactive ? "Inactive" : "Active"}</span>
          <label class="toggle">
            <input type="checkbox" ${isChecked ? "checked" : ""} data-zone-id="${zone.zone_id}">
            <span class="toggle-slider"></span>
          </label>
        </div>
      `;

      row.querySelector("input[type='checkbox']").addEventListener("change", async (e) => {
        const nowActive = e.target.checked; // true = green = active, false = red = inactive
        const labelEl   = row.querySelector(".toggle-label");
        labelEl.textContent = nowActive ? "Active" : "Inactive";
        row.classList.toggle("inactive-today", !nowActive);
        // When nowActive=false the zone is being marked inactive → pass inactive=true
        await toggleZoneInactive(buildingId, zone.zone_id, date, !nowActive);
      });

      container.appendChild(row);
    });

  } catch (err) {
    console.error("Error loading zone schedules", err);
    container.innerHTML = '<div class="sched-empty">Failed to load zone schedules.</div>';
  }
}

async function toggleZoneInactive(buildingId, zoneId, date, inactive) {
  try {
    const token = await getAuthToken();

    if (inactive) {
      // Zone is being set INACTIVE → POST to schedule it
      const r = await fetch(`${API}/buildings/${buildingId}/zones/schedule-inactive`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify({ building_id: buildingId, zone_id: zoneId, date })
      });
      if (!r.ok) throw new Error("Failed to schedule inactive");
      toast("Zone marked inactive ✔");
    } else {
      // Zone is being set ACTIVE → DELETE the inactive schedule
      const r = await fetch(
        `${API}/buildings/${buildingId}/zones/schedule-inactive?zone_id=${zoneId}&date=${date}`,
        {
          method: "DELETE",
          headers: { "Authorization": `Bearer ${token}` }
        }
      );
      if (!r.ok) throw new Error("Failed to remove inactive schedule");
      toast("Zone marked active ✔");
    }

    scanMonthForInactive(buildingId);

  } catch (err) {
    console.error(err);
    toast("Failed to update zone status");
  }
}

qs("calPrev").addEventListener("click", () => {
  calMonth--;
  if (calMonth < 0) { calMonth = 11; calYear--; }
  renderCalendar();
  if (getBuildingId()) scanMonthForInactive(getBuildingId());
});

qs("calNext").addEventListener("click", () => {
  calMonth++;
  if (calMonth > 11) { calMonth = 0; calYear++; }
  renderCalendar();
  if (getBuildingId()) scanMonthForInactive(getBuildingId());
});

/* ═══════════════════════════════════════════════════════════
   INIT
═══════════════════════════════════════════════════════════ */

qs("buildingId").addEventListener("input", updateLinks);
populateZoneTypeSelect();
autoLoadBuilding();