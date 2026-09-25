'use strict';

const express = require('express');
const multer  = require('multer');
const path    = require('path');
const router  = express.Router();

const controller   = require('./files.controller');
const authenticate = require('../../shared/middleware/authenticate');
const authorize    = require('../../shared/middleware/authorize');
const storage      = require('../../config/storage');

// Multer config - files land in lmsdata/temp first
const tempDir = path.join(storage.lmsdataPath, 'temp');

const upload = multer({
  dest: tempDir,
  limits: {
    fileSize: 500 * 1024 * 1024, // 500 MB hard cap (per-context limits in service)
    files: 1,
  },
  // Don't filter here - let the service validate MIME types properly
});

// Public file serving — no auth required, only serves files marked is_public = true
router.get('/public/:id', controller.servePublic);

// Upload/delete require authentication
router.use(authenticate);

// File serving is after auth middleware (also accepts ?token= query param for <video> elements)
router.get('/:id', controller.serve);
router.get('/:id/download', controller.serveDownload);

router.post('/upload', authorize('instructor', 'admin'), upload.single('file'), controller.upload);
router.delete('/:id', authorize('instructor', 'admin'), controller.remove);

module.exports = router;
