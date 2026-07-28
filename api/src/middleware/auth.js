'use strict';

const crypto = require('crypto');
const { Router } = require('express');
const { runtimeConfig } = require('../config');
const { authenticateUser, currentSessionUser, publicUser } = require('../services/user-directory');

const COOKIE_NAME = 'bmb_soc_session';

function parseCookies(header = '') {
  return Object.fromEntries(String(header).split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return index < 0 ? [part, ''] : [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest();
}

function equalSecret(actual, expected) {
  return crypto.timingSafeEqual(digest(actual), digest(expected));
}

function signPayload(payload, secret) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyPayload(token, secret) {
  try {
    const [encoded, signature] = String(token || '').split('.');
    if (!encoded || !signature) return null;
    const expected = crypto.createHmac('sha256', secret).update(encoded).digest('base64url');
    if (!equalSecret(signature, expected)) return null;
    const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() >= payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

function sessionFor(user, config = runtimeConfig()) {
  return {
    sub:String(user.id),
    sv:Number(user.session_version),
    csrf: crypto.randomBytes(24).toString('base64url'),
    exp: Date.now() + config.sessionTtlMinutes * 60 * 1000,
  };
}

function cookieOptions(config = runtimeConfig()) {
  return [
    `${COOKIE_NAME}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    config.cookieSecure ? 'Secure' : '',
  ].filter(Boolean);
}

function setSessionCookie(res, token, config = runtimeConfig()) {
  const options = cookieOptions(config);
  options[0] = `${COOKIE_NAME}=${encodeURIComponent(token)}`;
  options.push(`Max-Age=${config.sessionTtlMinutes * 60}`);
  res.setHeader('Set-Cookie', options.join('; '));
}

function clearSessionCookie(res, config = runtimeConfig()) {
  const options = cookieOptions(config);
  options.push('Max-Age=0');
  res.setHeader('Set-Cookie', options.join('; '));
}

async function readAuth(req, config = runtimeConfig()) {
  if (config.authDisabled) {
    return {
      user:{ id:null, username:'development', display_name:'Development Administrator', role:'administrator' },
      authType:'development',
      csrf:null,
    };
  }

  const authorization = String(req.headers.authorization || '');
  if (authorization.startsWith('Bearer ') && config.apiKey && equalSecret(authorization.slice(7), config.apiKey)) {
    return {
      user:{ id:null, username:'service', display_name:'Service Account', role:'administrator' },
      authType:'api_key',
      csrf:null,
    };
  }

  const token = parseCookies(req.headers.cookie)[COOKIE_NAME];
  const payload = verifyPayload(token, config.sessionSecret);
  if (!payload || !payload.sub || !Number.isInteger(payload.sv)) return null;
  const user = await currentSessionUser(payload.sub, payload.sv);
  if (!user) return null;
  return {
    user:publicUser(user),
    authType: 'session',
    csrf: payload.csrf,
  };
}

async function requireAuth(req, res, next) {
  if (req.path === '/health' || req.path === '/auth/login') return next();
  try {
    const auth = await readAuth(req);
    if (!auth) return res.status(401).json({ error: 'Authentication required' });
    Object.assign(req, auth);
    next();
  } catch (error) {
    next(error);
  }
}

function requireCsrf(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.authType !== 'session') return next();
  if (!req.csrf || !equalSecret(req.headers['x-csrf-token'] || '', req.csrf)) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

function requireRoles(...allowedRoles) {
  const allowed = new Set(allowedRoles);
  return (req, res, next) => {
    if (req.user?.role && allowed.has(req.user.role)) return next();
    return res.status(403).json({ error: 'This role cannot perform the requested operation' });
  };
}

function authRouter() {
  const router = Router();

  router.post('/auth/login', async (req, res, next) => {
    const config = runtimeConfig();
    if (config.authDisabled) {
      return res.json({
        user:{ id:null, username:'development', display_name:'Development Administrator', role:'administrator' },
        csrf:null,
      });
    }
    const username = typeof req.body?.username === 'string' ? req.body.username : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!username || username.length > 128 || !password || password.length > 256) {
      return res.status(401).json({ error:'Invalid credentials' });
    }
    try {
      const account = await authenticateUser(username, password);
      if (!account) return res.status(401).json({ error:'Invalid credentials' });
      const session = sessionFor(account, config);
      setSessionCookie(res, signPayload(session, config.sessionSecret), config);
      res.json({ user:publicUser(account), csrf:session.csrf });
    } catch (error) {
      next(error);
    }
  });

  router.get('/auth/session', async (req, res, next) => {
    try {
      const auth = await readAuth(req);
      if (!auth) return res.status(401).json({ error:'Authentication required' });
      res.json({ user:auth.user, csrf:auth.csrf });
    } catch (error) {
      next(error);
    }
  });

  router.post('/auth/logout', async (req, res, next) => {
    try {
      const auth = await readAuth(req);
      if (!auth) return res.status(401).json({ error:'Authentication required' });
      if (auth.authType === 'session' && (!auth.csrf || !equalSecret(req.headers['x-csrf-token'] || '', auth.csrf))) {
        return res.status(403).json({ error:'Invalid CSRF token' });
      }
      clearSessionCookie(res);
      res.json({ ok:true });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

module.exports = {
  COOKIE_NAME, authRouter, clearSessionCookie, parseCookies, readAuth,
  requireAuth, requireCsrf, requireRoles, sessionFor, signPayload, verifyPayload,
};
