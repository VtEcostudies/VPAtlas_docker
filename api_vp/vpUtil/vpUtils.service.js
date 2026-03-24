const db = require('_helpers/db_postgres');
const query = db.query;
const pgUtil = require('_helpers/db_pg_util');
var staticColumns = [];

module.exports = {
    testWhereClause
};

const tables = [
  "vpmapped",
  "vpvisit",
  "vpreview",
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
    .then(res => {return res;})
    .catch(err => {console.log(`vpUtils.service.pg.pgUtil.getColumns | table:${tables[i]} | error: `, err.message);});
}

async function testWhereClause(query) {
  const where = pgUtil.whereClause(query, staticColumns);
  return new Promise((resolve, reject) => {
    resolve(where);
  });
}
