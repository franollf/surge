const QR_API_URL = "http://localhost:8000/issue";
const POLL_INTERVAL = 20000; // 20 seconds

let currentSurgeId = null;
let currentZone = "terminal_entry"; // Default starting zone
let currentBuildingId = null; // Dynamic building ID
let buildingConfig = null; // Cached building config (contains zone names)

// Initialize on page load
window.addEventListener('DOMContentLoaded', () => {
  initializeQRCode();
  // Start polling after a short delay
  setTimeout(() => {
    fetchGuidance();
    setInterval(fetchGuidance, POLL_INTERVAL);
  }, 1000);
});

// Initialize and display QR code
async function initializeQRCode() {
  let surgeId = localStorage.getItem('surge_id');
  let qrCodeData = localStorage.getItem('surge_qr_code');
  let surgeIdTimestamp = localStorage.getItem('surge_id_timestamp');
  const ONE_HOUR = 60 * 60 * 1000;

  const isExpired = !surgeIdTimestamp || (Date.now() - parseInt(surgeIdTimestamp) > ONE_HOUR);

  if (surgeId && qrCodeData && !isExpired) {
    console.log("✅ Reusing existing SURGE ID:", surgeId);
    currentSurgeId = surgeId;

    const qrImage = document.getElementById("qr-code-image");
    qrImage.src = qrCodeData;

    document.getElementById("surge-id-text").textContent = `ID: ${surgeId}`;

    await fetchCurrentZone(surgeId);
  } else {
    console.log("🆕 Issuing new SURGE ID...");
    await issueNewQRCode();
  }
}

// Issue a new QR code and SURGE ID
async function issueNewQRCode() {
  const qrImage = document.getElementById("qr-code-image");

  try {
    const response = await fetch(QR_API_URL);

    if (!response.ok) throw new Error("Failed to issue SURGE ID");

    const surgeId = response.headers.get("x-surge-id");

    if (!surgeId) {
      console.error("❌ No X-Surge-ID header in response!");
      document.getElementById("surge-id-text").textContent = "Error: No ID received";
      return;
    }

    const imageBlob = await response.blob();

    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result;
      localStorage.setItem('surge_id', surgeId);
      localStorage.setItem('surge_qr_code', base64data);
      localStorage.setItem('surge_id_timestamp', Date.now().toString());
      console.log("✅ New SURGE ID issued and stored:", surgeId);
    };
    reader.readAsDataURL(imageBlob);

    const imageUrl = URL.createObjectURL(imageBlob);
    qrImage.src = imageUrl;

    currentSurgeId = surgeId;
    document.getElementById("surge-id-text").textContent = `ID: ${surgeId}`;

    // New passengers haven't been scanned into a building yet
    currentZone = "terminal_entry";
    currentBuildingId = null;

  } catch (error) {
    console.error("❌ Error issuing QR code:", error);
    document.getElementById("qr-code-display").innerHTML =
      `<p style="color: red;">Failed to load QR code. Check backend connection.</p>`;
    document.getElementById("surge-id-text").textContent = "Error loading ID";
  }
}

// Fetch the passenger's current zone AND building from backend
async function fetchCurrentZone(surgeId) {
  try {
    const response = await fetch(`http://localhost:8000/passenger/${surgeId}/zone`);
    if (!response.ok) throw new Error("Failed to fetch current zone");

    const data = await response.json();
    currentZone = data.current_zone;
    currentBuildingId = data.building_id || null;
    console.log("📍 Zone:", currentZone, "| Building:", currentBuildingId);

  } catch (error) {
    console.error("Error fetching current zone:", error);
    currentZone = "terminal_entry";
    currentBuildingId = null;
  }
}

// Fetch building config to get real zone names
async function fetchBuildingConfig(buildingId) {
  try {
    const response = await fetch(`http://localhost:8000/buildings/${buildingId}/config`);
    if (!response.ok) throw new Error("Failed to fetch building config");
    buildingConfig = await response.json();
    console.log("🏢 Building config loaded:", buildingConfig);
  } catch (error) {
    console.error("Error fetching building config:", error);
    buildingConfig = null;
  }
}

// Look up the human-readable zone name from the building config
function getZoneName(zoneId) {
  if (buildingConfig && buildingConfig.zones) {
    const zone = buildingConfig.zones.find(z => z.zone_id === zoneId);
    if (zone && zone.zone_name) return zone.zone_name;
  }
  // Fallback: format the ID if config isn't loaded
  return zoneId.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}

// Fetch congestion data and provide guidance
async function fetchGuidance() {
  if (!currentSurgeId) {
    console.log("⏳ Waiting for SURGE ID to be issued...");
    return;
  }

  console.log("🔄 Fetching guidance for SURGE ID:", currentSurgeId);

  try {
    // First, update current zone + building
    await fetchCurrentZone(currentSurgeId);

    console.log("📍 Zone:", currentZone, "| Building:", currentBuildingId);

    // If not scanned into a building yet, show a waiting state
    if (!currentBuildingId || currentBuildingId === "unknown") {
      document.getElementById("zone-name").textContent = "Not yet scanned";
      document.getElementById("zone-status").textContent = "Awaiting first checkpoint scan";
      document.getElementById("zone-status").className = "status";
      document.getElementById("guidance-text").textContent =
        "Please scan your QR code at the first checkpoint to receive guidance.";
      document.getElementById("wait-time-text").textContent = "—";
      const list = document.getElementById("alternatives-list");
      list.innerHTML = "";
      const li = document.createElement("li");
      li.textContent = "Scan at a checkpoint to see zone info.";
      list.appendChild(li);
      return;
    }

    // Fetch building config if we don't have it yet or building changed
    if (!buildingConfig || buildingConfig.building_id !== currentBuildingId) {
      await fetchBuildingConfig(currentBuildingId);
    }

    // Fetch congestion for the passenger's current building (dynamic)
    const response = await fetch(`http://localhost:8000/congestion/${currentBuildingId}`);
    if (!response.ok) throw new Error("Failed to fetch zone data");

    const data = await response.json();
    console.log("📊 Raw API response:", data);

    const zonesObject = data.zones;
    const zonesArray = Object.keys(zonesObject).map(zoneId => ({
      zone_id: zoneId,
      ...zonesObject[zoneId]
    }));

    console.log("📊 Zones array:", zonesArray);

    const currentZoneData = zonesArray.find(zone => zone.zone_id === currentZone);
    console.log("🎯 Current zone data found:", currentZoneData);

    if (!currentZoneData) {
      console.error("❌ Zone not found:", currentZone);
      document.getElementById("guidance-text").textContent = "Zone not found.";
      return;
    }

    updateUI(currentZoneData, zonesArray);
  } catch (error) {
    console.error("Error fetching guidance:", error);
    document.getElementById("guidance-text").textContent =
      "Unable to fetch guidance. Please try again later.";
  }
}

// Update UI based on current zone data
function updateUI(currentZoneData, allZones) {
  console.log("🎨 Updating UI with zone data:", currentZoneData);

  document.getElementById("zone-name").textContent = getZoneName(currentZoneData.zone_id);
  document.getElementById("zone-status").textContent =
    `Congestion: ${currentZoneData.congestion_level}`;
  document.getElementById("zone-status").className =
    `status ${currentZoneData.congestion_level.toLowerCase()}`;

  const guidanceText = getGuidanceText(currentZoneData.congestion_level);
  document.getElementById("guidance-text").textContent = guidanceText;

  const waitTimeMinutes = currentZoneData.estimated_wait_minutes;
  const waitElement = document.getElementById("wait-time-text");

  if (waitTimeMinutes !== null && waitTimeMinutes !== undefined) {
    const roundedMinutes = Math.round(waitTimeMinutes);

    if (roundedMinutes >= 60) {
      const hours = Math.floor(roundedMinutes / 60);
      waitElement.textContent =
        hours === 1 ? "Approximately 1 hour" : `Approximately ${hours} hours`;
    } else {
      waitElement.textContent =
        `Approximately ${roundedMinutes} minute${roundedMinutes === 1 ? "" : "s"}`;
    }
  } else {
    waitElement.textContent = "Processing currently delayed";
  }

  const alternativesList = document.getElementById("alternatives-list");
  alternativesList.innerHTML = "";

  if (currentZoneData.congestion_level === "HIGH") {
    const lowCongestionZones = allZones.filter(
      zone => zone.congestion_level === "LOW" && zone.zone_id !== currentZoneData.zone_id
    );

    if (lowCongestionZones.length > 0) {
      lowCongestionZones.forEach(zone => {
        const dwellMinutes = Math.round((zone.avg_dwell_time_seconds || 0) / 60);
        const li = document.createElement("li");
        li.textContent = `${getZoneName(zone.zone_id)} (${dwellMinutes} min wait)`;
        alternativesList.appendChild(li);
      });
    } else {
      const li = document.createElement("li");
      li.textContent = "No low-congestion zones available at this time.";
      alternativesList.appendChild(li);
    }
  } else {
    const li = document.createElement("li");
    li.textContent = "Current zone is operating normally.";
    alternativesList.appendChild(li);
  }

  console.log("✅ UI update complete");
}

// Generate guidance text based on congestion level
function getGuidanceText(congestionLevel) {
  switch (congestionLevel) {
    case "LOW":
      return "✅ You may proceed. The zone is clear.";
    case "MEDIUM":
      return "⚠️ Moderate congestion. Expect brief delays.";
    case "HIGH":
      return "🛑 High congestion. Consider waiting or visiting a low-congestion area.";
    default:
      return "Status unknown.";
  }
}