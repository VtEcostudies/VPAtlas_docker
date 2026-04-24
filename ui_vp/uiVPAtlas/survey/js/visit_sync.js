/*
    visit_sync.js — Upload queue manager for Atlas Visits
    Pattern from LoonWeb data_sync.js

    Handles uploading completed visits to the API server.
    Visits remain in IndexedDB until successfully uploaded.
    Manual retry — user clicks Upload for each completed visit.
*/
import { loadVisit, saveVisit } from './visit_store.js';

let syncInProgress = false;

// =============================================================================
// SYNC a single visit to the server
// =============================================================================
export async function syncVisit(uuid) {
    if (syncInProgress) {
        sendSyncStatus('warning', 'Upload already in progress');
        return false;
    }
    if (!navigator.onLine) {
        sendSyncStatus('warning', 'No network — visit saved locally for later upload');
        return false;
    }
    if (!uuid) {
        sendSyncStatus('error', 'No visit UUID to sync');
        return false;
    }

    syncInProgress = true;
    sendSyncStatus('info', 'Uploading visit...');

    try {
        let visit = await loadVisit(uuid);
        if (!visit) {
            sendSyncStatus('error', 'Visit not found in local storage');
            return false;
        }

        // Get auth token
        let token = null;
        try {
            let { getLocal } = await import('/js/storage.js');
            token = await getLocal('auth_token');
        } catch(e) {}

        if (!token) {
            sendSyncStatus('error', 'Not logged in — please sign in to upload');
            return false;
        }

        // Build API payload from stored form data
        let body = Object.assign({}, visit.formData || {});
        body.visitPoolId = visit.visitPoolId;
        body.visitDate = visit.visitDate;
        body.visitObserverUserName = visit.visitObserverUserName;
        body.visitLatitude = visit.visitLatitude;
        body.visitLongitude = visit.visitLongitude;
        body.visitLandownerPermission = visit.visitLandownerPermission;
        body.visitLandowner = visit.visitLandowner;
        body.visit_uuid = visit.visit_uuid;

        // Determine create vs update
        let apiUrl = window.appConfig?.apiUrl || '';
        let res;
        if (visit.server_visit_id) {
            res = await fetch(`${apiUrl}/pools/visit/${visit.server_visit_id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(body)
            });
        } else {
            res = await fetch(`${apiUrl}/pools/visit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify(body)
            });
        }

        if (!res.ok) {
            let errText = '';
            try { errText = await res.text(); } catch(e) {}
            throw new Error(`Server error ${res.status}: ${errText.substring(0, 200)}`);
        }

        let result = await res.json();

        // Mark as uploaded
        visit.status = 'uploaded';
        visit.server_visit_id = result.visitId || result.id || visit.server_visit_id;
        visit.uploaded_at = new Date().toISOString();
        await saveVisit(visit);

        sendSyncStatus('uploaded', { visit_uuid: uuid, visitId: visit.server_visit_id });
        return true;

    } catch (err) {
        console.error('visit_sync: upload failed', err);
        sendSyncStatus('error', `Upload failed: ${err.message || 'Unknown error'}`);
        return false;
    } finally {
        syncInProgress = false;
    }
}

// =============================================================================
// Sync all completed visits (batch upload)
// =============================================================================
export async function syncAllCompleted() {
    let { getVisitsByStatus } = await import('./visit_store.js');
    let pending = await getVisitsByStatus('complete');
    if (!pending.length) {
        sendSyncStatus('info', 'No visits to upload');
        return;
    }
    let success = 0, fail = 0;
    for (let visit of pending) {
        let ok = await syncVisit(visit.visit_uuid);
        if (ok) success++; else fail++;
    }
    sendSyncStatus('info', `Uploaded ${success} of ${success + fail} visits`);
}

// =============================================================================
// Status event system (matches LoonWeb pattern)
// =============================================================================
function sendSyncStatus(type, message) {
    window.dispatchEvent(new CustomEvent('visitSyncStatus', {
        detail: { type, message, timestamp: new Date() }
    }));
}

// Network monitoring — log connectivity changes
window.addEventListener('online', () => sendSyncStatus('info', 'Network connected'));
window.addEventListener('offline', () => sendSyncStatus('warning', 'Network disconnected — visits saved locally'));
