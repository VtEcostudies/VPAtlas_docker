/*
    utils.js - Shared utility functions for VPAtlas explore app
*/

// Wait overlay
var eleWait = null;
var waitHtml = `
<div id="wait-overlay">
    <i id="wait-icon" class="fa fa-spinner fa-spin" style="font-size:60px;"></i>
</div>
`;

function addWait(parentId=false) {
    if (!eleWait) {
        let parent = parentId ? document.getElementById(parentId) : document.body;
        if (parent) {
            parent.insertAdjacentHTML('afterbegin', waitHtml);
            eleWait = document.getElementById('wait-overlay');
        }
    }
}

export function showWait(parentId=false) {
    addWait(parentId);
    if (eleWait) { eleWait.style.display = 'block'; }
}

export function hideWait(parentId=false) {
    if (eleWait) { eleWait.style.display = 'none'; }
}

// Date/time formatting
export function formatDate(dateStr) {
    if (!dateStr) return '';
    let d = new Date(dateStr);
    return d.toLocaleDateString();
}

export function formatDateTime(dateStr) {
    if (!dateStr) return '';
    let d = new Date(dateStr);
    return d.toLocaleString();
}

// UUID generation
export function getUuid() {
    return crypto.randomUUID ? crypto.randomUUID() :
        'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
            var r = Math.random() * 16 | 0;
            var v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
}

// Encode URL query param values
export function encodeParamValues(searchTerm) {
    if (!searchTerm) return '';
    return searchTerm.split('&').map(pair => {
        let [key, val] = pair.split('=');
        return val !== undefined ? `${key}=${encodeURIComponent(val)}` : key;
    }).join('&');
}

// Load app config from API (state center, zoom, etc.)
export async function loadAppConfig(fetchConfigFn) {
    try {
        let res = await fetchConfigFn();
        if (res.rows && res.rows[0]) {
            return res.rows[0];
        }
    } catch(err) {
        console.warn('utils.js=>loadAppConfig error:', err);
    }
    return null;
}
