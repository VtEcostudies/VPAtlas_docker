const expressJwt = require('express-jwt');
const config = require('../config');
const userService = require('../users/vpUser.service.pg');

module.exports = jwt;

function jwt() {
    const secret = config.secret;
    const algorithms = ['HS256'];
    return expressJwt({ secret, algorithms, isRevoked }).unless({
        path: [
            // Public routes that don't require authentication
            '/users/authenticate',
            '/users/register',
            '/users/reset',
            '/users/verify',
            '/users/confirm',
            '/users/routes',
            '/users/test',

            { url: '/utils/untar', methods: ['GET'] },
            { url: /^\/utils\/timer/, methods: ['GET'] },
            { url: /^\/utils\/where/, methods: ['GET'] },

            { url: /^\/vtinfo\/towns/, methods: ['GET'] },
            { url: /^\/vtinfo\/counties/, methods: ['GET'] },
            { url: /^\/vtinfo\/routes/, methods: ['GET'] },

            { url: /^\/parcel\/townId\/.*/, methods: ['GET'] },
            { url: /^\/parcel\/townName\/.*/, methods: ['GET'] },

            { url: /^\/pools\/mapped\/.*/, methods: ['GET'] },
            { url: /^\/pools\/mapped\/page\/.*/, methods: ['GET'] },
            { url: /^\/mapped\/.*/, methods: ['GET'] },

            { url: /^\/pools\/visit\/.*/, methods: ['GET'] },
            { url: /^\/pools\/visit\/page\/.*/, methods: ['GET'] },
            { url: /^\/visit\/.*/, methods: ['GET'] },
            { url: /^\/visit\/pool\/.*/, methods: ['GET'] },

            { url: /^\/review/, methods: ['GET'] },

            { url: /^\/pools/, methods: ['GET'] },
            { url: /^\/pools\/.*/, methods: ['GET'] },
            { url: /^\/pools\/page\/.*/, methods: ['GET'] },

            { url: /^\/survey\/field\/\d+/, methods: ['GET'] },
            { url: /^\/survey\/columns/, methods: ['GET'] },
            { url: /^\/survey/, methods: ['GET'] },
            { url: /^\/survey\/.*/, methods: ['GET'] },
            { url: /^\/survey\/page\/.*/, methods: ['GET'] },
            { url: /^\/survey\/pool\/.*/, methods: ['GET'] },
        ]
    });
}

async function isRevoked(req, payload, done) {
    console.log(`jwt::isRevoked()
                req.body:[${Object.keys(req.body)}] [${Object.values(req.body)}]
                payload:[${Object.keys(payload)}] [${Object.values(payload)}]`
                );

    if (payload.sub) {
      req.user = await userService.getById(payload.sub);
      req.dbUser = req.user;
    }

    if (!req.user || config.disableLogins) {
        return done(null, true);
    }

    return done();
};
