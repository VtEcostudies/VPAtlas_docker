const db = require('_helpers/db_postgres');
const query = db.query;
const pgUtil = require('_helpers/db_pg_util');
const fetch = require('node-fetch');
const vpS123Util = require('vpUtil/vpS123.service');
const moment = require('moment');
const config = require('../config_s123.json');
var staticColumns = []; //all tables' columns in a single 1D array
var tableColumns = []; //each table's columns by table name

const defaultServiceId = config.survey123.vpsurvey.serviceId; //'service_e4f2a9746905471a9bb0d7a2d3d2c2a1';
//former services having direct attachments: service_fae86d23c46e403aa0dae67596be6073, service_71386df693ec4db8868d7a7c64c50761
const defaultFeatureId = 0;
const maximumFeatureId = 7;
const attachFeatureIds = {1:'WOFR',2:'SPSA',3:'JESA',4:'BLSA',5:'FASH',6:'CDFY',7:'POOL'};
const upsertAtchWiData = 1;
var abort = 0; //flag to abort loading, sent via the API

module.exports = {
    getData,
    getServices,
    getUploads,
    getUpsertData,
    getAttachments,
    getUpsertAttachments,
    getUpsertAll,
    abortAll
};

//file scope list of vpSurvey tables' columns retrieved at app startup (see 'getColumns()' below)
const tables = [
  "vpsurvey",
  "vpsurvey_equipment_status",
  "vpsurvey_year",
  "vpsurvey_amphib",
  "vpsurvey_macro",
  "vpsurvey_photos",
  "vpsurvey_uploads",
  "vptown"
];
for (i=0; i<tables.length; i++) {
  pgUtil.getColumns(tables[i], staticColumns) //run it once on init: to create the array here. also diplays on console.
    .then(res => {
      tableColumns[res.tableName] = res.tableColumns;
      return res;
    })
    .catch(err => {console.log(`vpSurvey.service.pg.pgUtil.getColumns | table:${tables[i]} | error: `, err.message);});
}

function getData(req) {
  return new Promise((resolve, reject) => {
    if (!req.query.serviceId) {req.query.serviceId = defaultServiceId;}
    vpS123Util.getData(req.query)
      .then(jsonData => {
        console.log('vpSurvey.s123.service::getData | RESULTS', jsonData);
        resolve(jsonData);
      })
      .catch(err => {
        console.log('vpSurvey.s123.service::getData | ERROR', err.message);
        reject(err);
      });
    });
}

/* Get a list of serviceIds with MAX objectId and updatedAt from vpsurvey */
function getServices(req) {
  const where = pgUtil.whereClause(req.query, staticColumns, "AND");
  let text = `SELECT MAX("surveyObjectId") AS "surveyObjectId", MAX("updatedAt") AS "surveyUpdatedAt", "surveyServiceId" 
  FROM vpsurvey 
  WHERE "surveyServiceId" IS NOT NULL
  ${where.text} --AND "surveyServiceId"='service_e4f2a9746905471a9bb0d7a2d3d2c2a1'
  GROUP BY "surveyServiceId"
  ORDER BY MAX("updatedAt")`;
  
  return query(text, where.values);
}

/* Get a list of uploads for serviceId(s) from vpsurvey */
function getUploads(req) {
  const where = pgUtil.whereClause(req.query, staticColumns);
  let text = `SELECT *,
  (ARRAY(SELECT "surveyPhotoUrl" FROM vpsurvey_photos WHERE "surveyPhotoSurveyId"="surveyId")) AS photos 
  FROM vpsurvey 
  ${where.text} --AND "surveyServiceId"='service_e4f2a9746905471a9bb0d7a2d3d2c2a1'
  ORDER BY "updatedAt" DESC
  `;
  
  return query(text, where.values);
}

function abortAll(req) {
  abort = 1;
  return Promise.resolve({message:'Abort requested!'})
}

 //you MUST parseInt on string values used to control for-loops!!!
function getUpsertAll(req) {
  abort = 0; //always start this way
  return new Promise(async (resolve, reject) => {
    var offset = req.query.offset?parseInt(req.query.offset):1; //you MUST parseInt on string values used to contol for-loops!!!
    var limit = req.query.limit?parseInt(req.query.limit):1; //you MUST parseInt on string values used to contol for-loops!!!
    var stop = offset + limit;
    var sucs = [], errs = []; counts = {};
    for (z=offset; z<stop; z++) {
      req.query.featureId = 0;
      req.query.objectId = z;
      if (abort) {
        break;
      } else {
        await getUpsertData(req)
          .then(res => {
            //console.log('vpSurvey.s123.service::getupsertAll | RESULTS', res);
            sucs.push(res);
          })
          .catch(err => {
            console.log('vpSurvey.s123.service::getupsertAll | ERROR | err.message:', err.message, err);
            errs.push(err)
          });
      }//end else
    }
    counts.success = sucs.length;
    counts.errors = errs.length;
    counts.target = limit;
    counts.total = z - offset;
    counts.aborted = abort;
    console.log('vpSurvey.s123.service::getupsertAll | RESULTS |', counts);
    resolve({counts:counts, results:sucs, errors:errs})
  });
}

function getUpsertData(req) {
  return new Promise((resolve, reject) => {
    if (!req.query.serviceId) {req.query.serviceId = defaultServiceId;}
    vpS123Util.getData(req.query)
      .then(jsonData => {
        upsertSurvey(req, jsonData) //put a single json Data object into array for future multi-object upsert
          .then(res => {resolve(res);})
          .catch(err => {reject(err);})
      })
      .catch(err => {
        console.log('vpSurvey.s123.service::getUpsertData | ERROR', err.message);
        reject(err);
      });
    });
}

function upsertSurvey(req, jsonData) {
  var update = 0;
  return new Promise((resolve, reject) => {
    try {
      if (req.query) {update = req.query.update === 'true';}
      const obsDelim = '_'; //delimiter for observer field prefix
      var colum = null; var split = []; var obsId = 0;
      var surveyColumns = []; //tableColumns['vpsurvey']; //this fails. pgpDb INSERT needs to match values to columns
      Object.keys(jsonData).forEach(colum => {
        split = colum.split(obsDelim); colum = split[split.length-1]; obsId=(2==split.length?split[0]:0);
        if (tableColumns['vpsurvey'].includes(colum)) surveyColumns.push(colum);
      });
      surveyColumns.push('surveyServiceId'); //optional. passed in req.query
      surveyColumns.push('surveyGlobalId'); //optional. sent as 'globalid'
      surveyColumns.push('surveyObjectId'); //required. sent as 'objectid'
      surveyColumns.push('surveyDataUrl'); //required. sent as 'dataUrl'
      surveyColumns.push('surveyAmphibJson');
      surveyColumns.push('surveyMacroJson');
      surveyColumns.push('surveyYearJson');
      surveyColumns.push('surveyPhotoJson');
      //console.log('vpsurvey.s123.upsertSurvey | vpsurvey header', surveyColumns);
      var valArr = [];
      var surveyRow = {}; //single object of colum:value pairs for one insert row into vpsurvey
      var amphibRow = {}; //array of objects of colum:value pairs to insert in jsonb column of vpsurvey_amphib
      var macroRow = {}; //array of objects of colum:value pairs to insert in jsonb column of vpsurvey_macro
      var yearRow = {}; //single object of colum:value pairs to insert in jsonb column of vpsurvey_year
      var photoRow = {}; //single object of colum:value pairs to insert in jsonb column of vpsurvey_photos
      var colum = null;
      var split = [];
      var obsId = 1; //obsId is 1-based for actual observers
      var value = null; //temporary local var to hold values for scrubbing
      jsonData.surveyServiceId = req.query.serviceId; //serviceId is passed with request from UI or set from default
      jsonData['surveyGlobalId'] = jsonData.globalid; //this is required
      jsonData['surveyObjectId'] = jsonData.objectid; //this is required
      jsonData['surveyDataUrl'] = jsonData.dataUrl; //this is required
      Object.keys(jsonData).forEach(colum => { //iterate over keys in jsonData object (column names)
        value = jsonData[colum]; //this MUST be done FIRST, before stripping the leading 'obsN_'
        value = typeof value === 'string' ? value.trim() : value; //values with leading/trailing spaces can muck db triggers
        split = colum.split(obsDelim); colum = split[split.length-1]; //observer column_name is the last piece
        obsId = (2==split.length?split[0]:0); //did we get two array-elements split by '_'? If yes, flag it.
        obsId = (obsId?obsId.slice(-1):0); //if flagged above, obsId is the trailing number of 'obs2...'
        if (obsId && !amphibRow[obsId]) {amphibRow[obsId] = {};} //initialize valid amphibRow array element
        if ('' === value) {value = null;} //convert empty strings to null
        if (`${Number(value)}` === value) {value = Number(value);} //convert string number to numbers (MUST USE '===' or it converts bool to int!!!)
        if (tableColumns['vpsurvey'].includes(colum)) {surveyRow[colum] = fixJsonColumnData(colum, value, jsonData);}
        if (tableColumns['vpsurvey_photos'].includes(colum)) {photoRow[colum]=value;}
        if (tableColumns['vpsurvey_year'].includes(colum)) {yearRow[colum]=value;}
        if (tableColumns['vpsurvey_macro'].includes(colum)) {macroRow[colum]=value;}
        if (tableColumns['vpsurvey_amphib'].includes(colum)) {amphibRow[obsId][colum]=value;}

/*
        if ('surveyTypeId'==colum && value===5) surveyRow[colum]=9; //map their 5 to our 9
        if ('surveyUserEmail'==colum && value===null) { //if not explicitly passed, use obs1 or obs2 for surveyUserEmail
          surveyRow[colum]=jsonData['obs1_surveyAmphibObsEmail']?jsonData['obs1_surveyAmphibObsEmail']:jsonData['obs2_surveyAmphibObsEmail'];
        }
        //if ('surveyUserEmail'==colum && value===null) surveyRow[colum]=req.query.surveyUserEmail;
        if ('surveyTime'==colum && !value) {
          surveyRow[colum]='00:00';
        }
*/
      });
      surveyRow['surveyAmphibJson'] = amphibRow; //set the vpsurvey jsonb column value for survey_amphib table
      surveyRow['surveyMacroJson'] = macroRow; //set the vpsurvey jsonb column value for survey_macro table
      surveyRow['surveyYearJson'] = yearRow; //set the vpsurvey jsonb column value for survey_year table
      surveyRow['surveyPhotoJson'] = photoRow; //set the vpsurvey jsonb column value for survey_photos table
      valArr.push(surveyRow);
      var columns = [];
      var query = null;
      //https://stackoverflow.com/questions/37300997/multi-row-insert-with-pg-promise
      columns = new db.pgp.helpers.ColumnSet(surveyColumns, {table: 'vpsurvey'});
      query = db.pgp.helpers.insert(valArr, columns);
      if (update) {
        query += `
        ON CONFLICT ON CONSTRAINT "unique_surveyGlobalId"
        DO UPDATE SET ("${surveyColumns.join('","')}")=(EXCLUDED."${surveyColumns.join('",EXCLUDED."')}")`;
        }
      query += ' RETURNING "surveyId","surveyPoolId","surveyGlobalId","surveyObjectId","surveyDataUrl","surveyUserEmail","surveyUserId","createdAt"!="updatedAt" AS updated ';
      //console.log('vpsurvey.upload | query', query); //verbatim query with values for testing
      //console.log('vpsurvey.s123.service::upsertSurvey | columns', columns);
      //console.log('vpsurvey.s123.service::upsertSurvey | values', valArr);
    } catch (err) {
      err.globalId = jsonData.globalid;
      err.objectId = jsonData.objectid;
      err.dataUrl = jsonData.dataUrl;
      console.log('vpsurvey.s123.service::upsertSurvey | try-catch ERROR', err.message, err.dataUrl);
      reject(err);
    }
    db.pgpDb.many(query) //'many' for expected return values
      .then(res_data => { //pgpDB.many return an array of results
        console.log('vpsurvey.s123.service::upsertSurvey-pgpDb | SUCCESS:', res_data);
        //to-do: create a for loop to handle multiple survey inserts
        req.query.surveyId = res_data[0].surveyId;
        req.query.globalId = res_data[0].surveyGlobalId;
        req.query.objectId = res_data[0].surveyObjectId;
        if (upsertAtchWiData) {
          getUpsertAttachments(req)
            .then(res_atch => {
              console.log('getUpsertAttachments AFTER getUpsertData | DOUBLE SUCCESS:', {data:res_data[0], attachments:res_atch});
              resolve({data:res_data[0], attachments:res_atch});
            })
            .catch(err_atch => {
              console.log('getUpsertAttachments AFTER getUpsertData | MIXED RESULTS:', {data:res_data[0], attachments:err_atch});
              resolve({data:res_data[0], attachments:err_atch});
            })
          } else {
            resolve(res_data);
          }
      })
      .catch(err => {
        err.globalId = jsonData.globalid;
        err.objectId = jsonData.objectid;
        err.dataUrl = jsonData.dataUrl;
        err.hint = err.message; //err.message here does not percolate on return
        console.log('vpsurvey.s123.service::upsertSurvey-pgpDb | ERROR', err.message, err.dataUrl);
        reject(err);
      }); //end pgpDb
  }); //end promise
}

function fixJsonColumnData(colum, value, jsonData) {
  var fixed = null;
  switch(colum) {
    /*
    case 'surveyGlobalId': fixed=jsonData.globalid; break;
    case 'surveyObjectId': fixed=jsonData.objectid; break;
    case 'surveyDataUrl': fixed=jsonData.dataUrl; break;
    */
    case 'surveyTypeId': fixed=value; if (value===5) fixed=9; break;
    case 'surveyUserEmail': fixed=value; if (!value) fixed=jsonData['obs1_surveyAmphibObsEmail']?jsonData['obs1_surveyAmphibObsEmail']:jsonData['obs2_surveyAmphibObsEmail']; break;
    case 'surveyTime': fixed=value; if (!value) fixed='00:00'; break;
    case 'surveyAmphibEdgeWOFR': fixed=value+0; break;
    case 'surveyAmphibEdgeSPSA': fixed=value+0; break;
    case 'surveyAmphibEdgeJESA': fixed=value+0; break;
    case 'surveyAmphibEdgeBLSA': fixed=value+0; break;
    case 'surveyAmphibInteriorWOFR': fixed=value+0; break;
    case 'surveyAmphibInteriorSPSA': fixed=value+0; break;
    case 'surveyAmphibInteriorJESA': fixed=value+0; break;
    case 'surveyAmphibInteriorBLSA': fixed=value+0; break;
    case 'surveyMacroNorthFASH': fixed=value+0; break;
    case 'surveyMacroEastFASH': fixed=value+0; break;
    case 'surveyMacroSouthFASH': fixed=value+0; break;
    case 'surveyMacroWestFASH': fixed=value+0; break;
    case 'surveyMacroTotalFASH': fixed=value+0; break;
    case 'surveyMacroNorthCDFY': fixed=value+0; break;
    case 'surveyMacroEastCDFY': fixed=value+0; break;
    case 'surveyMacroSouthCDFY': fixed=value+0; break;
    case 'surveyMacroWestCDFY': fixed=value+0; break;
    case 'surveyMacroTotalCDFY': fixed=value+0; break;
    default: fixed=value;
  }
  fixed = typeof fixed === 'string' ? fixed.trim() : fixed; //values with leading/trailing spaces can muck db triggers
  console.log('vpSurvey.s123.service::fixJsonColumnData |', colum, value, fixed)
  return fixed;
}

/*
https://services1.arcgis.com/d3OaJoSAh2eh6OA9/ArcGIS/rest/services/{defaultServiceId}/
FeatureServer/[1,2,3,4,5,6,7]/
queryAttachments
?objectIds=1&globalIds=&returnUrl=true&f=pjson

To get attachments for a VPSurvey
- required: objectId from the parent Survey
- optional: featureId of featureServer to limit results to a single repeatTable
  - featureId == [1, 2, 3, ...7] for VPSurvey

Without a featureId, getAttachments loops over all featureIds for VPSurvey.
*/
function getAttachments(req) {
  return new Promise(async (resolve, reject) => {
    var beg=1, end=maximumFeatureId, parentId=0, atchArr=[], atchErr=[];
    if (!req.query.serviceId) {req.query.serviceId = defaultServiceId;}
    if (req.query.featureId) {beg=req.query.featureId; end=req.query.featureId;}
    else {beg=1; end=maximumFeatureId;}
    for (var i=beg; i<=end; i++) {
      req.query.featureId=i;
      await vpS123Util.getRepeatAttachments(req.query)
        .then(jsonParent => {
          console.log(i, '| vpSurvey.s123.service::getAttachments | RESULTS', jsonParent);
          parentId = jsonParent.parentObjectId;
          atchArr = atchArr.concat(jsonParent.attachmentInfos);
        })
        .catch(err => {
          console.log(i, '| vpSurvey.s123.service::getAttachments | ERROR', err.message);
          atchErr.push(err.message);
        }); //end getRepeatAttachments
      } //end for-loop
      console.log('vpSurvey.s123.service::getAttachments | ERRORS', atchErr);
      console.log('vpSurvey.s123.service::getAttachments | RESULTS', atchArr);
      resolve({parentObjectId:parentId, attachmentInfos:atchArr});
    }); //end promise
}

function getUpsertAttachments(req) {
  return new Promise((resolve, reject) => {
    if (!req.query.objectId && !req.query.globalId && !req.query.surveyId) {
      reject({message:`surveyId and surveyObjectId and surveyGlobalId missing. Cannot upsert attachments without at least one.`});
    };
    getSurveyIdFromS123Id(req.query)
      .then(surveyId => {
        req.query.surveyId = surveyId;
        if (!req.query.serviceId) {req.query.serviceId = defaultServiceId;}
        getAttachments(req)
          .then(jsonParent => {
            console.log('vpSurvey.s123.service::getUpsertAttachments | RESULTS', jsonParent);
            upsertAttachments(req, jsonParent)
              .then(res => {resolve(res);})
              .catch(err => {reject(err);})
          })
          .catch(err => {
            console.log('vpSurvey.s123.service::getUpsertAttachments | ERROR', err.message);
            reject(err);
          });
      })
      .catch(err => {
        reject({message:`No parent survey in database. Cannot upsert attachments for parent globalId ${req.query.globalId}`});
      })
    }); //end promise
}

function getSurveyIdFromS123Id(qry) {
  return new Promise((resolve, reject) => {
    if (qry.surveyId > 0) {
      console.log('getSurveyIdFromS123Id | INPUT surveyId:', qry.surveyId);
      resolve(qry.surveyId);
    } else if (qry.objectId) {
      query(`SELECT "surveyId" FROM vpsurvey WHERE "surveyObjectId"=$1`, [qry.objectId])
        .then(res => {
          const id = res.rowCount?res.rows[0].surveyId:0;
          console.log('getSurveyIdFromS123Id | INPUT objectId:', qry.objectId, ' | RESULT:', res.rowCount?res.rows[0].surveyId:0);
          if (id) {resolve(id);}
          else {reject(0);}
        })
        .catch(err => {
          console.log('getSurveyIdFromS123Id | ERROR:', err.message);
          resolve(0);
       });
    } else if (qry.globalId) {
      query(`SELECT "surveyId" FROM vpsurvey WHERE "surveyGlobalId"=$1`, [qry.globalId])
        .then(res => {
          const id = res.rowCount?res.rows[0].surveyId:0;
          console.log('getSurveyIdFromS123Id | INPUT globalId:', qry.globalId, ' | RESULT:', res.rowCount?res.rows[0].surveyId:0);
          if (id) {resolve(id);}
          else {reject(0);}
        })
        .catch(err => {
          console.log('getSurveyIdFromS123Id | ERROR:', err.message);
          resolve(0);
       });
     } else {
       console.log('getSurveyIdFromS123Id | ERROR: surveyId, objectId, or globalId not found in request object.');
       reject(0);
     }//end else
   }); //end promise
}

/*
  INSERT or UPDATE an array of attachmentInfos for a single surveyId into table
  vpsurvey_photos.
*/
function upsertAttachments(req, jsonParent) {
  var update = 0;
  return new Promise((resolve, reject) => {
    try {
      if (!req.query.surveyId) {throw({message:'surveyId required to Upsert attachments.'});}
      if (!jsonParent.attachmentInfos.length) {throw({message:'No attachments found.'});}
      if (req.query) {update = !!req.query.update;}
      const jsonArr = jsonParent.attachmentInfos;
      //const typeArr = ['WOFR','SPSA','JESA','BLSA','FASH','CDFY','POOL'];
      var valArr = [];
      console.log('upsertAttachments | jsonArr', jsonArr);
      for (i=0; i<jsonArr.length; i++) { //iterate over jsonData objects in jsonArray
        var photoRow = {}; //single object of colum:value pairs for one insert row into vpsurvey_photos
        photoRow['surveyPhotoSurveyId']=req.query.surveyId;
        photoRow['surveyPhotoUrl']=jsonArr[i].url;
        photoRow['surveyPhotoName']=jsonArr[i].name;
        photoRow['surveyPhotoSpecies']=attachFeatureIds[jsonArr[i].featureServerId]; //we set this now for each attachmentInfo in vpS123.service::getFeatureAttachmentInfo(...)
/*
        var type = 'UNKNOWN';
        var keyw = jsonArr[i].keywords.toUpperCase();
        for (j=0; j<typeArr.length; j++) {
          type = keyw.includes(typeArr[j])?typeArr[j]:'UNKNOWN';
        }
        photoRow['surveyPhotoSpecies']=type;
*/
        valArr.push(photoRow);
      }
      var columns = [];
      var query = null;
      var photoColumns = tableColumns['vpsurvey_photos']; //make a copy so it can be altered in case of UPDATE, below.
      //https://stackoverflow.com/questions/37300997/multi-row-insert-with-pg-promise
      columns = new db.pgp.helpers.ColumnSet(photoColumns, {table: 'vpsurvey_photos'});
      query = db.pgp.helpers.insert(valArr, columns);
      if (update) {
        query += `
        ON CONFLICT ON CONSTRAINT "vpsurvey_photos_unique_surveyId_species_url"
        DO UPDATE SET ("${photoColumns.join('","')}")=(EXCLUDED."${photoColumns.join('",EXCLUDED."')}")`;
      }
      query += ' RETURNING *';
      console.log('vpSurvey.s123.service::upsertAttachments | query', query); //verbatim query with values for testing
      //console.log('vpSurvey.s123.service::upsertAttachments | columns', columns);
      //console.log('vpSurvey.s123.service::upsertAttachments | values', valArr);
      db.pgpDb.many(query) //'many' for expected return values
        .then(res => {
          console.log('vpSurvey.s123.service::upsertAttachments | pgpDb RESULTS', res);
          resolve(res);
        })
        .catch(err => {
          console.log('vpSurvey.s123.service::upsertAttachments | pgpDb ERROR', err.message);
          reject(err);
        }); //end pgpDb
    } catch (err) {
      console.log('vpSurvey.s123.service::upsertAttachments | try-catch ERROR', err.message);
      reject(err);
    }
  }); //end Promise
}
