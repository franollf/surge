const API_URL = "http://localhost:8000/congestion";

// Natural airport flow (MVP)
const ZONE_FLOW = {
  terminal_entry: "security",
  security: "amenities",
  amenities: "boarding_gate",
  boarding_gate: null
};

// DEMO: current zone (later this comes from last scan)
const CURRENT_ZONE = "terminal_entry";

// Poll every 20 seconds
const REFRESH_INTERVAL_MS = 20000;

async function fetchCongestion() {
  try {
    const response = await fetch(API_URL);
    const data = await response.json();
    updateGuidance(data.zones, data.computed_at);
  } catch (error) {
    console.error("Failed to fetch congestion data:", error);
  }
}

function updateGuidance(zones, computedAt) {
  const nextZone = ZONE_FLOW[CURRENT_ZONE];

  document.getElementById("next-zone-name").textContent =
    nextZone ? formatZone(nextZone) : "You have arrived";

  if (!nextZone || !zones[nextZone]) {
    document.getElementById("guidance-message").textContent =
      "No further action required.";
    return;
  }

  const zoneData = zones[nextZone];
  const level = zoneData.congestion_level;
  const avgDwellMin = Math.round(zoneData.avg_dwell_time_seconds / 60);

  const guidanceMessage = document.getElementById("guidance-message");
  const waitTime = document.getElementById("wait-time");
  const alternatives = document.getElementById("alternatives");
  const altList = document.getElementById("alternative-list");

  alternatives.classList.add("hidden");
  altList.innerHTML = "";

  if (level === "LOW") {
    guidanceMessage.textContent =
      "Security is clear. You may proceed.";
    waitTime.textContent =
      avgDwellMin ? `Estimated wait: ~${avgDwellMin} min` : "";
  }

  if (level === "MEDIUM") {
    guidanceMessage.textContent =
      "Security is moderately busy. A short wait is recommended.";
    waitTime.textContent =
      avgDwellMin ? `Estimated wait: ~${avgDwellMin} min` : "";
  }

  if (level === "HIGH") {
    guidanceMessage.textContent =
      "Security is congested. Please wait before proceeding.";
    waitTime.textContent =
      avgDwellMin ? `Estimated wait: ~${avgDwellMin} min` : "";

    // Suggest LOW congestion alternatives
    const lowZones = Object.entries(zones)
      .filter(([_, z]) => z.congestion_level === "LOW")
      .map(([zone]) => zone)
      .filter(z => z !== nextZone);

    if (lowZones.length > 0) {
      alternatives.classList.remove("hidden");
      lowZones.forEach(zone => {
        const li = document.createElement("li");
        li.textContent = formatZone(zone);
        altList.appendChild(li);
      });
    }
  }

  document.getElementById("last-updated").textContent =
    `Last updated: ${new Date(computedAt).toLocaleTimeString()}`;
}

function formatZone(zone) {
  return zone.replace("_", " ").toUpperCase();
}

// Initial load + polling
fetchCongestion();
setInterval(fetchCongestion, REFRESH_INTERVAL_MS);
