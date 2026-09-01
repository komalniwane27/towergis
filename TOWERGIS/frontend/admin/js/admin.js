"use strict";

/* ============================================================
   TOWERGIS ADMIN DASHBOARD (HYBRID: LOCAL SQLITE + CLOUD SUPABASE)
   ============================================================ */

const SUPABASE_URL = "https://lhbtkeniqvmeotdensjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_8l4_goaT5nmazuWEpSQrMw_a0R89dNY";
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

const API_BASE = "/api";
const $ = (id) => document.getElementById(id);

let globalComplaints = [];
let TOWERS = [];
let FACILITIES = [];
const PUNE = { lat: 18.5204, lng: 73.8567 };

// Chart.js instances (dashboard analytics)
let complaintsStatusChart = null;
let towersOperatorChart = null;
let complaintsTrendChart = null;

// User Markers Map
let activeMarkers = {};

// Dashboard Filtered Leaflet Map Instance
let dashTowerMap = null;
let dashTowerLayer = null;
let currentTowerFilter = "all";

// Heatmap Leaflet Map & Layer instances
let heatmapMap = null;
let heatmapInitialized = false;
let complaintHeatLayer = null;

// Susceptibility Map instances
let susceptibilityMap = null;
let susceptibilityLayer = null;
let susceptibilityInitialized = false;

// Logistics & Flood Map Instances
let facilityMap, facilityRouteLayer, facTowerLayer, facMarkerLayer, complaintMarkerLayer;
let facilityInitialized = false;
let towerMarkersMap = {};
let facilityMarkersMap = {};
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving/';

let floodMap, measuring = false, measurePoints = [], measureLayer, floodTowerLayer;
let floodInitialized = false;

// ============================================================
// TOKEN & LOCAL BACKEND REQUEST HELPER
// ============================================================

function getToken() {
    return localStorage.getItem("access_token") || localStorage.getItem("token") || localStorage.getItem("towergis_token");
}

async function apiRequest(endpoint, options = {}) {
    const token = getToken();
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    if (token) headers["Authorization"] = `Bearer ${token}`;

    const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

    if (response.status === 401) {
        localStorage.clear();
        window.location.href = "../login.html";
        throw new Error("Session expired.");
    }

    let data = null;
    try { data = await response.json(); } catch { data = null; }
    if (!response.ok) throw new Error(data?.detail || data?.message || `Request failed: ${response.status}`);
    return data;
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
let toastTimer = null;
function showToast(message, type = "success") {
    const toast = $("toast");
    const messageElement = $("toastMessage");
    if (!toast || !messageElement) return;

    messageElement.textContent = message;
    toast.className = `toast ${type} show`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

// ============================================================
// 1. UNIVERSAL GPS LOCATOR HELPER
// ============================================================
window.locateAdminGPS = function(mapType) {
    let targetMap, markerKey;
    if (mapType === 'dashboard') { targetMap = dashTowerMap; markerKey = 'dashUserMarker'; }
    else if (mapType === 'heatmap') { targetMap = heatmapMap; markerKey = 'heatmapMarker'; }
    else if (mapType === 'facility') { targetMap = facilityMap; markerKey = 'facilityUserMarker'; }
    else if (mapType === 'flood') { targetMap = floodMap; markerKey = 'floodUserMarker'; }
    else if (mapType === 'susceptibility') { targetMap = susceptibilityMap; markerKey = 'susceptibilityUserMarker'; }

    if (!targetMap) {
        showToast("Map is not fully initialized yet.", "error");
        return;
    }

    if (!navigator.geolocation) {
        showToast("Geolocation is not supported by your browser.", "error");
        return;
    }
    showToast("Detecting your live location...");
    navigator.geolocation.getCurrentPosition((position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;

        if (activeMarkers[markerKey]) {
            targetMap.removeLayer(activeMarkers[markerKey]);
        }

        activeMarkers[markerKey] = L.circleMarker([lat, lng], { 
            radius: 5, color:'#ffffff', weight:2, fillColor:'#3b82f6', fillOpacity:0.9 
        }).addTo(targetMap).bindPopup('<div class="pop-box"><h3>📍 You are here</h3></div>').openPopup();

        targetMap.setView([lat, lng], 15);
        showToast("Location found!");
    }, () => {
        showToast("Unable to retrieve location. Check permissions.", "error");
    });
};

// ============================================================
// LOAD ADMIN PROFILE
// ============================================================
async function loadCurrentAdmin() {
    try {
        const user = await apiRequest("/auth/me");
        const name = user.name || "TOWERGIS Administrator";
        const email = user.email || "admin@beacon.tc";
        const firstLetter = name.charAt(0).toUpperCase();

        if ($("welcomeAdminName")) $("welcomeAdminName").textContent = name;
        if ($("sidebarAdminName")) $("sidebarAdminName").textContent = name;
        if ($("sidebarAdminEmail")) $("sidebarAdminEmail").textContent = email;
        if ($("topAdminName")) $("topAdminName").textContent = name;
        if ($("adminAvatar")) $("adminAvatar").textContent = firstLetter;
        if ($("topAdminAvatar")) $("topAdminAvatar").textContent = firstLetter;
        return true;
    } catch (error) { console.error("Admin authentication error:", error); return true; }
}

// ============================================================
// LOAD DASHBOARD STATS
// ============================================================
async function loadDashboard() {
    try {
        const localData = await apiRequest("/admin/dashboard").catch(() => ({ stats: {} }));
        const stats = localData.stats || {};

        if ($("totalCustomers")) $("totalCustomers").textContent = stats.customers ?? 2;
        if ($("totalWorkers")) $("totalWorkers").textContent = stats.workers ?? 3;

        if (supabaseClient) {
            const { data: towerRows } = await supabaseClient.from('towers').select('*');
            const towersList = towerRows || [];
            
            let operational = 0; let maintenance = 0; let inactive = 0;
            towersList.forEach(t => {
                const s = (t.status || "Operational").trim().toLowerCase();
                if (s.includes("maint") || s.includes("under")) maintenance++;
                else if (s.includes("not") || s.includes("inactive") || s.includes("offline")) inactive++;
                else operational++;
            });

            if ($("totalTowers")) $("totalTowers").textContent = towersList.length;
            if ($("activeTowers")) $("activeTowers").textContent = operational;
            if ($("maintenanceTowers")) $("maintenanceTowers").textContent = maintenance;
            if ($("inactiveTowers")) $("inactiveTowers").textContent = inactive;

            const { data: dbComplaints } = await supabaseClient.from('complaints').select('*');
            globalComplaints = dbComplaints || [];
            const open = globalComplaints.filter(c => c.status !== 'Resolved' && c.status !== 'closed' && c.status !== 'Rejected').length;
            if ($("openComplaints")) $("openComplaints").textContent = open;
            if ($("pendingRequests")) $("pendingRequests").textContent = globalComplaints.length;
        }

        renderDashboardTowerMap();
        renderAnalyticsCharts();
    } catch (error) { console.error("Dashboard calculation error:", error); }
}

// ============================================================
// MAP BUILD HELPERS
// ============================================================
function buildBaseLayers() {
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap' });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { maxZoom: 17, attribution: 'OpenTopoMap' });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19, attribution: 'Esri' });
    const hybridLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { attribution: 'Esri' });
    const hybrid = L.layerGroup([satellite, hybridLabels]);
    return { streets, topo, satellite, hybrid };
}

// ============================================================
// MAIN DASHBOARD MAP
// ============================================================
function initDashboardMap() {
    if (dashTowerMap) return;
    const { streets, topo, satellite, hybrid } = buildBaseLayers();

    dashTowerMap = L.map('dashTowerMap', { center: [PUNE.lat, PUNE.lng], zoom: 12, layers: [streets] });

    const baseMaps = { "Streets": streets, "Topography": topo, "Satellite": satellite, "Hybrid": hybrid };
    L.control.layers(baseMaps, null, { position: 'topright' }).addTo(dashTowerMap);
    L.control.scale({ position: 'bottomright' }).addTo(dashTowerMap);
    dashTowerLayer = L.layerGroup().addTo(dashTowerMap);
}

function renderDashboardTowerMap() {
    initDashboardMap();
    if (!dashTowerMap || !dashTowerLayer) return;
    dashTowerLayer.clearLayers();

    const filtered = TOWERS.filter(t => {
        const s = (t.status || "Operational").trim().toLowerCase();
        if (currentTowerFilter === "operational") return !s.includes("maint") && !s.includes("under") && !s.includes("not") && !s.includes("offline");
        if (currentTowerFilter === "maintenance") return s.includes("maint") || s.includes("under");
        if (currentTowerFilter === "inactive") return s.includes("not") || s.includes("inactive") || s.includes("offline");
        return true;
    });

    filtered.forEach(t => {
        const s = (t.status || "Operational").trim().toLowerCase();
        let color = "#22c55e"; 
        if (s.includes("maint") || s.includes("under")) color = "#f59e0b"; 
        else if (s.includes("not") || s.includes("inactive") || s.includes("offline")) color = "#ef4444"; 

        L.circleMarker([t.lat, t.lng], { radius: 4.5, color: "#ffffff", weight: 1, fillColor: color, fillOpacity: 0.9 })
            .bindPopup(`<div class="pop-box"><h3 style="color:${color};">Tower ${escapeHTML(t.id)}</h3><div class="row"><span>Operator</span><span>${escapeHTML(t.op)}</span></div><div class="row"><span>Status</span><span style="font-weight:700; color:${color};">${escapeHTML(t.status || 'Operational')}</span></div><div class="row"><span>Technology</span><span>${escapeHTML(t.net)}</span></div><div class="row" style="border-bottom:none;"><span>Height / Radius</span><span>${t.height_m}m • ${t.cov_radius}km</span></div></div>`)
            .addTo(dashTowerLayer);
    });
    dashTowerMap.invalidateSize();
}

window.filterDashboardTowerMap = function(statusCategory) {
    currentTowerFilter = statusCategory;
    ["All", "Active", "Maint", "Inactive"].forEach(k => { const el = $("btnFilter" + k); if (el) el.classList.remove("active"); });
    const labelMap = {
        "all": ["All Infrastructure", "btnFilterAll"],
        "operational": ["Active / Operational Towers (Green)", "btnFilterActive"],
        "maintenance": ["Under Maintenance Towers (Yellow)", "btnFilterMaint"],
        "inactive": ["Not Active Towers (Red)", "btnFilterInactive"]
    };
    const target = labelMap[statusCategory] || labelMap.all;
    if ($("activeMapFilterLabel")) $("activeMapFilterLabel").textContent = `Showing: ${target[0]}`;
    if ($(target[1])) $(target[1]).classList.add("active");
    renderDashboardTowerMap();
};

// ============================================================
// DASHBOARD ANALYTICS CHARTS
// ============================================================
function renderAnalyticsCharts() {
    if (typeof Chart === "undefined" || !$("chartComplaintsStatus")) return;

    const statusCounts = { "Pending": 0, "In Progress": 0, "Resolved": 0, "Rejected": 0 };
    (globalComplaints || []).forEach(c => { statusCounts[c.status || "Pending"] = (statusCounts[c.status || "Pending"] || 0) + 1; });
    const lbls = Object.keys(statusCounts).filter(k => statusCounts[k] > 0);
    if ($("chartComplaintsTotal")) $("chartComplaintsTotal").textContent = `${globalComplaints.length} total`;

    if (complaintsStatusChart) complaintsStatusChart.destroy();
    complaintsStatusChart = new Chart($("chartComplaintsStatus").getContext("2d"), {
        type: "pie",
        data: { labels: lbls, datasets: [{ data: lbls.map(l => statusCounts[l]), backgroundColor: ["#f59e0b", "#3b82f6", "#22c55e", "#ef4444"], borderColor: "rgba(6,11,20,0.9)" }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: "bottom", labels: { color: "#cbd5e1" } } }, tooltip: chartTooltipTheme() }
    });

    const opCounts = {};
    (TOWERS || []).forEach(t => { opCounts[t.operator || t.op] = (opCounts[t.operator || t.op] || 0) + 1; });
    if ($("chartTowersTotal")) $("chartTowersTotal").textContent = `${TOWERS.length} towers`;

    if (towersOperatorChart) towersOperatorChart.destroy();
    towersOperatorChart = new Chart($("chartTowersOperator").getContext("2d"), {
        type: "bar",
        data: { labels: Object.keys(opCounts), datasets: [{ data: Object.values(opCounts), backgroundColor: ["#dc2626", "#1e3a8a", "#4ade80", "#facc15"] }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x:{ticks:{color:"#94a3b8"}}, y:{ticks:{color:"#94a3b8"}} } }
    });

    const buckets = [];
    const now = new Date();
    for (let i = 13; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
        buckets.push({ key: d.toISOString().slice(0, 10), label: d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }), count: 0 });
    }
    const bucketIndex = {}; buckets.forEach((b, idx) => bucketIndex[b.key] = idx);
    (globalComplaints || []).forEach(c => {
        if (!c.created_at) return;
        const dStr = String(c.created_at).slice(0, 10);
        if (bucketIndex[dStr] !== undefined) buckets[bucketIndex[dStr]].count++;
    });

    if (complaintsTrendChart) complaintsTrendChart.destroy();
    complaintsTrendChart = new Chart($("chartComplaintsTrend").getContext("2d"), {
        type: "line",
        data: { labels: buckets.map(b => b.label), datasets: [{ data: buckets.map(b => b.count), borderColor: "#3b82f6", backgroundColor: "rgba(59,130,246,0.15)", fill: true, tension: 0.35 }] },
        options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x:{ticks:{color:"#94a3b8"}}, y:{ticks:{color:"#94a3b8"}} } }
    });
}
function chartTooltipTheme() { return { backgroundColor: "#0b1329", borderColor: "rgba(56,90,134,0.5)", borderWidth: 1, titleColor: "#f8fafc", bodyColor: "#cbd5e1" }; }

// ============================================================
// MAP VIEWS (HEATMAP, SUSCEPTIBILITY, FACILITY, FLOOD)
// ============================================================
function initHeatmapView() {
    if (heatmapInitialized) { if (heatmapMap) heatmapMap.invalidateSize(); return; }
    heatmapInitialized = true;
    const { streets, topo, satellite, hybrid } = buildBaseLayers();
    const layer5G = L.tileLayer.wms('https://bounce-reptilian-iciness.ngrok-free.dev/geoserver/wms', { layers: 'telecom_tower:5g_tower_5class', format: 'image/png', transparent: true, opacity: 0.8 });
    const layer4G = L.tileLayer.wms('https://bounce-reptilian-iciness.ngrok-free.dev/geoserver/wms', { layers: 'telecom_tower:4g_tower_5class', format: 'image/png', transparent: true, opacity: 0.8 });
    const heatPoints = (globalComplaints || []).filter(c => c.latitude && c.longitude).map(c => [parseFloat(c.latitude), parseFloat(c.longitude), 0.8]);
    complaintHeatLayer = L.heatLayer(heatPoints, { radius: 28, blur: 18, maxZoom: 15, gradient: { 0.3: '#0461f5', 0.6: '#1afc06', 0.9: '#f60713' } });

    heatmapMap = L.map('heatmapContainer', { center: [PUNE.lat, PUNE.lng], zoom: 12, layers: [satellite, layer5G, complaintHeatLayer], zoomControl: false });
    L.control.zoom({ position: 'topright' }).addTo(heatmapMap);
    L.control.scale({ position: 'bottomright' }).addTo(heatmapMap);
    L.control.layers({"Satellite": satellite, "Hybrid": hybrid, "Streets": streets, "Topography": topo}, {"5G Layer": layer5G, "4G Layer": layer4G, "Complaint Density": complaintHeatLayer}, { position: 'topright' }).addTo(heatmapMap);
}

function initSusceptibilityView() {
    if (susceptibilityInitialized) { if (susceptibilityMap) susceptibilityMap.invalidateSize(); return; }
    susceptibilityInitialized = true;
    const { streets, topo, satellite, hybrid } = buildBaseLayers();

    const suitabilityLayer = L.tileLayer.wms('https://bounce-reptilian-iciness.ngrok-free.dev/geoserver/wms', { 
        layers: 'telecom_tower:Pune_Tower_Suitability_2500m', format: 'image/png', transparent: true, opacity: 0.8, attribution: 'GeoServer Suitability' 
    });

    susceptibilityMap = L.map('susceptibilityMap', { center: [PUNE.lat, PUNE.lng], zoom: 12, layers: [satellite, suitabilityLayer], zoomControl: false });
    L.control.zoom({ position: 'topright' }).addTo(susceptibilityMap);
    L.control.scale({ position: 'bottomright' }).addTo(susceptibilityMap);
    L.control.layers({"Satellite": satellite, "Hybrid": hybrid, "Topography": topo, "Streets": streets}, {"Suitability Overlay": suitabilityLayer}, { position: 'topright' }).addTo(susceptibilityMap);
    
    susceptibilityLayer = L.layerGroup().addTo(susceptibilityMap);
    renderSusceptibilityTowers();
}

function renderSusceptibilityTowers() {
    if (!susceptibilityLayer) return;
    susceptibilityLayer.clearLayers();
    TOWERS.forEach(t => {
        const color = '#3b82f6';
        L.circleMarker([t.lat, t.lng], { radius: 4, color: '#ffffff', weight: 1, fillColor: color, fillOpacity: 0.9 }).bindPopup(`<div class="pop-box"><h3>${escapeHTML(t.id)} (${escapeHTML(t.op)})</h3><div class="row"><span>Status</span><span><strong>${escapeHTML(t.status || 'Operational')}</strong></span></div></div>`).addTo(susceptibilityLayer);
    });
}

function initFacilityView() {
    if (!facilityInitialized) {
        facilityInitialized = true;
        facilityMap = L.map('facilityMap', { zoomControl: true }).setView([PUNE.lat, PUNE.lng], 12);
        const { streets, topo, satellite, hybrid } = buildBaseLayers();
        streets.addTo(facilityMap);
        L.control.layers({ 'Streets': streets, 'Topographic': topo, 'Satellite': satellite, 'Hybrid': hybrid }, {}, { position:'topright' }).addTo(facilityMap);
        L.control.scale({ position: 'bottomright' }).addTo(facilityMap);
        facilityRouteLayer = L.layerGroup().addTo(facilityMap);
    }
    renderFacilityMarkers();
    renderFacilityComplaintsList();
}

function initFloodView() {
    if (!floodInitialized) {
        floodInitialized = true;
        floodMap = L.map('floodMap', { zoomControl: true }).setView([PUNE.lat, PUNE.lng], 12);
        const { streets, topo, satellite, hybrid } = buildBaseLayers();
        streets.addTo(floodMap);
        L.control.layers({ 'Streets': streets, 'Topographic': topo, 'Satellite': satellite, 'Hybrid': hybrid }, {}, { position:'topright' }).addTo(floodMap);
        L.control.scale({ position: 'bottomright' }).addTo(floodMap);
        measureLayer = L.layerGroup().addTo(floodMap);
    }
    fetchFloodDataAndRender();
}

// ============================================================
// DATA FETCHING & UI RENDERING
// ============================================================
function getOperatorColor(op) {
    if (!op) return '#3b82f6';
    const lower = op.toLowerCase();
    if (lower.includes('jio')) return '#1e3a8a';                  
    if (lower.includes('airtel')) return '#dc2626';               
    if (lower.includes('bsnl')) return '#4ade80';                 
    if (lower.includes('vi') || lower.includes('vodafone')) return '#facc15'; 
    return '#3b82f6'; 
}

async function fetchSpatialData() {
    try {
        if (!supabaseClient) throw new Error("Supabase client is not initialized.");

        const { data: tData, error: tErr } = await supabaseClient.from('towers').select('*');
        if (tErr) throw tErr;

        TOWERS = (tData || []).map(t => {
            const fault = t.fault_cnt != null ? t.fault_cnt : (t.Fault_cnt != null ? t.Fault_cnt : 0);
            const fuel = t.fuel_lvl != null ? t.fuel_lvl : (t.Fuel_lvl != null ? t.Fuel_lvl : 50.0);
            const health = t.struc_hlth || t.Struc_hlth || 'Good';
            const status = t.status || t.Status || 'Operational';
            const riskScore = Math.min(100, Math.round((fault * 3) + (100 - fuel)));
            let riskClass = 'Low'; if (riskScore > 75) riskClass = 'Critical'; else if (riskScore > 50) riskClass = 'High'; else if (riskScore >= 30) riskClass = 'Medium';

            return {
                id: t.tower_id || t.Tower_id || `T${t.id}`, lat: parseFloat(t.latitude || t.Latitude), lng: parseFloat(t.longitude || t.Longitude),
                type: t.tower_type || t.Tower_type || 'Macro', op: t.operator || t.Operator || 'Unknown', net: t.network || t.Network || '4G',
                bkup: t.power_bkup || t.Power_bkup || 'Battery', health: health, status: status, fault: fault, fuel: fuel,
                floodExp: health === 'Poor' ? 'High' : 'Low', access: 'Easy', risk: riskScore, riskClass: riskClass,
                last_insp: t.last_insp || t.Last_insp || 'N/A', height_m: t.height_m || t.Height_m || 'N/A', cov_radius: t.cov_radius || t.Cov_radius || 'N/A'
            };
        }).filter(t => !isNaN(t.lat) && !isNaN(t.lng));

        const { data: fData, error: fErr } = await supabaseClient.from('facilities').select('*');
        if (fErr) throw fErr;

        FACILITIES = (fData || []).map(f => {
            const oid = f.oid || f.OID || f.id;
            return {
                facility_id: f.facility_id || f.Facility_id || `F${String(oid).padStart(2, '0')}`, name: f.name || f.Name || `Maintenance Facility #${oid}`,
                area: f.area || f.Area || 'Pune Region', latitude: parseFloat(f.lat || f.Lat || f.latitude || f.Latitude), longitude: parseFloat(f.lon || f.Lon || f.longitude || f.Longitude),
                type: f.type || f.Type || 'Maintenance Station', operator: f.operator || f.Operator || 'Multi-operator', crews_on_site: f.crews_on_site || f.Crews_on_site || 5,
                equipment_stock: f.equipment_stock || f.Equipment_stock || 'Adequate', contact: f.contact || f.Contact || '+91-9876543210', operating_hours: f.operating_hours || f.Operating_hours || '24x7'
            };
        }).filter(f => !isNaN(f.latitude) && !isNaN(f.longitude));

        if (facilityInitialized) { renderFacilityMarkers(); renderFacilityComplaintsList(); }
        if (floodInitialized) fetchFloodDataAndRender();
        if (susceptibilityInitialized) renderSusceptibilityTowers();

        renderDashboardTowerMap();
        renderAnalyticsCharts();

    } catch (error) { console.error("Failed to load spatial datasets from Supabase:", error); }
}

// ============================================================
// ADMIN SQLITE USER/WORKER FETCH LOGIC
// ============================================================
async function loadUsers() {
    const tbody = $("usersTableBody");
    if (!tbody) return;
    try {
        const data = await apiRequest("/admin/users");
        const users = Array.isArray(data) ? data : (data.users || []);
        if ($("userCount")) $("userCount").textContent = `${users.length} customer${users.length === 1 ? "" : "s"}`;
        if (users.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No customers found.</td></tr>`; return; }
        tbody.innerHTML = users.map(u => `<tr><td><strong>#${escapeHTML(u.id)}</strong></td><td><strong>${escapeHTML(u.name)}</strong></td><td>${escapeHTML(u.email)}</td><td><span class="role-badge customer">CUSTOMER</span></td><td>${formatDate(u.created_at)}</td><td><button class="small-btn delete-btn" onclick="deleteUser(${u.id})">Delete</button></td></tr>`).join("");
    } catch (e) { tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:red;">Error: ${escapeHTML(e.message)}</td></tr>`; }
}

window.deleteUser = async function(userId) {
    if (!confirm("Are you sure?")) return;
    try { await apiRequest(`/admin/users/${userId}`, { method: "DELETE" }); showToast("User deleted."); await loadUsers(); await loadDashboard(); } catch (e) { showToast(e.message, "error"); }
};

async function loadWorkers() {
    const tbody = $("workersTableBody");
    if (!tbody) return;
    try {
        const data = await apiRequest("/admin/workers");
        const workers = Array.isArray(data) ? data : (data.workers || []);
        if ($("workerCount")) $("workerCount").textContent = `${workers.length} technician${workers.length === 1 ? "" : "s"}`;
        if (workers.length === 0) { tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No technicians found.</td></tr>`; return; }
        tbody.innerHTML = workers.map(w => `<tr><td><strong>#${escapeHTML(w.id)}</strong></td><td><strong>${escapeHTML(w.name)}</strong></td><td>${escapeHTML(w.email)}</td><td><span class="role-badge worker">TECHNICIAN</span></td><td>${formatDate(w.created_at)}</td><td><button class="small-btn" onclick="openEditWorkerModal(${w.id}, '${escapeHTML(w.name)}', '${escapeHTML(w.email)}')">Edit</button><button class="small-btn delete-btn" onclick="deleteWorker(${w.id})">Delete</button></td></tr>`).join("");
    } catch (e) { tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:red;">Error: ${escapeHTML(e.message)}</td></tr>`; }
}

window.deleteWorker = async function(workerId) {
    if (!confirm("Are you sure?")) return;
    try { await apiRequest(`/admin/workers/${workerId}`, { method: "DELETE" }); showToast("Technician deleted."); await loadWorkers(); await loadDashboard(); } catch (e) { showToast(e.message, "error"); }
};

window.openEditWorkerModal = function(id, name, email) { $("editWorkerId").value = id; $("editWorkerName").value = name; $("editWorkerEmail").value = email; $("editWorkerFormCard").classList.remove("hidden"); };

function setupWorkerForms() {
    const showBtn = $("showTechnicianFormBtn") || $("showWorkerFormBtn"), closeBtn = $("closeWorkerFormBtn"), cancelBtn = $("cancelWorkerBtn"), formCard = $("workerFormCard");
    if (showBtn && formCard) showBtn.addEventListener("click", () => formCard.classList.remove("hidden"));
    if (closeBtn && formCard) closeBtn.addEventListener("click", () => formCard.classList.add("hidden"));
    if (cancelBtn && formCard) cancelBtn.addEventListener("click", () => formCard.classList.add("hidden"));
    
    if ($("workerForm")) $("workerForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const name = $("workerName").value.trim(), email = $("workerEmail").value.trim().toLowerCase(), password = $("workerPassword").value;
        if (!email.endsWith("@beacon.tc")) return showToast("Technician email must use the @beacon.tc domain.", "error");
        try { await apiRequest("/admin/workers", { method: "POST", body: JSON.stringify({ name, email, password }) }); showToast("Technician created successfully!"); formCard.classList.add("hidden"); $("workerForm").reset(); await loadWorkers(); await loadDashboard(); } catch (err) { showToast(err.message, "error"); }
    });
    
    const closeEditBtn = $("closeEditWorkerBtn"), cancelEditBtn = $("cancelEditWorkerBtn"), editFormCard = $("editWorkerFormCard");
    if (closeEditBtn && editFormCard) closeEditBtn.addEventListener("click", () => editFormCard.classList.add("hidden"));
    if (cancelEditBtn && editFormCard) cancelEditBtn.addEventListener("click", () => editFormCard.classList.add("hidden"));
    if ($("editWorkerForm")) $("editWorkerForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        const id = $("editWorkerId").value, name = $("editWorkerName").value.trim(), email = $("editWorkerEmail").value.trim().toLowerCase();
        if (!email.endsWith("@beacon.tc")) return showToast("Technician email must use the @beacon.tc domain.", "error");
        try { await apiRequest(`/admin/workers/${id}`, { method: "PUT", body: JSON.stringify({ name, email }) }); showToast("Technician updated successfully!"); editFormCard.classList.add("hidden"); $("editWorkerForm").reset(); await loadWorkers(); } catch (err) { showToast(err.message, "error"); }
    });
}

function setupTowerForm() {
    if ($("towerForm")) $("towerForm").addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!supabaseClient) return showToast("Supabase client not initialized.", "error");
        try {
            const newCloudTower = {
                tower_id: $("towerCode").value.trim(), tower_type: $("towerName").value.trim(), operator: $("towerOperator").value.trim() || null,
                network: $("towerTechnology").value, latitude: Number($("towerLatitude").value), longitude: Number($("towerLongitude").value),
                cov_radius: Number($("towerRadius").value), status: "Operational", struc_hlth: "Good", fault_cnt: 0, fuel_lvl: 100.0
            };
            const { error } = await supabaseClient.from('towers').insert([newCloudTower]);
            if (error) throw error;
            showToast("Tower successfully registered in Supabase Cloud database!");
            $("towerForm").reset(); await fetchSpatialData(); await loadDashboard();
        } catch (err) { showToast(err.message, "error"); }
    });
}

// Notice Broadcasting
async function loadAdminNotices() {
    const listContainer = $("adminNoticesList");
    if (!listContainer || !supabaseClient) return;
    const { data, error } = await supabaseClient.from('notices').select('*').order('created_at', { ascending: false });
    if (error || !data || data.length === 0) { listContainer.innerHTML = `<div style="color: var(--muted); font-size: 12px; text-align: center; padding: 10px;">No notices published yet.</div>`; return; }
    listContainer.innerHTML = data.map(n => `<div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(56,90,134,0.2); border-radius: 8px;"><div style="font-size: 12.5px; color: #e2e8f0; max-width: 80%; word-break: break-word;">${escapeHTML(n.message)}</div><button onclick="deleteAdminNotice(${n.id})" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 5px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">Remove</button></div>`).join('');
}
window.publishAdminNotice = async function() {
    const input = $("adminNoticeInput");
    if (!input || !supabaseClient || !input.value.trim()) return showToast("Please enter a notice message.", "error");
    const { error } = await supabaseClient.from('notices').insert([{ message: input.value.trim(), active: true }]);
    if (error) return showToast("Failed to publish notice: " + error.message, "error");
    input.value = ""; loadAdminNotices(); showToast("Notice published successfully!");
};
window.deleteAdminNotice = async function(id) {
    if (!confirm("Remove this notice?")) return;
    const { error } = await supabaseClient.from('notices').delete().eq('id', id);
    if (error) return showToast("Failed to remove notice.", "error");
    loadAdminNotices(); showToast("Notice removed.");
};

async function loadComplaints() {
    const tbody = $("complaintsTableBody");
    if (!tbody || !supabaseClient) return;
    try {
        const [cloudResult, localWorkersResult] = await Promise.all([
            supabaseClient.from('complaints').select('*').order('created_at', { ascending: false }),
            apiRequest("/admin/workers").catch(() => ({ workers: [] }))
        ]);
        globalComplaints = cloudResult.data || [];
        const workers = Array.isArray(localWorkersResult) ? localWorkersResult : (localWorkersResult.workers || []);
        if ($("complaintCount")) $("complaintCount").textContent = `${globalComplaints.length} complaint${globalComplaints.length === 1 ? "" : "s"}`;
        if (globalComplaints.length === 0) { tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No complaints registered.</td></tr>`; return; }

        tbody.innerHTML = globalComplaints.map(c => {
            const tId = c.ticket_id || ("CMP-" + c.id);
            const workerOptions = workers.map(w => `<option value="${escapeHTML(w.name)} (#${w.id})" ${c.assigned_worker_id === `${w.name} (#${w.id})` ? "selected" : ""}>${escapeHTML(w.name)} (${escapeHTML(w.email)})</option>`).join("");
            return `<tr><td><strong>${escapeHTML(tId)}</strong></td><td><strong>${escapeHTML(c.customer_name || "Customer")}</strong><small class="table-subtext">ID: ${escapeHTML(c.customer_id || "CUST-001")}</small></td><td><strong>${escapeHTML(c.subject || "No Subject")}</strong><small class="table-subtext">${escapeHTML(c.description || "")}</small></td><td><span class="priority-badge medium">${escapeHTML(c.category || "General")}</span><small class="table-subtext">${escapeHTML(c.area || "Pune")}</small></td><td><select class="status-select" id="status-select-${tId}"><option value="Pending" ${c.status === "Pending" ? "selected" : ""}>Pending</option><option value="In Progress" ${c.status === "In Progress" ? "selected" : ""}>In Progress</option><option value="Resolved" ${c.status === "Resolved" ? "selected" : ""}>Resolved</option><option value="Rejected" ${c.status === "Rejected" ? "selected" : ""}>Rejected</option></select></td><td><select class="status-select" id="worker-select-${tId}"><option value="">Unassigned</option>${workerOptions}</select></td><td><button class="small-btn" onclick="saveComplaintUpdate('${tId}')">Save</button></td></tr>`;
        }).join("");
    } catch (err) { tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:red;">Error loading: ${escapeHTML(err.message)}</td></tr>`; }
}

window.saveComplaintUpdate = async function(ticketId) {
    const statusSelect = $(`status-select-${ticketId}`);
    const workerSelect = $(`worker-select-${ticketId}`);
    if (!statusSelect || !supabaseClient) return;
    const newStatus = statusSelect.value;
    const workerId = workerSelect ? (workerSelect.value || null) : null;
    try {
        const { error } = await supabaseClient.from('complaints').update({ status: newStatus, assigned_worker_id: workerId }).eq('ticket_id', ticketId);
        if (error) { showToast("Update failed: " + error.message, "error"); return; }
        showToast(`Complaint ${ticketId} updated in Cloud!`);
        await loadComplaints(); await loadDashboard();
    } catch (err) { showToast("Error updating status.", "error"); }
};

window.__viewComplaintMap = function(lat, lng, ticketId, userName, subject, operator, status) {
    if (!facilityMap) return;
    facilityMap.flyTo([lat, lng], 15, { duration: 0.6 });
    if (complaintMarkerLayer) complaintMarkerLayer.clearLayers();
    else complaintMarkerLayer = L.layerGroup().addTo(facilityMap);

    const marker = L.circleMarker([lat, lng], { radius: 8, color: '#ef4444', weight: 2, fillColor: '#f87171', fillOpacity: 0.9 }).addTo(complaintMarkerLayer);
    marker.bindPopup(`<div class="pop-box"><h3 style="color:#f87171;">Complaint Origin</h3><div class="row"><span>Ticket ID</span><span><strong>${ticketId}</strong></span></div><div class="row"><span>Raised by</span><span>${userName} (${operator})</span></div><div class="row"><span>Status</span><span><strong>${status}</strong></span></div><div class="row" style="border-bottom:none;"><span>Subject</span><span>${subject}</span></div></div>`).openPopup();
    
    const normStatus = status.trim().toLowerCase();
    if (normStatus === 'pending' || normStatus === 'in progress') {
        L.circle([lat, lng], { radius: 1000, color: '#ef4444', weight: 1.5, dashArray: '4, 4', fillColor: '#f87171', fillOpacity: 0.12, interactive: false }).addTo(complaintMarkerLayer);
    }
};

function renderFacilityMarkers() {
    if (!facilityMap) return;
    if (facTowerLayer) facTowerLayer.clearLayers();
    else facTowerLayer = L.layerGroup().addTo(facilityMap);
    if (facMarkerLayer) facMarkerLayer.clearLayers();
    else facMarkerLayer = L.layerGroup().addTo(facilityMap);

    TOWERS.forEach(t => {
        const color = getOperatorColor(t.op);
        // MATCHED: Detailed Popups in Facility Map
        L.circleMarker([t.lat, t.lng], { radius: 5, color: color, weight:1, fillColor: color, fillOpacity:0.85 })
            .bindPopup(`<div class="pop-box">
                <h3>${escapeHTML(t.id)} (${escapeHTML(t.op)})</h3>
                <div class="row"><span>Type & Network</span><span>${escapeHTML(t.type)} • ${escapeHTML(t.net)}</span></div>
                <div class="row"><span>Height / Radius</span><span>${t.height_m}m / ${t.cov_radius}km</span></div>
                <div class="row"><span>Status</span><span style="font-weight:700;">${escapeHTML(t.status)}</span></div>
                <div class="row"><span>Power Backup</span><span>${escapeHTML(t.bkup)} (${t.fuel}% Fuel)</span></div>
                <div class="row"><span>Structural Health</span><span>${escapeHTML(t.health)}</span></div>
                <div class="row"><span>Risk Score</span><span>${t.risk}/100</span></div>
                <button class="btn" style="width:100%;margin-top:8px;" onclick="window.__routeToTower('${t.id}')">Find road route</button>
            </div>`)
            .addTo(facTowerLayer);
    });

    FACILITIES.forEach(f => {
        const icon = L.divIcon({ className:'', html:`<div style="width:11px;height:11px;background:#8B7FD9;border:1.5px solid #ffffff;border-radius:2px;transform:rotate(45deg);box-shadow:0 0 4px rgba(139,127,217,.5);"></div>`, iconSize:[11, 11], iconAnchor:[5.5, 5.5] });
        L.marker([f.latitude, f.longitude], { icon })
            .bindPopup(`<div class="pop-box"><h3>${f.name}</h3><div class="row"><span>Operator</span><span>${f.operator}</span></div></div>`)
            .addTo(facMarkerLayer);
    });
}

function renderFacilityComplaintsList() {
    const container = document.getElementById("facilityComplaintsList");
    if (!container) return;
    if (!globalComplaints || globalComplaints.length === 0) { container.innerHTML = `<div style="color:var(--muted); font-size:12px; text-align:center; padding:10px;">No assigned complaints.</div>`; return; }
    container.innerHTML = globalComplaints.map(c => {
        const ticketId = c.ticket_id || c.id || 'CMP-000';
        const userName = c.customer_name || 'Customer';
        const subject = c.subject || 'Issue';
        const operator = c.network_operator || c.category || 'General';
        const status = c.status || 'Pending';
        let lat = c.latitude ? parseFloat(c.latitude) : PUNE.lat;
        let lng = c.longitude ? parseFloat(c.longitude) : PUNE.lng;

        return `<div class="list-row" style="background:rgba(255,255,255,0.02); border:1px solid var(--border);"><span class="list-chip" style="background:${getOperatorColor(operator)};"></span><div class="list-info"><div class="list-id">${escapeHTML(ticketId)} — ${escapeHTML(userName)}</div><div class="list-meta">${escapeHTML(subject)} [${escapeHTML(status)}]</div></div><button class="btn" style="padding:4px 8px; font-size:10.5px;" onclick="window.__viewComplaintMap(${lat}, ${lng}, '${escapeHTML(ticketId)}', '${escapeHTML(userName)}', '${escapeHTML(subject).replace(/'/g, "\\'")}', '${escapeHTML(operator)}', '${escapeHTML(status)}')">View Map</button></div>`;
    }).join('');
}

function bandOf(score) { if (score >= 75) return 'critical'; if (score >= 55) return 'high'; if (score >= 30) return 'medium'; return 'low'; }
const BAND_COLOR = { low:'#0120e8', medium:'#04b5f6', high:'#f87171', critical:'#dc2626' }; 
const FLOOD_W = { Low:0.16, Medium:0.36, High:0.56 };

function fetchFloodDataAndRender() {
    if (!floodMap) return;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${PUNE.lat}&longitude=${PUNE.lng}&current=precipitation&timezone=Asia%2FKolkata`)
        .then(r => r.json())
        .then(weather => fetch(`https://flood-api.open-meteo.com/v1/flood?latitude=${PUNE.lat}&longitude=${PUNE.lng}&daily=river_discharge,river_discharge_p75&timezone=Asia%2FKolkata`)
            .then(r => r.json())
            .then(flood => renderFloodTowers(weather, flood))
        ).catch(() => renderFloodTowers(null, null));
}

function renderFloodTowers(weather, flood) {
    if (floodTowerLayer) floodTowerLayer.clearLayers();
    else floodTowerLayer = L.layerGroup().addTo(floodMap);

    let rain1h = 2.8, riverRatio = 1.1, live = false;
    if (weather && flood) {
        rain1h = weather.current?.precipitation ?? 0;
        const idx = flood.daily?.time?.length - 1;
        const discharge = flood.daily?.river_discharge?.[idx];
        const p75 = flood.daily?.river_discharge_p75?.[idx];
        riverRatio = (discharge && p75) ? discharge / p75 : 1.0;
        live = true;
    }
    const rainScore = Math.min(100, (rain1h / 25) * 100);
    const riverScore = Math.min(100, riverRatio * 60);
    const pressure = Math.round(0.55 * rainScore + 0.45 * riverScore);

    if ($('floodRain')) $('floodRain').textContent = rain1h.toFixed(1) + ' mm/hr';
    if ($('floodRiver')) $('floodRiver').textContent = riverRatio.toFixed(2) + '× normal';

    // MATCHED: Sync Flood Banner with Worker Page
    const bannerEl = $('floodBanner');
    if (bannerEl) {
        bannerEl.innerHTML = live
            ? `<span class="live-badge"><span class="dot"></span>LIVE</span> Real-time rainfall & Mula-Mutha river discharge from Open-Meteo — current flood pressure: <b style="margin-left:5px;">${pressure}/100</b>.`
            : `<span class="live-badge" style="color:#f59e0b;background:rgba(245,158,11,0.15);border-color:rgba(245,158,11,0.3)"><span class="dot" style="background:#f59e0b"></span>SIMULATED</span> Live feed unreachable right now — showing an illustrative baseline.`;
    }

    const scored = TOWERS.map(t => {
        const w = FLOOD_W[t.floodExp] ?? 0.3;
        const score = Math.min(100, (t.risk || 40) * 0.5 + pressure * w);
        return { ...t, liveScore: Math.round(score) };
    });

    const counts = { critical:0, high:0, medium:0, low:0 };
    scored.forEach(t => {
        const band = bandOf(t.liveScore);
        counts[band]++;
        // MATCHED: Detailed Popups in Flood Map
        L.circleMarker([t.lat, t.lng], { radius: band === 'critical' ? 5 : band === 'high' ? 4 : 3, color: BAND_COLOR[band], weight: 1, fillColor: BAND_COLOR[band], fillOpacity: 0.8 })
            .bindPopup(`<div class="pop-box"><h3>${escapeHTML(t.id)} (${escapeHTML(t.op)})</h3>
                <div class="row"><span>Network</span><span>${escapeHTML(t.net)}</span></div>
                <div class="row"><span>Structural Health</span><span>${escapeHTML(t.health)}</span></div>
                <div class="row"><span>Base Risk</span><span>${t.risk}/100</span></div>
                <div class="row"><span>Flood exposure</span><span>${escapeHTML(t.floodExp)}</span></div>
                <div class="row"><span>Accessibility</span><span>${escapeHTML(t.access)}</span></div>
                <div class="row" style="border-bottom:none;"><span>Live flood risk</span><span style="font-weight:bold; color:${BAND_COLOR[band]}">${t.liveScore}/100</span></div>
            </div>`)
            .addTo(floodTowerLayer);
    });

    const catMeta = [
        { key:'critical', label:'Critical', color:BAND_COLOR.critical },
        { key:'high', label:'High', color:BAND_COLOR.high },
        { key:'medium', label:'Medium', color:BAND_COLOR.medium },
        { key:'low', label:'Low', color:BAND_COLOR.low },
    ];
    if ($('riskCategoryCounts')) {
        $('riskCategoryCounts').innerHTML = catMeta.map(c => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid var(--border);">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="width:10px;height:10px;border-radius:3px;background:${c.color};"></span>
                    <span style="font-size:12.5px;font-weight:600;color:var(--text);">${c.label}</span>
                </div>
                <span style="font-size:16px;font-weight:800;color:#60a5fa;">${counts[c.key]}</span>
            </div>`).join('');
    }
}

function escapeHTML(value) {
    if (value === null || value === undefined) return "";
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#039;");
}

function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

function setupNavigation() {
    const navItems = document.querySelectorAll(".nav-item");
    const showSection = (sectionName) => {
        ["dashboardSection", "usersSection", "workersSection", "towersSection", "complaintsSection", "heatmapSection", "facilitySection", "floodSection", "susceptibilitySection"].forEach(s => $(s)?.classList.add("hidden"));
        $(sectionName + "Section")?.classList.remove("hidden");
        navItems.forEach(item => item.classList.toggle("active", item.dataset.section === sectionName));

        const titles = {
            dashboard: ["Admin Dashboard", "TOWERGIS system administration"],
            users: ["User Management", "View and manage registered customers (Local SQLite)"],
            workers: ["Technician Management", "Create and manage field technicians (Local SQLite)"],
            towers: ["Tower Management", "Manage telecom infrastructure in Cloud Supabase"],
            complaints: ["Complaint Management", "Review live customer complaints (Cloud Supabase)"],
            heatmap: ["GeoServer Heatmap", "Coverage analysis & 3-class complaint density layer"],
            facility: ["Facility Map", "Locate maintenance facilities and routes"],
            flood: ["Flood Risk Map", "Live monsoon risk overlay across monitored towers"],
            susceptibility: ["Susceptibility Map", "Tower Suitability & Spatial Analysis"]
        };

        const titleData = titles[sectionName] || titles.dashboard;
        $("pageTitle").textContent = titleData[0];
        $("pageSubtitle").textContent = titleData[1];

        if (sectionName === "dashboard") { loadDashboard(); setTimeout(() => dashTowerMap?.invalidateSize(), 200); }
        if (sectionName === "heatmap") { initHeatmapView(); setTimeout(() => heatmapMap?.invalidateSize(), 200); }
        if (sectionName === "facility") { initFacilityView(); setTimeout(() => facilityMap?.invalidateSize(), 200); }
        if (sectionName === "flood") { initFloodView(); setTimeout(() => floodMap?.invalidateSize(), 200); }
        if (sectionName === "susceptibility") { initSusceptibilityView(); setTimeout(() => susceptibilityMap?.invalidateSize(), 200); }
    };
    navItems.forEach(item => item.addEventListener("click", () => showSection(item.dataset.section)));
}

// ============================================================
// CONCURRENT OSRM ROUTING - FACILITY MAP
// ============================================================
window.__routeToTower = function(id) {
    const t = TOWERS.find(x => x.id === id);
    if (t) selectTowerForRouting(t);
};

async function roadRoute(a, b) {
    const url = `${OSRM_BASE}${a.lng},${a.lat};${b.lng},${b.lat}?overview=full&geometries=geojson`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('OSRM ' + res.status);
    const data = await res.json();
    if (!data.routes || !data.routes.length) throw new Error('No route found');
    const r = data.routes[0];
    return { km: r.distance / 1000, minutes: r.duration / 60, geometry: r.geometry };
}

async function selectTowerForRouting(t) {
    document.getElementById('routeSelectionCard').style.display = 'block';
    document.getElementById('routeSelTitle').textContent = `${t.id} (${t.op}) → nearest facility`;
    const status = document.getElementById('routeStatus');
    const results = document.getElementById('routeResults');

    const compatibleFacilities = FACILITIES.filter(f => {
        const facOp = (f.operator || '').toLowerCase();
        const towOp = (t.op || '').toLowerCase();
        return facOp.includes(towOp) || facOp.includes('multi');
    });

    status.textContent = `Calculating road distance to ${compatibleFacilities.length} compatible facilities for ${t.op}…`;
    results.innerHTML = '';
    facilityRouteLayer.clearLayers();

    facilityMap.flyTo([t.lat, t.lng], 14, { duration: 0.4 });

    if (compatibleFacilities.length === 0) {
        status.textContent = `No compatible maintenance facilities found for operator: ${t.op}.`;
        return;
    }

    // Process routing in parallel for extreme speed
    const promises = compatibleFacilities.map(async (f) => {
        try {
            const r = await roadRoute(t, { lat: f.latitude, lng: f.longitude });
            return { f, ...r, error: null };
        } catch (e) {
            return { f, error: e.message };
        }
    });

    let computed = await Promise.all(promises);
    computed = computed.filter(c => !c.error).sort((a, b) => a.km - b.km);

    if (computed.length === 0) {
        status.textContent = 'Could not reach road routing service.';
        return;
    }
    
    status.textContent = 'Ranked by real road distance (OSRM)';
    results.innerHTML = computed.map((c, i) => `
        <div class="list-row" style="background:${i === 0 ? 'rgba(255,255,255,0.05)' : 'transparent'};border:${i === 0 ? '1px solid var(--border)' : '1px solid transparent'};">
            <span class="list-chip" style="background:#8B7FD9"></span>
            <div class="list-info">
                <div class="list-id" style="font-size:11.5px;">${c.f.name}</div>
                <div class="list-meta">${Math.round(c.minutes)} min drive • Serves: ${c.f.operator}</div>
            </div>
            <div class="list-val">${c.km.toFixed(1)} km</div>
        </div>`).join('');

    const best = computed[0];
    L.geoJSON(best.geometry, { style: { color:'#2563eb', weight:4, opacity:0.85 } }).addTo(facilityRouteLayer);
    facilityMap.fitBounds(L.geoJSON(best.geometry).getBounds(), { padding:[40, 40] });
}


document.addEventListener("DOMContentLoaded", async () => {
    await loadCurrentAdmin();
    setupNavigation();
    setupWorkerForms();
    setupTowerForm();
    await fetchSpatialData();

    if ($("refreshUsersBtn")) $("refreshUsersBtn").addEventListener("click", () => { loadUsers(); showToast("Users refreshed from SQLite."); });
    if ($("refreshWorkersBtn")) $("refreshWorkersBtn").addEventListener("click", () => { loadWorkers(); showToast("Technicians refreshed from SQLite."); });
    if ($("refreshComplaintsBtn")) $("refreshComplaintsBtn").addEventListener("click", () => { loadComplaints(); showToast("Complaints refreshed from Cloud."); });
    if ($("logoutBtn")) $("logoutBtn").addEventListener("click", () => { localStorage.clear(); window.location.href = "../login.html"; });

    await loadDashboard();
    await loadWorkers();
    await loadUsers();
    await loadComplaints();
    await loadAdminNotices();

    if (supabaseClient) {
        supabaseClient.channel('admin-cloud-feed')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'complaints' }, payload => {
                const newRec = payload.new;
                if (newRec && newRec.latitude && newRec.longitude) {
                    triggerNearbyTowersMaintenance(parseFloat(newRec.latitude), parseFloat(newRec.longitude), newRec.network_operator);
                }
                loadComplaints();
                loadDashboard();
            })
            .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, () => {
                loadComplaints();
                loadDashboard();
            })
            .subscribe();
    }
});