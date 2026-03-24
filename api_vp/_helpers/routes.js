
function routes(router) {
    let ruts = {};
    for (const rut of router.stack) {
        ruts[rut.route.path] = rut.route.methods;
    }
    console.log('_helpers/routes::routes', ruts);
    return ruts;
}
module.exports = routes;