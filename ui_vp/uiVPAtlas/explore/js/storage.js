/*
    storage.js - IndexedDB wrapper for VPAtlas
    Uses idb-keyval for simple key-value storage.
*/
import { get, set, del, keys, entries } from '/js/idb-keyval_6.esm.js';

const DB_NAME = 'VPAtlas';

export async function getLocal(key) {
    return await get(key);
}

export async function setLocal(key, val) {
    return await set(key, val);
}

export async function delLocal(key) {
    return await del(key);
}

export async function getKeys() {
    return await keys();
}

export async function getEntries() {
    return await entries();
}
