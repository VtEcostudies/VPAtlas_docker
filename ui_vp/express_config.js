/*
    Express server configuration.
    All values come from environment variables (set by docker-compose or .env file).
*/
const process = require('process');

// Build full URL (only include port for localhost)
function buildFqdn(protocol, host, port) {
    if (host === 'localhost') {
        return `${protocol}://${host}:${port}`;
    }
    return `${protocol}://${host}`;
}

const config = {
    ui: {
        protocol: process.env.UI_PROT || 'http',
        host: process.env.UI_HOST || 'localhost',
        port: process.env.UI_PORT || '8090'
    },
    api: {
        protocol: process.env.API_PROT || 'http',
        host: process.env.API_HOST || 'localhost',
        port: process.env.API_PORT || '4010'
    }
};

config.api.fqdn = buildFqdn(config.api.protocol, config.api.host, config.api.port);
config.ui.fqdn = buildFqdn(config.ui.protocol, config.ui.host, config.ui.port);

console.log('express_config.js =>', config);

module.exports = config;
