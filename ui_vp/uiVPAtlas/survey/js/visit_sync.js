/*
    visit_sync.js — Upload queue manager for Atlas Visits
    Pattern from LoonWeb data_sync.js

    Two-stage upload:
      Stage 1: Visit data (JSON) — uploaded as soon as network is available
      Stage 2: Photos — uploaded over WiFi only (or if user allows cellular)

    Visits remain in IndexedDB until both stages complete.
    Manual retry — user clicks Upload for each visit.
*/
import { loadVisit, saveVisit } from './visit_store.js';

const ME = 'visit_sync';
let syncInProgress = false;

// =============================================================================
// SYNC a single visit (stage 1: data, stage 2: photos)
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
    sendSyncStatus('info', 'Uploading visit data...');

    try {
        let visit = await loadVisit(uuid);
        if (!visit) {
            sendSyncStatus('error', 'Visit not found in local storage');
            return false;
        }

        let token = await getAuthToken();
        if (!token) {
            sendSyncStatus('error', 'Not logged in — please sign in to upload');
            return false;
        }

        // --- Stage 1: Upload visit data ---
        let visitId = await uploadVisitData(visit, token);
        if (!visitId) return false;

        visit.server_visit_id = visitId;
        visit.status = 'uploaded';
        visit.uploaded_at = new Date().toISOString();
        await saveVisit(visit);

        sendSyncStatus('info', `Visit data uploaded (visitId=${visitId}). Checking photos...`);

        // --- Stage 2: Upload photos (WiFi or user-allowed) ---
        let photoCount = countPhotos(visit);
        if (photoCount > 0) {
            if (canUploadMedia()) {
                sendSyncStatus('info', `Uploading ${photoCount} photos...`);
                let photoResult = await uploadPhotos(visit, visitId, token);
                visit.photos_uploaded = true;
                await saveVisit(visit);
                sendSyncStatus('uploaded', {
                    visit_uuid: uuid, visitId,
                    message: `Visit + ${photoResult.uploaded} photos uploaded`
                });
            } else {
                visit.photos_uploaded = false;
                await saveVisit(visit);
                sendSyncStatus('uploaded', {
                    visit_uuid: uuid, visitId,
                    message: `Visit data uploaded. ${photoCount} photos pending (WiFi required)`
                });
            }
        } else {
            visit.photos_uploaded = true;
            await saveVisit(visit);
            sendSyncStatus('uploaded', { visit_uuid: uuid, visitId });
        }

        return true;

    } catch (err) {
        console.error(`${ME}: upload failed`, err);
        sendSyncStatus('error', `Upload failed: ${err.message || 'Unknown error'}`);
        return false;
    } finally {
        syncInProgress = false;
    }
}

// =============================================================================
// Stage 1: Upload visit JSON data
// =============================================================================
async function uploadVisitData(visit, token) {
    let body = Object.assign({}, visit.formData || {});
    body.visitPoolId = visit.visitPoolId;
    body.visitDate = visit.visitDate;
    body.visitObserverUserName = visit.visitObserverUserName;
    body.visitLatitude = visit.visitLatitude;
    body.visitLongitude = visit.visitLongitude;
    body.visitLandownerPermission = visit.visitLandownerPermission;
    body.visitLandowner = visit.visitLandowner;
    body.visit_uuid = visit.visit_uuid;

    let apiUrl = appConfig?.api?.fqdn || '';
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
    let rows = result.rows || [result];
    return rows[0]?.visitId || rows[0]?.id || visit.server_visit_id;
}

// =============================================================================
// Stage 2: Upload photos
// =============================================================================
async function uploadPhotos(visit, visitId, token) {
    let photos = visit.photos || {};
    let apiUrl = appConfig?.api?.fqdn || '';
    let uploaded = 0, failed = 0;

    for (let [photoType, files] of Object.entries(photos)) {
        if (!files || !files.length) continue;

        for (let photo of files) {
            try {
                let blob;
                if (photo.data instanceof ArrayBuffer || photo.data instanceof Uint8Array) {
                    blob = new Blob([photo.data], { type: photo.type || 'image/jpeg' });
                } else if (photo instanceof Blob) {
                    blob = photo;
                } else {
                    console.warn(`${ME}: skipping unrecognized photo format`, photo);
                    failed++;
                    continue;
                }

                let formData = new FormData();
                formData.append('photos', blob, photo.name || `${photoType}.jpg`);
                formData.append('photoType', photoType);

                let res = await fetch(`${apiUrl}/pools/visit/${visitId}/photos`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${token}` },
                    body: formData
                });

                if (res.ok) {
                    uploaded++;
                } else {
                    console.warn(`${ME}: photo upload failed`, res.status);
                    failed++;
                }
            } catch (err) {
                console.warn(`${ME}: photo upload error`, err);
                failed++;
            }
        }
    }

    console.log(`${ME}: photos uploaded=${uploaded} failed=${failed}`);
    return { uploaded, failed };
}

// =============================================================================
// Check if media upload is allowed (WiFi or user preference)
// =============================================================================
function canUploadMedia() {
    // Check navigator.connection for WiFi
    let conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    if (conn) {
        // WiFi or ethernet — always OK
        if (conn.type === 'wifi' || conn.type === 'ethernet') return true;
        // Cellular — check user preference
        if (conn.type === 'cellular') {
            return localStorage.getItem('allowCellularPhotoUpload') === 'true';
        }
    }
    // Connection API not available (desktop browser) — allow
    return true;
}

// Export for use in settings
export function setAllowCellularUpload(allow) {
    localStorage.setItem('allowCellularPhotoUpload', allow ? 'true' : 'false');
}

export function getAllowCellularUpload() {
    return localStorage.getItem('allowCellularPhotoUpload') === 'true';
}

// =============================================================================
// Upload photos only (for visits already uploaded but photos pending)
// =============================================================================
export async function syncPhotosOnly(uuid) {
    let visit = await loadVisit(uuid);
    if (!visit || !visit.server_visit_id) {
        sendSyncStatus('error', 'Visit data must be uploaded first');
        return false;
    }
    if (!canUploadMedia()) {
        sendSyncStatus('warning', 'Photos require WiFi (or enable cellular in settings)');
        return false;
    }

    let token = await getAuthToken();
    if (!token) {
        sendSyncStatus('error', 'Not logged in');
        return false;
    }

    syncInProgress = true;
    try {
        let result = await uploadPhotos(visit, visit.server_visit_id, token);
        visit.photos_uploaded = true;
        await saveVisit(visit);
        sendSyncStatus('uploaded', {
            visit_uuid: uuid,
            visitId: visit.server_visit_id,
            message: `${result.uploaded} photos uploaded`
        });
        return true;
    } catch (err) {
        sendSyncStatus('error', `Photo upload failed: ${err.message}`);
        return false;
    } finally {
        syncInProgress = false;
    }
}

// =============================================================================
// Sync all completed/pending visits
// =============================================================================
export async function syncAllCompleted() {
    let { getVisitsByStatus, loadAllVisits } = await import('./visit_store.js');
    let pending = await getVisitsByStatus('complete');
    // Also include drafts that user chose to upload
    let drafts = await getVisitsByStatus('draft');
    let all = [...pending, ...drafts.filter(d => d.visitPoolId)]; // only drafts with a poolId
    if (!all.length) {
        sendSyncStatus('info', 'No visits to upload');
        return;
    }
    let success = 0, fail = 0;
    for (let visit of all) {
        let ok = await syncVisit(visit.visit_uuid);
        if (ok) success++; else fail++;
    }
    sendSyncStatus('info', `Uploaded ${success} of ${success + fail} visits`);
}

// =============================================================================
// Helpers
// =============================================================================
function countPhotos(visit) {
    let photos = visit.photos || {};
    let count = 0;
    for (let files of Object.values(photos)) {
        if (Array.isArray(files)) count += files.length;
    }
    return count;
}

async function getAuthToken() {
    try {
        let { getLocal } = await import('/js/storage.js');
        return await getLocal('auth_token');
    } catch(e) {
        return null;
    }
}

function sendSyncStatus(type, message) {
    window.dispatchEvent(new CustomEvent('visitSyncStatus', {
        detail: { type, message, timestamp: new Date() }
    }));
}

// Network monitoring
window.addEventListener('online', () => sendSyncStatus('info', 'Network connected'));
window.addEventListener('offline', () => sendSyncStatus('warning', 'Network disconnected — visits saved locally'));
