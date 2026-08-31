"use strict";

/* =========================================================
   BEACON WORKER DASHBOARD & MAP LOGIC
========================================================= */

/* ---------------------------------------------------------
   SUPABASE CLOUD CONFIGURATION
--------------------------------------------------------- */
const SUPABASE_URL = "https://lhbtkeniqvmeotdensjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_8l4_goaT5nmazuWEpSQrMw_a0R89dNY";
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

/* ---------------------------------------------------------
   GLOBAL VARIABLES
--------------------------------------------------------- */
let token = null;
let currentUser = null;
let complaints = [];
let selectedComplaint = null;

let TOWERS = [];
let FACILITIES = [];
const PUNE = { lat: 18.5204, lng: 73.8567 };

/* ---------------------------------------------------------
   OPERATOR COLOR MAP
--------------------------------------------------------- */
function getOperatorColor(op) {
    if (!op) return '#3b82f6';
    const lower = op.toLowerCase();
    if (lower.includes('jio')) return '#1e3a8a';                  // Dark blue
    if (lower.includes('airtel')) return '#dc2626';               // Red
    if (lower.includes('bsnl')) return '#4ade80';                 // Light green
    if (lower.includes('vi') || lower.includes('vodafone')) return '#facc15'; // Yellow
    return '#3b82f6'; 
}

/* ---------------------------------------------------------
   FETCH SPATIAL DATA
--------------------------------------------------------- */
async function fetchSpatialData() {
    try {
        if (!supabaseClient) throw new Error("Supabase client is not initialized.");

        // 1. Fetch Towers Table
        const { data: tData, error: tErr } = await supabaseClient.from('towers').select('*');
        if (tErr) throw tErr;

        TOWERS = (tData || []).map(t => ({
            id: t.tower_id || 'T000',
            lat: parseFloat(t.latitude),
            lng: parseFloat(t.longitude),
            type: t.tower_type || 'Macro',
            op: t.operator || 'Unknown',
            net: t.network || '4G',
            bkup: t.power_bkup || 'Battery',
            health: 'Good',
            fault: 0,
            fuel: 50.0,
            floodExp: 'Medium',
            access: 'Easy',
            risk: 40,
            riskClass: 'Medium'
        })).filter(t => !isNaN(t.lat) && !isNaN(t.lng));

        // 2. Fetch Facilities Table
        const { data: fData, error: fErr } = await supabaseClient.from('facilities').select('*');
        if (fErr) throw fErr;

        FACILITIES = (fData || []).map(f => ({
            facility_id: f.facility_id || `F${String(f.id).padStart(2, '0')}`,
            name: f.name || `Maintenance Facility #${f.id}`,
            area: 'Pune Region',
            latitude: parseFloat(f.lat),
            longitude: parseFloat(f.lon),
            type: 'Maintenance Station',
            operator: f.operator || 'Multi-operator',
            crews_on_site: 5,
            equipment_stock: 'Adequate',
            contact: '+91-9876543210',
            operating_hours: '24x7'
        })).filter(f => !isNaN(f.latitude) && !isNaN(f.longitude));

        window.__towerIndex = Object.fromEntries(TOWERS.map(t => [t.id, t]));

        renderFacilityMarkers();
        renderFacilityComplaintsList();
        if (floodInitialized) {
            fetchFloodDataAndRender();
        }

    } catch (error) {
        console.error("Failed to load spatial datasets from Supabase:", error);
    }
}

/* =========================================================
   ELEMENTS
========================================================= */
const workerName = document.getElementById("workerName");
const workerEmail = document.getElementById("workerEmail");
const workerAvatar = document.getElementById("workerAvatar");
const totalComplaints = document.getElementById("totalComplaints");
const pendingComplaints = document.getElementById("pendingComplaints");
const progressComplaints = document.getElementById("progressComplaints");
const completedComplaints = document.getElementById("completedComplaints");
const complaintsTable = document.getElementById("complaintsTable");
const loading = document.getElementById("loading");
const tableWrapper = document.getElementById("tableWrapper");
const emptyState = document.getElementById("emptyState");
const errorMessage = document.getElementById("errorMessage");
const refreshButton = document.getElementById("refreshButton");
const logoutButton = document.getElementById("logoutButton");
const complaintModal = document.getElementById("complaintModal");
const modalBody = document.getElementById("modalBody");
const closeModal = document.getElementById("closeModal");
const statusSelect = document.getElementById("statusSelect");
const updateStatusButton = document.getElementById("updateStatusButton");

/* =========================================================
   SHOW/HIDE ERROR & LOGOUT
========================================================= */
function showError(message) {
    if (errorMessage) {
        errorMessage.textContent = message;
        errorMessage.style.display = "block";
    }
}
function hideError() {
    if (errorMessage) errorMessage.style.display = "none";
}

function logout() {
    localStorage.removeItem("towergis_token");
    localStorage.removeItem("towergis_user");
    localStorage.removeItem("access_token");
    window.location.href = "/app/login.html";
}
if (logoutButton) logoutButton.addEventListener("click", logout);

/* =========================================================
   CHECK AUTHENTICATION & WORKER INFO
========================================================= */
function checkAuthentication() {
    token = localStorage.getItem("towergis_token") || localStorage.getItem("access_token");
    const storedUser = localStorage.getItem("towergis_user");

    if (!token && !storedUser) {
        window.location.href = "/app/login.html";
        return false;
    }

    try {
        currentUser = storedUser ? JSON.parse(storedUser) : null;
    } catch (error) {
        logout();
        return false;
    }

    if (!currentUser) {
        currentUser = { id: 2, name: "ok", email: "worker001@beacon.tc", role: "worker" };
    }

    if (currentUser.role && currentUser.role !== "worker") {
        alert("Access denied. This page is only for workers.");
        logout();
        return false;
    }
    return true;
}

function loadWorkerInformation() {
    if (!currentUser) return;
    if (workerName) workerName.textContent = currentUser.name || "Field Worker";
    if (workerEmail) workerEmail.textContent = currentUser.email || "";
    const name = currentUser.name || "W";
    if (workerAvatar) workerAvatar.textContent = name.charAt(0).toUpperCase();
}

/* =========================================================
   LOAD DASHBOARD & COMPLAINTS
========================================================= */
async function loadDashboard() {
    try { 
        hideError(); 
        calculateStatistics(); 
    } catch (error) { 
        console.error("Dashboard error:", error); 
        showError(error.message); 
    }
}

async function loadComplaints() {
    if (loading) loading.style.display = "block";
    if (tableWrapper) tableWrapper.style.display = "none";
    if (emptyState) emptyState.style.display = "none";

    try {
        hideError();
        if (!supabaseClient) throw new Error("Supabase client failed to initialize.");

        const { data: allComplaints, error: dbError } = await supabaseClient
            .from('complaints')
            .select('*')
            .order('created_at', { ascending: false });

        if (dbError) throw dbError;

        const currentId = currentUser?.id != null ? String(currentUser.id) : "";
        const currentName = (currentUser?.name || "").toLowerCase();
        const currentEmail = (currentUser?.email || "").toLowerCase();

        complaints = (allComplaints || []).filter(c => {
            if (!c.assigned_worker_id) return false;
            const assigned = String(c.assigned_worker_id).toLowerCase();
            return (
                (currentId && assigned.includes(`#${currentId}`)) ||
                (currentId && assigned === `wrk-${currentId}`) ||
                (currentName && assigned.includes(currentName)) ||
                (currentEmail && assigned.includes(currentEmail))
            );
        });

        renderComplaints();
        renderFacilityComplaintsList();
        calculateStatistics();
    } catch (error) {
        console.error("Complaints error:", error);
        showError(error.message);
    } finally {
        if (loading) loading.style.display = "none";
    }
}

function renderComplaints() {
    if (!complaintsTable) return;
    complaintsTable.innerHTML = "";

    if (!complaints || complaints.length === 0) {
        if (tableWrapper) tableWrapper.style.display = "none";
        if (emptyState) emptyState.style.display = "block";
        return;
    }

    if (tableWrapper) tableWrapper.style.display = "block";
    if (emptyState) emptyState.style.display = "none";

    complaints.forEach(function(complaint) {
        const row = document.createElement("tr");
        const complaintId = complaint.ticket_id || complaint.complaint_id || complaint.id || "N/A";
        const title = complaint.subject || complaint.title || complaint.type || "Complaint";
        const description = complaint.description || complaint.details || "";
        const status = complaint.status || "Unknown";
        const customer = complaint.customer_name || complaint.customer_email || complaint.customer?.name || complaint.customer?.email || "Customer";
        const date = complaint.created_at || complaint.createdAt || complaint.date || "—";

        row.innerHTML = `
            <td><div class="complaint-id">${escapeHtml(String(complaintId))}</div></td>
            <td>
                <div class="complaint-title">${escapeHtml(title)}</div>
                <div class="complaint-description">${escapeHtml(description)}</div>
            </td>
            <td><span class="status ${getStatusClass(status)}">${escapeHtml(status)}</span></td>
            <td>${escapeHtml(customer)}</td>
            <td>${formatDate(date)}</td>
            <td><button class="view-btn" data-id="${escapeHtml(String(complaintId))}">View</button></td>
        `;
        complaintsTable.appendChild(row);

        const viewButton = row.querySelector(".view-btn");
        viewButton.addEventListener("click", function() { openComplaint(complaint); });
    });
}

function calculateStatistics() {
    const total = complaints.length;
    let pending = 0;
    let progress = 0;
    let completed = 0;

    complaints.forEach(function(complaint) {
        const status = normalizeStatus(complaint.status);
        if (status === "pending") { pending++; }
        else if (status === "in progress") { progress++; }
        else if (status === "completed" || status === "resolved") { completed++; }
    });

    if (totalComplaints) totalComplaints.textContent = total;
    if (pendingComplaints) pendingComplaints.textContent = pending;
    if (progressComplaints) progressComplaints.textContent = progress;
    if (completedComplaints) completedComplaints.textContent = completed;
}

/* =========================================================
   MODAL LOGIC
========================================================= */
function openComplaint(complaint) {
    selectedComplaint = complaint;
    const complaintId = complaint.ticket_id || complaint.complaint_id || complaint.id || "N/A";
    const title = complaint.subject || complaint.title || complaint.type || "Complaint";
    const description = complaint.description || complaint.details || "No description available.";
    const status = complaint.status || "Pending";
    const customerName = complaint.customer_name || complaint.customer?.name || "Not available";
    const customerEmail = complaint.customer_email || complaint.customer?.email || "Not available";
    const createdAt = complaint.created_at || complaint.createdAt || complaint.date || "Not available";

    modalBody.innerHTML = `
        <div class="detail-row"><div class="detail-label">Complaint ID</div><div class="detail-value">${escapeHtml(String(complaintId))}</div></div>
        <div class="detail-row"><div class="detail-label">Title</div><div class="detail-value">${escapeHtml(title)}</div></div>
        <div class="detail-row"><div class="detail-label">Description</div><div class="detail-value">${escapeHtml(description)}</div></div>
        <div class="detail-row"><div class="detail-label">Customer</div><div class="detail-value">${escapeHtml(customerName)}<br>${escapeHtml(customerEmail)}</div></div>
        <div class="detail-row"><div class="detail-label">Created</div><div class="detail-value">${formatDate(createdAt)}</div></div>
        <div class="detail-row"><div class="detail-label">Current Status</div><div class="detail-value"><span class="status ${getStatusClass(status)}">${escapeHtml(status)}</span></div></div>
    `;

    if (statusSelect) statusSelect.value = findMatchingStatus(status);
    if (complaintModal) complaintModal.style.display = "flex";
}

function closeComplaintModal() {
    if (complaintModal) complaintModal.style.display = "none";
    selectedComplaint = null;
}
if (closeModal) closeModal.addEventListener("click", closeComplaintModal);
if (complaintModal) complaintModal.addEventListener("click", function(event) { if (event.target === complaintModal) closeComplaintModal(); });

if (updateStatusButton) {
    updateStatusButton.addEventListener("click", async function() {
        if (!selectedComplaint) return;
        const ticketId = selectedComplaint.ticket_id || selectedComplaint.complaint_id || selectedComplaint.id;
        if (!ticketId) { alert("Complaint ID was not found."); return; }

        const newStatus = statusSelect.value;
        updateStatusButton.disabled = true;
        updateStatusButton.textContent = "Updating...";

        try {
            if (!supabaseClient) throw new Error("Cloud database connection not found.");
            const { error: updateError } = await supabaseClient
                .from('complaints')
                .update({ status: newStatus })
                .eq('ticket_id', String(ticketId));

            if (updateError) throw updateError;
            alert("Complaint status updated successfully in Cloud Database.");
            closeComplaintModal();
            await loadComplaints();
        } catch (error) {
            console.error("Status update error:", error);
            alert(error.message || "Unable to update complaint.");
        } finally {
            updateStatusButton.disabled = false;
            updateStatusButton.textContent = "Update Status";
        }
    });
}

if (refreshButton) {
    refreshButton.addEventListener("click", async function() {
        refreshButton.disabled = true;
        refreshButton.textContent = "Refreshing...";
        await Promise.all([ loadDashboard(), loadComplaints() ]);
        refreshButton.disabled = false;
        refreshButton.textContent = "↻ Refresh";
    });
}

/* =========================================================
   HELPERS
========================================================= */
function normalizeStatus(status) { if (!status) return "unknown"; return String(status).trim().toLowerCase().replace(/_/g, " "); }
function getStatusClass(status) {
    const normalized = normalizeStatus(status);
    if (normalized === "pending") return "pending";
    if (normalized === "in progress") return "in-progress";
    if (normalized === "completed" || normalized === "complete" || normalized === "resolved") return "completed";
    if (normalized === "rejected") return "rejected";
    return "unknown";
}
function findMatchingStatus(status) {
    const normalized = normalizeStatus(status);
    if (normalized === "in progress") return "In Progress";
    if (normalized === "completed" || normalized === "resolved") return "Resolved";
    if (normalized === "rejected") return "Rejected";
    return "Pending";
}
function formatDate(date) {
    if (!date || date === "—") return "—";
    try {
        const parsed = new Date(date);
        if (Number.isNaN(parsed.getTime())) return escapeHtml(String(date));
        return parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
    } catch (error) {
        return escapeHtml(String(date));
    }
}
function escapeHtml(value) {
    if (value === null || value === undefined) return "";
    return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

/* =========================================================
   MAP & VIEW SWITCHER LOGIC
========================================================= */
function switchView(viewId, element) { 
    document.querySelectorAll('.view-section').forEach(view => view.classList.remove('active')); 
    document.getElementById(viewId).classList.add('active'); 
    
    if (element) { 
        document.querySelectorAll('.sidebar-menu .nav-item').forEach(nav => nav.classList.remove('active')); 
        element.classList.add('active'); 
    } 
    window.scrollTo({ top: 0, behavior: "smooth" }); 

    requestAnimationFrame(() => {
        if (viewId === 'view-dashboard') { initGisMap(); if (gisMapInstance) gisMapInstance.invalidateSize(); }
        if (viewId === 'view-facility') { initFacilityView(); if (facilityMap) facilityMap.invalidateSize(); }
        if (viewId === 'view-flood') { initFloodView(); if (floodMap) floodMap.invalidateSize(); }
    });
} 

function buildBaseLayers() {
    const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { 
        attribution: '&copy; OpenStreetMap contributors' 
    });
    const topo = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { 
        attribution: '&copy; OpenTopoMap' 
    });
    const satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { 
        attribution: 'Tiles &copy; Esri' 
    });
    const hybridLabels = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', { 
        attribution: 'Labels &copy; Esri' 
    });
    const hybrid = L.layerGroup([satellite, hybridLabels]);
    return { streets, topo, satellite, hybrid };
}

function addLocateControl(map) {
    const LocateControl = L.Control.extend({
        options: { position: 'topleft' },
        onAdd: function() {
            const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
            const btn = L.DomUtil.create('a', '', container);
            btn.href = '#';
            btn.title = 'Locate me';
            btn.innerHTML = '&#9678;';
            btn.style.fontSize = '16px';
            btn.style.display = 'flex';
            btn.style.alignItems = 'center';
            btn.style.justifyContent = 'center';
            btn.style.background = '#0b1329';
            btn.style.color = '#fff';
            btn.style.borderColor = 'rgba(148, 163, 184, 0.35)';
            L.DomEvent.disableClickPropagation(container);
            L.DomEvent.on(btn, 'click', function(e) {
                L.DomEvent.preventDefault(e);
                map.locate({ setView: true, maxZoom: 15 });
            });
            return container;
        }
    });
    map.addControl(new LocateControl());
    let locateMarker;
    map.on('locationfound', function(e) {
        if (locateMarker) map.removeLayer(locateMarker);
        locateMarker = L.circleMarker(e.latlng, { radius: 2, color:'#2563eb', weight:2, fillColor:'#60a5fa', fillOpacity:0.6 })
            .addTo(map).bindPopup('You are here').openPopup();
    });
    map.on('locationerror', function(e) {
        alert('Unable to retrieve your location: ' + e.message);
    });
}

/* ============ GIS DASHBOARD MAP ============ */
let gisMapInstance = null;
let gisMarkerGroup = null;

function initGisMap() {
    if (!gisMapInstance) {
        gisMapInstance = L.map('gisMap', { zoomControl: false }).setView([PUNE.lat, PUNE.lng], 12);
        L.control.zoom({ position: 'topright' }).addTo(gisMapInstance);
        const baseMaps = buildBaseLayers();
        baseMaps.streets.addTo(gisMapInstance);
        L.control.layers({ 'Streets': baseMaps.streets, 'Topography': baseMaps.topo, 'Satellite': baseMaps.satellite, 'Hybrid': baseMaps.hybrid }, {}, { position:'topright' }).addTo(gisMapInstance);
    }
    renderGisMarkers();
}

function renderGisMarkers() {
    if (!gisMapInstance) return;
    if (gisMarkerGroup) gisMarkerGroup.clearLayers();
    else gisMarkerGroup = L.layerGroup().addTo(gisMapInstance);

    TOWERS.forEach(t => {
        const color = getOperatorColor(t.op);
        const marker = L.circleMarker([t.lat, t.lng], {
            radius: 2,
            fillColor: color,
            color: "#ffffff",
            weight: 0.8,
            fillOpacity: 0.9
        }).addTo(gisMarkerGroup);
        marker.bindPopup(`<div class="pop-box"><h3>Tower ${t.id}</h3>
            <div class="row"><span>Operator</span><span>${t.op}</span></div>
            <div class="row"><span>Network</span><span><strong>${t.net}</strong></span></div>
        </div>`);
    });
}

/* ============ TOP-CENTER TRANSPARENT MAP SEARCH CONTROL WITH AUTOCOMPLETE ============ */
let towerMarkersMap = {};
let facilityMarkersMap = {};

function addMapSearchControl(map) {
    const SearchControl = L.Control.extend({
        options: { position: 'topcenter' },
        onAdd: function() {
            const wrapper = L.DomUtil.create('div', 'leaflet-bar leaflet-control search-wrapper');
            wrapper.style.position = 'relative';
            wrapper.style.background = 'rgba(11, 19, 41, 0.85)';
            wrapper.style.backdropFilter = 'blur(10px)';
            wrapper.style.padding = '6px 12px';
            wrapper.style.borderRadius = '12px';
            wrapper.style.border = '1px solid rgba(148, 163, 184, 0.4)';
            wrapper.style.display = 'flex';
            wrapper.style.alignItems = 'center';
            wrapper.style.gap = '8px';
            wrapper.style.boxShadow = '0 8px 32px rgba(0, 0, 0, 0.4)';
            wrapper.style.marginTop = '12px';

            const input = L.DomUtil.create('input', '', wrapper);
            input.type = 'text';
            input.placeholder = 'Search Tower ID (e.g. T001) or Facility...';
            input.style.padding = '6px 12px';
            input.style.fontSize = '12.5px';
            input.style.borderRadius = '8px';
            input.style.border = '1px solid rgba(148, 163, 184, 0.2)';
            input.style.background = 'rgba(6, 11, 20, 0.6)';
            input.style.color = '#fff';
            input.style.outline = 'none';
            input.style.width = '260px';

            const btn = L.DomUtil.create('button', '', wrapper);
            btn.innerHTML = '🔍';
            btn.style.background = '#3b82f6';
            btn.style.border = 'none';
            btn.style.color = '#fff';
            btn.style.padding = '6px 10px';
            btn.style.borderRadius = '8px';
            btn.style.cursor = 'pointer';
            btn.style.fontSize = '12px';

            const dropdown = L.DomUtil.create('div', '', wrapper);
            dropdown.style.position = 'absolute';
            dropdown.style.top = 'calc(100% + 6px)';
            dropdown.style.left = '0';
            dropdown.style.width = '100%';
            dropdown.style.background = '#0b1329';
            dropdown.style.border = '1px solid var(--border)';
            dropdown.style.borderRadius = '10px';
            dropdown.style.maxHeight = '200px';
            dropdown.style.overflowY = 'auto';
            dropdown.style.boxShadow = '0 10px 30px rgba(0,0,0,0.5)';
            dropdown.style.display = 'none';
            dropdown.style.zIndex = '1000';

            L.DomEvent.disableClickPropagation(wrapper);

            L.DomEvent.on(input, 'input', function(e) {
                const val = input.value.trim().toLowerCase();
                dropdown.innerHTML = '';
                if (!val) {
                    dropdown.style.display = 'none';
                    return;
                }

                const matchedTowers = TOWERS.filter(t => t.id.toLowerCase().includes(val) || t.op.toLowerCase().includes(val)).slice(0, 5);
                const matchedFacilities = FACILITIES.filter(f => f.facility_id.toLowerCase().includes(val) || f.name.toLowerCase().includes(val)).slice(0, 5);

                if (matchedTowers.length === 0 && matchedFacilities.length === 0) {
                    dropdown.style.display = 'none';
                    return;
                }

                dropdown.style.display = 'block';

                matchedTowers.forEach(t => {
                    const item = L.DomUtil.create('div', '', dropdown);
                    item.innerHTML = `<b>Tower ${t.id}</b> (${t.op})`;
                    item.style.padding = '8px 12px';
                    item.style.fontSize = '11.5px';
                    item.style.color = '#e2e8f0';
                    item.style.cursor = 'pointer';
                    item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                    L.DomEvent.on(item, 'click', () => {
                        input.value = t.id;
                        dropdown.style.display = 'none';
                        focusOnTarget(map, t.lat, t.lng, towerMarkersMap[t.id]);
                    });
                });

                matchedFacilities.forEach(f => {
                    const item = L.DomUtil.create('div', '', dropdown);
                    item.innerHTML = `<b>Facility ${f.facility_id}:</b> ${f.name}`;
                    item.style.padding = '8px 12px';
                    item.style.fontSize = '11.5px';
                    item.style.color = '#93c5fd';
                    item.style.cursor = 'pointer';
                    item.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                    L.DomEvent.on(item, 'click', () => {
                        input.value = f.facility_id;
                        dropdown.style.display = 'none';
                        focusOnTarget(map, f.latitude, f.longitude, facilityMarkersMap[f.facility_id]);
                    });
                });
            });

            L.DomEvent.on(btn, 'click', function(e) {
                L.DomEvent.preventDefault(e);
                dropdown.style.display = 'none';
                executeSearch(map, input.value);
            });

            L.DomEvent.on(input, 'keydown', function(e) {
                if (e.key === 'Enter') {
                    L.DomEvent.preventDefault(e);
                    dropdown.style.display = 'none';
                    executeSearch(map, input.value);
                }
            });

            document.addEventListener('click', (e) => {
                if (!wrapper.contains(e.target)) {
                    dropdown.style.display = 'none';
                }
            });

            return wrapper;
        }
    });

    const customControl = new SearchControl();
    const controlDiv = customControl.onAdd(map);
    const topCenterPane = map.getContainer().querySelector('.leaflet-top.leaflet-center') || createTopCenterPane(map);
    topCenterPane.appendChild(controlDiv);
}

function focusOnTarget(map, lat, lng, marker) {
    map.flyTo([lat, lng], 16, { duration: 0.6 });
    if (marker) {
        setTimeout(() => { marker.openPopup(); }, 600);
    }
}

function executeSearch(map, query) {
    const q = query.trim().toUpperCase();
    if (!q) return;

    const foundTower = TOWERS.find(t => t.id.toUpperCase() === q || t.id.toUpperCase().includes(q));
    if (foundTower) {
        focusOnTarget(map, foundTower.lat, foundTower.lng, towerMarkersMap[foundTower.id]);
        if (foundTower.op) selectTowerForRouting(foundTower);
        return;
    }

    const foundFacility = FACILITIES.find(f => f.facility_id.toUpperCase() === q || f.name.toUpperCase().includes(q));
    if (foundFacility) {
        focusOnTarget(map, foundFacility.latitude, foundFacility.longitude, facilityMarkersMap[foundFacility.facility_id]);
        return;
    }

    alert(`No matching Tower ID or Facility found for "${query}".`);
}

function createTopCenterPane(map) {
    const corner = L.DomUtil.create('div', 'leaflet-top leaflet-center', map.getContainer());
    corner.style.position = 'absolute';
    corner.style.top = '0';
    corner.style.left = '50%';
    corner.style.transform = 'translateX(-50%)';
    corner.style.zIndex = '1000';
    corner.style.pointerEvents = 'none';
    const inner = L.DomUtil.create('div', 'leaflet-control-container', corner);
    inner.style.pointerEvents = 'auto';
    return corner;
}


/* ============ NEAREST FACILITY FINDER & COMPLAINTS MAP PANEL ============ */
let facilityMap, facilityRouteLayer, facTowerLayer, facMarkerLayer, complaintMarkerLayer;
let facilityInitialized = false;
const OSRM_BASE = 'https://router.project-osrm.org/route/v1/driving/';

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

    const computed = [];
    for (const f of compatibleFacilities) {
        try {
            const r = await roadRoute(t, { lat: f.latitude, lng: f.longitude });
            computed.push({ f, ...r });
        } catch (e) { 
            console.warn('route failed', f.facility_id, e.message); 
        }
    }
    computed.sort((a, b) => a.km - b.km);

    if (computed.length === 0) {
        status.textContent = 'Could not reach the road-routing service (OSRM) from this browser.';
        return;
    }
    status.textContent = 'Ranked by real road distance (OSRM driving profile)';
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

function initFacilityView() {
    if (!facilityInitialized) {
        facilityInitialized = true;
        facilityMap = L.map('facilityMap', { zoomControl: true }).setView([PUNE.lat, PUNE.lng], 12);
        const base = buildBaseLayers();
        base.streets.addTo(facilityMap);
        L.control.layers({ 'Streets': base.streets, 'Topographic': base.topo, 'Satellite': base.satellite, 'Hybrid': base.hybrid }, {}, { position:'topright' }).addTo(facilityMap);
        L.control.scale({ position: 'bottomright' }).addTo(facilityMap);
        addLocateControl(facilityMap);
        addMapSearchControl(facilityMap);
        facilityRouteLayer = L.layerGroup().addTo(facilityMap);
    }
    renderFacilityMarkers();
    renderFacilityComplaintsList();
}

function renderFacilityMarkers() {
    if (!facilityMap) return;
    if (facTowerLayer) facTowerLayer.clearLayers();
    else facTowerLayer = L.layerGroup().addTo(facilityMap);

    if (facMarkerLayer) facMarkerLayer.clearLayers();
    else facMarkerLayer = L.layerGroup().addTo(facilityMap);

    if (complaintMarkerLayer) complaintMarkerLayer.clearLayers();
    else complaintMarkerLayer = L.layerGroup().addTo(facilityMap);

    towerMarkersMap = {};
    facilityMarkersMap = {};

    TOWERS.forEach(t => {
        const color = getOperatorColor(t.op);
        const marker = L.circleMarker([t.lat, t.lng], { radius: 2, color: color, weight:1, fillColor: color, fillOpacity:0.85 })
            .bindPopup(`<div class="pop-box"><h3>${t.id} (${t.op})</h3>
                <div class="row"><span>Operator</span><span>${t.op}</span></div>
                <div class="row"><span>Structural health</span><span>${t.health}</span></div>
                <div class="row"><span>Risk score</span><span>${t.risk}/100 (${t.riskClass})</span></div>
                <button class="btn" style="width:100%;margin-top:8px;" onclick="window.__routeToTower('${t.id}')">Find road route</button>
            </div>`)
            .on('click', () => selectTowerForRouting(t))
            .addTo(facTowerLayer);
        
        towerMarkersMap[t.id] = marker;
    });

    FACILITIES.forEach(f => {
        const icon = L.divIcon({ className:'', html:`<div style="width:13px;height:13px;background:#8B7FD9;border:2px solid #ffffff;border-radius:3px;transform:rotate(45deg);box-shadow:0 0 6px rgba(139,127,217,.5);"></div>`, iconSize:[8, 8], iconAnchor:[7, 7] });
        const marker = L.marker([f.latitude, f.longitude], { icon })
            .bindPopup(`<div class="pop-box"><h3>${f.name}</h3>
                <div class="row"><span>Facility ID</span><span>${f.facility_id}</span></div>
                <div class="row"><span>Operator served</span><span>${f.operator}</span></div>
                <div class="row"><span>Location / area</span><span>${f.area}</span></div>
                <div class="row"><span>Facility type</span><span>${f.type}</span></div>
                <div class="row"><span>Crews on site</span><span>${f.crews_on_site}</span></div>
                <div class="row"><span>Equipment stock</span><span>${f.equipment_stock}</span></div>
                <div class="row"><span>Operating hours</span><span>${f.operating_hours}</span></div>
                <div class="row" style="border-bottom:none;"><span>Contact</span><span>${f.contact}</span></div>
            </div>`)
            .addTo(facMarkerLayer);
        
        facilityMarkersMap[f.facility_id] = marker;
    });
}

/* ============ RENDER COMPLAINTS INTO FACILITY SIDE PANEL ============ */
function renderFacilityComplaintsList() {
    const container = document.getElementById("facilityComplaintsList");
    if (!container) return;

    if (!complaints || complaints.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); font-size:12px; text-align:center; padding:10px;">No assigned complaints.</div>`;
        return;
    }

    container.innerHTML = complaints.map(c => {
        const ticketId = c.ticket_id || c.id || 'CMP-000';
        const userName = c.customer_name || c.customer?.name || 'Customer';
        const subject = c.subject || c.title || 'Issue';
        const operator = c.network_operator || 'General';
        const status = c.status || 'Pending';
        
        let lat = c.latitude ? parseFloat(c.latitude) : PUNE.lat;
        let lng = c.longitude ? parseFloat(c.longitude) : PUNE.lng;

        return `
            <div class="list-row" style="background:rgba(255,255,255,0.02); border:1px solid var(--border);">
                <span class="list-chip" style="background:${getOperatorColor(operator)};"></span>
                <div class="list-info">
                    <div class="list-id">${escapeHtml(ticketId)} — ${escapeHtml(userName)} (${escapeHtml(operator)})</div>
                    <div class="list-meta">${escapeHtml(subject)} [${escapeHtml(status)}]</div>
                </div>
                <button class="btn" style="padding:4px 8px; font-size:10.5px;" onclick="window.__viewComplaintMap(${lat}, ${lng}, '${escapeHtml(ticketId)}', '${escapeHtml(userName)}', '${escapeHtml(subject)}', '${escapeHtml(operator)}', '${escapeHtml(status)}')">View Map</button>
            </div>
        `;
    }).join('');
}

window.__viewComplaintMap = function(lat, lng, ticketId, userName, subject, operator, status) {
    if (!facilityMap) return;
    
    // Smoothly fly to the exact customer complaint location
    facilityMap.flyTo([lat, lng], 15, { duration: 0.6 });

    // Clear previous complaint highlight so new one takes over
    if (complaintMarkerLayer) {
        complaintMarkerLayer.clearLayers();
    } else {
        complaintMarkerLayer = L.layerGroup().addTo(facilityMap);
    }

    // 1. Drop a marker pin at the complaint location
    const marker = L.circleMarker([lat, lng], {
        radius: 8,
        color: '#ef4444',
        weight: 2,
        fillColor: '#f87171',
        fillOpacity: 0.9
    }).addTo(complaintMarkerLayer);

    marker.bindPopup(`
        <div class="pop-box">
            <h3 style="color:#f87171;">Complaint Origin</h3>
            <div class="row"><span>Ticket ID</span><span><strong>${ticketId}</strong></span></div>
            <div class="row"><span>Raised by</span><span>${userName} (${operator})</span></div>
            <div class="row"><span>Status</span><span><strong>${status}</strong></span></div>
            <div class="row" style="border-bottom:none;"><span>Subject</span><span>${subject}</span></div>
        </div>
    `).openPopup();

    // 2. Conditionally draw the 1km radius circle ONLY if status is Pending or In Progress
    const normStatus = status.trim().toLowerCase();
    if (normStatus === 'pending' || normStatus === 'in progress') {
        L.circle([lat, lng], {
            radius: 1000, // 1000 meters = 1 km radius
            color: '#ef4444',
            weight: 1.5,
            dashArray: '4, 4',
            fillColor: '#f87171',
            fillOpacity: 0.12,
            interactive: false 
        }).addTo(complaintMarkerLayer);
    }
};


/* ============ FLOOD MAP ============ */
let floodMap, measuring = false, measurePoints = [], measureLayer, floodTowerLayer;
let floodInitialized = false;

function bandOf(score) { if (score >= 75) return 'critical'; if (score >= 55) return 'high'; if (score >= 30) return 'medium'; return 'low'; }
const BAND_COLOR = { low:'#0120e8', medium:'#6face1', high:'#f87171', critical:'#dc2626' }; 
const FLOOD_W = { Low:0.16, Medium:0.36, High:0.56 };

function initFloodView() {
    if (!floodInitialized) {
        floodInitialized = true;
        floodMap = L.map('floodMap', { zoomControl: true }).setView([PUNE.lat, PUNE.lng], 12);
        const base = buildBaseLayers();
        base.streets.addTo(floodMap);
        L.control.layers({ 'Streets': base.streets, 'Topographic': base.topo, 'Satellite': base.satellite, 'Hybrid': base.hybrid }, {}, { position:'topright' }).addTo(floodMap);
        L.control.scale({ position: 'bottomright' }).addTo(floodMap);
        addLocateControl(floodMap);

        measureLayer = L.layerGroup().addTo(floodMap);
        const MeasureControl = L.Control.extend({
            options: { position: 'topleft' },
            onAdd: function() {
                const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control');
                const btn = L.DomUtil.create('a', '', container);
                btn.href = '#';
                btn.title = 'Measure distance';
                btn.innerHTML = '&#128207;';
                btn.style.fontSize = '14px';
                btn.style.display = 'flex';
                btn.style.alignItems = 'center';
                btn.style.justifyContent = 'center';
                btn.style.background = '#0b1329';
                btn.style.color = '#fff';
                btn.style.borderColor = 'rgba(148, 163, 184, 0.35)';
                L.DomEvent.disableClickPropagation(container);
                L.DomEvent.on(btn, 'click', function(e) {
                    L.DomEvent.preventDefault(e);
                    measuring = !measuring;
                    btn.style.background = measuring ? 'rgba(59, 130, 246, 0.3)' : '#0b1329';
                    measurePoints = []; 
                    measureLayer.clearLayers();
                });
                return container;
            }
        });
        floodMap.addControl(new MeasureControl());

        floodMap.on('click', e => {
            if (!measuring) return;
            measurePoints.push(e.latlng);
            L.circleMarker(e.latlng, { radius:2, color:'#60a5fa', fillColor:'#60a5fa', fillOpacity:1 }).addTo(measureLayer);
            if (measurePoints.length === 2) {
                const d = haversineKm({ lat: measurePoints[0].lat, lng: measurePoints[0].lng }, { lat: measurePoints[1].lat, lng: measurePoints[1].lng });
                L.polyline(measurePoints, { color:'#60a5fa', weight:1, dashArray:'6,6' }).addTo(measureLayer);
                L.popup().setLatLng(measurePoints[1]).setContent(`<b style="color:#0f172a;">${d.toFixed(2)} km</b>`).openOn(floodMap);
                measurePoints = [];
            }
        });
    }
    fetchFloodDataAndRender();
}

function fetchFloodDataAndRender() {
    if (!floodMap) return;
    fetch(`https://api.open-meteo.com/v1/forecast?latitude=${PUNE.lat}&longitude=${PUNE.lng}&current=precipitation&timezone=Asia%2FKolkata`)
        .then(r => r.json())
        .then(weather => fetch(`https://flood-api.open-meteo.com/v1/flood?latitude=${PUNE.lat}&longitude=${PUNE.lng}&daily=river_discharge,river_discharge_p75&timezone=Asia%2FKolkata`)
            .then(r => r.json())
            .then(flood => renderFloodTowers(weather, flood))
        )
        .catch(() => renderFloodTowers(null, null));
}

function renderFloodTowers(weather, flood) {
    if (floodTowerLayer) floodTowerLayer.clearLayers();
    else floodTowerLayer = L.layerGroup().addTo(floodMap);

    let rain1h = 0, riverRatio = 1.0, live = true;
    if (weather && flood) {
        rain1h = weather.current?.precipitation ?? 0;
        const idx = flood.daily?.time?.length - 1;
        const discharge = flood.daily?.river_discharge?.[idx];
        const p75 = flood.daily?.river_discharge_p75?.[idx];
        riverRatio = (discharge && p75) ? discharge / p75 : 1.0;
    } else {
        rain1h = 2.8; 
        riverRatio = 1.1; 
        live = false;
    }
    const rainScore = Math.min(100, (rain1h / 25) * 100);
    const riverScore = Math.min(100, riverRatio * 60);
    const pressure = Math.round(0.55 * rainScore + 0.45 * riverScore);

    const rainEl = document.getElementById('floodRain');
    const riverEl = document.getElementById('floodRiver');
    const bannerEl = document.getElementById('floodBanner');

    if (rainEl) rainEl.textContent = rain1h.toFixed(1) + ' mm/hr';
    if (riverEl) riverEl.textContent = riverRatio.toFixed(2) + '× normal';
    if (bannerEl) {
        bannerEl.innerHTML = live
            ? `<span class="live-badge"><span class="dot"></span>LIVE</span> Real-time rainfall &amp; Mula-Mutha river discharge from Open-Meteo — current flood pressure: <b style="margin-left:5px;">${pressure}/100</b>.`
            : `Live feed unreachable right now — showing an illustrative baseline instead of real-time data.`;
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
        L.circleMarker([t.lat, t.lng], { radius: band === 'critical' ? 2 : band === 'high' ? 2 : 2, color: BAND_COLOR[band], weight: 1, fillColor: BAND_COLOR[band], fillOpacity: 0.8 })
            .bindPopup(`<div class="pop-box"><h3>${t.id}</h3>
                <div class="row"><span>Flood exposure</span><span>${t.floodExp}</span></div>
                <div class="row"><span>Accessibility</span><span>${t.access}</span></div>
                <div class="row"><span>Live risk</span><span>${t.liveScore}/100</span></div>
            </div>`)
            .addTo(floodTowerLayer);
    });

    const catMeta = [
        { key:'critical', label:'Critical', color:BAND_COLOR.critical },
        { key:'high', label:'High', color:BAND_COLOR.high },
        { key:'medium', label:'Medium', color:BAND_COLOR.medium },
        { key:'low', label:'Low', color:BAND_COLOR.low },
    ];
    const riskCountsEl = document.getElementById('riskCategoryCounts');
    if (riskCountsEl) {
        riskCountsEl.innerHTML = catMeta.map(c => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:10px;background:rgba(255,255,255,0.03);border:1px solid var(--border);">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span style="width:10px;height:10px;border-radius:3px;background:${c.color};"></span>
                    <span style="font-size:12.5px;font-weight:600;color:var(--text-main);">${c.label}</span>
                </div>
                <span style="font-size:16px;font-weight:800;color:#60a5fa;">${counts[c.key]}</span>
            </div>`).join('');
    }
}

function haversineKm(a, b) {
    const R = 6371;
    const dLat = (b.lat - a.lat) * Math.PI / 180;
    const dLng = (b.lng - a.lng) * Math.PI / 180;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/* =========================================================
   LIVE ADMIN NOTICES SYNC FOR WORKER
========================================================= */
async function fetchAndListenNotices() {
    const tickerBox = document.getElementById("noticeTickerBox");
    const noticeText = document.getElementById("liveNoticeText");
    if (!tickerBox || !noticeText || !supabaseClient) return;

    async function loadNotices() {
        const { data, error } = await supabaseClient
            .from('notices')
            .select('*')
            .eq('active', true)
            .order('created_at', { ascending: false });

        if (error || !data || data.length === 0) {
            tickerBox.style.display = 'none';
            return;
        }

        const messages = data.map(n => n.message).join("  •  ");
        noticeText.textContent = messages;
        tickerBox.style.display = 'flex';
    }

    await loadNotices();

    supabaseClient
        .channel('admin-notices-realtime')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'notices' }, () => {
            loadNotices();
        })
        .subscribe();
}

/* =========================================================
   INITIALIZE
========================================================= */
async function initialize() {
    if (!checkAuthentication()) { return; }
    loadWorkerInformation();
    
    // Fetch live Map Data from Supabase
    await fetchSpatialData();

    await Promise.all([ loadDashboard(), loadComplaints() ]);
    
    // Start live notices listener
    await fetchAndListenNotices();

    // Force active tab setup
    const activeNav = document.querySelector('.sidebar-menu .nav-item.active');
    if (activeNav) {
        const text = activeNav.textContent.trim().toLowerCase();
        if (text.includes('facility')) switchView('view-facility', activeNav);
        else if (text.includes('flood')) switchView('view-flood', activeNav);
        else switchView('view-dashboard', activeNav);
    } else {
        switchView('view-dashboard');
    }

    if (supabaseClient) {
        supabaseClient
            .channel('worker-complaints-live')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, () => {
                loadComplaints();
            })
            .subscribe();
    }
}

initialize();

/* =========================================================
   DOM CONTENT LOADED
========================================================= */
document.addEventListener("DOMContentLoaded", async function () {
    try {
        if (typeof requireRole === "function") {
            const worker = await requireRole("worker");
            if (!worker) return;
        }
        
        if (typeof loadWorkerDashboard === "function") {
            loadWorkerDashboard();
        }
    } catch (e) {
        console.warn("Worker initialization check completed.");
    }
});