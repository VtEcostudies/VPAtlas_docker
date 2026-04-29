/*
  vpVisitPhoto.service.js — Photo upload and management for visit photos.

  Follows S3 naming convention:
    {poolId}/{visitId}/{Type}.{n}
    e.g. MLS567/1735/Pool.1, NEW442/1848/WoodFrog.1

  Local storage at /opt/api/photos/{poolId}/{visitId}/{Type}.{n}
  Served by Express static middleware at /photos/...
  Metadata stored in vpvisit_photos table.

  Photo type names (matching S3/legacy convention):
    Pool, Vegetation, WoodFrog, Sps, Jesa, Bssa, FairyShrimp, FingerNailClams, SpeciesOther
*/

const db = require('_helpers/db_postgres');
const query = db.query;
const fs = require('fs');
const path = require('path');

const PHOTO_DIR = path.join(__dirname, '..', 'photos');

// Map from UI species keys to canonical type names (S3 convention)
const TYPE_MAP = {
    pool:           'Pool',
    vegetation:     'Vegetation',
    woodfrog:       'WoodFrog',
    sps:            'Sps',
    jesa:           'Jesa',
    bssa:           'Bssa',
    fairyshrimp:    'FairyShrimp',
    fingernailclams:'FingerNailClams',
    speciesother:   'SpeciesOther',
};

function canonicalType(raw) {
    return TYPE_MAP[raw?.toLowerCase()] || raw || 'Pool';
}

module.exports = {
    upload,
    getByVisitId,
    deletePhoto
};

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Look up poolId for a visit
async function getPoolId(visitId) {
    let res = await query(`SELECT "visitPoolId" FROM vpvisit WHERE "visitId" = $1`, [visitId]);
    return res.rows.length ? res.rows[0].visitPoolId : null;
}

// Save a photo file to disk and insert metadata into vpvisit_photos
async function upload(visitId, photoType, file) {
    let poolId = await getPoolId(visitId);
    if (!poolId) throw new Error(`Visit ${visitId} not found`);

    let type = canonicalType(photoType);
    let visitDir = path.join(PHOTO_DIR, poolId, String(visitId));
    ensureDir(visitDir);

    // Determine next sequence number for this visit+type
    let existing = await query(
        `SELECT count(*) FROM vpvisit_photos WHERE "visitPhotoVisitId" = $1 AND "visitPhotoSpecies" = $2`,
        [visitId, type]
    );
    let seq = parseInt(existing.rows[0].count) + 1;

    // S3 convention: {Type}.{n} (no file extension in the key)
    let key = `${type}.${seq}`;
    // But save with extension on local disk for serving with correct mime type
    let ext = path.extname(file.originalname || '').toLowerCase() || '.jpg';
    let filename = `${key}${ext}`;
    let filePath = path.join(visitDir, filename);

    fs.writeFileSync(filePath, file.buffer);

    // URL path matches S3 key structure: /photos/{poolId}/{visitId}/{Type}.{n}.jpg
    let photoUrl = `/photos/${poolId}/${visitId}/${filename}`;

    let text = `INSERT INTO vpvisit_photos ("visitPhotoVisitId", "visitPhotoSpecies", "visitPhotoUrl", "visitPhotoName")
                VALUES ($1, $2, $3, $4)
                ON CONFLICT ("visitPhotoVisitId", "visitPhotoSpecies", "visitPhotoUrl") DO NOTHING
                RETURNING *`;
    await query(text, [visitId, type, photoUrl, file.originalname || filename]);

    console.log(`vpVisitPhoto.upload | ${poolId}/${visitId}/${key} (${file.originalname})`);

    return {
        visitPhotoVisitId: visitId,
        visitPhotoSpecies: type,
        visitPhotoUrl: photoUrl,
        visitPhotoName: file.originalname || filename
    };
}

async function getByVisitId(visitId) {
    let text = `SELECT * FROM vpvisit_photos WHERE "visitPhotoVisitId" = $1 ORDER BY "visitPhotoSpecies", "visitPhotoUrl"`;
    return await query(text, [visitId]);
}

async function deletePhoto(visitId, photoUrl) {
    // Remove file — photoUrl is like /photos/{poolId}/{visitId}/{Type}.{n}.jpg
    let relPath = photoUrl.replace(/^\/photos\//, '');
    let filePath = path.join(PHOTO_DIR, relPath);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}

    let text = `DELETE FROM vpvisit_photos WHERE "visitPhotoVisitId" = $1 AND "visitPhotoUrl" = $2`;
    return await query(text, [visitId, photoUrl]);
}
