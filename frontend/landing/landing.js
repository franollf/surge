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
  setTimeout(() => t.classList.remove("show"), 1500);
}

function getBuildingId() {
  return qs("buildingId").value.trim() || "default-building";
}

let state = {
  building_id: "default-building",
  building_name: "",
  default_floor_id: "",
  floors: [],
  zones: []
};

function updateLinks() {
  const id = document.getElementById('buildingId').value.trim();
  const passenger = document.getElementById('openPassenger');
  const admin = document.getElementById('openAdmin');

  passenger.href = id ? `../passenger/index.html?building=${encodeURIComponent(id)}` : '#';
admin.href = id ? `../admin/dashboard.html?building=${encodeURIComponent(id)}` : '../admin/dashboard.html';
}

document.getElementById('buildingId').addEventListener('input', updateLinks);
updateLinks();
/* ─────────────────────────────────────────────
   FLOOR SELECTS
───────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────
   DELETE
───────────────────────────────────────────── */

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

/* ─────────────────────────────────────────────
   PREVIEW
───────────────────────────────────────────── */

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

    const zonesForFloor = state.zones.filter(
      z => z.floor_id === floor.floor_id
    );

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
}

/* ─────────────────────────────────────────────
   ADD FLOOR
───────────────────────────────────────────── */

qs("btnAddFloor").addEventListener("click", () => {
  const name = qs("floorName").value.trim();
  if (!name) return toast("Enter floor name");

  const floor = {
    floor_id: uid("floor"),
    floor_name: name
  };

  state.floors.push(floor);

  if (!state.default_floor_id)
    state.default_floor_id = floor.floor_id;

  qs("floorName").value = "";
  refreshFloorSelects();
  renderPreview();
});

/* ─────────────────────────────────────────────
   ADD ZONE
───────────────────────────────────────────── */

qs("btnAddZone").addEventListener("click", () => {
  const name = qs("zoneName").value.trim();
  const floorId = qs("zoneFloor").value;

  if (!name) return toast("Enter zone name");
  if (!floorId) return toast("Select a floor");

  const zone = {
    zone_id: uid("zone"),
    floor_id: floorId,
    zone_name: name,
    zone_type: "custom"
  };

  state.zones.push(zone);

  qs("zoneName").value = "";
  renderPreview();
});

/* ─────────────────────────────────────────────
   SAVE TO BACKEND
───────────────────────────────────────────── */

qs("btnSave").addEventListener("click", async () => {

  const buildingId = getBuildingId();

  state.building_id = buildingId;
  state.building_name =
    qs("buildingName").value.trim() || buildingId;
  state.default_floor_id =
    qs("defaultFloor").value;

  try {
    const response = await fetch(
      `http://localhost:8000/buildings/${buildingId}/config`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(state)
      }
    );

    if (!response.ok)
      throw new Error("Save failed");

    toast("Saved to backend ✔");
  } catch (err) {
    console.error(err);
    toast("Backend save failed");
  }
});

// 🔥 Auto-load building if coming from dashboard
async function autoLoadBuilding() {
  const buildingFromURL = getBuildingFromURL();

  if (buildingFromURL) {
    document.getElementById("buildingId").value = buildingFromURL;
    updateLinks();

    try {
      const response = await fetch(
        `http://localhost:8000/buildings/${buildingFromURL}/config`
      );

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
}

autoLoadBuilding();