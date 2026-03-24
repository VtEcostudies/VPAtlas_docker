/*
 this module attempts to capture the process to create database elements, import
 initial datasets, then migrate those db elements and datasets over time.
 
 it is not foolproof. beware.
 */
const fs = require('fs'); //uses process.cwd() as root for relative paths
const path = require("path"); //needed to use paths relative to this file's location
const db = require('_helpers/db_postgres');
const query = db.query;
const pgUtil = require('_helpers/db_pg_util');
var staticColumns = [];

module.exports = {
    createVpVisitTable,
    importCSV,
};  

async function createVpVisitTable() {
    const sqlvpVisitTable = fs.readFileSync(path.resolve(__dirname, '/db.02/01.vpVisit.table.sql')).toString();
    console.log('vpVisit.model.createVpVisitTable | query:', sqlvpVisitTable);
    await query(sqlvpVisitTable)
    .then(res => {
        console.log(`createVpVisitTable() | res:`, res);
        return res;
    })
    .catch(err => {
        console.log(`createVpVisitTable() | err:`, err.message);
        throw err;
    });
}

async function importCSV(csvFileName='vpvisit.20190611.csv') {
    const sqlvpVisitImportCsv = fs.readFileSync(path.resolve(__dirname, '/db.02/02.vpVisit.import.sql')).toString();
    const qtext = `${sqlvpVisitImportCsv} FROM '${path.resolve(__dirname, csvFileName)}' DELIMITER ',' CSV HEADER;`;
    console.log('vpVisit.model.importCSV | query:', qtext);
    await query(qtext)
    .then(res => {
        console.log(`vpVisit.service.importCSV() | res:`, res);
        return res;
    })
    .catch(err => {
        console.log(`vpVisit.service.importCSV() | err:`, err.message);
        throw err;
    });
}
