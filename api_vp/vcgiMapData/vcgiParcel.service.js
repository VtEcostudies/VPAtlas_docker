const db = require('_helpers/db_postgres');
const query = db.query;

module.exports = {
    getTownParcelByTownName,
    getTownParcelByTownId
};

async function getTownParcelByTownName(param) {
    const text = `select * from vcgi_parcel where upper("${param.column}")=$1;`;
    return await query(text, [param.value]);
}
async function getTownParcelByTownId(param) {
    const text = `select * from vcgi_parcel where "${param.column}"=$1;`;
    return await query(text, [param.value]);
}
