const db = require('_helpers/db_postgres');
const query = db.query;
const pgUtil = require('_helpers/db_pg_util');
const common = require('_helpers/db_common');
const shapeFile = require('_helpers/db_shapefile').shapeFile;
var staticColumns = [];

module.exports = {
    getColumns,
    getCount,
    getOverview,
    getSummary,
    getAll,
    getPage,
    getById,
    getByPoolId,
    getCsv,
    getGeoJson,
    getShapeFile,
    getDeleteEligibility,
    create,
    update,
    delete: _delete
};

//file scope list of vpvisit table columns retrieved on app startup (see 'getColumns()' below)
const tables = [
  "vpvisit",
  "vpmapped",
  "vptown",
  "vpcounty",
  "vpuser"
];
for (i=0; i<tables.length; i++) {
  pgUtil.getColumns(tables[i], staticColumns) //run it once on init: to create the array here. also diplays on console.
    .then(res => {return res;})
    .catch(err => {console.log(`vpVisit.service.pg.pgUtil.getColumns | table:${tables[i]} | error: `, err.message);});
}

function getColumns() {
    return new Promise((resolve, reject) => {
      console.log(`vpVisit.service.pg.getColumns | staticColumns:`, staticColumns);
      resolve(new Promise((resolve, reject) => {
      resolve(staticColumns);
    }));
    });
}

async function getCount(params={}) {
    const where = pgUtil.whereClause(params, staticColumns);
    const text = `select count(*) from vpvisit ${where.text};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

/*
  New primary query for map/table list view - smaller dataset to improve speed.
*/
async function getOverview(params={}) {
    var orderClause = 'order by "visitId"';
    if (params.orderBy) {
        var col = params.orderBy.split("|")[0];
        var dir = params.orderBy.split("|")[1]; dir = dir ? dir : '';
        orderClause = `order by "${col}" ${dir}`;
    }
    const where = pgUtil.whereClause(params, staticColumns, 'AND');
    if (params.visitHasIndicator) {if (where.text) {where.text += ' AND ';} else {where.text = ' WHERE '} where.text += common.visitHasIndicator();}
    const text = `
    SELECT
    "townId",
    "townName",
    "countyName",
    "mappedPoolId" AS "poolId",
    "mappedPoolStatus" AS "poolStatus",
    SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 1) AS latitude,
    SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 2) AS longitude,
    "mappedByUser",
    "mappedMethod",
    "mappedConfidence",
    "mappedObserverUserName",
    "mappedLandownerPermission",
    vpvisit."visitId",
    vpvisit."visitUserName",
    vpvisit."visitDate",
    vpvisit."visitLatitude",
    vpvisit."visitLongitude",
    vpvisit."visitVernalPool",
    vpvisit."visitLatitude",
    vpvisit."visitLongitude",
    vpvisit."updatedAt" AS "visitUpdatedAt"
    FROM vpmapped
    INNER JOIN vpvisit ON "visitPoolId"="mappedPoolId"
    LEFT JOIN vptown ON "mappedTownId"="townId"
    LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
    WHERE "visitId" > 0
    ${where.text} ${orderClause};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

// Lightweight summary for offline cache — only fields needed for pool detail view
async function getSummary() {
  const text = `
  SELECT "visitId", "visitPoolId", "visitDate",
         visituser.username AS "visitObserverUserName"
  FROM vpvisit
  LEFT JOIN vpuser AS visituser ON "visitUserId"=visituser."id"
  ORDER BY "visitPoolId", "visitDate" DESC`;
  return await query(text);
}

async function getAll(params={}) {
  var orderClause = 'order by "visitId"';
  if (params.orderBy) {
      var col = params.orderBy.split("|")[0];
      var dir = params.orderBy.split("|")[1]; dir = dir ? dir : '';
      orderClause = `order by "${col}" ${dir}`;
  }
  var where = pgUtil.whereClause(params, staticColumns);
  if (params.visitHasIndicator) {if (where.text) {where.text += ' AND ';} else {where.text = ' WHERE '} where.text += common.visitHasIndicator();}
  const text = `
SELECT
"townId",
"townName",
"countyName",
"mappedPoolId" AS "poolId",
"mappedPoolStatus" AS "poolStatus",
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 1) AS latitude,
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 2) AS longitude,
vpmapped.*,
vpmapped."updatedAt" AS "mappedUpdatedAt",
vpmapped."createdAt" AS "mappedCreatedAt",
vpvisit.*,
vpvisit."updatedAt" AS "visitUpdatedAt",
vpvisit."createdAt" AS "visitCreatedAt",
(SELECT COUNT(*)::int FROM vpreview WHERE "reviewVisitId" = vpvisit."visitId") AS "reviewCount",
(SELECT COUNT(*)::int FROM vpvisit_photos WHERE "visitPhotoVisitId" = vpvisit."visitId") AS "photoCount"
from vpmapped
INNER JOIN vpvisit ON "visitPoolId"="mappedPoolId"
LEFT JOIN vptown ON "mappedTownId"="townId"
LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
${where.text} ${orderClause};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

async function getPage(page, params={}) {
    page = Number(page) ? Number(page) : 1;
    const pageSize = Number(params.pageSize) ? Number(params.pageSize) : 10;
    const offset = (page-1) * pageSize;
    var orderClause = 'order by "visitId"';
    if (params.orderBy) {
        var col = params.orderBy.split("|")[0];
        var dir = params.orderBy.split("|")[1]; dir = dir ? dir : '';
        orderClause = `order by "${col}" ${dir}`;
    }
    var where = pgUtil.whereClause(params, staticColumns, 'AND'); //whereClause filters output against vpvisit.columns
    if (params.visitHasIndicator) {if (where.text) {where.text += ' AND ';} else {where.text = ' WHERE '} where.text += common.visitHasIndicator();}
    const text = `
SELECT
(SELECT COUNT(*) FROM vpmapped INNER JOIN vpvisit ON vpvisit."visitPoolId"=vpmapped."mappedPoolId" ${where.text}) AS count,
"townId",
"townName",
"countyName",
"mappedPoolId" AS "poolId",
"mappedPoolStatus" AS "poolStatus",
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 1) AS latitude,
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 2) AS longitude,
vpmapped.*,
vpmapped."updatedAt" AS "mappedUpdatedAt",
vpmapped."createdAt" AS "mappedCreatedAt",
vpvisit.*,
vpvisit."updatedAt" AS "visitUpdatedAt",
vpvisit."createdAt" AS "visitCreatedAt"
from vpmapped
INNER JOIN vpvisit ON "visitPoolId"="mappedPoolId"
LEFT JOIN vptown ON "mappedTownId"="townId"
LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
${where.text} ${orderClause}
offset ${offset} limit ${pageSize};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

/*
  NOW get 2 points for each Visit, and return as a 2-element JSON object:

  {both: {mapped:{}, visit:{}}}
*/
async function getById(id) {
    var text = `
    SELECT
    	json_build_object(
    	'mapped', (SELECT row_to_json(mapped) FROM (
    		SELECT
    		"townId",
    		"townName",
    		"countyName",
    		"mappedPoolId" AS "poolId",
    		"mappedPoolStatus" AS "poolStatus",
    		SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 1) AS latitude,
    		SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 2) AS longitude,
    		vpmapped.*
    		) mapped),
    	'visit', (SELECT row_to_json(visit) FROM (
    		SELECT
    		"townId",
    		"townName",
    		"countyName",
    		"mappedPoolId" AS "poolId",
    		"mappedPoolStatus" AS "poolStatus",
    		"visitLatitude" AS latitude,
    		"visitLongitude" AS longitude,
    		vpmapped.*,
    		vpmapped."updatedAt" AS "mappedUpdatedAt",
    		vpmapped."createdAt" AS "mappedCreatedAt",
    		vpvisit.*,
    		vpvisit."updatedAt" AS "visitUpdatedAt",
    		vpvisit."createdAt" AS "visitCreatedAt"
    		) visit)
    ) AS both,
    "reviewId",
    EXISTS (SELECT 1 FROM vpreview WHERE "reviewVisitId" = vpvisit."visitId") AS "isReviewed"
    FROM vpmapped
    INNER JOIN vpvisit ON "visitPoolId"="mappedPoolId"
    LEFT JOIN vpreview ON "reviewPoolId"="mappedPoolId"
    LEFT JOIN vptown ON "mappedTownId"="townId"
    LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
    WHERE "visitId"=$1;`;

    return await query(text, [id])
}

function getByPoolId(poolId) {
  const text = `
  SELECT
  "townId",
  "townName",
  "countyName",
  visituser.username AS "visitUserName",
  visituser.id AS "visitUserId",
  --visituser.email AS "visitUserEmail",
  vpVisit.*,
  vpVisit."updatedAt" AS "visitUpdatedAt",
  vpVisit."createdAt" AS "visitCreatedAt",
  vpmapped.*,
  vpmapped."updatedAt" AS "mappedUpdatedAt",
  vpmapped."createdAt" AS "mappedCreatedAt"
  FROM vpvisit
  INNER JOIN vpmapped ON "mappedPoolId"="visitPoolId"
  LEFT JOIN vpuser AS visituser ON "visitUserId"="id"
  LEFT JOIN vptown ON "mappedTownId"="townId"
  LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
  WHERE "visitPoolId"=$1`

  return query(text, [poolId]);
}

async function getCsv(params={}) {
    const where = pgUtil.whereClause(params, staticColumns);
    if (params.visitHasIndicator) {if (where.text) {where.text += ' AND ';} else {where.text = ' WHERE '} where.text += common.visitHasIndicator();}
    if (params.visitNeedsReview) {if (where.text) {where.text += ' AND ';} else {where.text = ' WHERE '} where.text += common.visitNeedsReview();}
    const sql = `
    SELECT
    "mappedPoolId" AS "poolId",
    "mappedPoolStatus" AS "poolStatus",
    SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 1) AS latitude,
    SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 2) AS longitude,
    "townName",
    "countyName",
    vpvisit.*,
    vpreview.*
    FROM vpvisit
    INNER JOIN vpmapped on "mappedPoolId"="visitPoolId"
    LEFT JOIN vptown ON "mappedTownId"="townId"
    LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
    --LEFT JOIN vpuser AS mappeduser ON "mappedUserId"=mappeduser.id
    --LEFT JOIN vpuser AS visituser ON "visitUserId"=visituser.id
    LEFT JOIN vpreview ON "visitId" = "reviewVisitId"
    ${where.text}`;

    return await query(sql, where.values)
}

/*
  NOTE: WE DO NOT NEED TO USE ST_AsGeoJSON("mappedPoolLocation")::json to convert geometry to geoJSON.

  Simply use eg. this:

  SELECT
    to_json("mappedPoolLocation"), "mappedPoolLocation", "mappedPoolStatus"
  FROM vpmapped
  WHERE "mappedPoolId"='NEW400';

  Input: params are passed as req.query
*/
async function getGeoJson(params={}) {
    console.log('vpVisit.service | getGeoJson |', params);
    var where = pgUtil.whereClause(params, staticColumns, 'WHERE');
    if (params.visitHasIndicator) {if (where.text) {where.text += ' AND ';} else {where.text = ' WHERE '} where.text += common.visitHasIndicator();}
    where.pretty = JSON.stringify(params).replace(/\"/g,'');
    const sql = `
    SELECT
        row_to_json(fc) as geojson
    FROM (
        SELECT
    		'FeatureCollection' AS type,
    		'Vermont Vernal Pool Atlas - Pool Visits' as name,
        'WHERE ${where.pretty}' AS filter,
        --The CRS type below causes importing this dataset into GIS software to fail.
        --The default GeoJSON CRS is WGS84, which is what we have.
    		--'{ "type": "name", "properties": { "name": "urn:ogc:def:crs:EPSG::3857" } }'::json as crs,
        array_to_json(array_agg(f)) AS features
        FROM (
            SELECT
                'Feature' AS type,
                ST_AsGeoJSON("mappedPoolLocation")::json as geometry,
                (SELECT row_to_json(p) FROM
                  (SELECT
                    "mappedPoolId" AS "poolId",
                    "mappedPoolStatus" AS "poolStatus",
                    CONCAT('https://vpatlas.org/pools/list?poolId=',"mappedPoolId",'&zoomFilter=false') AS vpatlas_pool_url,
                    CONCAT('https://vpatlas.org/pools/visit/view/',"visitId") AS vpatlas_visit_url,
                    vptown."townName",
                    vpcounty."countyName",
                    vpmapped.*,
                    vpvisit.*,
                    vpreview.*
                    ) AS p
              ) AS properties
            FROM vpvisit
            INNER JOIN vpmapped ON "visitPoolId"="mappedPoolId"
            LEFT JOIN vptown ON "mappedTownId"="townId"
            LEFT JOIN vpcounty ON "townCountyId"="govCountyId"
            --LEFT JOIN vpuser AS mappeduser ON "mappedUserId"=mappeduser."id"
            --LEFT JOIN vpuser AS visituser ON "visitUserId"=visituser."id"
            LEFT JOIN vpreview ON "visitId" = "reviewVisitId"
            ${where.text}
        ) AS f
    ) AS fc;`
    console.log('vpVisit.service | getGeoJson |', where.text, where.values);
    return await query(sql, where.values);
}

async function getShapeFile(params={}, excludeHidden=1) {
  var where = pgUtil.whereClause(params, staticColumns, 'AND');
  where.pretty = JSON.stringify(params).replace(/\"/g,'');
  where.combined = where.text;
  where.values.map((val, idx) => {
    console.log('vpVisit.service::getShapeFile | WHERE values', val, idx);
    where.combined = where.combined.replace(`$${idx+1}`, `'${val}'`)
  })
  console.log('vpVisit.service::getShapeFile | WHERE', where);
  //Important: notes and comments fields have characters that crash the shapefile dump. It must be handled.
  let qry = `SELECT * 
  FROM visit_shapefile
  WHERE TRUE
  ${where.combined}
  `;
  if (excludeHidden) {qry += `AND "mappedPoolStatus" NOT IN ('Duplicate', 'Eliminated')`}
  return await shapeFile(qry, params.authUser, 'vpvisit')
}

async function create(body) {
    var queryColumns = pgUtil.parseColumns(body, 1, [], staticColumns);
    text = `insert into vpvisit (${queryColumns.named}) values (${queryColumns.numbered}) returning "visitId"`;
    console.log(text, queryColumns.values);
    var res = await query(text, queryColumns.values);
    console.log('vpVisit.service.create | returning: ', res);
    return res;
}

async function update(id, body) {
    console.log(`vpVisit.service.update | before pgUtil.parseColumns`, staticColumns);
    var queryColumns = pgUtil.parseColumns(body, 2, [id], staticColumns);
    // Stamp "lastEditedAt" = now() on every user edit. This service.update
    // is reached ONLY via PUT /pools/visit/:id (the app's edit path) —
    // S123 / bulk-upload paths use separate upsert services and never call
    // this. "lastEditedAt" has no DEFAULT and no trigger, so this is its
    // sole writer: NULL means "never user-edited since baseline", which is
    // what the Review filter keys off. Appended as a plain assignment after
    // the tuple SET; Postgres allows mixing the two forms.
    text = `update vpvisit set (${queryColumns.named}) = (${queryColumns.numbered}), "lastEditedAt" = now() where "visitId"=$1 returning "visitId"`;
    console.log(text, queryColumns.values);
    return await query(text, queryColumns.values);
}

async function _delete(id) {
    return await query(`delete from vpvisit where "visitId"=$1;`, [id]);
}

// Returns the ownership / review-status fields needed to decide whether the
// caller is allowed to delete a given visit. NULL row means visit not found;
// the route layer turns that into a 404. `isReviewed` is computed via EXISTS
// on vpreview so we don't have to materialise a JOIN.
async function getDeleteEligibility(id) {
    const sql = `
        SELECT "visitId", "visitUserId", "visitObserverUserId",
               EXISTS (SELECT 1 FROM vpreview WHERE "reviewVisitId" = v."visitId") AS "isReviewed"
        FROM vpvisit v
        WHERE "visitId" = $1`;
    const res = await query(sql, [id]);
    return res.rowCount ? res.rows[0] : null;
}
