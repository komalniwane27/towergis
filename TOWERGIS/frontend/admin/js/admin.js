"use strict";

/* ============================================================
   TOWERGIS ADMIN DASHBOARD (HYBRID: LOCAL SQLITE + CLOUD SUPABASE)
   ============================================================ */

// 1. SUPABASE CLOUD SETUP (FOR LIVE COMPLAINTS)
const SUPABASE_URL = "https://lhbtkeniqvmeotdensjn.supabase.co";
const SUPABASE_KEY = "sb_publishable_8l4_goaT5nmazuWEpSQrMw_a0R89dNY";
const supabaseClient = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_KEY) : null;

// 2. LOCAL PYTHON API SETUP (FOR LOCAL WORKERS & SQLITE DB)
const API_BASE = "/api";
const $ = (id) => document.getElementById(id);

// ============================================================
// TOKEN & LOCAL BACKEND REQUEST HELPER
// ============================================================

function getToken() {
    return (
        localStorage.getItem("access_token") ||
        localStorage.getItem("token") ||
        localStorage.getItem("towergis_token")
    );
}

async function apiRequest(endpoint, options = {}) {
    const token = getToken();
    const headers = {
        "Content-Type": "application/json",
        ...(options.headers || {})
    };

    if (token) {
        headers["Authorization"] = `Bearer ${token}`;
    }

    const response = await fetch(`${API_BASE}${endpoint}`, {
        ...options,
        headers
    });

    if (response.status === 401) {
        localStorage.clear();
        window.location.href = "../login.html";
        throw new Error("Session expired.");
    }

    let data = null;
    try {
        data = await response.json();
    } catch {
        data = null;
    }

    if (!response.ok) {
        throw new Error(data?.detail || data?.message || `Request failed: ${response.status}`);
    }

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
// 1. LOAD ADMIN PROFILE FROM LOCAL SQLITE (/api/auth/me)
// ============================================================

async function loadCurrentAdmin() {
    try {
        const user = await apiRequest("/auth/me");

        const name = user.name || "TOWERGIS Administrator";
        const email = user.email || "admin@towergis.tc";
        const firstLetter = name.charAt(0).toUpperCase();

        if ($("welcomeAdminName")) $("welcomeAdminName").textContent = name;
        if ($("sidebarAdminName")) $("sidebarAdminName").textContent = name;
        if ($("sidebarAdminEmail")) $("sidebarAdminEmail").textContent = email;
        if ($("topAdminName")) $("topAdminName").textContent = name;
        if ($("adminAvatar")) $("adminAvatar").textContent = firstLetter;
        if ($("topAdminAvatar")) $("topAdminAvatar").textContent = firstLetter;

        return true;
    } catch (error) {
        console.error("Admin authentication error:", error);
        return true;
    }
}

// ============================================================
// 2. LOAD DASHBOARD STATS (HYBRID)
// ============================================================

async function loadDashboard() {
    try {
        // Fetch local users/towers stats from SQLite
        const localData = await apiRequest("/admin/dashboard").catch(() => ({ stats: {} }));
        const stats = localData.stats || {};

        if ($("totalUsers")) $("totalUsers").textContent = stats.total_users ?? 6;
        if ($("totalCustomers")) $("totalCustomers").textContent = stats.customers ?? 2;
        if ($("totalWorkers")) $("totalWorkers").textContent = stats.workers ?? 3;
        if ($("totalTowers")) $("totalTowers").textContent = stats.total_towers ?? 2000;
        if ($("activeTowers")) $("activeTowers").textContent = stats.active_towers ?? 1700;

        // Fetch Live Complaints stats from Cloud Supabase
        if (supabaseClient) {
            const { data: dbComplaints } = await supabaseClient.from('complaints').select('*');
            const list = dbComplaints || [];
            const open = list.filter(c => c.status !== 'Resolved' && c.status !== 'closed' && c.status !== 'Rejected').length;

            if ($("openComplaints")) $("openComplaints").textContent = open;
            if ($("pendingRequests")) $("pendingRequests").textContent = list.length;
        }
    } catch (error) {
        console.error("Dashboard calculation error:", error);
    }
}

// ============================================================
// 3. LOAD & MANAGE USERS DIRECTLY FROM LOCAL SQLITE DB
// ============================================================

async function loadUsers() {
    const tbody = $("usersTableBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading users from local SQLite...</td></tr>`;

    try {
        // We assume /api/admin/users returns a list of customers.
        const data = await apiRequest("/admin/users");
        const users = data.users || [];

        if ($("userCount")) {
            $("userCount").textContent = `${users.length} customer${users.length === 1 ? "" : "s"}`;
        }

        if (users.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No customers found in database.</td></tr>`;
            return;
        }

        tbody.innerHTML = users.map(u => `
            <tr>
                <td><strong>#${escapeHTML(u.id)}</strong></td>
                <td><strong>${escapeHTML(u.name)}</strong></td>
                <td>${escapeHTML(u.email)}</td>
                <td><span class="role-badge customer">CUSTOMER</span></td>
                <td>${formatDate(u.created_at)}</td>
                <td>
                    <button class="small-btn delete-btn" onclick="deleteUser(${u.id})">Delete</button>
                </td>
            </tr>
        `).join("");
    } catch (error) {
        console.error("Failed to load users from SQLite:", error);
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:red;">Error: ${escapeHTML(error.message)}</td></tr>`;
    }
}

// Global function to delete a user
window.deleteUser = async function(userId) {
    if (!confirm("Are you sure you want to delete this user? This cannot be undone.")) return;

    try {
        await apiRequest(`/admin/users/${userId}`, { method: "DELETE" });
        showToast("User deleted successfully.");
        await loadUsers();
        await loadDashboard();
    } catch (error) {
        showToast("Failed to delete user: " + error.message, "error");
    }
};

// ============================================================
// 4. LOAD & MANAGE WORKERS DIRECTLY FROM LOCAL SQLITE DB
// ============================================================

async function loadWorkers() {
    const tbody = $("workersTableBody");
    if (!tbody) return;

    tbody.innerHTML = `<tr><td colspan="6" class="empty-state">Loading workers from local SQLite...</td></tr>`;

    try {
        const data = await apiRequest("/admin/workers");
        const workers = data.workers || [];

        if ($("workerCount")) {
            $("workerCount").textContent = `${workers.length} worker${workers.length === 1 ? "" : "s"}`;
        }

        if (workers.length === 0) {
            tbody.innerHTML = `<tr><td colspan="6" class="empty-state">No workers found in SQLite database.</td></tr>`;
            return;
        }

        tbody.innerHTML = workers.map(w => `
            <tr>
                <td><strong>#${escapeHTML(w.id)}</strong></td>
                <td><strong>${escapeHTML(w.name)}</strong></td>
                <td>${escapeHTML(w.email)}</td>
                <td><span class="role-badge worker">WORKER</span></td>
                <td>${formatDate(w.created_at)}</td>
                <td>
                    <button class="small-btn" onclick="openEditWorkerModal(${w.id}, '${escapeHTML(w.name)}', '${escapeHTML(w.email)}')">Edit</button>
                    <button class="small-btn delete-btn" onclick="deleteWorker(${w.id})" style="background:var(--danger); margin-left:5px;">Delete</button>
                </td>
            </tr>
        `).join("");
    } catch (error) {
        console.error("Failed to load workers from SQLite:", error);
        tbody.innerHTML = `<tr><td colspan="6" class="empty-state" style="color:red;">Error: ${escapeHTML(error.message)}</td></tr>`;
    }
}

// Global functions for Worker Management
window.deleteWorker = async function(workerId) {
    if (!confirm("Are you sure you want to delete this worker? This cannot be undone.")) return;

    try {
        await apiRequest(`/admin/workers/${workerId}`, { method: "DELETE" });
        showToast("Worker deleted successfully.");
        await loadWorkers();
        await loadDashboard();
    } catch (error) {
        showToast("Failed to delete worker: " + error.message, "error");
    }
};

window.openEditWorkerModal = function(id, name, email) {
    const editModal = $("editWorkerFormCard");
    if (!editModal) return;

    $("editWorkerId").value = id;
    $("editWorkerName").value = name;
    $("editWorkerEmail").value = email;

    editModal.classList.remove("hidden");
};

function setupWorkerForms() {
    const showBtn = $("showWorkerFormBtn");
    const closeBtn = $("closeWorkerFormBtn");
    const cancelBtn = $("cancelWorkerBtn");
    const formCard = $("workerFormCard");

    if (showBtn) showBtn.addEventListener("click", () => formCard.classList.remove("hidden"));
    if (closeBtn) closeBtn.addEventListener("click", () => formCard.classList.add("hidden"));
    if (cancelBtn) cancelBtn.addEventListener("click", () => formCard.classList.add("hidden"));

    if ($("workerForm")) {
        $("workerForm").addEventListener("submit", async (e) => {
            e.preventDefault();

            const name = $("workerName").value.trim();
            const email = $("workerEmail").value.trim().toLowerCase();
            const password = $("workerPassword").value;

            if (!name || !email || !password) {
                showToast("Please fill all fields.", "error");
                return;
            }

            if (!email.endsWith("@beacon.tc")) {
                showToast("Worker email must use the @beacon.tc domain.", "error");
                return;
            }

            try {
                const res = await apiRequest("/admin/workers", {
                    method: "POST",
                    body: JSON.stringify({ name, email, password })
                });

                showToast(res.message || "Worker saved to local SQLite!");
                formCard.classList.add("hidden");
                $("workerForm").reset();

                await loadWorkers();
                await loadDashboard();
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }

    const closeEditBtn = $("closeEditWorkerBtn");
    const cancelEditBtn = $("cancelEditWorkerBtn");
    const editFormCard = $("editWorkerFormCard");

    if (closeEditBtn) closeEditBtn.addEventListener("click", () => editFormCard.classList.add("hidden"));
    if (cancelEditBtn) cancelEditBtn.addEventListener("click", () => editFormCard.classList.add("hidden"));

    if ($("editWorkerForm")) {
        $("editWorkerForm").addEventListener("submit", async (e) => {
            e.preventDefault();

            const id = $("editWorkerId").value;
            const name = $("editWorkerName").value.trim();
            const email = $("editWorkerEmail").value.trim().toLowerCase();

            if (!name || !email) {
                showToast("Name and email are required.", "error");
                return;
            }

            try {
                const res = await apiRequest(`/admin/workers/${id}`, {
                    method: "PUT",
                    body: JSON.stringify({ name, email })
                });

                showToast(res.message || "Worker updated successfully!");
                editFormCard.classList.add("hidden");
                $("editWorkerForm").reset();

                await loadWorkers();
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }
}

// ============================================================
// 5. FETCH COMPLAINTS FROM CLOUD SUPABASE & ASSIGN LOCAL WORKERS
// ============================================================

async function loadComplaints() {
    const tbody = $("complaintsTableBody");
    if (!tbody) return;

    if (!supabaseClient) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:red;">Cloud database connection not initialized.</td></tr>`;
        return;
    }

    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">Loading complaints from Cloud Database...</td></tr>`;

    try {
        const [cloudResult, localWorkersResult] = await Promise.all([
            supabaseClient.from('complaints').select('*').order('created_at', { ascending: false }),
            apiRequest("/admin/workers").catch(() => ({ workers: [] }))
        ]);

        const complaints = cloudResult.data || [];
        const workers = localWorkersResult.workers || [];

        if (cloudResult.error) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:red;">Error: ${escapeHTML(cloudResult.error.message)}</td></tr>`;
            return;
        }

        if ($("complaintCount")) {
            $("complaintCount").textContent = `${complaints.length} complaint${complaints.length === 1 ? "" : "s"}`;
        }

        if (complaints.length === 0) {
            tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No complaints registered in Cloud Database yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = complaints.map(c => {
            const tId = c.ticket_id || ("CMP-" + c.id);

            const workerOptions = workers.map(w => `
                <option value="${escapeHTML(w.name)} (#${w.id})" ${c.assigned_worker_id === `${w.name} (#${w.id})` ? "selected" : ""}>
                    ${escapeHTML(w.name)} (${escapeHTML(w.email)})
                </option>
            `).join("");

            return `
                <tr>
                    <td><strong>${escapeHTML(tId)}</strong></td>
                    <td>
                        <strong>${escapeHTML(c.customer_name || "Customer")}</strong>
                        <small class="table-subtext">ID: ${escapeHTML(c.customer_id || "CUST-001")}</small>
                    </td>
                    <td>
                        <strong>${escapeHTML(c.subject || "No Subject")}</strong>
                        <small class="table-subtext">${escapeHTML(c.description || "")}</small>
                    </td>
                    <td>
                        <span class="priority-badge medium">${escapeHTML(c.category || "General")}</span>
                        <small class="table-subtext">${escapeHTML(c.area || "Pune")}</small>
                    </td>
                    <td>
                        <select class="status-select" id="status-select-${tId}">
                            <option value="Pending" ${c.status === "Pending" ? "selected" : ""}>Pending</option>
                            <option value="In Progress" ${c.status === "In Progress" ? "selected" : ""}>In Progress</option>
                            <option value="Resolved" ${c.status === "Resolved" ? "selected" : ""}>Resolved</option>
                            <option value="Rejected" ${c.status === "Rejected" ? "selected" : ""}>Rejected</option>
                        </select>
                    </td>
                    <td>
                        <select class="status-select" id="worker-select-${tId}">
                            <option value="">Unassigned</option>
                            ${workerOptions}
                        </select>
                    </td>
                    <td>
                        <button class="small-btn" onclick="saveComplaintUpdate('${tId}')">Save</button>
                    </td>
                </tr>
            `;
        }).join("");

    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="7" class="empty-state" style="color:red;">Error loading: ${escapeHTML(err.message)}</td></tr>`;
    }
}

// ============================================================
// 6. SAVE COMPLAINT UPDATES TO CLOUD SUPABASE
// ============================================================

window.saveComplaintUpdate = async function(ticketId) {
    const statusSelect = $(`status-select-${ticketId}`);
    const workerSelect = $(`worker-select-${ticketId}`);

    if (!statusSelect || !supabaseClient) return;

    const newStatus = statusSelect.value;
    const workerId = workerSelect ? (workerSelect.value || null) : null;

    try {
        const { error } = await supabaseClient
            .from('complaints')
            .update({
                status: newStatus,
                assigned_worker_id: workerId
            })
            .eq('ticket_id', ticketId);

        if (error) {
            showToast("Update failed: " + error.message, "error");
            return;
        }

        showToast(`Complaint ${ticketId} updated in Cloud!`);
        await loadComplaints();
        await loadDashboard();
    } catch (err) {
        showToast("Error updating status.", "error");
    }
};

// ============================================================
// 7. ADMIN NOTICE MANAGEMENT LOGIC
// ============================================================

async function loadAdminNotices() {
    const listContainer = $("adminNoticesList");
    if (!listContainer || !supabaseClient) return;

    const { data, error } = await supabaseClient
        .from('notices')
        .select('*')
        .order('created_at', { ascending: false });

    if (error || !data || data.length === 0) {
        listContainer.innerHTML = `<div style="color: var(--muted); font-size: 12px; text-align: center; padding: 10px;">No notices published yet.</div>`;
        return;
    }

    listContainer.innerHTML = data.map(n => `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 10px 14px; background: rgba(255,255,255,0.03); border: 1px solid rgba(56,90,134,0.2); border-radius: 8px;">
            <div style="font-size: 12.5px; color: #e2e8f0; max-width: 80%; word-break: break-word;">${escapeHTML(n.message)}</div>
            <button onclick="deleteAdminNotice(${n.id})" style="background: rgba(239, 68, 68, 0.15); border: 1px solid rgba(239, 68, 68, 0.4); color: #fca5a5; padding: 5px 10px; border-radius: 6px; cursor: pointer; font-size: 11px; font-weight: 600;">Remove</button>
        </div>
    `).join('');
}

window.publishAdminNotice = async function() {
    const input = $("adminNoticeInput");
    if (!input || !supabaseClient) return;
    const message = input.value.trim();

    if (!message) {
        showToast("Please enter a notice message.", "error");
        return;
    }

    const { error } = await supabaseClient
        .from('notices')
        .insert([{ message: message, active: true }]);

    if (error) {
        showToast("Failed to publish notice: " + error.message, "error");
        return;
    }

    input.value = "";
    loadAdminNotices();
    showToast("Notice published successfully! It is now live on worker terminals.");
};

window.deleteAdminNotice = async function(id) {
    if (!confirm("Are you sure you want to remove this notice?")) return;

    const { error } = await supabaseClient
        .from('notices')
        .delete()
        .eq('id', id);

    if (error) {
        showToast("Failed to remove notice: " + error.message, "error");
        return;
    }

    loadAdminNotices();
    showToast("Notice removed.");
};

// ============================================================
// 8. NAVIGATION
// ============================================================

function setupNavigation() {
    const navItems = document.querySelectorAll(".nav-item");
    const actionCards = document.querySelectorAll(".action-card");

    const showSection = (sectionName) => {
        const sections = {
            dashboard: $("dashboardSection"),
            users: $("usersSection"),
            workers: $("workersSection"),
            towers: $("towersSection"),
            complaints: $("complaintsSection")
        };

        Object.values(sections).forEach(s => { if (s) s.classList.add("hidden"); });
        if (sections[sectionName]) sections[sectionName].classList.remove("hidden");

        navItems.forEach(item => item.classList.toggle("active", item.dataset.section === sectionName));

        const titles = {
            dashboard: ["Admin Dashboard", "TOWERGIS system administration"],
            users: ["User Management", "View and manage registered customers (Local SQLite)"],
            workers: ["Worker Management", "Create and manage field workers (Local SQLite)"],
            towers: ["Tower Management", "Manage telecom infrastructure"],
            complaints: ["Complaint Management", "Review live customer complaints (Cloud Supabase)"]
        };

        const titleData = titles[sectionName] || titles.dashboard;
        $("pageTitle").textContent = titleData[0];
        $("pageSubtitle").textContent = titleData[1];

        if (sectionName === "dashboard") loadDashboard();
        if (sectionName === "users") loadUsers();
        if (sectionName === "workers") loadWorkers();
        if (sectionName === "complaints") loadComplaints();
    };

    navItems.forEach(item => item.addEventListener("click", () => showSection(item.dataset.section)));
    actionCards.forEach(card => card.addEventListener("click", () => showSection(card.dataset.section)));
}

// ============================================================
// 9. TOWER FORM
// ============================================================

function setupTowerForm() {
    if ($("towerForm")) {
        $("towerForm").addEventListener("submit", async (e) => {
            e.preventDefault();
            try {
                const body = {
                    tower_code: $("towerCode").value.trim(),
                    name: $("towerName").value.trim(),
                    operator: $("towerOperator").value.trim() || null,
                    technology: $("towerTechnology").value,
                    latitude: Number($("towerLatitude").value),
                    longitude: Number($("towerLongitude").value),
                    coverage_radius_km: Number($("towerRadius").value),
                    status: $("towerStatus").value,
                    address: $("towerAddress").value.trim() || null
                };

                const res = await apiRequest("/admin/towers", {
                    method: "POST",
                    body: JSON.stringify(body)
                });

                showToast(res.message || "Tower registered in SQLite!");
                $("towerForm").reset();
                await loadDashboard();
            } catch (err) {
                showToast(err.message, "error");
            }
        });
    }
}

// ============================================================
// HELPERS
// ============================================================

function escapeHTML(value) {
    if (value === null || value === undefined) return "";
    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatDate(value) {
    if (!value) return "-";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

// ============================================================
// INITIALIZATION
// ============================================================

document.addEventListener("DOMContentLoaded", async () => {
    await loadCurrentAdmin();
    setupNavigation();
    setupWorkerForms();
    setupTowerForm();

    if ($("refreshUsersBtn")) $("refreshUsersBtn").addEventListener("click", () => { loadUsers(); showToast("Users refreshed from SQLite."); });
    if ($("refreshWorkersBtn")) $("refreshWorkersBtn").addEventListener("click", () => { loadWorkers(); showToast("Workers refreshed from SQLite."); });
    if ($("refreshComplaintsBtn")) $("refreshComplaintsBtn").addEventListener("click", () => { loadComplaints(); showToast("Complaints refreshed from Cloud."); });
    if ($("logoutBtn")) $("logoutBtn").addEventListener("click", () => { localStorage.clear(); window.location.href = "/app/login.html"; });

    await loadDashboard();
    await loadWorkers();
    await loadUsers();
    await loadComplaints();
    await loadAdminNotices();

    // Live Real-time listener for Cloud Complaints
    if (supabaseClient) {
        supabaseClient
            .channel('admin-cloud-feed')
            .on('postgres_changes', { event: '*', schema: 'public', table: 'complaints' }, () => {
                loadComplaints();
                loadDashboard();
            })
            .subscribe();
    }
});