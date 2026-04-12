/*
  vpSurvey.field.routes.js — Field survey endpoints (LoonWeb pattern)

  New endpoints for the offline-first field survey app.
  Uses explicit parent + child inserts instead of JSON triggers.

  Mounted at /survey/field
*/
const express = require('express');
const router = express.Router();
const service = require('./vpSurvey.field.service');

router.get('/:id', getById);
router.post('/', create);
router.put('/:id', update);

module.exports = router;

function getById(req, res, next) {
    service.getById(req.params.id)
        .then(result => {
            if (!result) return res.status(404).json({ message: 'Survey not found' });
            res.json(result);
        })
        .catch(err => {
            console.log('vpSurvey.field.routes.getById | error:', err);
            next(err);
        });
}

function create(req, res, next) {
    console.log('vpSurvey.field.routes.create req.body:');
    console.dir(req.body, { depth: 3 });

    // Validate before touching DB
    let errors = service.validate(req.body);
    if (errors.length) {
        return res.status(400).json({ errors });
    }

    service.create(req.body)
        .then(result => res.json(result))
        .catch(err => {
            console.log('vpSurvey.field.routes.create | error:', err);
            next(err);
        });
}

function update(req, res, next) {
    let id = req.params.id;
    console.log(`vpSurvey.field.routes.update id=${id} req.body:`);
    console.dir(req.body, { depth: 3 });

    // Validate before touching DB
    let errors = service.validate(req.body);
    if (errors.length) {
        return res.status(400).json({ errors });
    }

    service.update(id, req.body)
        .then(result => res.json(result))
        .catch(err => {
            console.log('vpSurvey.field.routes.update | error:', err);
            next(err);
        });
}
