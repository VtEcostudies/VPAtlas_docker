/*
    filter_bar.js - Filter bar with token/chip pattern for VPAtlas

    Selected filters appear as removable tokens below the filter inputs.
    Town/county selectors support type-ahead filtering of the dropdown list
    and multi-select (each selection adds a token).

    Token pattern adapted from CSWG BeeWiki beewiki-filters.js.
*/
import { filters, putUserState, buildSearchTerm, DEFAULT_STATUSES, DATA_TYPES } from './url_state.js';
import { fetchTowns, fetchCounties, fetchPools, fetchMappedPoolStats } from './api.js';
import { getUser } from './auth.js';

var onFilterChange = null;
var typeaheadTimer = null;
var allTowns = [];
var allCounties = [];

// =============================================================================
// INIT
// =============================================================================
export function initFilterBar(filterCallback) {
    onFilterChange = filterCallback;

    const container = document.getElementById('filter_container');
    if (!container) return;

    container.innerHTML = `
        <div id="filter-bar" style="display:flex; flex-wrap:wrap; gap:5px; align-items:center;">
            <!-- Primary data-type buttons -->
            <div id="data-type-buttons" class="data-type-group"></div>

            <div style="width:1px; height:24px; background:#ccc; margin:0 3px;"></div>

            <!-- Pool ID search -->
            <div style="position:relative;">
                <input type="text" id="filter_pool_id"
                    placeholder="Pool ID..." autocomplete="off"
                    style="font-size:15px; padding:5px 28px 5px 8px; border:1px solid var(--primary-color); border-radius:8px; width:140px;">
                <button id="filter_pool_id_clear" class="input-clear-btn" style="display:none;">&times;</button>
                <div id="pool_id_suggestions" class="dropdown-suggestions"></div>
            </div>

            <!-- Town type-ahead -->
            <div style="position:relative;">
                <input type="text" id="filter_town"
                    placeholder="Town..." autocomplete="off"
                    style="font-size:15px; padding:5px 8px; border:1px solid var(--primary-color); border-radius:8px; width:130px;">
                <div id="town_suggestions" class="dropdown-suggestions"></div>
            </div>

            <!-- County type-ahead -->
            <div style="position:relative;">
                <input type="text" id="filter_county"
                    placeholder="County..." autocomplete="off"
                    style="font-size:15px; padding:5px 8px; border:1px solid var(--primary-color); border-radius:8px; width:130px;">
                <div id="county_suggestions" class="dropdown-suggestions"></div>
            </div>

            <!-- Status dropdown (multi-select checkboxes) -->
            <div id="status-filter" style="position:relative;">
                <label id="status-label" class="filter-dropdown-btn">
                    Status <i class="fa fa-caret-down"></i>
                </label>
                <div id="status-panel" class="dropdown-panel"></div>
            </div>
        </div>

        <!-- Active filter tokens -->
        <div id="filter-tokens" class="filter-tokens"></div>
    `;

    // Pool ID type-ahead
    setupPoolIdSearch();

    // Town type-ahead (multi-select)
    setupTypeAhead('filter_town', 'town_suggestions', () => allTowns, (name) => {
        if (!filters.townNames.includes(name)) {
            filters.townNames.push(name);
            putUserState(1, { townNames: filters.townNames });
            document.getElementById('filter_town').value = '';
            renderTokens();
            applyFilters();
        }
    });

    // County type-ahead (multi-select)
    setupTypeAhead('filter_county', 'county_suggestions', () => allCounties, (name) => {
        if (!filters.countyNames.includes(name)) {
            filters.countyNames.push(name);
            putUserState(1, { countyNames: filters.countyNames });
            document.getElementById('filter_county').value = '';
            renderTokens();
            applyFilters();
        }
    });

    // Data-type buttons (All, Visited, Monitored, Mine, Review)
    populateDataTypeButtons();

    // Status checkboxes
    populateStatusOptions();

    // Load reference data
    loadTowns();
    loadCounties();

    // Close dropdowns on outside click
    document.addEventListener('click', (e) => {
        document.querySelectorAll('.dropdown-suggestions, .dropdown-panel').forEach(el => {
            if (!el.parentElement.contains(e.target)) el.style.display = 'none';
        });
    });

    // Listen for map boundary clicks to toggle filters
    document.addEventListener('map:town-click', (e) => {
        let name = e.detail.name;
        if (!name) return;
        // Toggle: if already filtered, remove; otherwise add
        if (filters.townNames.includes(name)) {
            filters.townNames = filters.townNames.filter(n => n !== name);
        } else {
            filters.townNames.push(name);
        }
        putUserState(1, { townNames: filters.townNames });
        renderTokens();
        applyFilters();
    });

    document.addEventListener('map:county-click', (e) => {
        let name = e.detail.name;
        if (!name) return;
        if (filters.countyNames.includes(name)) {
            filters.countyNames = filters.countyNames.filter(n => n !== name);
        } else {
            filters.countyNames.push(name);
        }
        putUserState(1, { countyNames: filters.countyNames });
        renderTokens();
        applyFilters();
    });

    // Render initial tokens from loaded filters
    if (filters.poolIdSearch) document.getElementById('filter_pool_id').value = filters.poolIdSearch;
    renderTokens();
}

// =============================================================================
// DATA-TYPE BUTTONS (All, Visited, Monitored, Mine, Review)
// =============================================================================
async function populateDataTypeButtons() {
    let container = document.getElementById('data-type-buttons');
    if (!container) return;

    let user = await getUser();
    let stats = null;
    try {
        let res = await fetchMappedPoolStats();
        if (res.rows && res.rows[0]) stats = res.rows[0];
    } catch(err) {}

    let buttonDefs = [
        { value: 'All',       label: 'All',       count: stats?.total,     show: true },
        { value: 'Visited',   label: 'Visited',   count: stats?.visited,   show: true },
        { value: 'Monitored', label: 'Monitored', count: stats?.monitored, show: true },
        { value: 'Mine',      label: 'Mine',      count: stats?.mine,      show: !!user },
        { value: 'Review',    label: 'Review',    count: stats?.review,    show: !!user },
    ];

    buttonDefs.forEach(def => {
        if (!def.show) return;
        let btn = document.createElement('button');
        btn.className = 'data-type-btn' + (filters.dataType === def.value ? ' active' : '');
        btn.dataset.value = def.value;
        let countStr = def.count != null ? ` (${Number(def.count).toLocaleString()})` : '';
        btn.textContent = def.label + countStr;
        btn.addEventListener('click', () => {
            filters.dataType = def.value;
            putUserState(1, { dataType: def.value });
            // Update active state
            container.querySelectorAll('.data-type-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyFilters();
        });
        container.appendChild(btn);
    });
}

// =============================================================================
// POOL ID SEARCH (type-ahead with ILIKE)
// =============================================================================
function setupPoolIdSearch() {
    let input = document.getElementById('filter_pool_id');
    let clearBtn = document.getElementById('filter_pool_id_clear');
    let sugBox = document.getElementById('pool_id_suggestions');

    input.addEventListener('input', () => {
        let val = input.value.trim();
        clearBtn.style.display = val ? 'block' : 'none';
        clearTimeout(typeaheadTimer);
        if (val.length >= 2) {
            typeaheadTimer = setTimeout(() => fetchPoolSuggestions(val, sugBox), 300);
        } else {
            sugBox.style.display = 'none';
        }
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            sugBox.style.display = 'none';
            filters.poolIdSearch = input.value.trim();
            putUserState(1, { poolIdSearch: filters.poolIdSearch });
            renderTokens();
            applyFilters();
        }
    });

    clearBtn.addEventListener('click', () => {
        input.value = '';
        clearBtn.style.display = 'none';
        sugBox.style.display = 'none';
        filters.poolIdSearch = '';
        putUserState(1, { poolIdSearch: '' });
        renderTokens();
        applyFilters();
    });
}

async function fetchPoolSuggestions(text, sugBox) {
    try {
        let data = await fetchPools(`mappedPoolId|ILIKE=%${text}%&limit=15`);
        let rows = data.rows || [];
        if (!rows.length) {
            sugBox.innerHTML = '<div class="suggestion-empty">No matches</div>';
            sugBox.style.display = 'block';
            return;
        }
        let seen = new Set();
        let html = '';
        rows.forEach(row => {
            let id = row.poolId || row.mappedPoolId || '';
            let town = row.townName || '';
            if (id && !seen.has(id)) {
                seen.add(id);
                html += `<div class="suggestion-item" data-value="${id}">
                    <strong>${id}</strong> <span style="color:#888; font-size:12px;">${town}</span>
                </div>`;
            }
        });
        sugBox.innerHTML = html;
        sugBox.style.display = 'block';
        sugBox.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                let val = item.dataset.value;
                document.getElementById('filter_pool_id').value = val;
                document.getElementById('filter_pool_id_clear').style.display = 'block';
                sugBox.style.display = 'none';
                filters.poolIdSearch = val;
                putUserState(1, { poolIdSearch: val });
                renderTokens();
                applyFilters();
            });
        });
    } catch(err) {
        sugBox.style.display = 'none';
    }
}

// =============================================================================
// GENERIC TYPE-AHEAD (for town/county multi-select)
// =============================================================================
function setupTypeAhead(inputId, sugBoxId, getListFn, onSelectFn) {
    let input = document.getElementById(inputId);
    let sugBox = document.getElementById(sugBoxId);

    input.addEventListener('input', () => {
        let val = input.value.trim().toLowerCase();
        if (val.length < 1) { sugBox.style.display = 'none'; return; }
        let list = getListFn();
        let matches = list.filter(name => name.toLowerCase().includes(val)).slice(0, 15);
        if (!matches.length) {
            sugBox.innerHTML = '<div class="suggestion-empty">No matches</div>';
            sugBox.style.display = 'block';
            return;
        }
        sugBox.innerHTML = matches.map(name =>
            `<div class="suggestion-item" data-value="${name}">${name}</div>`
        ).join('');
        sugBox.style.display = 'block';
        sugBox.querySelectorAll('.suggestion-item').forEach(item => {
            item.addEventListener('click', () => {
                sugBox.style.display = 'none';
                onSelectFn(item.dataset.value);
            });
        });
    });

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // Select first visible suggestion
            let first = sugBox.querySelector('.suggestion-item');
            if (first) {
                sugBox.style.display = 'none';
                onSelectFn(first.dataset.value);
            }
        }
    });

    input.addEventListener('focus', () => {
        if (input.value.trim().length >= 1) input.dispatchEvent(new Event('input'));
    });
}

// =============================================================================
// STATUS CHECKBOXES
// =============================================================================
function populateStatusOptions() {
    let panel = document.getElementById('status-panel');
    let allStatuses = ['Potential', 'Probable', 'Confirmed', 'Duplicate', 'Eliminated'];

    allStatuses.forEach(status => {
        let label = document.createElement('label');
        label.className = 'dropdown-check-label';
        let cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.name = 'pool_status';
        cb.value = status;
        cb.checked = filters.poolStatuses.includes(status);
        cb.addEventListener('change', () => {
            filters.poolStatuses = Array.from(
                document.querySelectorAll('input[name="pool_status"]:checked')
            ).map(c => c.value);
            putUserState(1, { poolStatuses: filters.poolStatuses });
            renderTokens();
            applyFilters();
        });
        label.appendChild(cb);
        label.appendChild(document.createTextNode(' ' + status));
        panel.appendChild(label);
    });

    // Quick-select buttons
    let btnDiv = document.createElement('div');
    btnDiv.className = 'dropdown-quick-btns';
    ['All', 'Default'].forEach(btnLabel => {
        let btn = document.createElement('button');
        btn.textContent = btnLabel;
        btn.className = 'dropdown-quick-btn';
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            let targets = btnLabel === 'All' ? allStatuses : DEFAULT_STATUSES;
            document.querySelectorAll('input[name="pool_status"]').forEach(cb => {
                cb.checked = targets.includes(cb.value);
            });
            filters.poolStatuses = [...targets];
            putUserState(1, { poolStatuses: filters.poolStatuses });
            renderTokens();
            applyFilters();
        });
        btnDiv.appendChild(btn);
    });
    panel.appendChild(btnDiv);

    // Toggle panel
    document.getElementById('status-filter').addEventListener('click', (e) => {
        e.stopPropagation();
        let isOpen = panel.style.display === 'block';
        document.querySelectorAll('.dropdown-panel').forEach(p => p.style.display = 'none');
        panel.style.display = isOpen ? 'none' : 'block';
    });
}

// =============================================================================
// LOAD REFERENCE DATA
// =============================================================================
async function loadTowns() {
    try {
        let data = await fetchTowns();
        allTowns = (data.rows || []).map(r => r.townName || r.town_name || r.name).filter(Boolean).sort();
    } catch(err) { console.warn('filter_bar.js: towns load failed', err); }
}

async function loadCounties() {
    try {
        let data = await fetchCounties();
        allCounties = (data.rows || []).map(r => r.countyName || r.county_name || r.name).filter(Boolean).sort();
    } catch(err) { console.warn('filter_bar.js: counties load failed', err); }
}

// =============================================================================
// RENDER FILTER TOKENS
// =============================================================================
function renderTokens() {
    let container = document.getElementById('filter-tokens');
    if (!container) return;

    let tokens = [];

    if (filters.poolIdSearch) {
        tokens.push({ key: 'poolIdSearch', label: 'Pool', value: filters.poolIdSearch });
    }
    filters.townNames.forEach(name => {
        tokens.push({ key: 'townName', value: name, label: 'Town' });
    });
    filters.countyNames.forEach(name => {
        tokens.push({ key: 'countyName', value: name, label: 'County' });
    });
    // Each status as its own removable chip
    filters.poolStatuses.forEach(status => {
        tokens.push({ key: 'poolStatus', value: status, label: 'Status' });
    });

    if (!tokens.length) {
        container.innerHTML = '';
        return;
    }

    let html = tokens.map(t => {
        let removeData = t.key === 'townName' ? `data-remove-town="${t.value}"`
            : t.key === 'countyName' ? `data-remove-county="${t.value}"`
            : t.key === 'poolStatus' ? `data-remove-status="${t.value}"`
            : `data-remove-key="${t.key}"`;
        return `<span class="filter-token">
            ${t.label}: <strong>${t.value}</strong>
            <button class="filter-token-remove" ${removeData} title="Remove">&times;</button>
        </span>`;
    }).join('');

    // Clear all button if multiple tokens
    if (tokens.length > 1) {
        html += `<button class="filter-token-clear-all" id="clear_all_filters">Clear All</button>`;
    }

    container.innerHTML = html;

    // Wire remove handlers
    container.querySelectorAll('.filter-token-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (btn.dataset.removeTown) {
                filters.townNames = filters.townNames.filter(n => n !== btn.dataset.removeTown);
                putUserState(1, { townNames: filters.townNames });
            } else if (btn.dataset.removeCounty) {
                filters.countyNames = filters.countyNames.filter(n => n !== btn.dataset.removeCounty);
                putUserState(1, { countyNames: filters.countyNames });
            } else if (btn.dataset.removeKey === 'poolIdSearch') {
                filters.poolIdSearch = '';
                document.getElementById('filter_pool_id').value = '';
                document.getElementById('filter_pool_id_clear').style.display = 'none';
                putUserState(1, { poolIdSearch: '' });
            } else if (btn.dataset.removeStatus) {
                filters.poolStatuses = filters.poolStatuses.filter(s => s !== btn.dataset.removeStatus);
                document.querySelectorAll('input[name="pool_status"]').forEach(cb => {
                    cb.checked = filters.poolStatuses.includes(cb.value);
                });
                putUserState(1, { poolStatuses: filters.poolStatuses });
            }
            renderTokens();
            applyFilters();
        });
    });

    let clearAll = document.getElementById('clear_all_filters');
    if (clearAll) {
        clearAll.addEventListener('click', () => {
            filters.poolIdSearch = '';
            filters.townNames = [];
            filters.countyNames = [];
            filters.poolStatuses = [...DEFAULT_STATUSES];
            document.getElementById('filter_pool_id').value = '';
            document.getElementById('filter_pool_id_clear').style.display = 'none';
            document.querySelectorAll('input[name="pool_status"]').forEach(cb => {
                cb.checked = DEFAULT_STATUSES.includes(cb.value);
            });
            putUserState(1, {});
            renderTokens();
            applyFilters();
        });
    }
}

// =============================================================================
// APPLY
// =============================================================================
function applyFilters() {
    if (onFilterChange) onFilterChange(filters);
}
