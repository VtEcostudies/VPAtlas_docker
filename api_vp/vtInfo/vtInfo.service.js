const db = require('_helpers/db_postgres');
const query = db.query;
const pgUtil = require('_helpers/db_pg_util');
var townColumns = [];

module.exports = {
    getCounties,
    getCounty,
	getTowns,
	getTown
};

pgUtil.getColumns("vptown", townColumns) //run it once on init: to create the array here. also diplays on console.
    .then(res => {return res;})
    .catch(err => {
        console.log(`vtInfo.service.pg.pgUtil.getColumns | error: `, err.message);
    });

async function getCounties() {
    const text = `select * from vpcounty;`;
    return await query(text);
}

async function getCounty(id) {
    const text = `select * from vpcounty where "countyId"=$1;`;
    const res = await query(text,[id]);
    return res.rows;
}

async function getTowns(body={}) {
    const where = pgUtil.whereClause(body, townColumns);
    const text = `select * from vptown ${where.text} order by "townName";`;
    console.log(text, where.values);
    return await query(text, where.values);
}

async function getTown(id) {
    const text = `select * from vptown where "townId"=$1;`;
    return await query(text,[id]);
}
