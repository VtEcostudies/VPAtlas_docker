/*
    visit_store.js — IndexedDB storage for offline-first Atlas Visits

    Pattern from LoonWeb survey_utils.js. Visits are saved locally first,
    queued for upload, and synced when online.

    Storage keys:
      visit_<uuid>   → individual visit data object
      user_visits    → { uuid: visitObject, ... } collection of all visits

    Status flow: draft → complete → uploaded
*/

const DB_NAME = 'VPAtlas';
const STORE_NAME = 'store';

// =============================================================================
// IndexedDB primitives (from LoonWeb survey_utils.js)
// =============================================================================

async function saveToIndexedDB(key, value) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME);
        request.onerror = () => reject(request.error);
        request.onsuccess = (event) => {
            const db = event.target.result;
            if (!db.objectStoreNames.contains(STORE_NAME)) {
                db.close();
                const upgradeRequest = indexedDB.open(DB_NAME, db.version + 1);
                upgradeRequest.onerror = () => reject(upgradeRequest.error);
                upgradeRequest.onupgradeneeded = (e) => {
                    if (!e.target.result.objectStoreNames.contains(STORE_NAME))
                        e.target.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
                };
                upgradeRequest.onsuccess = (e) => {
                    const udb = e.target.result;
                    try {
                        const tx = udb.transaction([STORE_NAME], 'readwrite');
                        tx.objectStore(STORE_NAME).put({ key, value });
                        tx.oncomplete = () => { udb.close(); resolve(); };
                        tx.onerror = () => reject(tx.error);
                    } catch (err) { udb.close(); reject(err); }
                };
            } else {
                try {
                    const tx = db.transaction([STORE_NAME], 'readwrite');
                    tx.objectStore(STORE_NAME).put({ key, value });
                    tx.oncomplete = () => { db.close(); resolve(); };
                    tx.onerror = () => reject(tx.error);
                } catch (err) { db.close(); reject(err); }
            }
        };
        request.onupgradeneeded = (event) => {
            if (!event.target.result.objectStoreNames.contains(STORE_NAME))
                event.target.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        };
    });
}

async function getFromIndexedDB(key) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME);
        request.onerror = () => reject(request.error);
        request.onsuccess = (event) => {
            const db = event.target.result;
            try {
                const tx = db.transaction([STORE_NAME], 'readonly');
                const get = tx.objectStore(STORE_NAME).get(key);
                get.onsuccess = () => { db.close(); resolve(get.result?.value ?? null); };
                get.onerror = () => { db.close(); reject(get.error); };
            } catch (err) { db.close(); resolve(null); }
        };
        request.onupgradeneeded = (event) => {
            if (!event.target.result.objectStoreNames.contains(STORE_NAME))
                event.target.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        };
    });
}

async function deleteFromIndexedDB(key) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME);
        request.onerror = () => reject(request.error);
        request.onsuccess = (event) => {
            const db = event.target.result;
            try {
                const tx = db.transaction([STORE_NAME], 'readwrite');
                tx.objectStore(STORE_NAME).delete(key);
                tx.oncomplete = () => { db.close(); resolve(); };
                tx.onerror = () => reject(tx.error);
            } catch (err) { db.close(); reject(err); }
        };
        request.onupgradeneeded = (event) => {
            if (!event.target.result.objectStoreNames.contains(STORE_NAME))
                event.target.result.createObjectStore(STORE_NAME, { keyPath: 'key' });
        };
    });
}

// =============================================================================
// Visit CRUD — local-first with collection index
// =============================================================================

function generateUUID() {
    return crypto.randomUUID ? crypto.randomUUID()
        : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
            let r = Math.random() * 16 | 0;
            return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
}

// Save a visit to IndexedDB (both individual key and collection)
export async function saveVisit(visit) {
    if (!visit.visit_uuid) visit.visit_uuid = generateUUID();
    visit.last_modified = new Date().toISOString();

    // Save individual visit
    await saveToIndexedDB(`visit_${visit.visit_uuid}`, visit);

    // Update collection index
    let visits = await getFromIndexedDB('user_visits') || {};
    visits[visit.visit_uuid] = visit;
    await saveToIndexedDB('user_visits', visits);

    return visit;
}

// Load a single visit by UUID
export async function loadVisit(uuid) {
    return await getFromIndexedDB(`visit_${uuid}`);
}

// Load all visits from the collection index
export async function loadAllVisits() {
    let visits = await getFromIndexedDB('user_visits') || {};
    return Object.values(visits).sort((a, b) =>
        new Date(b.last_modified) - new Date(a.last_modified)
    );
}

// Delete a visit from both individual key and collection
export async function deleteVisit(uuid) {
    await deleteFromIndexedDB(`visit_${uuid}`);
    let visits = await getFromIndexedDB('user_visits') || {};
    delete visits[uuid];
    await saveToIndexedDB('user_visits', visits);
}

// Get visits by status
export async function getVisitsByStatus(status) {
    let all = await loadAllVisits();
    return all.filter(v => v.status === status);
}

// Count pending uploads
export async function getPendingCount() {
    let all = await loadAllVisits();
    return all.filter(v => v.status === 'complete').length;
}

// =============================================================================
// Visit form data <-> storage object conversion
// =============================================================================

// Create a new empty visit state
export function createVisitState(poolId, user) {
    return {
        visit_uuid: generateUUID(),
        status: 'draft',
        created_at: new Date().toISOString(),
        last_modified: new Date().toISOString(),

        // Visit info
        visitPoolId: poolId || '',
        visitDate: new Date().toLocaleDateString('sv-SE'),
        visitObserverUserName: user ? (user.handle || user.username || user.email) : '',
        visitUserId: user ? user.id : null,

        // Location
        visitLatitude: '',
        visitLongitude: '',
        visitLocationComments: '',

        // Landowner
        visitLandownerPermission: false,
        visitLandowner: { visitLandownerName: '', visitLandownerAddress: '', visitLandownerPhone: '', visitLandownerEmail: '' },

        // All form fields stored as flat key-value
        formData: {},

        // Photos stored as base64 data URLs keyed by species
        photos: {}
    };
}

export { saveToIndexedDB, getFromIndexedDB, deleteFromIndexedDB, generateUUID };
