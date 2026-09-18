'use strict';

const crypto  = require('crypto');
const jwt     = require('jsonwebtoken');
const db      = require('../../config/db');
const env     = require('../../config/env');

const RETENTION_MS = 24 * 60 * 60 * 1000;

function resolveUserId(req) {
  if (req.user && req.user.id) return req.user.id;
  const authHeader = req.headers.authorization;
  const token = authHeader && authHeader.startsWith('Bearer ')
    ? authHeader.split(' ')[1]
    : (req.query && req.query.token) || null;
  if (!token) return null;
  try {
    const decoded = jwt.verify(token, env.JWT_ACCESS_SECRET);
    return decoded.id || null;
  } catch (err) {
    return null;
  }
}

function hashRequestBody(req) {
  let raw = req.body;
  if (raw instanceof Buffer || raw instanceof Uint8Array) {
    raw = Buffer.from(raw).toString();
  } else if (raw && typeof raw === 'object') {
    raw = JSON.stringify(raw);
  } else {
    raw = String(raw || '');
  }
  return crypto.createHash('sha256')
    .update(`${req.method}|${req.originalUrl}|${raw}`)
    .digest('hex');
}

function isRecordable(body) {
  if (body === undefined || body === null) return false;
  if (Buffer.isBuffer(body)) return false;
  if (body && typeof body === 'object') {
    if (typeof body.pipe === 'function') return false;
    if (body instanceof Uint8Array) return false;
  }
  return true;
}

module.exports = function idempotency() {
  return async function idempotencyMiddleware(req, res, next) {
    const key = req.headers['idempotency-key'];
    const method = (req.method || '').toUpperCase();
    if (!key || !['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) return next();

    const userId = resolveUserId(req);
    const path = req.originalUrl;
    const requestHash = hashRequestBody(req);

    try {
      const { rows } = await db.query(
        `SELECT status_code, response_body, request_hash
           FROM idempotency_keys
          WHERE key = $1 AND user_id IS NOT DISTINCT FROM $2
            AND method = $3 AND path = $4`,
        [key, userId, method, path]
      );

      if (rows.length > 0) {
        const existing = rows[0];
        if (existing.request_hash !== requestHash) {
          return res.status(409).json({
            success: false,
            message: 'Idempotency-Key was reused with a different request',
          });
        }
        return res.status(existing.status_code).json(existing.response_body);
      }

      let recorded = false;
      const record = (statusCode, body) => {
        if (recorded) return;
        recorded = true;
        if (!isRecordable(body)) return;
        db.query(
          `INSERT INTO idempotency_keys (key, user_id, method, path, request_hash, status_code, response_body)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (key, user_id, method, path) DO NOTHING`,
          [key, userId, method, path, requestHash, statusCode, JSON.stringify(body)]
        ).catch((err) => console.error('[IDEMPOTENCY] store failed:', err.message));

        db.query(
          `DELETE FROM idempotency_keys WHERE created_at < NOW() - ($1 || ' milliseconds')::interval`,
          [RETENTION_MS]
        ).catch(() => {});
      };

      res.on('finish', () => {
        if (res.statusCode >= 200 && res.statusCode < 500) {
          record(res.statusCode, res.__idemBody);
        }
      });

      const _json = res.json.bind(res);
      res.json = (body) => { res.__idemBody = body; return _json(body); };
      const _send = res.send.bind(res);
      res.send = (body) => { res.__idemBody = res.__idemBody || body; return _send(body); };

      return next();
    } catch (err) {
      return next(err);
    }
  };
};