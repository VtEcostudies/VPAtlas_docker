// secrets.js - Sensitive credentials loaded from environment variables.
// In production, set these via docker-compose environment or a .env file.
// NEVER commit real secrets to version control.

const process = require('process');

module.exports = {
  apiSecret: process.env.API_SECRET || 'vpatlas-dev-secret-change-in-production',
  emailPassword: process.env.EMAIL_PASSWORD || ''
}
