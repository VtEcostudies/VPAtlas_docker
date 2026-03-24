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

module.exports.importCounties = function() {
    importCSV('COPY vpcounty ("countyId","govCountyId","countyName")', 'vtCounties.csv')
};

module.exports.importTowns = function() {
    importCSV('COPY vptown ("townId","townName","townCountyId")', 'vtTowns.csv')
};

async function importCSV(sqlCopy, csvFileName) {
    const qtext = `${sqlCopy} FROM '${path.resolve(__dirname, csvFileName)}' DELIMITER ',' CSV HEADER;`;
    console.log('vtInfo.model.importCSV | query:', qtext);
    await query(qtext)
    .then(res => {
        console.log(`vtInfo.model.importCSV() | res:`, res);
        return res;
    })
    .catch(err => {
        console.log(`vtInfo.model.importCSV() | err:`, err.message);
        throw err;
    });
}
