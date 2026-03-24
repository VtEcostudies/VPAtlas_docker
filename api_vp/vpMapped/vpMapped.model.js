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
    initVpMapped,
    createVpMappedTable,
    importCSV,
    upgradeVpMapped
};  

async function initVpMapped() {
    createVpMappedTable()
        .then(res => {
            pgUtil.getColumns("vpmapped", staticColumns);
            importCSV()
                .then(res => {return res;})
                .catch(err => {return err;});
        })
        .catch(err => {
            return err;
        });
}

/*
 chain upgrades together here
 -query dbversion for last successful upgrade by upgrade name
 -increment upgrade number from last successful
 -use upgrade number to try the next one
 */
async function upgradeVpMapped() {
    const nextQuery = 'SELECT max("dbVersionId") AS "dbVersionId" FROM dbversion;';
    await query(nextQuery)
    .then(res => {
        var next = Number(res.rows[0].dbVersionId);
        next++;
        console.log('vpMapped.model.upgradeVpMapped | next upgrade Id:', next);
        try_upgrade(next)
            .then(res => {
                console.log(res);
                return res;
            })
            .catch(err => {
                console.log(err);
                return err;
            });
    })
    .catch(err => {
        console.log('vpMapped.model.upgradeVpMapped | err:', err);
        return err;
    });
}

async function createVpMappedTable() {
    const sqlVpMappedTable = fs.readFileSync(path.resolve(__dirname, '/db.01/vpMapped.table.sql')).toString();
    console.log('vpMapped.model.createVpMappedTable | query:', sqlVpMappedTable);
    await query(sqlVpMappedTable)
    .then(res => {
        console.log(`createVpMappedTable() | res:`, res);
        return res;
    })
    .catch(err => {
        console.log(`createVpMappedTable() | err:`, err.message);
        throw err;
    });
}

async function importCSV(csvFileName='vpmapped.20190520.csv') {
    const sqlVpMappedImportCsv = fs.readFileSync(path.resolve(__dirname, '/db.01/vpMapped.import.sql')).toString();
    const qtext = `${sqlVpMappedImportCsv} FROM '${path.resolve(__dirname, csvFileName)}' DELIMITER ',' CSV HEADER;`;
    console.log('vpMapped.model.importCSV | query:', qtext);
    await query(qtext)
    .then(res => {
        console.log(`vpMapped.service.importCSV() | res:`, res);
        return res;
    })
    .catch(err => {
        console.log(`vpMapped.service.importCSV() | err:`, err.message);
        throw err;
    });
}

async function upgrade01() {
    const sqlUpgrade01 = fs.readFileSync(path.resolve(__dirname, '/db.01/db.upgrade_1.sql')).toString();
    console.log('vpMapped.model.upgrade01 | query:', sqlUpgrade01);
    await query(sqlUpgrade01)
    .then(res => {
        console.log(`upgrade01() | res:`, res);
        return res;
    })
    .catch(err => {
        console.log(`upgrade01() | err:`, err.message);
        throw err;
    });
}

async function try_upgrade(next) {
    const upgradeFile = path.resolve(__dirname, `db.upgrade_${next}.sql`);
    if (!fs.existsSync(upgradeFile)) {        
        throw `Error: ${upgradeFile} does not exist.`;
    }
    const sqlUpgrade = fs.readFileSync(upgradeFile).toString();
    console.log(`vpMapped.model.upgrade_${next} | query:`, sqlUpgrade);
    await query(sqlUpgrade)
    .then(res => {
        console.log(`vpMapped.model.upgrade_${next} | res:`, res);
        return query (`INSERT INTO dbversion
                    ("dbVersionId","dbUpgradeFileName","dbUpgradeScript")
                    VALUES (${next},${upgradeFile},${sqlUpgrade})`);
    })
    .catch(err => {
        console.log(`vpMapped.model.upgrade_${next} | err:`, err.message);
        throw err;
    });
}
