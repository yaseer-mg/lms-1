'use strict';

const fs          = require('fs');
const service     = require('./files.service');
const ApiResponse = require('../../shared/utils/apiResponse');
const ApiError    = require('../../shared/utils/apiError');

// Upload
async function upload(req, res, next) {
  try {
    if (!req.file) throw ApiError.badRequest('No file provided');

    const { context, ownerId, isPublic } = req.body;
    if (!context) throw ApiError.badRequest('File context is required (e.g. lesson_video, avatar)');
    if (!ownerId) throw ApiError.badRequest('ownerId is required');

    await service.verifyFileContextOwner(context, ownerId, req.user);

    const file = await service.saveFile({
      uploadedFile: req.file,
      context,
      ownerId,
      uploadedBy: req.user.id,
      isPublic: isPublic === 'true',
    });

    ApiResponse.created(res, { file }, 'File uploaded successfully');
  } catch (err) {
    // If Multer put a temp file and we error out, clean it up.
    if (req.file?.path) {
      fs.unlink(req.file.path, () => {});
    }
    next(err);
  }
}

// Force-attachment download of a private file (PDFs and other lesson resources).
async function serveDownload(req, res, next) {
  try {
    await service.verifyFileAccess(req.params.id, req.user);

    const { absPath, mimeType, sizeBytes, originalName } = await service.getFilePath(req.params.id);

    const fallbackName = originalName || `download-${req.params.id.slice(0, 8)}`;
    res.setHeader('Content-Type', mimeType || 'application/octet-stream');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Length', sizeBytes);
    res.setHeader('Content-Disposition', `attachment; filename="${fallbackName.replace(/["\r\n]/g, '')}"`);

    const stream = fs.createReadStream(absPath);
    stream.on('error', () => next(ApiError.notFound('File not found')));
    stream.pipe(res);
  } catch (err) {
    next(err);
  }
}

// Serve private file
// Public files are served directly by Nginx.
// This endpoint handles auth-gated private files.
async function serve(req, res, next) {
  try {
    await service.verifyFileAccess(req.params.id, req.user);

    const { absPath, mimeType, sizeBytes } = await service.getFilePath(req.params.id);

    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');

    const inline = mimeType.startsWith('image/') || mimeType === 'application/pdf';
    res.setHeader('Content-Disposition', inline ? 'inline' : 'attachment');

    const range = req.headers.range;
    if (range && sizeBytes > 0) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : sizeBytes - 1;
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${sizeBytes}`);
      res.setHeader('Content-Length', chunkSize);

      const stream = fs.createReadStream(absPath, { start, end });
      stream.on('error', () => next(ApiError.notFound('File not found')));
      stream.pipe(res);
    } else {
      if (sizeBytes) res.setHeader('Content-Length', sizeBytes);
      const stream = fs.createReadStream(absPath);
      stream.on('error', () => next(ApiError.notFound('File not found')));
      stream.pipe(res);
    }
  } catch (err) {
    next(err);
  }
}

// Soft delete
async function remove(req, res, next) {
  try {
    await service.deleteFile(req.params.id, req.user.id, req.user);
    ApiResponse.success(res, {}, 'File deleted');
  } catch (err) {
    next(err);
  }
}

// Serve public file — no auth needed, only is_public = true files
async function servePublic(req, res, next) {
  try {
    const { absPath, isPublic, mimeType, sizeBytes } = await service.getFilePath(req.params.id);
    if (!isPublic) throw ApiError.forbidden('File is not public');

    res.setHeader('Content-Type', mimeType);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Accept-Ranges', 'bytes');

    const inline = mimeType.startsWith('image/') || mimeType === 'application/pdf';
    res.setHeader('Content-Disposition', inline ? 'inline' : 'attachment');

    const range = req.headers.range;
    if (range && sizeBytes > 0) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : sizeBytes - 1;
      const chunkSize = end - start + 1;

      res.status(206);
      res.setHeader('Content-Range', `bytes ${start}-${end}/${sizeBytes}`);
      res.setHeader('Content-Length', chunkSize);

      const stream = fs.createReadStream(absPath, { start, end });
      stream.on('error', () => next(ApiError.notFound('File not found')));
      stream.pipe(res);
    } else {
      if (sizeBytes) res.setHeader('Content-Length', sizeBytes);
      const stream = fs.createReadStream(absPath);
      stream.on('error', () => next(ApiError.notFound('File not found')));
      stream.pipe(res);
    }
  } catch (err) {
    next(err);
  }
}

module.exports = { upload, serve, serveDownload, remove, servePublic };
