import { db, auth, googleProvider } from './firebase-config.js';
import {
    collection,
    addDoc,
    setDoc,
    getDocs,
    updateDoc,
    deleteDoc,
    doc,
    query,
    orderBy,
    where,
    onSnapshot,
    setLogLevel
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-firestore.js";
import {
    signInWithEmailAndPassword,
    signInWithPopup,
    signOut,
    onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/11.0.1/firebase-auth.js";

// App State & Data Management
const COLLECTION_NAME = 'Loans';

// Global state
let loans = [];
let editingId = null;
let currentUserRole = null;
let assignedName = null;
let authorizedUsers = [];

// DOM Elements
const contentArea = document.getElementById('content-area');
const navItems = document.querySelectorAll('.nav-item');
const pageTitle = document.getElementById('page-title');
const loginForm = document.getElementById('login-form');
const googleLoginBtn = document.getElementById('google-login-btn');
const logoutBtn = document.getElementById('logout-btn');
const authError = document.getElementById('auth-error');
const authOverlay = document.getElementById('auth-overlay');

window.addEventListener('online', () => showToast('Back Online'));
window.addEventListener('offline', () => showToast('Working Offline'));

// Global Error Catcher
window.onerror = function (msg, url, line, col, error) {
    console.error("GLOBAL ERROR:", msg, "at", url, ":", line);
    // Only alert for non-extension errors to avoid noise
    if (!url || url.includes('app.js')) {
        alert("CRITICAL APP ERROR:\n" + msg + "\nLine: " + line);
    }
    return false;
};

// Utility Functions
const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-IN', {
        style: 'currency',
        currency: 'INR',
        maximumFractionDigits: 0
    }).format(amount);
};

const formatDate = (dateString) => {
    if (!dateString) return '';
    return new Date(dateString).toLocaleDateString('en-IN');
};

const getStatusClass = (status) => {
    switch (status?.toLowerCase()) {
        case 'disbursed': return 'status-disbursed';
        case 'approved': return 'status-approved';
        case 'rejected': return 'status-rejected';
        case 'underwriting': return 'status-underwriting';
        case 'underwriting forward': return 'status-forward';
        default: return 'status-default';
    }
};

const saveToLocalStorage = () => {
    // Keeping this for legacy/backup purposes, but main data is in Firestore
    localStorage.setItem(APP_KEY, JSON.stringify(loans));
};

// Navigation Logic
const updateNavActive = (view) => {
    document.querySelectorAll('.nav-item').forEach(nav => {
        if (nav.getAttribute('data-view') === view) {
            nav.classList.add('active');
        } else {
            nav.classList.remove('active');
        }

        // Dynamically update sidebar text
        if (nav.getAttribute('data-view') === 'entry') {
            const span = nav.querySelector('span');
            if (span) {
                span.textContent = (currentUserRole === 'ADMIN' || currentUserRole === 'BACK_OFFICE') ? 'Daily Entry' : 'YOUR FILES';
            }
        }
    });
};

navItems.forEach(item => {
    item.addEventListener('click', () => {
        const view = item.getAttribute('data-view');
        loadView(view);
    });
});

const loadView = (view) => {
    // Security check for views
    if (view === 'dashboard' && currentUserRole !== 'ADMIN') {
        loadView('entry');
        return;
    }
    if (view === 'users' && currentUserRole !== 'ADMIN') {
        loadView('entry');
        return;
    }

    updateNavActive(view);

    contentArea.innerHTML = '';
    editingId = null; // Reset edit mode on view change
    if (view === 'entry') {
        renderEntryPage();
    } else if (view === 'dashboard') {
        renderDashboardPage();
    } else if (view === 'users' && (currentUserRole === 'ADMIN' || auth.currentUser?.email === 'sharmashubham22657@gmail.com')) {
        renderUserManagement();
    }
};



// --- BACKUP & RESTORE LOGIC ---
window.backupData = () => {
    const dataStr = JSON.stringify(loans, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);

    const exportFileDefaultName = `SBE_Backup_${new Date().toISOString().slice(0, 10)}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
};

window.restoreData = (input) => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const importedData = JSON.parse(e.target.result);
            if (Array.isArray(importedData)) {
                if (confirm(`Found ${importedData.length} records in backup.This will UPLOAD them to Firebase.Are you sure ? `)) {
                    // Upload to Firestore
                    const uploadPromises = importedData.map(item => {
                        // Ensure we have a clean object for Firestore
                        const { id, ...data } = item;
                        return addDoc(collection(db, COLLECTION_NAME), data);
                    });

                    Promise.all(uploadPromises).then(() => {
                        alert(`Successfully uploaded ${importedData.length} records to Firebase!`);
                        location.reload();
                    }).catch(error => {
                        console.error("Error restoring data: ", error);
                        alert("Failed to upload some records to Firebase.");
                    });
                }
            } else {
                alert("Invalid backup file format. Expected an array of records.");
            }
        } catch (error) {
            alert("Error parsing backup file. Please ensure it is a valid JSON file.");
            console.error(error);
        }
    };
    reader.readAsText(file);
    // Reset input so same file can be selected again if needed
    input.value = '';
};

// --- VIEW: DAILY ENTRY ---
const renderEntryPage = () => {
    pageTitle.textContent = (currentUserRole === 'ADMIN' || currentUserRole === 'BACK_OFFICE') ? 'Daily Entries' : 'YOUR FILES';

    const container = document.createElement('div');

    // Form Section
    const formHtml = `
    <div class="card">
            <h3 id="form-title" style="margin-bottom:1.5rem;">Add New Case</h3>
            <form id="entry-form" onsubmit="handleFormSubmit(event)">
                <div class="form-row">
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Date</label>
                        <input type="date" id="date" class="form-control" required>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Customer Name</label>
                        <input type="text" id="customerName" class="form-control" placeholder="Enter Name" required>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">LOS Number</label>
                        <input type="text" id="losNo" class="form-control" placeholder="Enter LOS No">
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Bank Name</label>
                        <input type="text" id="bankName" class="form-control" placeholder="Select Bank" list="bank-list">
                        <datalist id="bank-list">
                            <option value="HDFC Bank">
                            <option value="ICICI Bank">
                            <option value="Axis Bank">
                            <option value="Axis Finance">
                            <option value="Chola MS">
                            <option value="Kotak Mahindra">
                            <option value="Bajaj Finserv">
                        </datalist>
                    </div>
                </div>

                <div class="form-row">
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Loan Amount</label>
                        <input type="number" id="amount" class="form-control" placeholder="₹ Amount" required min="0">
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Tenure (Months)</label>
                        <input type="number" id="tenure" class="form-control" placeholder="e.g. 60" required list="tenure-list">
                        <datalist id="tenure-list">
                            <option value="12">
                            <option value="24">
                            <option value="36">
                            <option value="48">
                            <option value="60">
                            <option value="120">
                            <option value="180">
                            <option value="240">
                        </datalist>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Interest Rate (%)</label>
                        <input type="number" id="interestRate" class="form-control" placeholder="Rate" step="0.01">
                    </div>
                </div>

                <div class="form-row">
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Case Type</label>
                        <input type="text" id="caseType" class="form-control" placeholder="Select Type" list="case-type-list" required>
                        <datalist id="case-type-list">
                            <option value="Normal PL">
                            <option value="Golden Edge">
                            <option value="BT">
                            <option value="Ex BT">
                            <option value="Business Loan">
                            <option value="Home Loan">
                        </datalist>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Location</label>
                        <input type="text" id="location" class="form-control" placeholder="City / Area">
                    </div>
                </div>

                <div class="form-row">
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Status</label>
                        <input type="text" id="status" class="form-control" placeholder="Select Status" required list="status-list">
                        <datalist id="status-list">
                            <option value="Underwriting">
                            <option value="Underwriting Forward">
                            <option value="Approved">
                            <option value="Disbursed">
                            <option value="Rejected">
                        </datalist>
                    </div>
                    <div>
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Executive Name</label>
                        <input type="text" id="executiveName" class="form-control" placeholder="Select Executive" required list="exec-list">
                        <datalist id="exec-list">
                            <!-- Auto-populated from existing data and user list -->
                            ${getExecutiveListForDropdown().map(name => `<option value="${name}">`).join('')}
                        </datalist>
                    </div>
                    <div style="flex:2;">
                        <label style="display:block; margin-bottom:0.25rem; font-weight:600; font-size:0.85rem; color:#475569;">Remarks / Notes</label>
                        <input type="text" id="remarks" class="form-control" placeholder="Any comments...">
                    </div>
                </div>
                
                <div style="display:flex; gap:1rem; margin-top:2rem;">
                    <button type="submit" id="submit-btn" class="btn btn-primary"><i class="fas fa-plus"></i> Add Entry</button>
                    <button type="button" id="cancel-btn" class="btn btn-danger" style="display:none;" onclick="cancelEdit()">Cancel</button>
                </div>
            </form>
        </div>
    `;

    // Table Section
    const currentYear = new Date().getFullYear();
    const tableHtml = `
        <div class="controls-bar" style="display:flex; justify-content:space-between; margin-bottom:1rem; gap:1rem; flex-wrap:wrap; align-items:center;">
            <div style="display:flex; gap:0.5rem; align-items:center; flex-wrap:wrap;">
                <input type="text" id="search-input" class="form-control" placeholder="Search..." oninput="window.renderTableRows()" style="max-width:250px;">
                
                <!-- Date Filters -->
                <select id="filter-year" class="filter-select" onchange="window.renderTableRows()">
                    <option value="">All Years</option>
                    ${Array.from({ length: currentYear + 5 - 2020 + 1 }, (_, i) => 2020 + i).map(year =>
        `<option value="${year}">${year}</option>`
    ).join('')}
                </select>
                
                <select id="filter-month" class="filter-select" onchange="window.renderTableRows()">
                    <option value="">All Months</option>
                    <option value="0">January</option>
                    <option value="1">February</option>
                    <option value="2">March</option>
                    <option value="3">April</option>
                    <option value="4">May</option>
                    <option value="5">June</option>
                    <option value="6">July</option>
                    <option value="7">August</option>
                    <option value="8">September</option>
                    <option value="9">October</option>
                    <option value="10">November</option>
                    <option value="11">December</option>
                </select>

                <!-- Bulk Action Button -->
                <button id="bulk-delete-btn" class="btn btn-danger" onclick="deleteSelectedEntries()" style="display:none; padding: 0.5rem 1rem; font-size: 0.85rem;">
                    <i class="fas fa-trash"></i> Delete Selected (<span id="selected-count">0</span>)
                </button>
            </div>
            ${currentUserRole === 'ADMIN' ? `
            <div style="display:flex; gap:0.5rem; align-items:center;">
                <button class="btn btn-excel" onclick="exportToCSV()" title="Export All Data">
                    <i class="fas fa-file-excel"></i> Export Excel
                </button>
                <div style="position:relative;">
                    <button class="btn btn-primary" onclick="triggerImport()" style="background:#0f172a; border:1px solid #1e293b;">
                        <i class="fas fa-file-import"></i> Import Excel
                    </button>
                    <input type="file" id="excel-input" accept=".xlsx, .xls" style="display:none;" onchange="handleExcelImport(this)">
                </div>
                <button class="btn" onclick="downloadImportTemplate()" style="background:none; color:#64748b; font-size:0.85rem; padding:0.5rem; text-decoration:underline;">
                    <i class="fas fa-download"></i> Template
                </button>
            </div>
            ` : ''}
        </div>

        <!-- Floating Ghost Scrollbar (Fixed at bottom of viewport) -->
        <div id="ghost-scrollbar-container" style="position:fixed; bottom:0; height:20px; 
            overflow-x:auto; overflow-y:hidden; z-index:1000; display:none; background:transparent;">
            <div id="ghost-scrollbar-content" style="height:1px;"></div>
        </div>

        <div class="table-container" id="main-table-container">
            <table style="font-size: 0.85rem;">
                <thead>
                    <tr>
                        <th style="width: 40px; text-align: center;">
                            <input type="checkbox" id="select-all" onclick="toggleSelectAll(this)">
                        </th>
                        <th>Date</th>
                        <th>LOS No.</th>
                        <th>Customer</th>
                        <th>Type</th>
                        <th>Bank</th>
                        <th>Amount</th>
                        <th>Tenure</th>
                        <th>Loc</th>
                        <th>Status</th>
                        <th>Executive</th>
                        <th>Remarks</th>
                        <th>Action</th>
                    </tr>
                </thead>
                <tbody id="entries-body">
                    <!-- Rows injected here -->
                </tbody>
            </table>
        </div>
        <div class="total-summary">
            <span>Total Disbursed Volume</span>
            <strong id="grand-total">₹0</strong>
        </div>
    `;

    container.innerHTML = ((currentUserRole === 'ADMIN' || currentUserRole === 'BACK_OFFICE') ? formHtml : '') + tableHtml;
    contentArea.appendChild(container);

    const dateInput = document.getElementById('date');
    if (dateInput) {
        dateInput.valueAsDate = new Date();
    }

    // Auto-fill and Lock Executive Name ONLY for stringently restricted EXECUTIVE role
    const execInput = document.getElementById('executiveName');
    if (execInput && currentUserRole === 'EXECUTIVE' && assignedName) {
        execInput.value = assignedName;
        execInput.readOnly = true;
        execInput.style.backgroundColor = '#f1f5f9';
        execInput.style.cursor = 'not-allowed';
    }

    renderTableRows();

    // Initialize sticky scrollbar
    setTimeout(() => initStickyScrollbar(), 200);
};

const getUniqueExecutives = () => {
    const executives = new Set(loans.map(l => l.executiveName));
    return Array.from(executives).sort();
};

const getExecutiveListForDropdown = () => {
    // Combine names from existing loans and the authorized users list
    const fromLoans = loans.map(l => l.executiveName);
    const fromUsers = authorizedUsers.filter(u => u.role === 'EXECUTIVE').map(u => u.assignedName);
    const combined = new Set([...fromLoans, ...fromUsers]);
    return Array.from(combined).filter(Boolean).sort();
};

// Explicitly attach to window for HTML access
window.handleFormSubmit = (e) => {
    e.preventDefault();

    const amount = parseFloat(document.getElementById('amount').value);

    const entryData = {
        id: editingId || Date.now().toString(),
        date: document.getElementById('date').value,
        customerName: document.getElementById('customerName').value,
        losNo: document.getElementById('losNo').value,
        bankName: document.getElementById('bankName').value,
        amount: amount,
        interestRate: parseFloat(document.getElementById('interestRate').value) || 0,
        tenure: document.getElementById('tenure').value,
        caseType: document.getElementById('caseType').value,
        location: document.getElementById('location').value,
        status: document.getElementById('status').value,
        executiveName: document.getElementById('executiveName').value.trim(),
        remarks: document.getElementById('remarks').value
    };

    const performSave = async () => {
        try {
            if (editingId) {
                const loanRef = doc(db, COLLECTION_NAME, editingId);
                const { id, ...dataToSave } = entryData;
                await updateDoc(loanRef, dataToSave);
                editingId = null;
                cancelEdit();
                showToast("Entry updated successfully.");
            } else {
                const { id, ...dataToSave } = entryData;
                await addDoc(collection(db, COLLECTION_NAME), dataToSave);

                const date = document.getElementById('date').value;
                e.target.reset();
                if (document.getElementById('date')) document.getElementById('date').value = date;
                if (document.getElementById('status')) document.getElementById('status').value = 'Underwriting';
                showToast("Saved to database!");
            }
        } catch (error) {
            console.error("Firebase Error:", error.message);
            alert("Error saving data: " + error.message);
        }
    };

    performSave();

    // saveToLocalStorage(); // Optional
    // renderTableRows(); // Handled by onSnapshot
};

window.renderTableRows = () => {
    const tbody = document.getElementById('entries-body');
    if (!tbody) return;

    const searchInput = document.getElementById('search-input');
    const searchTerm = (searchInput?.value || '').toString().toLowerCase().trim();

    const monthFilterStr = document.getElementById('filter-month')?.value;
    const yearFilterStr = document.getElementById('filter-year')?.value;

    console.log("Searching for:", searchTerm, "Month:", monthFilterStr, "Year:", yearFilterStr); // Debugging

    const filteredLoans = loans.filter(loan => {
        // Safe String Casting helper
        const safeStr = (val) => String(val || '').toLowerCase();

        const textMatch =
            safeStr(loan.customerName).includes(searchTerm) ||
            safeStr(loan.losNo).includes(searchTerm) ||
            safeStr(loan.bankName).includes(searchTerm) ||
            safeStr(loan.caseType).includes(searchTerm) ||
            safeStr(loan.location).includes(searchTerm) ||
            safeStr(loan.executiveName).includes(searchTerm) ||
            safeStr(loan.amount).includes(searchTerm) ||
            safeStr(loan.status).includes(searchTerm);

        // Date Logic
        let dateMatch = true;
        if (loan.date && (monthFilterStr !== '' || yearFilterStr !== '')) {
            const loanDate = new Date(loan.date);
            if (!isNaN(loanDate)) {
                if (monthFilterStr !== '') {
                    if (loanDate.getMonth() !== parseInt(monthFilterStr)) {
                        dateMatch = false;
                    }
                }
                if (yearFilterStr !== '') {
                    if (loanDate.getFullYear() !== parseInt(yearFilterStr)) {
                        dateMatch = false;
                    }
                }
            }
        }

        return textMatch && dateMatch;
    });

    tbody.innerHTML = filteredLoans.map(loan => {
        const rowClass = {
            'Disbursed': 'row-disbursed',
            'Approved': 'row-approved',
            'Rejected': 'row-rejected',
            'Underwriting Forward': 'row-forward',
            'Underwriting': 'row-underwriting'
        }[loan.status] || '';
        return `
        <tr class="${rowClass}">
            <td style="text-align: center;">
                ${(currentUserRole === 'ADMIN' || currentUserRole === 'BACK_OFFICE') ? `<input type="checkbox" class="entry-checkbox" value="${loan.id}" onclick="updateBulkState()">` : ``}
            </td>
            <td>${formatDate(loan.date)}</td>
            <td>${loan.losNo || '-'}</td>
            <td style="font-weight:600;">${loan.customerName}</td>
            <td>${loan.caseType || '-'}</td>
            <td>${loan.bankName || '-'}</td>
            <td class="amount">${formatCurrency(loan.amount)}</td>
            <td>${loan.tenure || '-'} M</td>
            <td>${loan.location || '-'}</td>
            <td>
                ${(currentUserRole === 'ADMIN' || currentUserRole === 'BACK_OFFICE') ? `
                <select class="inline-status-select ${getStatusClass(loan.status)}" onchange="updateStatus('${loan.id}', this)">
                    <option value="Underwriting" ${loan.status === 'Underwriting' ? 'selected' : ''}>Underwriting</option>
                    <option value="Underwriting Forward" ${loan.status === 'Underwriting Forward' ? 'selected' : ''}>Underwriting Forward</option>
                    <option value="Approved" ${loan.status === 'Approved' ? 'selected' : ''}>Approved</option>
                    <option value="Disbursed" ${loan.status === 'Disbursed' ? 'selected' : ''}>Disbursed</option>
                    <option value="Rejected" ${loan.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
                </select>
                ` : `<span class="status-badge ${getStatusClass(loan.status)}">${loan.status}</span>`}
            </td>
            <td>${loan.executiveName}</td>
            <td style="font-size:0.8rem; color:var(--text-secondary); max-width:150px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${loan.remarks || ''}">${loan.remarks || '-'}</td>
            <td>
                ${(currentUserRole === 'ADMIN' || currentUserRole === 'BACK_OFFICE') ? `
                <button onclick="editEntry('${loan.id}')" style="color:var(--primary-color); background:none; border:none; cursor:pointer; margin-right:0.5rem;" title="Edit">
                    <i class="fas fa-edit"></i>
                </button>
                <button onclick="deleteEntry('${loan.id}')" style="color:red; background:none; border:none; cursor:pointer;" title="Delete">
                    <i class="fas fa-trash"></i>
                </button>
                ` : '<span style="color:#94a3b8; font-style:italic; font-size:0.75rem;">View Only</span>'}
            </td>
        </tr>
        `;
    }).join('');

    // Reset Select All checkbox
    const selectAllBox = document.getElementById('select-all');
    if (selectAllBox) selectAllBox.checked = false;
    updateBulkState();

    // Calculate totals based on filtered visible rows - ONLY Disbursed
    const disbursedLoans = filteredLoans.filter(l => l.status === 'Disbursed');

    // Total Volume (Disbursed Only)
    const totalVolume = disbursedLoans.reduce((sum, loan) => sum + loan.amount, 0);
    const grandTotalEl = document.getElementById('grand-total');
    if (grandTotalEl) {
        grandTotalEl.textContent = formatCurrency(totalVolume);
    }
};

// Inline Status Update - saves directly to Firestore on dropdown change
window.updateStatus = async (id, selectEl) => {
    const newStatus = selectEl.value;
    // Update class immediately for visual feedback
    selectEl.className = `inline-status-select ${getStatusClass(newStatus)}`;
    try {
        await updateDoc(doc(db, COLLECTION_NAME, id), { status: newStatus });
        showToast(`Status updated to "${newStatus}"`);
    } catch (error) {
        console.error('Status update error:', error);
        alert('Failed to update status: ' + error.message);
    }
};

// Sticky Scrollbar Functionality (Ghost Scrollbar)
// We keep global listeners but find elements dynamically to handle page navigation
let scrollListenersAttached = false;

const initStickyScrollbar = () => {
    const tableContainer = document.getElementById('main-table-container');
    const ghostContainer = document.getElementById('ghost-scrollbar-container');
    const ghostContent = document.getElementById('ghost-scrollbar-content');

    if (!tableContainer || !ghostContainer || !ghostContent) return;

    // 1. Setup Table-Specific Listeners (Must re-attach on every page render)
    const syncScroll = (source, target) => {
        if (Math.abs(target.scrollLeft - source.scrollLeft) > 1) {
            target.scrollLeft = source.scrollLeft;
        }
    };

    // Remove old listeners implicitly by the element being replaced, but we add fresh ones
    tableContainer.addEventListener('scroll', () => syncScroll(tableContainer, ghostContainer));
    ghostContainer.addEventListener('scroll', () => syncScroll(ghostContainer, tableContainer));

    // 2. Setup Global Visibility Logic (Attached only once)
    const checkVisibility = () => {
        // Find elements fresh in case of navigation
        const currentTable = document.getElementById('main-table-container');
        const currentGhost = document.getElementById('ghost-scrollbar-container');
        const currentContent = document.getElementById('ghost-scrollbar-content');

        if (!currentTable || !currentGhost || !currentContent) return;

        const rect = currentTable.getBoundingClientRect();
        const viewportHeight = window.innerHeight;

        const needsScroll = currentTable.scrollWidth > currentTable.clientWidth;
        const topOfTableVisible = rect.top < viewportHeight;
        const bottomOfTableBelowView = rect.bottom > viewportHeight;

        if (needsScroll && topOfTableVisible && bottomOfTableBelowView) {
            currentContent.style.width = currentTable.scrollWidth + 'px';
            currentGhost.style.left = rect.left + 'px';
            currentGhost.style.width = rect.width + 'px';
            currentGhost.style.display = 'block';
            currentGhost.scrollLeft = currentTable.scrollLeft;
        } else {
            currentGhost.style.display = 'none';
        }
    };

    if (!scrollListenersAttached) {
        window.addEventListener('scroll', checkVisibility);
        window.addEventListener('resize', checkVisibility);
        setInterval(checkVisibility, 1000); // Periodic check for content changes
        scrollListenersAttached = true;
    }

    // Initial check
    setTimeout(checkVisibility, 200);
};

// Undo History
let actionHistory = [];

// Toast Notification
const showToast = (message) => {
    let toast = document.getElementById('toast-notification');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'toast-notification';
        toast.style.cssText = `
            position: fixed;
            bottom: 2rem;
            right: 2rem;
            background: #1e293b;
            color: white;
            padding: 1rem 1.5rem;
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
            z-index: 1000;
            display: flex;
            align-items: center;
            gap: 0.5rem;
            transform: translateY(100px);
            transition: transform 0.3s ease-out;
            font-size: 0.9rem;
        `;
        document.body.appendChild(toast);
    }
    toast.innerHTML = `<i class="fas fa-info-circle"></i> ${message}`;
    toast.style.transform = 'translateY(0)';

    setTimeout(() => {
        toast.style.transform = 'translateY(100px)';
    }, 4000);
};

// Global Keyboard Shortcuts
document.addEventListener('keydown', (e) => {
    // Ctrl+Z: Undo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undoLastAction();
    }

    // Ctrl+S: Save/Submit form (if on Daily Entry page)
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        const form = document.getElementById('entry-form');
        if (form) {
            form.requestSubmit(); // Trigger form submission
        }
    }

    // Esc: Close modal
    if (e.key === 'Escape') {
        const modal = document.getElementById('exec-modal');
        if (modal && modal.classList.contains('open')) {
            closeModal();
        }
    }
});

const undoLastAction = () => {
    if (actionHistory.length === 0) {
        showToast("Nothing to undo.");
        return;
    }

    const lastAction = actionHistory.pop();
    if (lastAction.type === 'delete') {
        loans = [...loans, ...lastAction.data];
        saveToLocalStorage();
        renderTableRows();
        showToast(`Restored ${lastAction.data.length} entries.`);
    }
};

// Bulk Actions Logic
window.toggleSelectAll = (source) => {
    const checkboxes = document.querySelectorAll('.entry-checkbox');
    checkboxes.forEach(cb => cb.checked = source.checked);
    updateBulkState();
};

window.updateBulkState = () => {
    const checkboxes = document.querySelectorAll('.entry-checkbox:checked');
    const btn = document.getElementById('bulk-delete-btn');
    const countSpan = document.getElementById('selected-count');

    if (btn && countSpan) { // Ensure elements exist before manipulating
        if (checkboxes.length > 0 && (currentUserRole === 'ADMIN' || currentUserRole === 'BACK_OFFICE')) {
            btn.style.display = 'inline-flex';
            countSpan.textContent = checkboxes.length;
        } else {
            btn.style.display = 'none';
        }
    }
};

window.deleteSelectedEntries = () => {
    const checkboxes = document.querySelectorAll('.entry-checkbox:checked');
    if (checkboxes.length === 0) return;

    if (confirm(`Are you sure you want to delete these ${checkboxes.length} entries?`)) {
        const idsToDelete = Array.from(checkboxes).map(cb => cb.value);
        const deletedItems = loans.filter(l => idsToDelete.includes(l.id));

        // Save to history for undo (local only for now)
        actionHistory.push({ type: 'delete', data: deletedItems });

        // Delete from Firestore
        Promise.all(idsToDelete.map(id => deleteDoc(doc(db, COLLECTION_NAME, id))))
            .then(() => {
                showToast(`Deleted ${deletedItems.length} entries from Firebase.`);
            })
            .catch(error => {
                console.error("Error deleting documents: ", error);
                alert("Failed to delete entries from Firebase.");
            });
    }
};

// Edit Logic
window.editEntry = (id) => {
    const loan = loans.find(l => l.id === id);
    if (!loan) {
        alert("Error: Entry not found in memory. Please refresh.");
        return;
    }

    editingId = id;

    // Scroll to top
    document.querySelector('.main-content').scrollTop = 0;

    // Populate Form
    document.getElementById('date').value = loan.date;
    document.getElementById('customerName').value = loan.customerName;
    document.getElementById('losNo').value = loan.losNo || '';
    document.getElementById('bankName').value = loan.bankName || '';
    document.getElementById('amount').value = loan.amount;
    document.getElementById('interestRate').value = loan.interestRate || '';
    document.getElementById('tenure').value = loan.tenure || '';
    document.getElementById('caseType').value = loan.caseType || '';
    document.getElementById('location').value = loan.location || '';
    document.getElementById('status').value = loan.status;
    document.getElementById('executiveName').value = loan.executiveName;
    document.getElementById('remarks').value = loan.remarks || '';

    // Re-lock if executive role ONLY (not Back Office)
    const execInput = document.getElementById('executiveName');
    if (execInput && currentUserRole === 'EXECUTIVE') {
        execInput.readOnly = true;
    } else if (execInput) {
        execInput.readOnly = false;
        execInput.style.backgroundColor = '';
        execInput.style.cursor = '';
    }

    // Update UI
    document.getElementById('form-title').textContent = 'Edit Case';
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.innerHTML = '<i class="fas fa-save"></i> Update Entry';
    submitBtn.classList.remove('btn-primary');
    submitBtn.classList.add('btn-success');
    // Removed undefined background-color override to allow class color to show

    document.getElementById('cancel-btn').style.display = 'inline-block';
};

window.cancelEdit = () => {
    editingId = null;
    document.getElementById('entry-form').reset();
    document.getElementById('date').valueAsDate = new Date(); // Reset to today
    document.getElementById('status').value = 'Underwriting';

    // Reset UI
    document.getElementById('form-title').textContent = 'Add New Case';
    const submitBtn = document.getElementById('submit-btn');
    submitBtn.innerHTML = '<i class="fas fa-plus"></i> Add Entry';
    submitBtn.classList.add('btn-primary');
    submitBtn.style.backgroundColor = '';

    document.getElementById('cancel-btn').style.display = 'none';
};

window.deleteEntry = (id) => {
    if (!id || id === 'undefined') {
        alert("CRITICAL ERROR: No ID provided to delete function!");
        return;
    }

    if (confirm('Are you sure you want to delete this entry?')) {
        const deletedItem = loans.find(l => l.id === id);

        if (!deletedItem) {
            alert(`DATA ERROR: Entry with ID [${id}] not found in the list. Current list has ${loans.length} items.`);
            return;
        }

        actionHistory.push({ type: 'delete', data: [deletedItem] });

        // Optimistic UI Update
        loans = loans.filter(l => l.id !== id);
        renderTableRows();

        const loanRef = doc(db, COLLECTION_NAME, id);
        deleteDoc(loanRef)
            .then(() => {
                showToast("Entry deleted from Firebase.");
            })
            .catch(error => {
                console.error("Firebase Delete Error:", error);
                // Revert optimistic update
                loans.push(deletedItem);
                renderTableRows();
                alert("SERVER REJECTION: " + error.message + " (Code: " + error.code + ")");
            });
    }
};

window.triggerImport = () => {
    document.getElementById('excel-input').click();
};

window.downloadImportTemplate = () => {
    const headers = [
        "Date (YYYY-MM-DD)", "Customer Name", "LOS No", "Bank Name", "Amount",
        "Tenure", "Interest Rate", "Case Type", "Location", "Status", "Executive Name", "Remarks"
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Template");
    XLSX.writeFile(wb, "SBE_Import_Template.xlsx");
};

window.handleExcelImport = (input) => {
    const file = input.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const data = new Uint8Array(e.target.result);
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { defval: "" });

            if (jsonData.length === 0) {
                alert("File appears to be empty.");
                return;
            }

            let importedCount = 0;

            // Helper to parse Excel dates (Serial or String)
            const parseExcelDate = (raw) => {
                if (!raw) return new Date().toISOString().split('T')[0];

                // Handle Excel Serial Date (Numbers like 44562)
                if (typeof raw === 'number') {
                    // Excel base date is Dec 30, 1899 (crazy, but true due to leap year bug)
                    const date = new Date(Math.round((raw - 25569) * 86400 * 1000));
                    return date.toISOString().split('T')[0];
                }

                // Handle Strings
                const date = new Date(raw);
                if (!isNaN(date.getTime())) {
                    return date.toISOString().split('T')[0];
                }

                // Fallback for custom formats if simple parse fails (e.g., DD/MM/YYYY)
                // This is a basic implementation; relying on ISO is safest
                return new Date().toISOString().split('T')[0];
            };

            jsonData.forEach(row => {
                // Fuzzy mapping for column names
                const getVal = (keys) => {
                    for (let k of keys) {
                        const found = Object.keys(row).find(rk => rk.toLowerCase().includes(k.toLowerCase()));
                        if (found) return row[found];
                    }
                    return "";
                };

                // Extract data
                const dateRaw = getVal(["Date"]);
                const customer = getVal(["Customer", "Name"]);
                const amountRaw = getVal(["Amount"]);

                if (customer && amountRaw) {
                    const finalDate = parseExcelDate(dateRaw);

                    const newEntry = {
                        id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                        date: finalDate,
                        customerName: customer,
                        losNo: getVal(["LOS", "Application"]),
                        bankName: getVal(["Bank"]),
                        amount: parseFloat(amountRaw) || 0,
                        tenure: getVal(["Tenure"]),
                        interestRate: parseFloat(getVal(["Rate", "Interest"])) || 0,
                        caseType: getVal(["Type", "Case"]),
                        location: getVal(["Location", "City"]),
                        status: getVal(["Status"]) || "Underwriting",
                        executiveName: getVal(["Executive"]) || "Unassigned",
                        remarks: getVal(["Remark", "Note"])
                    };
                    // Add to Firestore
                    addDoc(collection(db, COLLECTION_NAME), newEntry);
                    importedCount++;
                }
            });

            // saveToLocalStorage(); // Optional
            // renderTableRows(); // Handled by onSnapshot
            alert(`Successfully imported ${importedCount} records to Firebase!`);
        } catch (error) {
            console.error(error);
            alert("Error parsing Excel file. Please ensure it is a valid format.");
        }
    };
    reader.readAsArrayBuffer(file);
    input.value = ""; // Reset
};

window.exportToCSV = () => {
    if (loans.length === 0) {
        alert("No data to export!");
        return;
    }

    // CSV Headers
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Date,LOS No,Customer Name,Type,Bank,Amount,Tenure (M),Rate (%),Status,Executive,Location,Remarks\n";

    // CSV Rows
    loans.forEach(loan => {
        const row = [
            loan.date,
            `"${loan.losNo || ''}"`,
            `"${loan.customerName}"`,
            `"${loan.caseType || ''}"`,
            `"${loan.bankName || ''}"`,
            loan.amount,
            loan.tenure || 0,
            loan.interestRate || 0,
            loan.status,
            `"${loan.executiveName}"`,
            `"${loan.location || ''}"`,
            `"${loan.remarks || ''}"`
        ].join(",");
        csvContent += row + "\r\n";
    });

    // Create Download Link
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `SBE_Data_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

// Dashboard Filter State
let dashboardDateFilter = { start: '', end: '' };

// --- VIEW: OWNER DASHBOARD ---
const renderDashboardPage = () => {
    pageTitle.textContent = 'Owner Dashboard';

    const executiveStats = {};
    let totalCompanyAmount = 0;

    loans.forEach(loan => {
        // Date Filter Logic
        if (dashboardDateFilter.start && dashboardDateFilter.end) {
            if (loan.date < dashboardDateFilter.start || loan.date > dashboardDateFilter.end) {
                return; // Skip this loan if outside range
            }
        }

        // Count all non-rejected files as "Work Done"
        const isFileProcessed = loan.status !== 'Rejected';

        // Only calculate VOLUME for "Disbursed" cases
        const isDisbursed = loan.status === 'Disbursed';

        if (!executiveStats[loan.executiveName]) {
            executiveStats[loan.executiveName] = {
                name: loan.executiveName,
                count: 0,
                disbursedCount: 0,
                totalAmount: 0,
                loans: []
            };
        }

        if (isFileProcessed) {
            executiveStats[loan.executiveName].count++;
        }

        if (isDisbursed) {
            executiveStats[loan.executiveName].disbursedCount++;
            executiveStats[loan.executiveName].totalAmount += loan.amount;
            totalCompanyAmount += loan.amount;
        }

        executiveStats[loan.executiveName].loans.push(loan);
    });

    const totalDisbursedFiles = Object.values(executiveStats).reduce((sum, e) => sum + e.disbursedCount, 0);
    const totalProcessedFiles = Object.values(executiveStats).reduce((sum, e) => sum + e.count, 0);

    const execArray = Object.values(executiveStats).sort((a, b) => b.totalAmount - a.totalAmount);

    const container = document.createElement('div');

    // Date Filter UI
    const filterHtml = `
        <div class="card" style="margin-bottom:1.5rem; display:flex; flex-wrap:wrap; gap:1rem; align-items:center;">
            <div style="font-weight:600; color:var(--text-secondary);"><i class="far fa-calendar-alt"></i> Filter by Date:</div>
            <input type="date" id="startDate" class="form-control" style="width:auto;" value="${dashboardDateFilter.start}">
            <span style="color:var(--text-secondary);">to</span>
            <input type="date" id="endDate" class="form-control" style="width:auto;" value="${dashboardDateFilter.end}">
            <button class="btn btn-primary" onclick="applyDashboardFilter()" style="padding:0.4rem 1rem; font-size:0.9rem;">Apply</button>
            <button class="btn btn-danger" onclick="clearDashboardFilter()" style="padding:0.4rem 1rem; font-size:0.9rem; background: #e5e7eb; color: #374151; border:none;">Clear</button>
        </div>
    `;

    // Top Summary
    const summaryHtml = `
        <div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap:1.5rem; margin-bottom:2rem;">
            <!-- Formal Volume Card -->
            <div class="card" style="background: white; padding:1.5rem; margin-bottom:0; border:1px solid #e2e8f0; border-top: 4px solid #0f172a; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                        <h3 style="color:#64748b; font-size:0.85rem; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.5rem;">Total Business Volume</h3>
                        <h1 style="color:#0f172a; font-size:2.2rem; font-weight:700; margin-bottom:0; letter-spacing:-0.03em;">${formatCurrency(totalCompanyAmount)}</h1>
                        ${dashboardDateFilter.start ? `
                        <div style="margin-top:0.75rem; display:inline-flex; align-items:center; background:#f8fafc; border:1px solid #e2e8f0; padding:4px 8px; border-radius:4px;">
                            <i class="far fa-calendar-alt" style="color:#64748b; font-size:0.75rem; margin-right:6px;"></i>
                            <span style="color:#334155; font-size:0.75rem; font-weight:600;">${formatDate(dashboardDateFilter.start)} - ${formatDate(dashboardDateFilter.end)}</span>
                        </div>` : ''}
                    </div>
                    <div style="width:48px; height:48px; background:#f1f5f9; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#0f172a;">
                        <i class="fas fa-chart-pie" style="font-size:1.2rem;"></i>
                    </div>
                </div>
            </div>

            <!-- Total Disbursed Files Card -->
            <div class="card" style="background: white; padding:1.5rem; margin-bottom:0; border:1px solid #e2e8f0; border-top: 4px solid #4f46e5; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                        <h3 style="color:#64748b; font-size:0.85rem; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.5rem;">Total Disbursed Files</h3>
                        <h1 style="color:#4f46e5; font-size:2.2rem; font-weight:700; margin-bottom:0; letter-spacing:-0.03em;">${totalDisbursedFiles}</h1>
                    </div>
                    <div style="width:48px; height:48px; background:#eef2ff; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#4f46e5;">
                        <i class="fas fa-check-circle" style="font-size:1.2rem;"></i>
                    </div>
                </div>
            </div>

            <!-- Total Processed Files Card -->
            <div class="card" style="background: white; padding:1.5rem; margin-bottom:0; border:1px solid #e2e8f0; border-top: 4px solid #64748b; box-shadow: 0 1px 3px rgba(0,0,0,0.05);">
                <div style="display:flex; justify-content:space-between; align-items:start;">
                    <div>
                        <h3 style="color:#64748b; font-size:0.85rem; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.5rem;">Total Files</h3>
                        <h1 style="color:#0f172a; font-size:2.2rem; font-weight:700; margin-bottom:0; letter-spacing:-0.03em;">${totalProcessedFiles}</h1>
                    </div>
                    <div style="width:48px; height:48px; background:#f1f5f9; border-radius:8px; display:flex; align-items:center; justify-content:center; color:#64748b;">
                        <i class="fas fa-file-alt" style="font-size:1.2rem;"></i>
                    </div>
                </div>
            </div>
        </div>
    `;

    // Grid of Executives
    const gridHtml = `
        <h3 style="margin-bottom:1rem; color:var(--text-secondary);">Executive Performance</h3>
        <div class="stats-grid">
            ${execArray.map(exec => `
                <div class="stat-card" onclick="openExecutiveDetails('${exec.name}')">
                    <div class="stat-info">
                        <h3>${exec.name}</h3>
                        <p>${formatCurrency(exec.totalAmount)}</p>
                        <div style="font-size:0.85rem; color:var(--text-secondary); margin-top:0.5rem; display:flex; gap:10px;">
                            <span><i class="fas fa-check-circle" style="color:#4f46e5;"></i> ${exec.disbursedCount} Disbursed</span>
                            <span><i class="fas fa-file-alt"></i> ${exec.count} Total</span>
                        </div>
                    </div>
                    <div class="stat-icon">
                        <i class="fas fa-user-tie"></i>
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    const modalHtml = `
        <div id="exec-modal" class="modal-overlay">
            <div class="modal modal-xl">
                <button class="close-modal" onclick="closeModal()">&times;</button>
                <div id="modal-content"></div>
            </div>
        </div>
    `;

    container.innerHTML = filterHtml + summaryHtml + gridHtml + modalHtml;
    contentArea.appendChild(container);
};

window.applyDashboardFilter = () => {
    const start = document.getElementById('startDate').value;
    const end = document.getElementById('endDate').value;

    if (start && end) {
        dashboardDateFilter = { start, end };
        loadView('dashboard'); // Use loadView to ensure clean render
    } else {
        alert("Please select both Start and End date.");
    }
};

window.clearDashboardFilter = () => {
    dashboardDateFilter = { start: '', end: '' };
    loadView('dashboard'); // Use loadView to ensure clean render
};

window.openExecutiveDetails = (name) => {
    const execLoans = loans.filter(l => l.executiveName === name);

    // Calculate totals
    const totalVolume = execLoans.reduce((sum, l) => l.status !== 'Rejected' ? sum + l.amount : sum, 0);
    const totalRevenue = execLoans.reduce((sum, l) => {
        if (l.status === 'Disbursed') {
            const payout = l.payoutPercent || 0;
            return sum + (l.amount * payout / 100);
        }
        return sum;
    }, 0);

    const uniqueBanks = [...new Set(execLoans.map(l => l.bankName).filter(Boolean))];

    const content = `
        <h2 style="margin-bottom:0.5rem; color:var(--primary-color);">${name}</h2>
        <p style="margin-bottom:1.5rem; color:var(--text-secondary);">Performance Report</p>
        
        <!-- Stats Grid -->
        <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:1rem; margin-bottom:1.5rem;">
            <div style="background:#f8fafc; padding:1rem; border-radius:8px;">
                <small>Volume</small>
                <div style="font-size:1.1rem; font-weight:bold;">${formatCurrency(totalVolume)}</div>
            </div>
            <div style="background:#f8fafc; padding:1rem; border-radius:8px;">
                <small>Files</small>
                <div style="font-size:1.1rem; font-weight:bold;">${execLoans.length}</div>
            </div>
            <div style="background:#ecfdf5; padding:1rem; border-radius:8px; border:1px solid #d1fae5;">
                <small style="color:#047857;">Est. Revenue</small>
                <div style="font-size:1.1rem; font-weight:bold; color:#047857;">${formatCurrency(totalRevenue)}</div>
            </div>
        </div>

        <!-- Bank Payout Config -->
        <div style="background:#f0f9ff; padding:1rem; border-radius:8px; border:1px solid #bae6fd; margin-bottom:1.5rem;">
            <h4 style="margin-top:0; color:#0369a1; margin-bottom:0.5rem; font-size:0.9rem;">Set Payouts by Bank</h4>
            <div style="display:flex; flex-wrap:wrap; gap:1rem; align-items:end;">
                ${uniqueBanks.map((bank, index) => `
                    <div style="display:flex; align-items:center; gap:4px;">
                        <div>
                            <label style="display:block; font-size:0.75rem; color:#0369a1; margin-bottom:2px;">${bank}</label>
                            <div style="display:flex; align-items:center; gap:4px;">
                                <input type="number" step="0.01" id="payout-bank-${index}" placeholder="%" 
                                    style="padding:4px; border:1px solid #7dd3fc; border-radius:4px; width:60px;"
                                    onkeypress="if(event.key==='Enter') updateBankPayouts('${name}')">
                                <span style="color:#0369a1; font-weight:600; font-size:0.85rem;">%</span>
                            </div>
                        </div>
                        <input type="hidden" id="name-bank-${index}" value="${bank}">
                    </div>
                `).join('')}
                <button onclick="updateBankPayouts('${name}')" class="btn btn-primary" style="padding:4px 12px; font-size:0.85rem; height:32px; background-color:#0284c7; border:none;">Apply to All</button>
            </div>
            <small style="color:#0c4a6e; display:block; margin-top:0.5rem; font-size:0.75rem;">* Entering a value here will update the Payout % for ALL files of that bank.</small>
        </div>

        <!-- Loans Table -->
        <div style="overflow-x:auto;">
            <table style="font-size:0.85rem; width:100%;">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th>Customer</th>
                        <th>Bank</th>
                        <th>Status</th>
                        <th>Amount</th>
                        <th style="width:80px;">Payout %</th>
                        <th>Revenue</th>
                    </tr>
                </thead>
                <tbody>
                    ${execLoans.map(l => {
        const payout = l.payoutPercent || 0;
        const revenue = l.status === 'Disbursed' ? (l.amount * payout / 100) : 0;
        return `
                        <tr>
                            <td>${formatDate(l.date)}</td>
                            <td>${l.customerName}</td>
                            <td>${l.bankName || '-'}</td>
                            <td><span class="status-badge ${getStatusClass(l.status)}">${l.status}</span></td>
                            <td class="amount">${formatCurrency(l.amount)}</td>
                            <td>
                                <input type="number" step="0.01" min="0" 
                                    value="${payout || ''}" 
                                    placeholder="0"
                                    style="width:60px; padding:4px; border:1px solid #ccc; border-radius:4px;"
                                    onchange="updateLoanPayout('${l.id}', this.value, '${name}')"
                                    ${l.status !== 'Disbursed' ? 'disabled' : ''}
                                >
                            </td>
                            <td style="font-weight:600; color:${revenue > 0 ? '#047857' : 'inherit'};">
                                ${formatCurrency(revenue)}
                            </td>
                        </tr>
                        `;
    }).join('')}
                </tbody>
            </table>
        </div>
    `;

    document.getElementById('modal-content').innerHTML = content;
    document.getElementById('exec-modal').classList.add('open');
};

window.updateBankPayouts = (execName) => {
    const execLoans = loans.filter(l => l.executiveName === execName);
    const uniqueBanks = [...new Set(execLoans.map(l => l.bankName).filter(Boolean))];
    let updatedCount = 0;

    // Store the input values BEFORE refreshing
    const bankValues = {};
    uniqueBanks.forEach((bank, index) => {
        const inputVal = document.getElementById(`payout-bank-${index}`)?.value;
        if (inputVal !== '' && inputVal !== null) {
            bankValues[bank] = inputVal;
            const percent = parseFloat(inputVal);
            // Update all loans for this exec and bank (only Disbursed ones)
            loans.forEach(l => {
                if (l.executiveName === execName && l.bankName === bank && l.status === 'Disbursed') {
                    l.payoutPercent = percent;
                    updatedCount++;
                }
            });
        }
    });

    if (updatedCount > 0) {
        // Update all modified loans in Firestore
        const updatePromises = [];
        loans.forEach(l => {
            if (l.executiveName === execName && bankValues[l.bankName] && l.status === 'Disbursed') {
                const loanRef = doc(db, COLLECTION_NAME, l.id);
                updatePromises.push(updateDoc(loanRef, { payoutPercent: parseFloat(bankValues[l.bankName]) }));
            }
        });

        Promise.all(updatePromises).then(() => {
            showToast(`Updated ${updatedCount} payouts in Firebase.`);
            openExecutiveDetails(execName);
        }).catch(error => {
            console.error("Error updating bank payouts: ", error);
            alert("Failed to update payouts in Firebase.");
        });

        // Restore the input values after modal refresh
        setTimeout(() => {
            uniqueBanks.forEach((bank, index) => {
                if (bankValues[bank]) {
                    const input = document.getElementById(`payout-bank-${index}`);
                    if (input) input.value = bankValues[bank];
                }
            });
        }, 100);
    } else {
        alert("Please enter a percentage for at least one bank.");
    }
};

window.updateLoanPayout = (loanId, percent, execName) => {
    const loanRef = doc(db, COLLECTION_NAME, loanId);
    updateDoc(loanRef, { payoutPercent: parseFloat(percent) || 0 })
        .then(() => {
            // Toast not needed here as it might be annoying while typing
            // but onSnapshot will trigger a re-render of the modal
            openExecutiveDetails(execName);
        })
        .catch(error => {
            console.error("Error updating payout: ", error);
        });
};

window.closeModal = () => {
    document.getElementById('exec-modal').classList.remove('open');
};

// --- AUTHENTICATION LOGIC ---

if (loginForm) {
    console.log("Login form found");
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const email = document.getElementById('login-email').value;
        const password = document.getElementById('login-password').value;
        console.log("Attempting email login...");

        signInWithEmailAndPassword(auth, email, password)
            .then(() => {
                console.log("Email login successful");
                authError.style.display = 'none';
            })
            .catch((error) => {
                console.error("Email login error:", error);
                authError.textContent = "Invalid email or password. " + error.message;
                authError.style.display = 'block';
            });
    });
}


if (googleLoginBtn) {
    console.log("Google login button found");
    googleLoginBtn.addEventListener('click', () => {
        console.log("Attempting Google login...");
        signInWithPopup(auth, googleProvider)
            .then(() => {
                console.log("Google login successful");
                authError.style.display = 'none';
            })
            .catch((error) => {
                console.error("Google login error:", error);
                authError.textContent = "Google sign-in failed. " + error.message;
                authError.style.display = 'block';
            });
    });
} else {
    console.error("Google login button NOT found!");
}

if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        signOut(auth).then(() => {
            location.reload(); // Refresh to clear state
        });
    });
}

// Global listener for Firestore subscription to close it on logout
let unsubscribeData = null;

// Monitor Auth State
// Monitor Auth State
onAuthStateChanged(auth, async (user) => {
    if (user) {
        console.log("Checking authorization for:", user.email);

        // ADMIN HARDCODE: Ensure you are always an admin
        const isAdmin = user.email === 'sharmashubham22657@gmail.com';

        try {
            // Check Users collection
            const userDoc = await getDocs(query(collection(db, 'Users')));
            authorizedUsers = userDoc.docs.map(d => ({ ...d.data(), id: d.id }));

            const userData = authorizedUsers.find(u => u.email.toLowerCase() === user.email.toLowerCase());

            if (!userData && !isAdmin) {
                alert("ACCESS DENIED: You are not authorized to access this system. Contact the administrator.");
                signOut(auth);
                return;
            }

            currentUserRole = isAdmin ? 'ADMIN' : (userData?.role || 'EXECUTIVE');
            assignedName = userData?.assignedName || (isAdmin ? 'Admin' : null);

            proceedWithLogin(user, isAdmin);

        } catch (error) {
            console.error("Auth Verification Error:", error);
            // Even if User collection check fails (e.g. permission error), the Hardcoded Admin must still work
            if (isAdmin) {
                currentUserRole = 'ADMIN';
                assignedName = 'Admin';
                proceedWithLogin(user, isAdmin);
            } else {
                alert("CRITICAL AUTH ERROR: " + error.message);
                signOut(auth);
            }
        }
    } else {
        document.body.classList.add('not-logged-in');
        document.body.classList.remove('logged-in');
        currentUserRole = null;
        assignedName = null;
        if (unsubscribeData) {
            unsubscribeData();
            unsubscribeData = null;
        }
    }
});

const proceedWithLogin = (user, isAdmin) => {
    // Update Header Profile
    const profileName = document.getElementById('user-display-name');
    const profileRole = document.getElementById('user-display-role');
    const profileIcon = document.getElementById('user-display-icon');

    if (profileName) profileName.textContent = user.displayName || user.email.split('@')[0];
    if (profileRole) {
        if (currentUserRole === 'ADMIN') profileRole.textContent = 'Owner / Admin';
        else if (currentUserRole === 'BACK_OFFICE') profileRole.textContent = `Back Office (${assignedName || 'Main'})`;
        else profileRole.textContent = `Executive (${assignedName || 'Unassigned'})`;
    }
    if (profileIcon) {
        profileIcon.innerHTML = `<i class="fas ${currentUserRole === 'ADMIN' ? 'fa-user-shield' : 'fa-user'}"></i>`;
        profileIcon.style.background = currentUserRole === 'ADMIN'
            ? 'linear-gradient(135deg, var(--accent-color), var(--accent-hover))'
            : 'linear-gradient(135deg, var(--primary-color), var(--primary-light))';
    }

    document.body.classList.remove('not-logged-in');
    document.body.classList.add('logged-in');

    // UI Adjustments based on role
    const dashboardTab = document.querySelector('.nav-item[data-view="dashboard"]');
    if (currentUserRole !== 'ADMIN') {
        if (dashboardTab) dashboardTab.style.display = 'none';
    } else {
        if (dashboardTab) dashboardTab.style.display = 'flex';
        // Add Users tab if not exists
        if (!document.querySelector('.nav-item[data-view="users"]')) {
            const navLinks = document.querySelector('.nav-links');
            const usersTab = document.createElement('li');
            usersTab.className = 'nav-item';
            usersTab.setAttribute('data-view', 'users');
            usersTab.innerHTML = '<i class="fas fa-users-cog"></i> <span>Manage Users</span>';
            usersTab.addEventListener('click', () => {
                loadView('users');
            });
            navLinks.appendChild(usersTab);
        }
    }

    loadView('entry');

    // Start Firestore Subscription - ROLE BASED QUERY
    const colRef = collection(db, COLLECTION_NAME);
    let q = query(colRef, orderBy('date', 'desc'));

    if (currentUserRole === 'EXECUTIVE' && assignedName) {
        console.log("FIRESTORE: Applying filter for", assignedName);
        q = query(colRef, where('executiveName', '==', assignedName));
    }

    // Update Sidebar visibility for Admin tools
    const adminSidebar = document.getElementById('admin-actions-sidebar');
    if (adminSidebar) adminSidebar.style.display = (currentUserRole === 'ADMIN') ? 'block' : 'none';

    // Show Diagnostic button for Admin
    const adminDebugBtn = document.getElementById('admin-debug-btn');
    if (adminDebugBtn) adminDebugBtn.style.display = (currentUserRole === 'ADMIN') ? 'block' : 'none';

    // Cleanup previous subscription if any
    if (unsubscribeData) unsubscribeData();

    unsubscribeData = onSnapshot(q, (snapshot) => {
        loans = snapshot.docs.map(doc => ({
            ...doc.data(),
            id: doc.id
        }));

        loans.sort((a, b) => new Date(b.date) - new Date(a.date));
        renderTableRows();

        const activeNav = document.querySelector('.nav-item.active');
        if (activeNav) {
            const view = activeNav.getAttribute('data-view');
            if (view === 'dashboard' && currentUserRole === 'ADMIN') renderDashboardPage();
            if (view === 'users' && currentUserRole === 'ADMIN') renderUserManagement();
        }
    }, (error) => {
        console.error("Firestore Snapshot Error:", error.code, error.message);
        alert("REAL-TIME SYNC ERROR: " + error.message + "\nCode: " + error.code);
    });
};

// User Management View
const renderUserManagement = () => {
    pageTitle.textContent = 'User Management';
    contentArea.innerHTML = `
        <div class="card">
            <h3>Authorize New User</h3>
            <form id="add-user-form" style="margin-top:1.5rem;">
                <div class="form-row">
                    <div>
                        <label>Google Email</label>
                        <input type="email" id="newUserEmail" class="form-control" placeholder="user@gmail.com" required>
                    </div>
                    <div>
                        <label>Assigned Name (Must match Daily Entry exactly)</label>
                        <input type="text" id="newUserAssignedName" class="form-control" placeholder="Executive Name" required>
                    </div>
                    <div>
                        <label>Role</label>
                        <select id="newUserRole" class="form-control">
                            <option value="EXECUTIVE">Executive (Own files, read only)</option>
                            <option value="BACK_OFFICE">Back Office (All files, can add)</option>
                            <option value="ADMIN">Admin (Sees and does everything)</option>
                        </select>
                    </div>
                </div>
                <button type="submit" class="btn btn-primary" style="margin-top:1rem;"><i class="fas fa-user-plus"></i> Grant Access</button>
            </form>
        </div>

        <div class="card">
            <h3 style="margin-bottom:1.5rem;">Authorized Users</h3>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Email</th>
                            <th>Assigned Name</th>
                            <th>Role</th>
                            <th>Action</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${authorizedUsers.map(user => `
                            <tr>
                                <td>${user.email}</td>
                                <td>${user.assignedName}</td>
                                <td><span class="status-badge ${user.role === 'ADMIN' ? 'status-approved' : 'status-forward'}">${user.role}</span></td>
                                <td>
                                    ${user.email === 'sharmashubham22657@gmail.com' ? '<span style="color:var(--text-secondary)">System Owner</span>' : `
                                        <button onclick="deleteUser('${user.id}')" class="btn btn-danger" style="padding:0.4rem 0.8rem; font-size:0.8rem;">
                                            <i class="fas fa-trash"></i> Revoke Access
                                        </button>
                                    `}
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;

    document.getElementById('add-user-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('newUserEmail').value.trim().toLowerCase();
        const assignedName = document.getElementById('newUserAssignedName').value.trim();
        const role = document.getElementById('newUserRole').value;

        try {
            // Use setDoc with email as ID for better rules management
            const userRef = doc(db, 'Users', email);
            await setDoc(userRef, {
                email,
                assignedName,
                role,
                createdAt: new Date().toISOString()
            });
            showToast("Access granted successfully.");
            // Refresh users list
            const userDoc = await getDocs(query(collection(db, 'Users')));
            authorizedUsers = userDoc.docs.map(d => ({ ...d.data(), id: d.id }));
            renderUserManagement();
        } catch (error) {
            alert("Error granting access: " + error.message);
        }
    });
};

window.deleteUser = async (id) => {
    if (!id) {
        alert("Error: No User ID provided for deletion.");
        return;
    }
    if (confirm("Are you sure you want to revoke access for this email?")) {
        try {
            // Optimistic Update
            authorizedUsers = authorizedUsers.filter(u => u.id !== id);
            renderUserManagement();

            await deleteDoc(doc(db, 'Users', id));
            showToast("Access revoked. User will be logged out.");

            // Re-fetch to confirm
            const userDoc = await getDocs(query(collection(db, 'Users')));
            authorizedUsers = userDoc.docs.map(d => ({ ...d.data(), id: d.id }));
            renderUserManagement();
        } catch (error) {
            console.error("Delete User Error:", error);
            // Revert
            const userDoc = await getDocs(query(collection(db, 'Users')));
            authorizedUsers = userDoc.docs.map(d => ({ ...d.data(), id: d.id }));
            renderUserManagement();

            alert("SERVER REJECTION: " + error.message);
        }
    }
};

// Emergency Admin Switch (Use only if database permissions fail)
window.debugAppStatus = () => {
    console.log("--- APP STATUS ---");
    console.log("Logged In:", !!auth.currentUser);
    console.log("User Email:", auth.currentUser?.email);
    console.log("Role:", currentUserRole);
    console.log("Assigned Name:", assignedName);
    console.log("Loans Count:", loans.length);
    console.log("Authorized Users:", authorizedUsers);

    alert(`Status Check:\nEmail: ${auth.currentUser?.email}\nRole: ${currentUserRole}\nFiles Loaded: ${loans.length}`);
};

// Tool to test deletion permission specifically
window.testDeletePermission = async (loanId) => {
    if (!loanId) {
        alert("Please provide a Loan ID to test.");
        return;
    }
    const loanRef = doc(db, COLLECTION_NAME, loanId);
    try {
        // We try to update a dummy field to test write permission without deleting
        await updateDoc(loanRef, { _lastTest: new Date().toISOString() });
        alert("PERMISSION CHECK: You HAVE write/delete access for this file.");
    } catch (error) {
        alert("PERMISSION CHECK: ACCESS DENIED.\nReason: " + error.message + "\n\nThis confirms your Firestore Security Rules are blocking you.");
    }
};
