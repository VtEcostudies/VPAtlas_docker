const db = require('_helpers/db_postgres');
const query = db.query;
const pgUtil = require('_helpers/db_pg_util');
const common = require('_helpers/db_common');
const shapeFile = require('_helpers/db_shapefile').shapeFile;
var staticColumns = [];

module.exports = {
    getColumns,
    getCount,
    getStats,
    getOverview,
    getAll,
    getPage,
    getById,
    getGeoJson,
    getShapeFile,
    create,
    update,
    delete: _delete
};

//file scope list of vpmapped table columns retrieved on app startup (see 'getColumns()' below)
const tables = [
  "vpmapped",
  "vptown",
  "vpcounty",
  "vpuser"
];
for (i=0; i<tables.length; i++) {
  pgUtil.getColumns(tables[i], staticColumns) //run it once on init: to create the array here. also diplays on console.
    .then(res => {return res;})
    .catch(err => {console.log(`vpMapped.service.pg.pgUtil.getColumns | table:${tables[i]} | error: `, err.message);});
}

function getColumns() {
    return new Promise((resolve, reject) => {
      console.log(`vpMapped.service.pg.getColumns | staticColumns:`, staticColumns);
      resolve(staticColumns);
    });
}

async function getCount(params={}) {
    var where = pgUtil.whereClause(params, staticColumns);
    const text = `select count(*) from vpmapped ${where.text};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

//TO-DO: filter out non-display pools for non-admin users
//maybe do this by having roles available here, filtering queries based on role.
async function getStats(params={"username":null}) {
    if ('null' == params.username || !params.username) {params.username='unknownnobodyperson';}
    console.log('getStats | params.username=', params.username);
    const text = `
select
(select count("mappedPoolId") from vpmapped) as total_data,
(select count("mappedPoolId") from vpmapped where "mappedPoolStatus"!='Eliminated' AND "mappedPoolStatus"!='Duplicate'
) as total,
(select count("mappedPoolId") from vpmapped where "mappedPoolStatus"='Potential') as potential,
(select count("mappedPoolId") from vpmapped where "mappedPoolStatus"='Probable') as probable,
(select count("mappedPoolId") from vpmapped where "mappedPoolStatus"='Confirmed') as confirmed,
(select count("mappedPoolId") from vpmapped where "mappedPoolStatus"='Duplicate') as duplicate,
(select count("mappedPoolId") from vpmapped where "mappedPoolStatus"='Eliminated') as eliminated,
(select count(distinct "mappedPoolId") from vpmapped m
left join vpvisit v on v."visitPoolId"=m."mappedPoolId"
left join vpreview r on r."reviewVisitId"=v."visitId"
where
("reviewId" IS NULL AND "visitId" IS NOT NULL
--OR (r."updatedAt" IS NOT NULL AND m."updatedAt" > r."updatedAt")
--OR (r."updatedAt" IS NOT NULL AND v."updatedAt" > r."updatedAt")
)) as review,
(select count(distinct("visitPoolId")) from vpvisit
inner join vpmapped on vpmapped."mappedPoolId"=vpvisit."visitPoolId"
where "mappedPoolStatus"!='Eliminated' AND "mappedPoolStatus"!='Duplicate'
) as visited,
(select count(distinct("surveyPoolId")) from vpsurvey
inner join vpmapped on "mappedPoolId"="surveyPoolId"
) as monitored,
(select count(distinct("mappedPoolId")) from vpmapped
left join vpvisit on "mappedPoolId"="visitPoolId"
left join vpsurvey on "mappedPoolId"="surveyPoolId"
where "mappedByUser"='${params.username}'
OR "visitUserName"='${params.username}'
OR "surveyUserId"=(SELECT id from vpuser WHERE username='${params.username}')
) as mine;`;
    return await query(text); //this can't work with a multi-command statement. results are returned per-command.

    /*
      Here's how it must be done if using the view 'pool_stats'. instead of in-lining values as above to this:
      where "mappedByUser"=current_setting('params.username')
      OR "visitUserName"=current_setting('params.username')
    */
    /*
    const text = `SET params.username = ${params.username}; SELECT * from pool_stats;`;
    var res = await query(text);
    console.log(res[1].rows);
    return {"rowCount":res[1].rowCount, "rows":res[1].rows};
    */
}

async function getOverview(params={}) {
    var where = pgUtil.whereClause(params, staticColumns);
    const text = `
SELECT
"townId",
"townName",
"countyName",
"mappedPoolId" AS "poolId",
"mappedPoolStatus" AS "poolStatus",
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 1) AS latitude,
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 2) AS longitude,
"mappedPoolId",
"mappedPoolStatus",
"mappedByUser",
"mappedMethod",
"mappedConfidence",
"mappedObserverUserName",
"mappedLandownerPermission",
"createdAt",
"updatedAt"
FROM vpmapped
LEFT JOIN vptown ON "mappedTownId"="townId"
LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
${where.text};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

async function getAll(params={}) {
    console.log('vpmapped.service::getAll | ', staticColumns);
    var where = pgUtil.whereClause(params, staticColumns);
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
vpmapped."createdAt" AS "mappedCreatedAt",
vpmapped."updatedAt" AS "mappedUpdatedAt"
FROM vpmapped
LEFT JOIN vptown ON "mappedTownId"="townId"
LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
LEFT JOIN vpuser ON "mappedUserId"=id
${where.text};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

async function getPage(page, params={}) {
    page = Number(page) ? Number(page) : 1;
    const pageSize = Number(params.pageSize) ? Number(params.pageSize) : 10;
    const offset = (page-1) * pageSize;
    var orderClause = '';
    if (params.orderBy) {
        var col = params.orderBy.split("|")[0];
        var dir = params.orderBy.split("|")[1]; dir = dir ? dir : '';
        orderClause = `order by "${col}" ${dir}`;
    }
    var where = pgUtil.whereClause(params, staticColumns); //whereClause filters output against vpmapped.columns
    const text = `
SELECT (SELECT count(*) from vpmapped ${where.text}),
"townId",
"townName",
"countyName",
"mappedPoolId" AS "poolId",
"mappedPoolStatus" AS "poolStatus",
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 1) AS latitude,
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 2) AS longitude,
vpmapped.*,
"createdAt" AS "mappedCreatedAt",
"updatedAt" AS "mappedUpdatedAt"
FROM vpmapped
LEFT JOIN vptown ON "mappedTownId"="townId"
LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
${where.text} ${orderClause}
offset ${offset} limit ${pageSize};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

async function getById(id) {
    const text = `
SELECT
"townId",
"townName",
"countyName",
"mappedPoolId" AS "poolId",
"mappedPoolStatus" AS "poolStatus",
"createdAt" AS "mappedCreatedAt",
"updatedAt" AS "mappedUpdatedAt",
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 1) AS latitude,
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 2) AS longitude,
vpmapped.*
FROM vpmapped
LEFT JOIN vptown ON "mappedTownId"="townId"
LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
WHERE "mappedPoolId"=$1;`
    return await query(text, [id]);
}

async function getGeoJson(params={}) {
    console.log('vpMapped.service | getGeoJson |', params);
    //console.log('vpMapped.service | getGeoJson |', staticColumns);
    var where = pgUtil.whereClause(params, staticColumns);
    where.pretty = JSON.stringify(params).replace(/\"/g,'');
    const sql = `
    SELECT
      row_to_json(fc) as geojson
      FROM (
        SELECT
    		'FeatureCollection' AS type,
    		'Vermont Vernal Pool Atlas - Mapped Pools' AS name,
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
                  vptown."townName",
                  vpcounty."countyName",
                  vpmapped.*
                ) AS p
              ) AS properties
            FROM vpmapped
            LEFT JOIN vptown on "mappedTownId"=vptown."townId"
            LEFT JOIN vpcounty ON "townCountyId"="govCountyId"
            LEFT JOIN vpuser ON "mappedUserId"=id
            ${where.text}
        ) AS f
      ) AS fc`;
    console.log('vpMapped.service | getGeoJson |', where.text, where.values);
    return await query(sql, where.values);
}

/*
  For shapeFiles, we allow the usual db columns as query parameters. In addition, 
  we require req.query.authUser, passed from the UI, to be used in the filesystem
  to save a unique version of the downlaod for this user (to handle simultaneity).
*/
async function getShapeFile(params={}, excludeHidden=1) {
  var where = pgUtil.whereClause(params, staticColumns, 'AND');
  where.pretty = JSON.stringify(params).replace(/\"/g,'');
  where.combined = where.text;
  where.values.map((val, idx) => {
    console.log('vpMapped.service::getShapeFile | WHERE values', val, idx);
    where.combined = where.combined.replace(`$${idx+1}`, `'${val}'`)
  })
  console.log('vpMapped.service::getShapeFile | WHERE', where);
  let qry = `SELECT
  "mappedPoolId" AS "poolId",
  "mappedPoolStatus" AS "poolStatus",
  CONCAT('https://vpatlas.org/pools/list?poolId=',"mappedPoolId",'&zoomFilter=false') AS "poolUrl",
  "townName",
  "countyName",
  vpmapped.*
  FROM vpmapped
  LEFT JOIN vptown on "mappedTownId"="townId"
  LEFT JOIN vpcounty ON "townCountyId"="govCountyId"
  LEFT JOIN vpuser ON "mappedUserId" = id
  WHERE TRUE
  ${where.combined}
  `;
  if (excludeHidden) {qry += ` AND "mappedPoolStatus" NOT IN ('Duplicate', 'Eliminated')`}
  return await shapeFile(qry, params.authUser, 'vpmapped')
}

async function create(body) {
    var queryColumns = pgUtil.parseColumns(body, 1, [], staticColumns);
    text = `insert into vpmapped (${queryColumns.named}) values (${queryColumns.numbered}) returning "mappedPoolId"`;
    console.log(text, queryColumns.values);
    return await query(text, queryColumns.values);
}

async function update(id, body) {
    console.log(`vpMapped.service.update | before pgUtil.parseColumns`, staticColumns);
    var queryColumns = pgUtil.parseColumns(body, 2, [id], staticColumns);
    text = `update vpmapped set (${queryColumns.named}) = (${queryColumns.numbered}) where "mappedPoolId"=$1 returning "mappedPoolId"`;
    console.log(text, queryColumns.values);
    return await query(text, queryColumns.values);
}

async function _delete(id) {
    return await query(`delete from vpmapped where "mappedPoolId"=$1;`, [id]);
}
