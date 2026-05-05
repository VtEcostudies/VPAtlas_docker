/*
    filter_bar.js - Filter bar with token/chip pattern for VPAtlas

    Selected filters appear as removable tokens below the filter inputs.
    Town/county selectors support type-ahead filtering of the dropdown list
    and multi-select (each selection adds a token).

    Token pattern adapted from CSWG BeeWiki beewiki-filters.js.
*/
import { filters, putUserState, buildSearchTerm, DEFAULT_STATUSES, DATA_TYPES } from './url_state.js';
import { fetchTowns, fetchCounties, fetchPools, fetchMappedPoolStats } from '/js/api.js';
import { getUser } from '/js/auth.js';

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
        <div id="filter-bar" class="filter-bar">
            <!-- Primary data-type buttons -->
            <div id="data-type-buttons" class="data-type-group"></div>

            <!-- Pool ID search -->
            <div style="position:relative; flex-shrink:1; min-width:0;">
                <input type="text" id="filter_pool_id"
                    placeholder="Pool..." autocomplete="off"
                    class="filter-input" style="width:100%; max-width:120px; padding-right:24px;">
                <button id="filter_pool_id_clear" class="input-clear-btn" style="display:none;">&times;</button>
                <div id="pool_id_suggestions" class="dropdown-suggestions"></div>
            </div>

            <!-- Town type-ahead -->
            <div style="position:relative; flex-shrink:1; min-width:0;">
                <input type="text" id="filter_town"
                    placeholder="Town..." autocomplete="off"
                    class="filter-input" style="width:100%; max-width:110px;">
                <div id="town_suggestions" class="dropdown-suggestions"></div>
            </div>

            <!-- County type-ahead -->
            <div style="position:relative; flex-shrink:1; min-width:0;">
                <input type="text" id="filter_county"
                    placeholder="County..." autocomplete="off"
                    class="filter-input" style="width:100%; max-width:110px;">
                <div id="county_suggestions" class="dropdown-suggestions"></div>
            </div>

            <!-- Status dropdown — hidden, now controlled by map layer toggles -->
            <div id="status-filter" style="position:relative; display:none;">
                <label id="status-label" class="filter-dropdown-btn">
                    Status <i class="fa fa-caret-down"></i>
                </label>
                <div id="status-panel" class="dropdown-panel"></div>
            </div>

            <!-- Indicator Species toggle -->
            <label id="indicator-toggle" class="data-type-btn" style="display:flex; align-items:center; gap:4px; cursor:pointer;">
                <input type="checkbox" id="filter_indicator" style="width:auto; margin:0; accent-color:var(--primary-color);">
                <span style="font-size:12px;">Indicator Spp</span>
            </label>

            <!-- Near-me radius filter (uses GPS) -->
            <label id="near-me-toggle" class="data-type-btn" style="display:flex; align-items:center; gap:4px; cursor:pointer;" title="Show only pools within a radius of your GPS location">
                <input type="checkbox" id="filter_near_me" style="width:auto; margin:0; accent-color:var(--primary-color);">
                <span style="font-size:12px;">Near me</span>
                <input type="number" id="filter_near_me_km" min="0.5" max="200" step="0.5" value="5"
                    style="width:46px; font-size:12px; padding:1px 3px; margin-left:2px;" disabled>
                <span style="font-size:11px;">km</span>
            </label>
        </div>

        <!-- Active filter tokens (rendered into row 3 if available, else here) -->
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

    // Indicator species toggle
    let indicatorCb = document.getElementById('filter_indicator');
    if (indicatorCb) {
        indicatorCb.checked = !!filters.hasIndicator;
        indicatorCb.addEventListener('change', () => {
            filters.hasIndicator = indicatorCb.checked;
            putUserState(1, { hasIndicator: indicatorCb.checked });
            applyFilters();
        });
    }

    // Near-me radius toggle. Activating prompts the browser for GPS, captures
    // a one-shot fix as the filter origin, then triggers a refresh. The
    // radius input is enabled only while the toggle is on.
    let nearCb = document.getElementById('filter_near_me');
    let nearKm = document.getElementById('filter_near_me_km');
    if (nearCb && nearKm) {
        // Restore from filters state on init
        nearCb.checked = !!(filters.nearMeKm > 0 && filters.nearMeOrigin);
        if (filters.nearMeKm > 0) nearKm.value = filters.nearMeKm;
        nearKm.disabled = !nearCb.checked;

        nearCb.addEventListener('change', async () => {
            if (nearCb.checked) {
                if (!navigator.geolocation) {
                    alert('Geolocation is not available on this device.');
                    nearCb.checked = false;
                    return;
                }
                let prevLabel = nearCb.parentElement.querySelector('span').textContent;
                nearCb.parentElement.querySelector('span').textContent = 'Locating…';
                nearCb.disabled = true;
                try {
                    let pos = await new Promise((resolve, reject) => {
                        navigator.geolocation.getCurrentPosition(resolve, reject, {
                            enableHighAccuracy: true, timeout: 15000, maximumAge: 60000
                        });
                    });
                    filters.nearMeOrigin = { lat: pos.coords.latitude, lng: pos.coords.longitude };
                    filters.nearMeKm = parseFloat(nearKm.value) || 5;
                    nearKm.disabled = false;
                    putUserState(1, { nearMeOrigin: filters.nearMeOrigin, nearMeKm: filters.nearMeKm });
                    renderTokens();
                    applyFilters();
                } catch (err) {
                    console.warn('Near-me GPS failed:', err);
                    alert('Could not get your GPS location: ' + (err.message || err.code));
                    nearCb.checked = false;
                } finally {
                    nearCb.parentElement.querySelector('span').textContent = prevLabel;
                    nearCb.disabled = false;
                }
            } else {
                filters.nearMeKm = 0;
                filters.nearMeOrigin = null;
                nearKm.disabled = true;
                putUserState(1, { nearMeKm: 0, nearMeOrigin: null });
                renderTokens();
                applyFilters();
            }
        });

        nearKm.addEventListener('change', () => {
            if (!nearCb.checked) return;
            let v = parseFloat(nearKm.value);
            if (!(v > 0)) return;
            filters.nearMeKm = v;
            putUserState(1, { nearMeKm: v });
            renderTokens();
            applyFilters();
        });
    }

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
        // Visited/Monitored now handled by map layer control
        { value: 'Mine',      label: 'Mine',      count: null,             show: !!user },
        { value: 'Review',    label: 'Review',    count: null,             show: user && user.userrole === 'admin' },
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

    function setHighlighted(idx) {
        let items = sugBox.querySelectorAll('.suggestion-item');
        if (!items.length) return;
        if (idx < 0) idx = items.length - 1;
        if (idx >= items.length) idx = 0;
        items.forEach((it, i) => it.classList.toggle('highlighted', i === idx));
        // Scroll the highlighted item into view if it's outside the visible area
        let active = items[idx];
        if (active) active.scrollIntoView({ block: 'nearest' });
    }

    function getHighlightedIdx() {
        let items = [...sugBox.querySelectorAll('.suggestion-item')];
        return items.findIndex(it => it.classList.contains('highlighted'));
    }

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
            // Mouse hover updates the highlight for visual consistency
            item.addEventListener('mouseenter', () => {
                sugBox.querySelectorAll('.suggestion-item').forEach(i => i.classList.remove('highlighted'));
                item.classList.add('highlighted');
            });
        });
    });

    input.addEventListener('keydown', (e) => {
        let visible = sugBox.style.display === 'block';
        if (e.key === 'ArrowDown') {
            if (!visible) return;
            e.preventDefault();
            setHighlighted(getHighlightedIdx() + 1);
        } else if (e.key === 'ArrowUp') {
            if (!visible) return;
            e.preventDefault();
            setHighlighted(getHighlightedIdx() - 1);
        } else if (e.key === 'Escape') {
            sugBox.style.display = 'none';
        } else if (e.key === 'Enter') {
            e.preventDefault();
            let items = sugBox.querySelectorAll('.suggestion-item');
            if (!items.length) return;
            let idx = getHighlightedIdx();
            let target = idx >= 0 ? items[idx] : items[0];
            sugBox.style.display = 'none';
            onSelectFn(target.dataset.value);
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
    // Prefer the shared row-3 container if the explore page provides it
    let container = document.getElementById('filter_tokens_row') || document.getElementById('filter-tokens');
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
    if (filters.nearMeKm > 0 && filters.nearMeOrigin) {
        tokens.push({ key: 'nearMe', value: `${filters.nearMeKm} km`, label: 'Near me' });
    }
    // Status chips now driven by map layer control, not shown here

    if (!tokens.length) {
        container.innerHTML = '';
        return;
    }

    let html = tokens.map(t => {
        let removeData = t.key === 'townName' ? `data-remove-town="${t.value}"`
            : t.key === 'countyName' ? `data-remove-county="${t.value}"`
            : t.key === 'poolStatus' ? `data-remove-status="${t.value}"`
            : `data-remove-key="${t.key}"`;
        return `<span class="filter-token"><span class="filter-token-label">${t.label}: <strong>${t.value}</strong></span><button class="filter-token-remove" ${removeData} title="Remove">&times;</button></span>`;
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
            } else if (btn.dataset.removeKey === 'nearMe') {
                filters.nearMeKm = 0;
                filters.nearMeOrigin = null;
                let cb = document.getElementById('filter_near_me');
                let km = document.getElementById('filter_near_me_km');
                if (cb) cb.checked = false;
                if (km) km.disabled = true;
                putUserState(1, { nearMeKm: 0, nearMeOrigin: null });
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
