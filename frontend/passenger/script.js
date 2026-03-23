// ─── Config ───────────────────────────────────────────────────────────────────
const QR_API_URL    = "http://localhost:8000/issue";
const API_BASE      = "http://localhost:8000";
const POLL_INTERVAL = 20000; // 20 seconds
const BAR_MAX       = 30;    // minutes = 100% bar fill

// ─── State ────────────────────────────────────────────────────────────────────
let currentSurgeId    = null;
let currentZone       = null;
let currentBuildingId = null;
let buildingConfig    = null;

// ─── Detect building from URL param ──────────────────────────────────────────
// QR codes should encode a URL like: /passenger/index.html?building=default-building
// This lets us show live airport waits before any scan happens.
const urlParams  = new URLSearchParams(window.location.search);
const URL_BUILDING = urlParams.get("building") || "default-building";

// ─── Init ─────────────────────────────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  await initializeQRCode();
  await fetchBuildingConfig(URL_BUILDING);
  renderIncentives();                                // show enabled incentives
  await fetchLiveAirportData();                      // show data immediately
  setInterval(fetchLiveAirportData, POLL_INTERVAL);  // keep polling

  // Route recommendation — init independently so it always fires on load
  // regardless of whether fetchLiveAirportData succeeds
  initRouteTabs(URL_BUILDING);

  // Virtual queue — load available zones
  initQueueCard(URL_BUILDING);
});

// ─── QR Code: restore from localStorage or issue fresh ────────────────────────
async function initializeQRCode() {
  const surgeId          = localStorage.getItem('surge_id');
  const qrCodeData       = localStorage.getItem('surge_qr_code');
  const surgeIdTimestamp = localStorage.getItem('surge_id_timestamp');
  const ONE_HOUR         = 60 * 60 * 1000;
  const isExpired        = !surgeIdTimestamp || (Date.now() - parseInt(surgeIdTimestamp) > ONE_HOUR);

  if (surgeId && qrCodeData && !isExpired) {
    console.log("✅ Reusing existing SURGE ID:", surgeId);
    currentSurgeId = surgeId;
    document.getElementById("qr-code-image").src = qrCodeData;
    document.getElementById("surge-id-text").textContent = surgeId;
    await fetchCurrentZone(surgeId);
  } else {
    await issueNewQRCode();
  }
}

async function issueNewQRCode() {
  try {
    const response = await fetch(QR_API_URL);
    if (!response.ok) throw new Error("Failed to issue SURGE ID");

    const surgeId = response.headers.get("x-surge-id");
    if (!surgeId) {
      document.getElementById("surge-id-text").textContent = "Error: No ID received";
      return;
    }

    const imageBlob = await response.blob();
    const reader    = new FileReader();
    reader.onloadend = () => {
      localStorage.setItem('surge_id', surgeId);
      localStorage.setItem('surge_qr_code', reader.result);
      localStorage.setItem('surge_id_timestamp', Date.now().toString());
    };
    reader.readAsDataURL(imageBlob);

    document.getElementById("qr-code-image").src = URL.createObjectURL(imageBlob);
    currentSurgeId = surgeId;
    document.getElementById("surge-id-text").textContent = surgeId;

  } catch (error) {
    console.error("❌ Error issuing QR code:", error);
    document.getElementById("surge-id-text").textContent = "Failed to connect";
  }
}

// ─── Fetch current zone + building ────────────────────────────────────────────
async function fetchCurrentZone(surgeId) {
  try {
    const res = await fetch(`${API_BASE}/passenger/${surgeId}/zone`);
    if (!res.ok) return;
    const data        = await res.json();
    currentZone       = data.current_zone   || null;
    currentBuildingId = data.building_id    || null;
  } catch (e) {
    console.error("fetchCurrentZone error:", e);
  }
}

// ─── Fetch building config (public endpoint, no auth) ─────────────────────────
async function fetchBuildingConfig(buildingId) {
  try {
    const res = await fetch(`${API_BASE}/passenger/building/${buildingId}/config`);
    if (!res.ok) throw new Error("Config not found");
    buildingConfig = await res.json();
    console.log("🏢 Building config loaded:", buildingConfig.building_name);
  } catch (e) {
    console.error("fetchBuildingConfig error:", e);
    buildingConfig = null;
  }
}

// ─── Main poll: live airport data ─────────────────────────────────────────────
// Always shows airport-wide waits. After a scan, adds the personalised
// "Current Location" banner and updates the timeline active step.
async function fetchLiveAirportData() {
  const buildingId = currentBuildingId || URL_BUILDING;

  try {
    // Refresh current zone if we have a surge ID
    if (currentSurgeId) {
      await fetchCurrentZone(currentSurgeId);
    }

    // Refresh building config if building changed
    const effectiveBuildingId = currentBuildingId || URL_BUILDING;
    if (!buildingConfig || buildingConfig.building_id !== effectiveBuildingId) {
      await fetchBuildingConfig(effectiveBuildingId);
    }

    // Fetch live airport status — uses surge_id if scanned, else falls back
    // to the airport-wide live endpoint
    let statusData;

    if (currentSurgeId && currentBuildingId) {
      // Passenger has been scanned — get personalised status
      const res = await fetch(`${API_BASE}/passenger/${currentSurgeId}/status`);
      if (!res.ok) throw new Error("Status fetch failed");
      statusData = await res.json();
    } else {
      // Not yet scanned — get airport-wide live waits
      const res = await fetch(`${API_BASE}/airport/${effectiveBuildingId}/live`);
      if (!res.ok) throw new Error("Live fetch failed");
      statusData = await res.json();
    }

    // Fetch full congestion for zone card + alternatives
    const congRes = await fetch(`${API_BASE}/congestion/${effectiveBuildingId}`);
    if (!congRes.ok) throw new Error("Congestion fetch failed");
    const congData = await congRes.json();
    const zonesObj = congData.zones || {};
    const zonesArr = Object.keys(zonesObj).map(id => ({ zone_id: id, ...zonesObj[id] }));

    // ── Render ──
    updateMetricCards(statusData);
    updateTimeline(statusData);
    updateLastUpdated();
    setConnectionStatus("online");

    // Route recommendation — refresh active tab on each poll
    fetchRouteRecommendation(effectiveBuildingId, activeRouteTab);

    // Virtual queue — refresh position if in a queue
    fetchQueueStatus(effectiveBuildingId);

    if (currentBuildingId && currentZone) {
      // Scanned in — show personalised location banner + guidance
      const currentZoneData = zonesArr.find(z => z.zone_id === currentZone);
      showLocationBanner(currentZoneData);
      updateGuidance(currentZoneData);
      updateAlternatives(currentZoneData, zonesArr);
      document.getElementById("journey-details").style.display = "block";
    } else {
      // Not scanned — hide location banner + guidance, show pre-scan hint
      document.getElementById("location-card").style.display = "none";
      document.getElementById("journey-details").style.display = "none";
      document.getElementById("prescan-hint").style.display = "block";
    }

    console.log("✅ UI updated");

  } catch (error) {
    console.error("fetchLiveAirportData error:", error);
  }
}

// ─── Render: location banner (post-scan) ──────────────────────────────────────
function showLocationBanner(zoneData) {
  document.getElementById("location-card").style.display = "block";
  document.getElementById("prescan-hint").style.display  = "none";

  const nameEl   = document.getElementById("zone-name");
  const statusEl = document.getElementById("zone-status");

  if (!zoneData) {
    nameEl.textContent   = getZoneName(currentZone);
    statusEl.textContent = "—";
    statusEl.className   = "status";
    return;
  }

  nameEl.textContent   = getZoneName(zoneData.zone_id);
  statusEl.textContent = zoneData.congestion_level || "—";
  statusEl.className   = `status ${(zoneData.congestion_level || "").toLowerCase()}`;
}

// ─── Render: 4 metric cards ────────────────────────────────────────────────────
function updateMetricCards(d) {
  setMetricCard("security-val", "security-bar", d.security_wait_minutes);
  setMetricCard("customs-val",  "customs-bar",  d.customs_wait_minutes);

  // Gates breakdown — individual wait per gate
  updateGatesCard(d);
}

function setMetricCard(valId, barId, minutes) {
  document.getElementById(valId).textContent =
    minutes !== null && minutes !== undefined ? Math.round(minutes) : "—";

  const bar = document.getElementById(barId);
  if (bar) {
    const pct = minutes !== null && minutes !== undefined
      ? Math.min(100, Math.round((minutes / BAR_MAX) * 100))
      : 0;
    bar.style.width = pct + "%";
  }
}

function updateGatesCard(d) {
  const list = document.getElementById("gates-list");
  const card = document.getElementById("card-gates");
  if (!list) return;

  const gates = d.gates || [];

  if (!gates.length) {
    list.innerHTML = '<p class="gates-empty">No gate data</p>';
    card.style.borderColor = "";
    return;
  }

  // Colour border based on worst gate congestion
  const levels   = gates.map(g => g.congestion_level);
  const hasHigh  = levels.includes("HIGH");
  const hasMed   = levels.includes("MEDIUM");
  card.style.borderColor = hasHigh
    ? "rgba(248,113,113,0.4)"
    : hasMed
      ? "rgba(251,191,36,0.3)"
      : "rgba(45,212,191,0.25)";

  list.innerHTML = gates.map(g => {
    const wait  = g.wait_minutes !== null ? `${Math.round(g.wait_minutes)} min` : "—";
    const level = g.congestion_level || "LOW";
    const dot   = level === "HIGH"
      ? "var(--error)"
      : level === "MEDIUM"
        ? "var(--warning)"
        : "var(--teal)";

    return `
      <div class="gate-row">
        <div class="gate-row-left">
          <span class="gate-dot" style="background:${dot}"></span>
          <span class="gate-name">${g.zone_name}</span>
        </div>
        <span class="gate-wait">${wait}</span>
      </div>
    `;
  }).join("");
}

// ─── Render: guidance + wait time ─────────────────────────────────────────────
function updateGuidance(zoneData) {
  const guidanceEl = document.getElementById("guidance-text");
  const waitEl     = document.getElementById("wait-time-text");

  if (!zoneData) {
    guidanceEl.textContent = "Zone data unavailable.";
    waitEl.textContent     = "—";
    return;
  }

  guidanceEl.textContent = getGuidanceText(zoneData.congestion_level);

  const mins = zoneData.estimated_wait_minutes;
  if (mins !== null && mins !== undefined) {
    const r = Math.round(mins);
    waitEl.textContent = r >= 60
      ? `~${Math.floor(r / 60)}h`
      : `${r} min`;
  } else {
    waitEl.textContent = "—";
  }
}

function getGuidanceText(level) {
  switch (level) {
    case "LOW":    return "✅ You may proceed. The zone is clear.";
    case "MEDIUM": return "⚠️ Moderate congestion. Expect brief delays.";
    case "HIGH":   return "🛑 High congestion. Consider an alternative route below.";
    default:       return "Status unknown.";
  }
}

// ─── Render: alternatives ─────────────────────────────────────────────────────
function updateAlternatives(currentZoneData, allZones) {
  const list = document.getElementById("alternatives-list");
  list.innerHTML = "";

  if (!currentZoneData || currentZoneData.congestion_level !== "HIGH") {
    const li = document.createElement("li");
    li.textContent = "Current zone is operating normally.";
    list.appendChild(li);
    return;
  }

  const lowZones = allZones.filter(
    z => z.congestion_level === "LOW" && z.zone_id !== currentZoneData.zone_id
  );

  if (lowZones.length > 0) {
    lowZones.forEach(zone => {
      const li = document.createElement("li");
      li.textContent = `${getZoneName(zone.zone_id)} — ${Math.round(zone.estimated_wait_minutes || 0)} min`;
      list.appendChild(li);
    });
  } else {
    const li = document.createElement("li");
    li.textContent = "No low-congestion alternatives available right now.";
    list.appendChild(li);
  }
}

// ─── Render: journey timeline ──────────────────────────────────────────────────
function updateTimeline(d) {
  const typeOrder   = { security: 0, customs: 1, gate: 2 };
  const currentType = getZoneType(currentZone);
  const currentIdx  = typeOrder[currentType] ?? -1;

  [
    { el: document.getElementById("tl-security"), idx: 0 },
    { el: document.getElementById("tl-customs"),  idx: 1 },
    { el: document.getElementById("tl-gate"),     idx: 2 },
    { el: document.getElementById("tl-board"),    idx: 3 },
  ].forEach(({ el, idx }) => {
    el.className = "timeline-step";
    if (currentIdx === -1) return;
    if (idx < currentIdx)   el.classList.add("done");
    if (idx === currentIdx) el.classList.add("active");
  });

  const fmt = v => (v !== null && v !== undefined) ? `~${Math.round(v)} min` : "—";
  document.getElementById("tl-security-time").textContent = fmt(d.security_wait_minutes);
  document.getElementById("tl-customs-time").textContent  = fmt(d.customs_wait_minutes);
  document.getElementById("tl-gate-time").textContent     = fmt(d.gates?.[0]?.wait_minutes ?? null);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function getZoneName(zoneId) {
  if (!zoneId) return "—";
  if (buildingConfig && buildingConfig.zones) {
    const z = buildingConfig.zones.find(z => z.zone_id === zoneId);
    if (z && z.zone_name) return z.zone_name;
  }
  return zoneId.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function getZoneType(zoneId) {
  if (!zoneId) return "general";
  if (buildingConfig && buildingConfig.zones) {
    const z = buildingConfig.zones.find(z => z.zone_id === zoneId);
    if (z) return z.zone_type || "general";
  }
  return "general";
}

function updateLastUpdated() {
  const el = document.getElementById("last-updated");
  if (el) el.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function setConnectionStatus(state) {
  const pill  = document.getElementById("connection-pill");
  const label = document.getElementById("connection-label");
  if (!pill || !label) return;
  if (state === "online") {
    label.textContent = "Live";
    pill.className    = "status-pill online";
  }
  // offline state removed — pill stays as last known state
}

// ─── Route Recommendation ─────────────────────────────────────────────────────

let activeRouteTab        = "security"; // default tab

// Init tab buttons
document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll(".route-tab").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".route-tab").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      activeRouteTab = btn.dataset.type;
      const bid = currentBuildingId || URL_BUILDING;
      if (bid) fetchRouteRecommendation(bid, activeRouteTab);
    });
  });
});

// Pick the best default tab — whichever zone type has the most options
async function initRouteTabs(buildingId) {
  const types = ["security", "customs", "gate"];
  let bestType  = null;
  let bestCount = 0;

  // Fetch all types in parallel — hide tabs with no zones
  const results = await Promise.all(types.map(async (type) => {
    try {
      const res  = await fetch(`${API_BASE}/airport/${buildingId}/recommend/${type}`);
      if (!res.ok) return { type, count: 0 };
      const data = await res.json();
      return { type, count: data.options?.length || 0 };
    } catch (_) {
      return { type, count: 0 };
    }
  }));

  // Show/hide each tab based on whether zones exist, track best
  results.forEach(({ type, count }) => {
    const btn = document.querySelector(`.route-tab[data-type="${type}"]`);
    if (btn) {
      btn.style.display = count > 0 ? "" : "none";
    }
    if (count > bestCount) { bestCount = count; bestType = type; }
  });

  // If no zones found at all, hide the whole card
  const routeCard = document.getElementById("route-card");
  if (!bestType || bestCount === 0) {
    if (routeCard) routeCard.style.display = "none";
    return;
  }

  // Activate the best tab
  activeRouteTab = bestType;
  document.querySelectorAll(".route-tab").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.type === bestType);
  });

  fetchRouteRecommendation(buildingId, bestType);
}

async function fetchRouteRecommendation(buildingId, zoneType) {
  const card = document.getElementById("route-card");
  if (!card) return;

  try {
    const res = await fetch(`${API_BASE}/airport/${buildingId}/recommend/${zoneType}`);
    if (!res.ok) {
      card.style.display = "none";
      return;
    }

    const data = await res.json();

    // Hide card if no zones of this type exist at all
    if (!data.options || data.options.length === 0) {
      card.style.display = "none";
      return;
    }

    card.style.display = "block";
    renderRouteOptions(data);

  } catch (e) {
    console.error("fetchRouteRecommendation error:", e);
    if (card) card.style.display = "none";
  }
}

function renderRouteOptions(data) {
  const optionsEl = document.getElementById("route-options");
  const recEl     = document.getElementById("route-recommendation");
  const recName   = document.getElementById("route-rec-name");
  const recWait   = document.getElementById("route-rec-wait");

  const recommended = data.recommended;
  const options     = data.options;

  // Render each option row
  optionsEl.innerHTML = options.map((opt, i) => {
    const wait    = opt.total_travel_time_minutes !== null && opt.total_travel_time_minutes !== undefined
      ? `${Math.round(opt.total_travel_time_minutes)} min`
      : "—";
    const level   = opt.congestion_level || "LOW";
    const isRec   = recommended && opt.zone_id === recommended.zone_id;

    const levelColor = level === "HIGH"
      ? "var(--error)"
      : level === "MEDIUM"
        ? "var(--warning)"
        : "var(--teal)";

    return `
      <div class="route-option ${isRec ? "route-option-best" : ""}">
        <div class="route-option-left">
          <span class="route-dot" style="background:${levelColor}"></span>
          <span class="route-option-name">${opt.zone_name}</span>
        </div>
        <div class="route-option-right">
          <span class="route-option-wait">${wait}</span>
          ${isRec ? '<span class="route-best-badge">Best</span>' : ''}
        </div>
      </div>
    `;
  }).join("");

  // Recommendation banner
  if (recommended) {
    recEl.style.display = "flex";
    recName.textContent = recommended.zone_name;
    recWait.textContent = recommended.total_travel_time_minutes !== null
      ? `${Math.round(recommended.total_travel_time_minutes)} min`
      : "—";
  } else {
    recEl.style.display = "none";
  }
}

// ─── Virtual Queue ────────────────────────────────────────────────────────────

let activeQueueZoneId = null;   // zone_id passenger has selected to queue for
let inQueue           = false;  // whether current passenger is in a queue

async function initQueueCard(buildingId) {
  const card = document.getElementById("queue-card");
  if (!card) return;

  try {
    const res = await fetch(`${API_BASE}/queue/${buildingId}`);
    if (!res.ok) { card.style.display = "none"; return; }

    const data   = await res.json();
    const queues = data.queues || [];

    // Only show zones that make sense to queue for
    const queueableTypes = ["security", "customs", "gate", "transfer"];
    const relevant = queues.filter(q => queueableTypes.includes(q.zone_type));

    if (!relevant.length) { card.style.display = "none"; return; }

    card.style.display = "block";

    // Build zone selector buttons
    const selector = document.getElementById("queue-zone-select");
    selector.innerHTML = relevant.map(q => `
      <button class="queue-zone-btn" data-zone-id="${q.location_id}" data-zone-name="${q.zone_name}">
        ${q.zone_name}
        <span class="queue-zone-size">${q.current_queue_size} in queue</span>
      </button>
    `).join("");

    // Default to first zone
    if (!activeQueueZoneId && relevant.length > 0) {
      activeQueueZoneId = relevant[0].location_id;
    }

    // Highlight active zone button
    highlightQueueZoneBtn(activeQueueZoneId);

    // Attach click handlers
    selector.querySelectorAll(".queue-zone-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        activeQueueZoneId = btn.dataset.zoneId;
        highlightQueueZoneBtn(activeQueueZoneId);
        fetchQueueStatus(buildingId);
      });
    });

    // Check if already in any queue
    await fetchQueueStatus(buildingId);

  } catch (e) {
    console.error("initQueueCard error:", e);
  }
}

function highlightQueueZoneBtn(zoneId) {
  document.querySelectorAll(".queue-zone-btn").forEach(btn => {
    btn.classList.toggle("active", btn.dataset.zoneId === zoneId);
  });
}

async function fetchQueueStatus(buildingId) {
  if (!currentSurgeId || !activeQueueZoneId) return;

  try {
    const res = await fetch(
      `${API_BASE}/queue/${buildingId}/${activeQueueZoneId}/status?surge_id=${currentSurgeId}`
    );
    if (!res.ok) return;

    const data = await res.json();
    inQueue    = data.in_queue;

    renderQueueState(data);

    // Always refresh zone button sizes on every status poll
    await updateQueueZoneSizes(buildingId);

  } catch (e) {
    console.error("fetchQueueStatus error:", e);
  }
}

async function updateQueueZoneSizes(buildingId) {
  try {
    const res = await fetch(`${API_BASE}/queue/${buildingId}`);
    if (!res.ok) return;
    const data = await res.json();

    (data.queues || []).forEach(q => {
      const btn = document.querySelector(`.queue-zone-btn[data-zone-id="${q.location_id}"]`);
      if (btn) {
        const sizeEl = btn.querySelector(".queue-zone-size");
        if (sizeEl) sizeEl.textContent = `${q.current_queue_size} in queue`;
      }
    });
  } catch (_) {}
}

function renderQueueState(data) {
  const activeEl = document.getElementById("queue-active");
  const joinEl   = document.getElementById("queue-join");
  const subEl    = document.getElementById("queue-join-sub");

  if (data.in_queue) {
    activeEl.style.display = "block";
    joinEl.style.display   = "none";

    document.getElementById("queue-position").textContent =
      data.queue_position !== null ? `#${data.queue_position}` : "—";
    document.getElementById("queue-wait").textContent =
      data.estimated_wait_minutes !== null ? Math.round(data.estimated_wait_minutes) : "—";
    document.getElementById("queue-size").textContent =
      data.current_queue_size !== null ? data.current_queue_size : "—";

  } else {
    activeEl.style.display = "none";
    joinEl.style.display   = "block";

    subEl.textContent = data.current_queue_size > 0
      ? `${data.current_queue_size} people currently in queue`
      : "No queue — join to hold your place";
  }
}

// Join queue button
document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("queue-join-btn")?.addEventListener("click", async () => {
    if (!currentSurgeId || !activeQueueZoneId) return;
    const bid = currentBuildingId || URL_BUILDING;

    try {
      const res = await fetch(`${API_BASE}/queue/${bid}/${activeQueueZoneId}/join`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ surge_id: currentSurgeId }),
      });
      if (!res.ok) throw new Error("Join failed");
      const data = await res.json();
      inQueue    = true;
      renderQueueState({ ...data, in_queue: true });
      // Immediately refresh zone button sizes after joining
      await updateQueueZoneSizes(bid);
    } catch (e) {
      console.error("join queue error:", e);
    }
  });

  document.getElementById("queue-leave-btn")?.addEventListener("click", async () => {
    if (!currentSurgeId || !activeQueueZoneId) return;
    const bid = currentBuildingId || URL_BUILDING;

    try {
      const res = await fetch(
        `${API_BASE}/queue/${bid}/${activeQueueZoneId}/leave?surge_id=${currentSurgeId}`,
        { method: "DELETE" }
      );
      if (!res.ok) throw new Error("Leave failed");
      inQueue = false;
      renderQueueState({
        in_queue:               false,
        current_queue_size:     0,
        estimated_wait_minutes: null,
        queue_position:         null,
      });
      // Immediately refresh zone button sizes after leaving
      const bid2 = currentBuildingId || URL_BUILDING;
      await updateQueueZoneSizes(bid2);
    } catch (e) {
      console.error("leave queue error:", e);
    }
  });
});

// ─── Incentive Modules ────────────────────────────────────────────────────────

const INCENTIVE_MODULES = [
  {
    key:         "queue_priority",
    label:       "Digital Queue Access",
    icon:        "🎟",
    description: "Join virtual queues from your phone and hold your place",
    action:      "Join a Queue",
    actionFn:    () => document.getElementById("queue-card")?.scrollIntoView({ behavior: "smooth" }),
  },
  {
    key:         "retail_discount",
    label:       "Retail Discounts",
    icon:        "🛍",
    description: "Exclusive discounts at terminal retail during your wait",
    action:      "View Offers",
    actionFn:    null,  // no provider connected yet
  },
  {
    key:         "lounge_offer",
    label:       "Lounge Access",
    icon:        "🛋",
    description: "Complimentary lounge access available during delays",
    action:      "View Lounges",
    actionFn:    null,
  },
  {
    key:         "wifi_priority",
    label:       "WiFi Priority",
    icon:        "📶",
    description: "Priority WiFi access while in the terminal",
    action:      "Connect",
    actionFn:    null,
  },
];

function renderIncentives() {
  const card = document.getElementById("incentives-card");
  const list = document.getElementById("incentives-list");
  if (!card || !list || !buildingConfig) return;

  const incentives = buildingConfig.incentives || {};

  // Find which modules are enabled for this building
  const enabled = INCENTIVE_MODULES.filter(m => incentives[m.key] === true);

  if (!enabled.length) {
    card.style.display = "none";
    return;
  }

  card.style.display = "block";
  list.innerHTML = enabled.map(m => `
    <div class="incentive-item">
      <div class="incentive-item-left">
        <span class="incentive-item-icon">${m.icon}</span>
        <div>
          <p class="incentive-item-label">${m.label}</p>
          <p class="incentive-item-desc">${m.description}</p>
        </div>
      </div>
      <button
        class="incentive-action-btn"
        onclick="handleIncentiveAction('${m.key}')"
      >${m.action} →</button>
    </div>
  `).join("");
}

function handleIncentiveAction(key) {
  const module = INCENTIVE_MODULES.find(m => m.key === key);
  if (!module) return;

  if (module.actionFn) {
    module.actionFn();
  } else {
    // Provider not connected yet — show a gentle message
    alert(`${module.label} integration coming soon at this terminal.`);
  }
}