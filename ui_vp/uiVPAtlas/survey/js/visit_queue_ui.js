/*
    visit_queue_ui.js — Reusable visit queue UI component

    Renders local (IndexedDB) visits anywhere they're needed:
    - Pool detail pages (visits for a specific pool)
    - Pool Finder nav panel
    - Explore summary pane

    Local visits are shown alongside DB visits but visually distinct:
    - No visitId (they have visit_uuid instead)
    - Status badge: draft (amber), complete (blue), uploaded (green)
    - Actions: Edit (draft), Upload (complete), Delete (draft/complete)
*/
import { loadAllVisits, deleteVisit } from './visit_store.js';
import { syncVisit, syncAllCompleted } from './visit_sync.js';

// =============================================================================
// Render a visit queue into a container element
// =============================================================================
// Options:
//   poolId: string — filter to visits for this pool only (null = show all)
//   showHeader: boolean — show the "Saved Visits (N)" header (default true)
//   compact: boolean — compact single-line layout (default false)
//
// Returns: { count, pendingCount } for caller to use (e.g. badge)

export async function renderVisitQueue(containerId, opts = {}) {
    let container = typeof containerId === 'string'
        ? document.getElementById(containerId) : containerId;
    if (!container) return { count: 0, pendingCount: 0 };

    let allVisits = await loadAllVisits();
    let visits = opts.poolId
        ? allVisits.filter(v => (v.visitPoolId || v.formData?.visitPoolId) === opts.poolId)
        : allVisits;

    let pendingCount = visits.filter(v => v.status === 'complete').length;
    let draftCount = visits.filter(v => v.status === 'draft').length;
    let showHeader = opts.showHeader !== false;

    if (!visits.length) {
        // Keep status message area even when queue is empty
        let statusEl = container.querySelector('.vq-status-msg');
        if (statusEl) {
            container.innerHTML = '';
            container.appendChild(statusEl);
        } else {
            container.innerHTML = '';
        }
        container.style.display = statusEl ? 'block' : 'none';
        return { count: 0, pendingCount: 0 };
    }

    container.style.display = 'block';

    // Preserve existing status message if present
    let existingMsg = container.querySelector('.vq-status-msg');
    let savedMsgHtml = existingMsg ? existingMsg.outerHTML : '';

    let html = '';
    if (showHeader) {
        html += `<div class="vq-header">
            <span class="vq-header-label"><i class="fa fa-inbox"></i> Saved Visits <span class="vq-header-count">(${visits.length})</span></span>
            ${pendingCount > 0 ? `<button class="vq-upload-all"><i class="fa fa-cloud-arrow-up"></i> Upload All</button>` : ''}
        </div>`;
    }

    // Status message area (populated by sync events)
    html += savedMsgHtml || '<div class="vq-status-msg" style="display:none;"></div>';

    html += `<div class="vq-list">`;
    visits.forEach(v => {
        let poolId = v.visitPoolId || v.formData?.visitPoolId || '—';
        let date = v.visitDate || v.formData?.visitDate || '';
        let observer = v.visitObserverUserName || v.formData?.visitObserverUserName || '';
        let statusClass = `vq-status-${v.status}`;
        let statusLabel = v.status;
        let uploadedInfo = '';
        let actions = '';

        if (v.status === 'draft') {
            actions = `<button class="vq-btn vq-edit" data-uuid="${v.visit_uuid}" title="Edit"><i class="fa fa-pen"></i></button>
                <button class="vq-btn vq-upload" data-uuid="${v.visit_uuid}" title="Upload"><i class="fa fa-cloud-arrow-up"></i></button>
                <button class="vq-btn vq-delete" data-uuid="${v.visit_uuid}" title="Delete"><i class="fa fa-trash"></i></button>`;
        } else if (v.status === 'complete') {
            actions = `<button class="vq-btn vq-upload" data-uuid="${v.visit_uuid}" title="Upload"><i class="fa fa-cloud-arrow-up"></i></button>
                <button class="vq-btn vq-delete" data-uuid="${v.visit_uuid}" title="Delete"><i class="fa fa-trash"></i></button>`;
        } else {
            // Uploaded — show server visitId if available
            if (v.server_visit_id) uploadedInfo = ` #${v.server_visit_id}`;
            let photoNote = (v.photos_uploaded === false) ? ' <i class="fa fa-image" title="Photos pending WiFi"></i>' : '';
            actions = `<span class="vq-btn" style="color:#2e7d32;" title="Uploaded${uploadedInfo}"><i class="fa fa-check"></i>${photoNote}</span>`;
        }

        if (opts.compact) {
            html += `<div class="vq-item vq-compact">
                <span class="vq-status ${statusClass}">${statusLabel}${uploadedInfo}</span>
                <span class="vq-pool">${opts.poolId ? '' : poolId + ' '}${date}</span>
                <span class="vq-actions">${actions}</span>
            </div>`;
        } else {
            html += `<div class="vq-item">
                <span class="vq-status ${statusClass}">${statusLabel}${uploadedInfo}</span>
                <div class="vq-info">
                    <span class="vq-pool">${poolId}</span>
                    <span class="vq-date">${date}${observer ? ' — ' + observer : ''}</span>
                </div>
                <div class="vq-actions">${actions}</div>
            </div>`;
        }
    });
    html += `</div>`;

    container.innerHTML = html;
    wireActions(container, containerId, opts);

    return { count: visits.length, pendingCount };
}

// =============================================================================
// Get count of local visits for a pool (for badge display without rendering)
// =============================================================================
export async function getLocalVisitCount(poolId) {
    let allVisits = await loadAllVisits();
    if (!poolId) return { total: allVisits.length, pending: allVisits.filter(v => v.status === 'complete').length };
    let filtered = allVisits.filter(v => (v.visitPoolId || v.formData?.visitPoolId) === poolId);
    return { total: filtered.length, pending: filtered.filter(v => v.status === 'complete').length };
}

// =============================================================================
// Wire action buttons and sync status listener
// =============================================================================
function wireActions(container, containerId, opts) {
    container.querySelectorAll('.vq-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            window.location.href = `/survey/visit_create.html?local=${btn.dataset.uuid}`;
        });
    });

    container.querySelectorAll('.vq-upload').forEach(btn => {
        btn.addEventListener('click', async () => {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa fa-spinner fa-spin"></i>';
            clearStatusMsg(container);
            let ok = await syncVisit(btn.dataset.uuid);
            await renderVisitQueue(containerId, opts);
        });
    });

    container.querySelectorAll('.vq-delete').forEach(btn => {
        btn.addEventListener('click', async () => {
            if (confirm('Delete this saved visit?')) {
                await deleteVisit(btn.dataset.uuid);
                await renderVisitQueue(containerId, opts);
            }
        });
    });

    let uploadAll = container.querySelector('.vq-upload-all');
    if (uploadAll) {
        uploadAll.addEventListener('click', async () => {
            uploadAll.disabled = true;
            uploadAll.innerHTML = '<i class="fa fa-spinner fa-spin"></i> Uploading...';
            clearStatusMsg(container);
            await syncAllCompleted();
            await renderVisitQueue(containerId, opts);
        });
    }

    // Listen for sync status events and show messages in this queue
    if (!container._vqSyncListener) {
        container._vqSyncListener = (e) => {
            let d = e.detail;
            if (!d) return;
            let type = d.type;
            let msg = typeof d.message === 'string' ? d.message
                     : d.message?.message || '';
            if (!msg) return;
            showStatusMsg(container, type, msg);
        };
        window.addEventListener('visitSyncStatus', container._vqSyncListener);
    }
}

// Show a status message inside the queue container
function showStatusMsg(container, type, msg) {
    let el = container.querySelector('.vq-status-msg');
    if (!el) return;
    let icon = type === 'error' ? 'fa-circle-exclamation'
             : type === 'warning' ? 'fa-triangle-exclamation'
             : type === 'uploaded' ? 'fa-circle-check'
             : 'fa-circle-info';
    el.className = `vq-status-msg vq-msg-${type === 'uploaded' ? 'success' : type}`;
    el.innerHTML = `<i class="fa ${icon}"></i> ${msg}`;
    el.style.display = 'block';
    // Auto-hide success/info after 6s
    if (type === 'uploaded' || type === 'info') {
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => { el.style.display = 'none'; }, 6000);
    }
}

function clearStatusMsg(container) {
    let el = container.querySelector('.vq-status-msg');
    if (el) { el.style.display = 'none'; el.innerHTML = ''; }
}
