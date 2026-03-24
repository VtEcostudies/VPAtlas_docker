const fs = require('fs');
const fastCsv = require('fast-csv');

const db = require('_helpers/db_postgres');
const query = db.query;
const pgUtil = require('_helpers/db_pg_util');
var staticColumns = []; //all tables' columns in a single 1D array
var tableColumns = []; //each table's columns by table name

module.exports = {
    upload,
    history
};

//file scope list of vpVisit tables' columns retrieved at app startup (see 'getColumns()' below)
const tables = [
  "vpvisit",
  "vpvisit_uploads",
  "vptown"
];
for (i=0; i<tables.length; i++) {
  pgUtil.getColumns(tables[i], staticColumns) //run it once on init: to create the array here. also diplays on console.
    .then(res => {
      tableColumns[res.tableName] = res.tableColumns;
      //console.log(tableColumns);
      return res;
    })
    .catch(err => {console.log(`vpVisit.service.pg.pgUtil.getColumns | table:${tables[i]} | error: `, err.message);});
}

function getColumns() {
    return new Promise((resolve, reject) => {
      console.log(`vpVisit.service.pg.getColumns | staticColumns:`, staticColumns);
      resolve(staticColumns);
    });
}

async function getHistory(params={}) {
  const where = pgUtil.whereClause(params, staticColumns);
  const text = `
  SELECT *
  FROM vpvisit_uploads
  ${where.text}
  `;
  console.log(text, where.values);
  return await query(text, where.values);
}

/*
  Upload a single csv file having one to many rows and insert/update these tables:

    - vpvisit

  Column Names in CSV file MUST conform to specific conventions. See sample spreadsheet for details.

*/
async function upload(req) {
  const fileRows = [];
  var logId = 0;
  var update = 0;

  return new Promise((resolve, reject) => {

    if (!req.file) {
      reject({message:`Upload file missing.`, error:true});
    }

    if (req.query) {update = 'true' == req.query.update;}

    console.log('upload | update:', update);

    insert_log_upload_attempt(req.file)
      .then(res => {console.log('insert_log_visit_upload_attempt | Success |', res.rows[0]); logId=res.rows[0].visitUploadId;})
      .catch(err => {console.log('insert_log_visit_upload_attempt | Error |', err.message);});

      fastCsv.parseFile(req.file.path)
        .on("error", (err) => {
            console.log('vpvisit.upload | fastCsv.parsefile ERROR', err.message);
            err.where = 'fast-csv.parseFile'; err.hint = 'File must be vpvisit CSV format with header columns.';
            reject(err);
        })
        .on("data", (data) => {
          fileRows.push(data); // push each row
        })
        .on("end", () => {
try { //try-catch with promise doesn't work wrapped around fastCsv call. Put inside .on("end")
          fs.unlinkSync(req.file.path); //this does nothing
          var colum = null;
          var visitColumns = [];
          for (i=0;i<fileRows[0].length;i++) {
            colum = fileRows[0][i];
            if (tableColumns['vpvisit'].includes(colum)) visitColumns.push(colum);
          }
          console.log('vpvisit header', visitColumns);
          var valArr = [];
          for (i=1;i<fileRows.length;i++) {
            var visitRow = {}; //single object of colum:value pairs for one insert row into vpVisit
            var colum = null;
            var value = null; //temporary local var to hold values for scrubbing
            for (j=0;j<fileRows[0].length;j++) {
              colum = fileRows[0][j];
              value = fileRows[i][j];
              if ('' === value) {value = null;} //convert empty strings to null
              if (`${Number(value)}` === value) {value = Number(value);} //convert string number to numbers (MUST USE '===' or it converts bool to int!!!)
              if (tableColumns['vpvisit'].includes(colum)) {visitRow[colum]=value;}
            }
            valArr.push(visitRow);
          }

          var columns = [];
          var query = null;
          //https://stackoverflow.com/questions/37300997/multi-row-insert-with-pg-promise
          columns = new db.pgp.helpers.ColumnSet(visitColumns, {table: 'vpvisit'});
          query = db.pgp.helpers.insert(valArr, columns);
          if (update) {
            query += `
            ON CONFLICT ON CONSTRAINT "vpVisit_unique_visitPoolId_visitDate_visitUserName"
            DO UPDATE SET ("${visitColumns.join('","')}")=(EXCLUDED."${visitColumns.join('",EXCLUDED."')}")`;
          }
          query += ' RETURNING "visitId", "visitPoolId", "createdAt"!="updatedAt" AS updated ';
          console.log('vpvisit.upload | query', query); //verbatim query with values for testing
          console.log('vpvisit.upload | columns', columns);
          console.log('vpvisit.upload | values', valArr);

} catch (err) {
  console.log('vpsurvey.upload | pgp.helpers try-catch ERROR', err.message);
  reject(err);
}

          db.pgpDb.many(query) //'many' for expected return values
            .then(res => {
              console.log('vpvisit.upload | pgpDb SUCCESS', res);
              update_log_upload_attempt(logId, {
                visitUploadSuccess:true,
                visitUploadRowCount:res.length,
                visitUploadvisitId:res
                });
              resolve(res);
            })
            .catch(err => {
              console.log('vpvisit.upload | pgpDb ERROR', err.message);
              update_log_upload_attempt(logId, {
                visitUploadSuccess:false,
                visitUploadError:err.message,
                visitUploadDetail:err.detail
                });
              reject(err);
            }); //end pgpDb
        }); //end fastCSV.parsefile
    }); //end Promise
}
/*
upload req.file:
{
  fieldname: 'vpVisit.csv',
  originalname: 'vpVisit.csv',
  encoding: '7bit',
  mimetype: 'text/csv',
  destination: 'vpVisit/uploads/',
  filename: '532fa603b058c6c6c9672bdf1ea50e8f',
  path: 'vpVisit\\uploads\\532fa603b058c6c6c9672bdf1ea50e8f',
  size: 1971
}
*/
async function insert_log_upload_attempt(body={}, update=false) {
  var columns = {};
  columns.named = [`"visitUpload_fieldname"`,`"visitUpload_mimetype"`,`"visitUpload_path"`,`"visitUpload_size"`,`"visitUploadType"`];
  columns.numbered = ['$1','$2','$3','$4','$5'];
  columns.values = [body.fieldname,body.mimetype,body.path,body.size,update?'update':'insert'];
  text = `insert into vpVisit_uploads (${columns.named}) values (${columns.numbered}) returning "visitUploadId"`;
  console.log('vpVisit.service::log_upload_attempt', text, columns.values);
  return await query(text, columns.values);
}

async function update_log_upload_attempt(visitUploadId=0, body={}) {
  var columns = pgUtil.parseColumns(body, 2, [visitUploadId], staticColumns);
  text = `update vpVisit_uploads set (${columns.named}) = (${columns.numbered}) where "visitUploadId"=$1`;
  console.log('vpVisit.service::log_upload_attempt', text, columns.values);
  return await query(text, columns.values);
}

async function history(params={}) {
  const where = pgUtil.whereClause(params, staticColumns);
  const text = `
  SELECT *
  FROM vpvisit_uploads
  ${where.text}
  `;
  console.log(text, where.values);
  return await query(text, where.values);
}
