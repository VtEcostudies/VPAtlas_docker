const os = require("os");
const process = require('process');
const config = require('../config');

const env = {
    os_host: os.hostname(),
    api_env: process.env.NODE_ENV || 'env-local',
    db_env: config.db
}

console.log('env.js | env', env);

module.exports = {
    env: env
}
