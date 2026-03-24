require('dotenv').config(); // load environment variables from .env file
const secrets = require('./secrets');
const process = require('process');
const os = require('os');

module.exports = {

  "disableLogins": false,
  "secret": secrets.apiSecret,
  "vceEmail": process.env.APP_EMAIL || 'vpatlas@vtecostudies.org',
  "vcePassW": secrets.emailPassword,
  "userTbl": "vpuser",
  "roleTbl": "vprole",

  "token" : {
    "required": true,
    "ignoreExpiry": true,
    "loginExpiry": "24 hours",
    "registrationExpiry": "1 hour",
    "resetExpiry": "1 hour"
  },

  "os" : {
    "host": os.hostname()
  },

  "ui": {
    "protocol": process.env.UI_PROT || 'http',
    "host": process.env.UI_HOST || 'localhost',
    "port": process.env.UI_PORT || '8090'
  },

  "api": {
    "protocol": process.env.API_PROT || 'http',
    "host": process.env.API_HOST || 'localhost',
    "port": process.env.API_PORT || '4010'
  },

  "db": {
    "host": process.env.DB_HOST || 'localhost',
    "port": process.env.DB_PORT || '5432',
    "user": process.env.DB_USER || 'postgres',
    "database": process.env.DB_NAME || 'vpatlas',
    "password": process.env.DB_PASSWORD || 'postgres'
  }

}
