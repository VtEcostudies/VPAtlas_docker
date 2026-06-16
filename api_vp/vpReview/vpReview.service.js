const db = require('_helpers/db_postgres');
const query = db.query;
const pgUtil = require('_helpers/db_pg_util');
var staticColumns = [];

module.exports = {
    getColumns,
    getCount,
    getAll,
    getById,
    getGeoJson,
    create,
    update,
    reassign,
    delete: _delete
};

//file scope list of vpSurvey tables' columns retrieved at app startup (see 'getColumns()' below)
// vpmapped + vpvisit added so the /review/csv endpoint (admin Download dialog)
// can filter by mappedPoolStatus and other JOIN-table columns via pgUtil.
// Column name collisions on createdAt/updatedAt exist (all three tables have
// them) — don't pass those as filter params or PG will throw "ambiguous
// column reference".
const tables = [
  "vpreview",
  "vpmapped",
  "vpvisit",
  "vptown"
];
for (i=0; i<tables.length; i++) {
  pgUtil.getColumns(tables[i], staticColumns) //run it once on init: to create the array here. also diplays on console.
    .then(res => {
      return res;
    })
    .catch(err => {console.log(`vpReview.service.pg.pgUtil.getColumns | table:${tables[i]} | error: `, err.message);});
}

function getColumns() {
    return new Promise((resolve, reject) => {
      console.log(`vpReview.service.pg.getColumns | staticColumns:`, staticColumns);
      resolve(staticColumns);
    });
}

async function getCount(body={}) {
    // reviewReasons is text[] — whereClause emits `= $1` which errors against an array column.
    const { reviewReasons: _r, ...filterBody } = body;
    const where = pgUtil.whereClause(filterBody, staticColumns);
    const text = `select count(*) from vpreview ${where.text};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

async function getAll(params={}) {
    var orderClause = 'order by "reviewId" desc';
    if (params.orderBy) {
        var col = params.orderBy.split("|")[0];
        var dir = params.orderBy.split("|")[1]; dir = dir ? dir : '';
        orderClause = `order by "${col}" ${dir}`;
    }
    const { reviewReasons: _r, ...filterParams } = params;
    const where = pgUtil.whereClause(filterParams, staticColumns);
    const text = `
        SELECT
        "townId",
        "townName",
        "countyName",
        vpreview.*,
        vpreview."updatedAt" AS "reviewUpdatedAt",
        vpreview."createdAt" AS "reviewCreatedAt",
        vpvisit.*,
        vpvisit."updatedAt" AS "visitUpdatedAt",
        vpvisit."createdAt" AS "visitCreatedAt",
        vpmapped.*,
        vpmapped."updatedAt" AS "mappedUpdatedAt",
        vpmapped."createdAt" AS "mappedCreatedAt"
        FROM vpreview
        INNER JOIN vpvisit ON vpvisit."visitId"=vpreview."reviewVisitId"
        INNER JOIN vpmapped ON vpmapped."mappedPoolId"=vpreview."reviewPoolId"
        LEFT JOIN vptown ON "mappedTownId"="townId"
        LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
        ${where.text} ${orderClause};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

async function getById(id) {
    const text = `
        SELECT
        "townId",
        "townName",
        "countyName",
        vpreview.*,
        vpreview."updatedAt" AS "reviewUpdatedAt",
        vpreview."createdAt" AS "reviewCreatedAt",
        vpvisit.*,
        vpvisit."updatedAt" AS "visitUpdatedAt",
        vpvisit."createdAt" AS "visitCreatedAt",
        vpmapped.*,
        vpmapped."updatedAt" AS "mappedUpdatedAt",
        vpmapped."createdAt" AS "mappedCreatedAt"
        FROM vpreview
        INNER JOIN vpvisit ON vpvisit."visitId"=vpreview."reviewVisitId"
        INNER JOIN vpmapped ON vpmapped."mappedPoolId"=vpreview."reviewPoolId"
        LEFT JOIN vptown ON "mappedTownId"="townId"
        LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
        WHERE "reviewId"=$1;`;
    return await query(text, [id])
}

async function getGeoJson(body={}) {
    const { reviewReasons: _r, ...filterBody } = body;
    const where = pgUtil.whereClause(filterBody, staticColumns);
    const sql = `
      SELECT
          row_to_json(fc) AS geojson
      FROM (
          SELECT
      		'FeatureCollection' AS type,
      		'Vermont Vernal Pool Atlas - Pool Reviews' AS name,
              array_to_json(array_agg(f)) AS features
          FROM (
              SELECT
                  'Feature' AS type,
      			         ST_AsGeoJSON(
                       ST_GeomFromText('POINT(' || "mappedLongitude" || ' ' || "mappedLatitude" || ')'))::json
                       AS geometry,
                  (SELECT
      				row_to_json(p) FROM (SELECT
      					"reviewId",
      					"reviewUserName",
      					"reviewUserId",
      					"reviewPoolId",
      					"reviewVisitIdLegacy",
      					"reviewVisitId",
      					"reviewQACode",
      					"reviewQAAlt",
      					"reviewQAPerson",
      					"reviewQADate",
      					"reviewQANotes",
      					vpreview."createdAt" AS "createdAt",
      					vpreview."updatedAt" AS "updatedAt",
      					"reviewPoolStatus",
                "visitLongitude",
                "visitLatitude"
      				) AS p
      			) AS properties
              FROM vpreview
      		INNER JOIN vpvisit ON "reviewPoolId"="visitPoolId"
          INNER JOIN vpmapped ON "reviewPoolId"="mappedPoolId"
          ) AS f
      ) AS fc; `;
    console.log('vpReview.service | getGeoJson |', where.text, where.values);
    return await query(sql, where.values);
}

async function create(body) {
    var queryColumns = pgUtil.parseColumns(body, 1, [], staticColumns);
    text = `insert into vpreview (${queryColumns.named}) values (${queryColumns.numbered}) returning "reviewId"`;
    console.log(text, queryColumns.values);
    return new Promise(async (resolve, reject) => {
      await query(text, queryColumns.values)
        .then(async rev => {
          var qry = `update vpmapped set "mappedPoolStatus"=$1 where "mappedPoolId"=$2 returning $3::int as "reviewId"`;
          var val = [body.reviewPoolStatus, body.reviewPoolId, rev.rows[0].reviewId];
          console.log('vpReview.service::create', qry, val);
          await query(qry, val)
            .then(res => {resolve(res);})
            .catch(err => {reject(err);});
        })
        .catch(err => {reject(err);});
    })
}

async function update(id, body) {
    console.log(`vpReview.service.update | before pgUtil.parseColumns`, staticColumns);
    var queryColumns = pgUtil.parseColumns(body, 2, [id], staticColumns);
    text = `update vpreview set (${queryColumns.named}) = (${queryColumns.numbered}) where "reviewId"=$1 returning "reviewId"`;
    console.log(text, queryColumns.values);
    return new Promise(async (resolve, reject) => {
      await query(text, queryColumns.values)
        .then(async rev => {
          var qry = `update vpmapped set "mappedPoolStatus"=$1 where "mappedPoolId"=$2 returning $3::int as "reviewId"`;
          var val = [body.reviewPoolStatus, body.reviewPoolId, rev.rows[0].reviewId];
          console.log('vpReview.service::update', qry, val);
          await query(qry, val)
            .then(res => {resolve(res);})
            .catch(err => {reject(err);});
        })
        .catch(err => {reject(err);});
    })
}

// Reassign a visit (and its review) to a different mapped pool, optionally
// disposing of the now-orphaned source pool. One atomic transaction:
//   1. vpvisit.visitPoolId    → newPoolId
//   2. vpreview.reviewPoolId  → newPoolId   (review follows the visit)
//   3a. fate=duplicate → vpmapped[oldPool].mappedPoolStatus = 'Duplicate'
//   3b. fate=delete    → DELETE vpmapped[oldPool]   (only if no other refs)
//   3c. fate=leave     → no change to the old pool
async function reassign(reviewId, body) {
    const newPoolId = body && body.newPoolId;
    const fate = (body && body.fate) || 'duplicate';
    if (!newPoolId) throw { status: 400, message: 'newPoolId required' };
    if (!['duplicate', 'delete', 'leave'].includes(fate))
        throw { status: 400, message: `Unknown fate '${fate}' (expected duplicate|delete|leave)` };

    const r = await query(`
        SELECT v."visitId", v."visitPoolId" AS "oldPoolId"
        FROM vpreview rev JOIN vpvisit v ON v."visitId"=rev."reviewVisitId"
        WHERE rev."reviewId"=$1`, [reviewId]);
    if (!r.rows.length) throw { status: 404, message: `Review ${reviewId} not found` };
    const { visitId, oldPoolId } = r.rows[0];

    if (newPoolId === oldPoolId)
        throw { status: 400, message: `newPoolId ${newPoolId} is the same as current pool` };

    const np = await query(`SELECT 1 FROM vpmapped WHERE "mappedPoolId"=$1`, [newPoolId]);
    if (!np.rows.length) throw { status: 404, message: `Target pool ${newPoolId} not found` };

    // Hard refuse delete if the old pool still has other visits / reviews / surveys.
    if (fate === 'delete') {
        const g = await query(`
            SELECT
              (SELECT count(*) FROM vpvisit  WHERE "visitPoolId"=$1  AND "visitId"<>$2)  AS other_visits,
              (SELECT count(*) FROM vpreview WHERE "reviewPoolId"=$1 AND "reviewId"<>$3) AS other_reviews,
              (SELECT count(*) FROM vpsurvey WHERE "surveyPoolId"=$1)                    AS surveys`,
            [oldPoolId, visitId, reviewId]);
        const o = g.rows[0];
        if (Number(o.other_visits) || Number(o.other_reviews) || Number(o.surveys)) {
            throw { status: 409, message:
                `Cannot delete ${oldPoolId}: still referenced by ${o.other_visits} other visit(s), ${o.other_reviews} other review(s), ${o.surveys} survey(s). Use 'Duplicate' or 'Leave' instead.` };
        }
    }

    return db.pgpDb.tx(async t => {
        await t.none(`UPDATE vpvisit  SET "visitPoolId"=$1  WHERE "visitId"=$2`, [newPoolId, visitId]);
        await t.none(`UPDATE vpreview SET "reviewPoolId"=$1 WHERE "reviewId"=$2`, [newPoolId, reviewId]);
        if (fate === 'duplicate') {
            await t.none(`UPDATE vpmapped SET "mappedPoolStatus"='Duplicate' WHERE "mappedPoolId"=$1`, [oldPoolId]);
        } else if (fate === 'delete') {
            await t.none(`DELETE FROM vpmapped WHERE "mappedPoolId"=$1`, [oldPoolId]);
        }
        return { reviewId: Number(reviewId), visitId, oldPoolId, newPoolId, fate };
    });
}

async function _delete(id) {
    return await query(`delete from vpreview where "reviewId"=$1;`, [id]);
}
