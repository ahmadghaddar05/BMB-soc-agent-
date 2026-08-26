'use strict';

const crypto = require('crypto');
const { promisify } = require('util');
const db = require('../db');
const { AUTH_ROLES, runtimeConfig } = require('../config');

const scrypt = promisify(crypto.scrypt);
const SCRYPT_COST = 16384;
const SCRYPT_BLOCK_SIZE = 8;
const SCRYPT_PARALLELIZATION = 1;
const SCRYPT_KEY_LENGTH = 64;
const DUMMY_HASH = 'scrypt$16384$8$1$MDEyMzQ1Njc4OWFiY2RlZg$8Y0gdi3g7TmdDkG8MeTfgJCszt3U0T7AgO8Vtaz41G7Xj2glUo8F5CFrUv3I0fOEHHjZlaQS5adCP8FVr9wEoA';

function passwordError(password) {
  if (typeof password !== 'string') return 'Password is required';
  if (password.length < 12) return 'Password must be at least 12 characters';
  if (password.length > 256) return 'Password must be at most 256 characters';
  return null;
}

function usernameError(username) {
  if (typeof username !== 'string' || !username.trim()) return 'Username is required';
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/.test(username.trim())) {
    return 'Username must be 3-64 characters and use only letters, numbers, dots, underscores, or hyphens';
  }
  return null;
}

function displayNameError(displayName) {
  if (typeof displayName !== 'string' || !displayName.trim()) return 'Display name is required';
  if (displayName.trim().length > 120) return 'Display name must be at most 120 characters';
  return null;
}

function roleError(role) {
  return AUTH_ROLES.includes(role) ? null : 'Role is unsupported';
}

async function hashPassword(password) {
  const invalid = passwordError(password);
  if (invalid) throw new TypeError(invalid);
  const salt = crypto.randomBytes(16);
  const derived = await scrypt(password, salt, SCRYPT_KEY_LENGTH, {
    N: SCRYPT_COST,
    r: SCRYPT_BLOCK_SIZE,
    p: SCRYPT_PARALLELIZATION,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt', SCRYPT_COST, SCRYPT_BLOCK_SIZE, SCRYPT_PARALLELIZATION,
    salt.toString('base64url'), derived.toString('base64url'),
  ].join('$');
}

async function verifyPassword(password, encodedHash) {
  try {
    const [algorithm, cost, blockSize, parallelization, saltValue, hashValue] = String(encodedHash || '').split('$');
    if (algorithm !== 'scrypt' || !saltValue || !hashValue) return false;
    const expected = Buffer.from(hashValue, 'base64url');
    if (expected.length !== SCRYPT_KEY_LENGTH) return false;
    const actual = await scrypt(String(password || ''), Buffer.from(saltValue, 'base64url'), expected.length, {
      N:Number(cost), r:Number(blockSize), p:Number(parallelization), maxmem:64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function publicUser(row) {
  if (!row) return null;
  return {
    id:String(row.id),
    username:row.username,
    display_name:row.display_name,
    role:row.role,
    active:Boolean(row.active),
    created_by:row.created_by || null,
    created_at:row.created_at || null,
    updated_at:row.updated_at || null,
    last_login_at:row.last_login_at || null,
  };
}

async function authenticateUser(username, password, database = db) {
  const result = await database.query(
    `SELECT id,username,display_name,role,password_hash,active,session_version,
            created_by,created_at,updated_at,last_login_at
     FROM app_users WHERE LOWER(username)=LOWER($1) LIMIT 1`,
    [String(username || '').trim()]
  );
  const row = result.rows[0] || null;
  const passwordMatches = await verifyPassword(password, row?.password_hash || DUMMY_HASH);
  if (!row || !row.active || !passwordMatches) return null;
  await database.query('UPDATE app_users SET last_login_at=NOW() WHERE id=$1', [row.id]);
  return row;
}

async function currentSessionUser(id, sessionVersion, database = db) {
  const result = await database.query(
    `SELECT id,username,display_name,role,active,session_version,
            created_by,created_at,updated_at,last_login_at
     FROM app_users
     WHERE id=$1 AND active=TRUE AND session_version=$2
     LIMIT 1`,
    [id, sessionVersion]
  );
  return result.rows[0] || null;
}

async function bootstrapUserDirectory(config = runtimeConfig(), logger = console, database = db) {
  if (config.authDisabled) return { created:0, skipped:'authentication_disabled' };
  const client = await database.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext('bmb_soc_user_directory_bootstrap'))");
    const existing = await client.query('SELECT COUNT(*)::int AS total FROM app_users');
    if (Number(existing.rows[0]?.total || 0) > 0) {
      await client.query('COMMIT');
      return { created:0, skipped:'directory_not_empty' };
    }
    if (!config.authAccounts.length) {
      throw new Error('The user directory is empty and no bootstrap accounts are configured');
    }
    if (!config.authAccounts.some(account => account.role === 'administrator')) {
      throw new Error('An administrator bootstrap account is required for an empty user directory');
    }

    let created = 0;
    for (const account of config.authAccounts) {
      const passwordHash = await hashPassword(account.password);
      await client.query(
        `INSERT INTO app_users(username,display_name,role,password_hash,created_by)
         VALUES($1,$2,$3,$4,'environment_bootstrap')`,
        [account.username, account.displayName || account.username, account.role, passwordHash]
      );
      created += 1;
    }
    await client.query(
      `INSERT INTO audit_events(actor,event_type,target_type,target_id,outcome,metadata)
       VALUES('system','user_directory.bootstrapped','user_directory','global','success',$1)`,
      [{ created_accounts:created, source:'environment_bootstrap' }]
    );
    await client.query('COMMIT');
    logger.info(`[auth] bootstrapped ${created} database-managed RBAC accounts`);
    return { created };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  DUMMY_HASH,
  authenticateUser,
  bootstrapUserDirectory,
  currentSessionUser,
  displayNameError,
  hashPassword,
  passwordError,
  publicUser,
  roleError,
  usernameError,
  verifyPassword,
};
