/*
    visit_store.js — IndexedDB storage for offline-first Atlas Visits

    Uses idb-keyval (same as storage.js) to avoid raw IndexedDB version
    upgrade issues that block in Firefox when multiple connections exist.

    Storage keys:
      visit_<uuid>   → individual visit data object
      user_visits    → { uuid: visitObject, ... } collection of all visits

    Status flow: draft → complete → uploaded
*/

import { get, set, del } from '/js/idb-keyval_6.esm.js';

const ME = 'visit_store.js';

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
    console.log(`${ME} saveVisit: uuid=${visit.visit_uuid} status=${visit.status} pool=${visit.visitPoolId}`);

    try {
        // Save individual visit
        await set(`visit_${visit.visit_uuid}`, visit);
        console.log(`${ME} saveVisit: individual key saved`);

        // Update collection index
        let visits = await get('user_visits') || {};
        visits[visit.visit_uuid] = visit;
        await set('user_visits', visits);
        console.log(`${ME} saveVisit: collection updated (${Object.keys(visits).length} visits)`);
    } catch (err) {
        console.error(`${ME} saveVisit FAILED:`, err);
        throw err;
    }

    return visit;
}

// Load a single visit by UUID
export async function loadVisit(uuid) {
    let visit = await get(`visit_${uuid}`) ?? null;
    console.log(`${ME} loadVisit: uuid=${uuid} found=${!!visit}`);
    return visit;
}

// Load all visits from the collection index
export async function loadAllVisits() {
    let visits = await get('user_visits') || {};
    let list = Object.values(visits).sort((a, b) =>
        new Date(b.last_modified) - new Date(a.last_modified)
    );
    console.log(`${ME} loadAllVisits: ${list.length} visits`);
    return list;
}

// Delete a visit from both individual key and collection
export async function deleteVisit(uuid) {
    await del(`visit_${uuid}`);
    let visits = await get('user_visits') || {};
    delete visits[uuid];
    await set('user_visits', visits);
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

export { generateUUID };
