const express = require('express');
const router = express.Router();
const service = require('./vp_s3_info.service');

// routes
router.get('/bucket/:bucketName', getByBucketName);

module.exports = router;

function getByBucketName(req, res, next) {
    console.log('vp_s3_info.routes.getByBucketName req.params', req.params);
    service.getByBucketName(req.params.bucketName)
        .then(items => res.json(items))
        .catch(err => next(err));
}
