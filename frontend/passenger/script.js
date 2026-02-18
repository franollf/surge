const API_URL = "http://localhost:8000/zones";
const QR_API_URL = "http://localhost:8000/issue";
const POLL_INTERVAL = 20000; // 20 seconds

let currentSurgeId = null;
let currentZone = "terminal_entry"; // Default starting zone

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
  // Check if we already have a SURGE ID stored
  let surgeId = localStorage.getItem('surge_id');
  let qrCodeData = localStorage.getItem('surge_qr_code'); // Store QR image too!
  let surgeIdTimestamp = localStorage.getItem('surge_id_timestamp');
  const ONE_HOUR = 60 * 60 * 1000; // 1 hour in milliseconds

  // Check if ID exists and is still valid (less than 1 hour old)
  const isExpired = !surgeIdTimestamp || (Date.now() - parseInt(surgeIdTimestamp) > ONE_HOUR);

  if (surgeId && qrCodeData && !isExpired) {
    // Reuse existing SURGE ID and QR code
    console.log("✅ Reusing existing SURGE ID:", surgeId);
    currentSurgeId = surgeId;
    
    // Display stored QR code
    const qrImage = document.getElementById("qr-code-image");
    qrImage.src = qrCodeData;
    
    // Display FULL ID
    document.getElementById("surge-id-text").textContent = `ID: ${surgeId}`;
    
    await fetchCurrentZone(surgeId);
  } else {
    // Issue new SURGE ID
    console.log("🆕 Issuing new SURGE ID...");
    await issueNewQRCode();
  }
}

// Issue a new QR code and SURGE ID
async function issueNewQRCode() {
  const qrImage = document.getElementById("qr-code-image");
  
  try {
    // Fetch new QR code
    const response = await fetch(QR_API_URL);
    
    if (!response.ok) throw new Error("Failed to issue SURGE ID");
    
    // Get the SURGE ID from response header
    const surgeId = response.headers.get("x-surge-id");
    
    if (!surgeId) {
      console.error("❌ No X-Surge-ID header in response!");
      document.getElementById("surge-id-text").textContent = "Error: No ID received";
      return;
    }
    
    // Convert response to blob
    const imageBlob = await response.blob();
    
    // Convert blob to base64 for storage
    const reader = new FileReader();
    reader.onloadend = () => {
      const base64data = reader.result;
      
      // Store everything in localStorage
      localStorage.setItem('surge_id', surgeId);
      localStorage.setItem('surge_qr_code', base64data); // Store QR as base64
      localStorage.setItem('surge_id_timestamp', Date.now().toString());
      
      console.log("✅ New SURGE ID issued and stored:", surgeId);
    };
    reader.readAsDataURL(imageBlob);
    
    // Display the QR code
    const imageUrl = URL.createObjectURL(imageBlob);
    qrImage.src = imageUrl;
    
    // Store and display the ID
    currentSurgeId = surgeId;
    document.getElementById("surge-id-text").textContent = `ID: ${surgeId}`; // Full ID shown
    
    // New users start at terminal_entry by default
    currentZone = "terminal_entry";
    
  } catch (error) {
    console.error("❌ Error issuing QR code:", error);
    document.getElementById("qr-code-display").innerHTML = 
      `<p style="color: red;">Failed to load QR code. Check backend connection.</p>`;
    document.getElementById("surge-id-text").textContent = "Error loading ID";
  }
}

// Fetch the passenger's current zone from backend
async function fetchCurrentZone(surgeId) {
  try {
    const response = await fetch(`http://localhost:8000/passenger/${surgeId}/zone`);
    if (!response.ok) throw new Error("Failed to fetch current zone");
    
    const data = await response.json();
    currentZone = data.current_zone;
    console.log("📍 Current zone updated:", currentZone);
    
  } catch (error) {
    console.error("Error fetching current zone:", error);
    // Fallback to default
    currentZone = "terminal_entry";
  }
}

// Fetch congestion data and provide guidance
async function fetchGuidance() {
  // Make sure we have a SURGE ID first
  if (!currentSurgeId) {
    console.log("⏳ Waiting for SURGE ID to be issued...");
    return;
  }

  console.log("🔄 Fetching guidance for SURGE ID:", currentSurgeId);

  try {
    // First, update current zone
    await fetchCurrentZone(currentSurgeId);
    
    console.log("📍 Current zone after fetch:", currentZone);
    
    // Then fetch zone congestion data
    const response = await fetch(API_URL);
    if (!response.ok) throw new Error("Failed to fetch zone data");

    const data = await response.json();
    console.log("📊 Raw API response:", data);
    
    // ✅ FIX: Extract zones object and convert to array
    const zonesObject = data.zones;
    const zonesArray = Object.keys(zonesObject).map(zoneId => ({
      zone_id: zoneId,
      ...zonesObject[zoneId]
    }));
    
    console.log("📊 Zones array:", zonesArray);
    
    // Now find the current zone in the array
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
  
  // Update zone info
  document.getElementById("zone-name").textContent = formatZoneName(currentZoneData.zone_id);
  document.getElementById("zone-status").textContent = 
    `Congestion: ${currentZoneData.congestion_level}`;
  document.getElementById("zone-status").className = 
    `status ${currentZoneData.congestion_level.toLowerCase()}`;

  // Update guidance
  const guidanceText = getGuidanceText(currentZoneData.congestion_level);
  document.getElementById("guidance-text").textContent = guidanceText;

  // REAL Estimated Wait Time
const waitTimeMinutes = currentZoneData.estimated_wait_minutes;
const waitElement = document.getElementById("wait-time-text");

if (waitTimeMinutes !== null && waitTimeMinutes !== undefined) {

  const roundedMinutes = Math.round(waitTimeMinutes);

  if (roundedMinutes >= 60) {
    const hours = Math.floor(roundedMinutes / 60);

    waitElement.textContent =
      hours === 1
        ? "Approximately 1 hour"
        : `Approximately ${hours} hours`;
  } else {
    waitElement.textContent =
      `Approximately ${roundedMinutes} minute${roundedMinutes === 1 ? "" : "s"}`;
  }

} else {
  waitElement.textContent = "Processing currently delayed";
}

  // Update alternatives if congestion is high
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
        li.textContent = `${formatZoneName(zone.zone_id)} (${dwellMinutes} min wait)`;
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

// Format zone ID for display
function formatZoneName(zoneId) {
  return zoneId.replace(/_/g, " ").replace(/\b\w/g, char => char.toUpperCase());
}