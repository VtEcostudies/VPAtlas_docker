const db = require('_helpers/db_postgres');
const query = db.query;

module.exports = {
    listForUser,
    listAll,
    getById,
    create,
    delete: _delete
};

// Returns just the metadata + a precomputed bbox-friendly summary, not the
// full geometry — that comes from getById to keep listings small.
const LIST_COLUMNS = `
    "trackId", "userId", "name", "notes",
    "startedAt", "endedAt", "pointCount", "lengthM",
    "uploadedAt", "createdAt"
`;

function listForUser(userId, limit = 200) {
    let sql = `SELECT ${LIST_COLUMNS}
                 FROM vptrack
                WHERE "userId" = $1
                ORDER BY "startedAt" DESC
                LIMIT $2`;
    return query(sql, [userId, limit]);
}

function listAll(limit = 500) {
    let sql = `SELECT t."trackId", t."userId", t."name", t."notes",
                      t."startedAt", t."endedAt", t."pointCount", t."lengthM",
                      t."uploadedAt", t."createdAt",
                      u."userName" AS "userName"
                 FROM vptrack t
                 LEFT JOIN vpuser u ON u.id = t."userId"
                ORDER BY t."startedAt" DESC
                LIMIT $1`;
    return query(sql, [limit]);
}

// Returns metadata + GeoJSON of the line so the client can plot the track.
function getById(trackId) {
    let sql = `SELECT ${LIST_COLUMNS},
                      ST_AsGeoJSON(geom) AS "geomJson",
                      ST_AsGeoJSON(COALESCE("geomZ", geom)) AS "geomZJson"
                 FROM vptrack
                WHERE "trackId" = $1`;
    return query(sql, [trackId]);
}

// Body: { name?, notes?, startedAt, endedAt, points: [[lng,lat,(elev?),(epochMs?)], ...] }
async function create(userId, body) {
    let pts = Array.isArray(body.points) ? body.points : [];
    if (pts.length < 2) {
        let err = new Error('Track requires at least 2 points'); err.status = 400; throw err;
    }

    // Build WKT line. We always emit a 2D LINESTRING for the spatial
    // index, plus an optional 3D LINESTRINGZ if any point has an elevation.
    let any3d = pts.some(p => p.length >= 3 && Number.isFinite(p[2]));
    let coords2d = pts.map(p => `${Number(p[0])} ${Number(p[1])}`).join(',');
    let wkt2d = `LINESTRING(${coords2d})`;
    let wkt3d = null;
    if (any3d) {
        let coords3d = pts.map(p => {
            let z = (p.length >= 3 && Number.isFinite(p[2])) ? Number(p[2]) : 0;
            return `${Number(p[0])} ${Number(p[1])} ${z}`;
        }).join(',');
        wkt3d = `LINESTRINGZ(${coords3d})`;
    }

    let sql = `WITH g AS (
              SELECT ST_GeomFromText($7, 4326) AS geom2d,
                     CASE WHEN $8::text IS NULL THEN NULL ELSE ST_GeomFromText($8, 4326) END AS geom3d
           )
           INSERT INTO vptrack
              ("userId","name","notes","startedAt","endedAt","pointCount","lengthM","geom","geomZ")
           SELECT $1,$2,$3,$4,$5,$6,
                  ST_Length(geom2d::geography),
                  geom2d,
                  geom3d
             FROM g
           RETURNING ${LIST_COLUMNS}`;
    let params = [
        userId,
        body.name || null,
        body.notes || null,
        body.startedAt,
        body.endedAt,
        pts.length,
        wkt2d,
        wkt3d
    ];
    return query(sql, params);
}

function _delete(trackId, userId, isAdmin) {
    // Admins can delete any track; users only their own.
    let sql, params;
    if (isAdmin) {
        sql = `DELETE FROM vptrack WHERE "trackId" = $1 RETURNING "trackId"`;
        params = [trackId];
    } else {
        sql = `DELETE FROM vptrack WHERE "trackId" = $1 AND "userId" = $2 RETURNING "trackId"`;
        params = [trackId, userId];
    }
    return query(sql, params);
}
