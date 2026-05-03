/*
  Mid-Alpha development, the team decided that 'Mapped Pools' and 'Pool Visits'
  should just be one list of items having different amounts of data. This module
  serves the gets for those joined table queries.
*/
const db = require('_helpers/db_postgres');
const query = db.query;
const pgUtil = require('_helpers/db_pg_util');
const common = require('_helpers/db_common');
const Moment = require('moment');
var staticColumns = [];

module.exports = {
    getColumns,
    getCount,
    getOverview,
    getPoolsNeedReview, //no longer used. for primary UX view of data, all queries call getOverview. views of data are filtered in UI logic (uxValuesService.ts)
    getAll,
    getPage,
    getByVisitId,
    getByPoolId
};

//file scope list of vpPools tables' columns retrieved at app startup (see 'getColumns()' below)
const tables = [
  "vpmapped",
  "vpvisit",
  "vpreview",
  "vpsurvey",
  "vpsurvey_amphib",
  "vpsurvey_macro",
  "vptown",
  "vpcounty"
];
for (i=0; i<tables.length; i++) {
  pgUtil.getColumns(tables[i], staticColumns) //run it once on init: to create the array here. also diplays on console.
    .then(res => {return res;})
    .catch(err => {console.log(`vpPools.service.pg.pgUtil.getColumns | table:${tables[i]} | error: `, err.message);});
}

function getColumns() {
  return new Promise((resolve, reject) => {
    console.log(`vpPools.service.pg.getColumns | staticColumns:`, staticColumns);
    resolve(staticColumns);
  });
}

async function getCount(body={}) {
    var where = pgUtil.whereClause(body, staticColumns);
    const text = `select count(*) from vpvisit ${where.text};`;
    console.log(text, where.values);
    return await query(text, where.values);
}

/*
  The NEW primary map/table overview query.

  A new, minimized dataset for the primary map/table overview query.

  This still supports filtering results by "updatedAt" to reduce network
  traffic and speed the UX.

  Otherwise, the new paradigm is to query UX-filterable values here to be
  filtered in UI logic (uxvalues.service.ts).

  To filter by user, we return mappedByUser, mappedUserName, visitUserName, visitObserverUserName, surveyUserName
*/
async function getOverview(params={}) {
  if (0 === Object.keys(params).length) {params={timestamp:'1970-01-31'};}
  if (!params.timestamp) {params.timestamp = '1970-01-01'};
  var timestamp = params.timestamp;
  delete params.timestamp;
  console.log('vpPools.service::getOverview | timestamp', timestamp);
  var orderClause = 'order by "poolId"';
  var where = pgUtil.whereClause(params, staticColumns, 'AND');
  if (params.visitHasIndicator) {where.text += ' AND '; where.text += common.visitHasIndicator();}
  var text = `
SELECT
"townId",
"townName",
"countyName",
"mappedPoolId" AS "poolId",
"mappedPoolStatus" AS "poolStatus",
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 1) AS latitude,
SPLIT_PART(ST_AsLatLonText("mappedPoolLocation", 'D.DDDDDD'), ' ', 2) AS longitude,
"mappedByUser",
"mappedUserId",
mappeduser.username AS "mappedUserName",
"mappedMethod",
"mappedConfidence",
"mappedLocationUncertainty",
vpmapped."updatedAt" AS "mappedUpdatedAt",
"visitId",
"visitUserId",
"visitUserName",
"visitObserverUserName",
--visitobserver.username AS "visitObserverUserName", --use this when we improve database to use a userId for visitObserver
"visitDate",
"visitVernalPool",
  COALESCE("visitWoodFrogAdults",0)+
  COALESCE("visitWoodFrogLarvae",0)+
  COALESCE("visitWoodFrogEgg",0)+
  COALESCE("visitSpsAdults",0)+
  COALESCE("visitSpsLarvae",0)+
  COALESCE("visitSpsEgg",0)+
  COALESCE("visitJesaAdults",0)+
  COALESCE("visitJesaLarvae",0)+
  COALESCE("visitJesaEgg",0)+
  COALESCE("visitBssaAdults",0)+
  COALESCE("visitBssaLarvae",0)+
  COALESCE("visitBssaEgg",0)+
  COALESCE("visitFairyShrimp",0)+
  COALESCE("visitFingerNailClams",0)
AS "speciesCount",
(SELECT array_agg( --sumAmphib[0] and sumAmphib[1]
  "surveyAmphibEdgeWOFR"+"surveyAmphibEdgeSPSA"+"surveyAmphibEdgeJESA"+"surveyAmphibEdgeBLSA"+
  "surveyAmphibInteriorWOFR"+"surveyAmphibInteriorSPSA"+"surveyAmphibInteriorJESA"+"surveyAmphibInteriorBLSA")
  AS "sumAmphib" FROM vpsurvey_amphib WHERE "surveyAmphibSurveyId"="surveyId"),
(SELECT
  "surveyMacroNorthFASH"+"surveyMacroEastFASH"+"surveyMacroSouthFASH"+"surveyMacroWestFASH"+
  "surveyMacroNorthCDFY"+"surveyMacroEastCDFY"+"surveyMacroSouthCDFY"+"surveyMacroWestCDFY"
  AS "sumMacros" FROM vpsurvey_macro WHERE "surveyMacroSurveyId"="surveyId"),
vpvisit."updatedAt" AS "visitUpdatedAt",
"reviewId",
"reviewQACode",
"reviewPoolStatus",
vpreview."updatedAt" AS "reviewUpdatedAt",
"surveyId",
"surveyUserId",
COALESCE(surveyuser.handle, surveyuser.username) AS "surveyUserName",
--surveyamphibuser.username AS "surveyAmphibObsUser", --remove this, it adds too many rows to results
vpsurvey."updatedAt" AS "surveyUpdatedAt",
(ARRAY(SELECT "visitId" FROM vpvisit WHERE "visitPoolId"="mappedPoolId")) AS visits,
--(ARRAY(SELECT "reviewId" FROM vpreview WHERE "reviewPoolId"="mappedPoolId")) AS reviews, --adds 1 second to query. why?
(ARRAY(SELECT "surveyId" FROM vpsurvey WHERE "surveyPoolId"="mappedPoolId")) AS surveys,
(SELECT COUNT(*) FROM vpvisit_photos WHERE "visitPhotoVisitId" IN
    (SELECT "visitId" FROM vpvisit WHERE "visitPoolId"="mappedPoolId"))::int AS "photoCount"
FROM vpmapped
LEFT JOIN vpvisit ON "visitPoolId"="mappedPoolId"
LEFT JOIN vpreview ON "reviewVisitId"="visitId" -- Must be reviews by visitId, not by poolId
LEFT JOIN vpsurvey ON "surveyPoolId"="mappedPoolId"
--LEFT JOIN vpsurvey_amphib ON "surveyAmphibSurveyId"=vpsurvey."surveyId" --remove this, it adds too many rows to results
LEFT JOIN vptown ON "mappedTownId"="townId"
LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
LEFT JOIN vpuser AS mappeduser ON "mappedUserId"=mappeduser."id"
--LEFT JOIN vpuser AS visitobserver ON "visitObserverUserId"=visitobserver."id"
LEFT JOIN vpuser AS surveyuser ON "surveyUserId"=surveyuser."id"
--LEFT JOIN vpuser AS surveyamphibuser ON "surveyAmphibObsId"=surveyamphibuser."id" --remove this, it adds too many rows to results
WHERE
(vpmapped."updatedAt">'${timestamp}'::timestamp
OR vpvisit."updatedAt">'${timestamp}'::timestamp
OR vpreview."updatedAt">'${timestamp}'::timestamp
OR vpsurvey."updatedAt">'${timestamp}'::timestamp)
${where.text} ${orderClause}`;
  console.log('vpPools.service::getOverview | query', text);
  console.log('vpPools.service::getOverview | timestamp NOW:', Moment.utc().format());
  return await query(text, where.values);
}

/*
  This endpoint serves the UI filter for 'Review', which is all the pools that need
  to be Reviewed by an administrator.

  NOTE: This endpoint is no longer used by the primary map/table UX view. To speed the UX,
  it calls getOverview, and results are filtered in UI logic (uxValuesService.ts).
*/
async function getPoolsNeedReview(params={}) {
  console.log('vpPools.service::getPoolsNeedReview | params:', params);
  var orderClause = `ORDER BY vpreview."updatedAt"`;
  if (!params.timestamp) {params.timestamp = '1970-01-01';}
  const timestamp = params.timestamp;
  var where = pgUtil.whereClause(params, staticColumns, 'AND');
  text = `
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
"mappedLocationUncertainty",
--"mappedObserverUserId",
vpmapped."updatedAt" AS "mappedUpdatedAt",
"visitId",
"visitPoolId",
"visitUserName",
"visitDate",
"visitVernalPool",
"visitLatitude",
"visitLongitude",
vpvisit."updatedAt" AS "visitUpdatedAt",
"reviewId",
"reviewQACode",
"reviewPoolStatus",
vpreview."updatedAt" AS "reviewUpdatedAt",
"surveyId",
vpsurvey."updatedAt" AS "surveyUpdatedAt"
FROM vpvisit
JOIN vpmapped ON "visitPoolId"="mappedPoolId"
LEFT JOIN vpreview ON "reviewPoolId"="mappedPoolId"
LEFT JOIN vpsurvey ON "surveyPoolId"="mappedPoolId"
LEFT JOIN vptown ON "mappedTownId"="townId"
LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
--LEFT JOIN vpuser ON "mappedByUserId"="id";
WHERE
("reviewId" IS NULL AND "visitId" IS NOT NULL
--New db triggers update vpmapped when review saved, so this criterion doesn't work.
--OR (vpreview."updatedAt" IS NOT NULL AND vpmapped."updatedAt" > vpreview."updatedAt")
--With S123-Visit, too many pools get updated frequently. This criterion is a nuisance.
--OR (vpreview."updatedAt" IS NOT NULL AND vpvisit."updatedAt" > vpreview."updatedAt")
)
AND
(vpmapped."updatedAt">'${timestamp}'::timestamp
OR vpvisit."updatedAt">'${timestamp}'::timestamp
OR vpreview."updatedAt">'${timestamp}'::timestamp
OR vpsurvey."updatedAt">'${timestamp}'::timestamp
)
${where.text}
${orderClause};
`;
    console.log(text, where.values);
    return await query(text, where.values);
}

/*
  getAll serves API endpoints needing *all* fields. This no longer serves map/table
  views.
*/
async function getAll(params={}) {
    var orderClause = 'order by "mappedPoolId"';
    if (params.orderBy) {
        var col = params.orderBy.split("|")[0];
        var dir = params.orderBy.split("|")[1]; dir = dir ? dir : '';
        orderClause = `order by "${col}" ${dir}`;
    }
    delete params.orderBy;
    var pagingClause = '';
    if (params.offset || params.limit) {
      var offset = params.offset ? params.offset : 0;
      var limit = params.limit ? params.limit : 10;
      pagingClause = `offset ${offset} limit ${limit}`;
    }
    delete params.offset;
    delete params.limit;
    var hasIndicator = params.visitHasIndicator;
    delete params.visitHasIndicator;
    var where = pgUtil.whereClause(params, staticColumns);
    // Indicator-species filter: match if EITHER an Atlas Visit OR a Monitoring
    // Survey for this pool reports any indicator species. NULLs (when there's
    // no visit/survey row) compare false, so the OR is safe.
    if (hasIndicator) {
        if (where.text) where.text += ' AND ';
        else where.text = ' WHERE ';
        where.text += `(${common.visitHasIndicator()} OR ${common.surveyHasIndicator()})`;
    }
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
vpmapped."updatedAt" AS "mappedUpdatedAt",
vpvisit.*,
vpvisit."createdAt" AS "visitCreatedAt",
vpvisit."updatedAt" AS "visitUpdatedAt",
vpvisit_photos.*,
vpreview.*,
vpreview."createdAt" AS "reviewCreatedAt",
vpreview."updatedAt" AS "reviewUpdatedAt"
--list all vpSurvey columns except email
,"surveyId"
,"surveyGlobalId"
,"surveyPoolId"
,"surveyTypeId"
,"surveyUserId"
,"surveyDate"
,"surveyTime"
,"surveyPoolLatitude"
,"surveyPoolLongitude"
,"surveyPoolBorderJson"
,"surveyAcousticMonitor"
,"surveyHoboLogger"
,"surveyHoboData"
,"surveyCustomLogger"
,"surveyIceCover"
,"surveyWaterLevel"
,"surveySubmergedVeg"
,"surveyFloatingVeg"
,"surveyEmergentVeg"
,"surveyShrubs"
,"surveyTrees"
,"surveyPhysicalParametersNotes"
,"surveyAirTempF"
,"surveyHumidity"
,"surveyWindBeaufort"
,"surveyWeatherConditions"
,"surveyWeatherNotes"
,"surveySpermatophores"
,"surveyAmphibMacroNotes"
,"surveyEdgeVisualImpairment"
,"surveyInteriorVisualImpairment"
,"surveyAmphibJson"
,"surveyMacroJson"
,"surveyYearJson"
,"surveyPhotoJson"
,"surveyObjectId"
,"surveyDataUrl"
,"surveyServiceId",
vpsurvey."createdAt" AS "surveyCreatedAt",
vpsurvey."updatedAt" AS "surveyUpdatedAt",
vpsurvey_photos.*,
(SELECT COUNT(*) FROM vpvisit_photos WHERE "visitPhotoVisitId" IN
    (SELECT "visitId" FROM vpvisit v2 WHERE v2."visitPoolId"="mappedPoolId"))::int AS "photoCount"
FROM vpmapped
LEFT JOIN vpvisit ON vpvisit."visitPoolId"="mappedPoolId"
LEFT JOIN vpvisit_photos ON "visitPhotoVisitId"="visitId"
LEFT JOIN vpreview ON "reviewVisitId"="visitId"
LEFT JOIN vpsurvey ON "surveyPoolId"="mappedPoolId"
LEFT JOIN vpsurvey_photos ON "surveyPhotoSurveyId"="surveyId"
LEFT JOIN vptown ON "mappedTownId"=vptown."townId"
LEFT JOIN vpcounty ON "govCountyId"="townCountyId"
${where.text} ${orderClause} ${pagingClause};`;

    console.log(text, where.values);
    return await query(text, where.values);
}

async function getPage(page, params={}) {
    page = Number(page) ? Number(page) : 1;
    const limit = Number(params.pageSize) ? Number(params.pageSize) : 10;
    const offset = (page-1) * pageSize;
    params.offset = offset;
    params.limit = limit;
    return getAll(params);
}

function getByVisitId(id) {
  return getAll({visitId:id});
}

function getByPoolId(id) {
  return getAll({mappedPoolId:id});
}
