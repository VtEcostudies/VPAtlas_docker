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
    delete: _delete
};

//file scope list of vpSurvey tables' columns retrieved at app startup (see 'getColumns()' below)
const tables = [
  "vpreview",
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
    const where = pgUtil.whereClause(body, staticColumns);
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
    const where = pgUtil.whereClause(params, staticColumns);
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
    const where = pgUtil.whereClause(body, staticColumns);
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
      					"createdAt",
      					"updatedAt",
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

async function _delete(id) {
    return await query(`delete from vpreview where "reviewId"=$1;`, [id]);
}
