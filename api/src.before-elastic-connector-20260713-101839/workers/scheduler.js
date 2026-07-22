'use strict';
const cron       = require('node-cron');
const db         = require('../db');
const { runCycle } = require('./pipeline');

let _task        = null;
let _running     = false;
let _lastRun     = null;
let _lastResult  = null;
let _lastError   = null;

function cronExpr(minutes) {
  const m = Math.max(1, parseInt(minutes) || 5);
  return `*/${m} * * * *`;
}

// Core cycle executor — used by both cron and manual trigger
async function _execute(trigger) {
  if (_running) {
    console.log(`[scheduler] cycle already running, skipping trigger=${trigger}`);
    return { skipped: true, reason: 'cycle_in_progress' };
  }
  _running = true;
  _lastRun = new Date().toISOString();
  _lastError = null;
  console.log(`[scheduler] starting cycle trigger=${trigger}`);
  try {
    _lastResult = await runCycle(trigger);
    console.log(`[scheduler] cycle complete:`, JSON.stringify(_lastResult.stats || {}));
    return _lastResult;
  } catch (err) {
    _lastError  = err instanceof Error ? err.message : String(err);
    _lastResult = { error: _lastError };
    console.error(`[scheduler] cycle failed:`, _lastError);
    return { error: _lastError };
  } finally {
    _running = false;
  }
}

async function start() {
  const settings = await db.getAllSettings();
  if (settings.scheduler_enabled !== 'true') {
    console.log('[scheduler] auto-fetch disabled');
    return;
  }
  const interval = parseInt(settings.interval_minutes || 5);
  console.log(`[scheduler] starting cron every ${interval} min`);
  _task = cron.schedule(cronExpr(interval), () => {
    _execute('scheduler').catch(e =>
      console.error('[scheduler] unhandled cron error:', e));
  });
}

async function restart() {
  if (_task) { _task.stop(); _task = null; }
  await start();
}

// Manual trigger — runs synchronously and returns result
async function triggerNow() {
  return _execute('manual');
}

function status() {
  return {
    running:      !!_task,
    cycle_active: _running,
    last_run:     _lastRun,
    last_result:  _lastResult,
    last_error:   _lastError,
  };
}

module.exports = { start, restart, triggerNow, status };
