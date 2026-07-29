'use strict';

const cron = require('node-cron');
const db = require('../db');
const { runCycle } = require('./pipeline');
const { runRetention } = require('../services/alert-retention');

let _processingTask = null;
let _retentionTask = null;
let _collectorTimer = null;
let _collectionRunning = false;
let _processingRunning = false;
let _lastRun = null;
let _lastResult = null;
let _lastError = null;
let _lastCollectionRun = null;
let _lastCollectionResult = null;
let _lastCollectionError = null;
let _lastProcessingRun = null;
let _lastProcessingResult = null;
let _lastProcessingError = null;
let _retentionRunning = false;
let _lastRetentionRun = null;
let _lastRetentionResult = null;
let _lastRetentionError = null;

function cronExpr(minutes) {
  const value = Math.max(1, parseInt(minutes, 10) || 5);
  return `*/${value} * * * *`;
}

function collectionIntervalMs(seconds) {
  const value = Math.min(300, Math.max(5, parseInt(seconds, 10) || 15));
  return value * 1000;
}

function publicError(error) {
  return error instanceof Error ? error.message : String(error);
}

async function executeCollection(trigger = 'live-collector') {
  if (_collectionRunning) {
    return { skipped: true, reason: 'collection_in_progress' };
  }
  _collectionRunning = true;
  _lastRun = new Date().toISOString();
  _lastCollectionRun = _lastRun;
  _lastError = null;
  _lastCollectionError = null;
  console.log(`[collector] starting live ingestion trigger=${trigger}`);
  try {
    const result = await runCycle(trigger, { collect: true, process: false });
    _lastResult = result;
    _lastCollectionResult = result;
    console.log('[collector] ingestion complete:', JSON.stringify(result.stats || {}));
    return result;
  } catch (error) {
    const message = publicError(error);
    _lastError = message;
    _lastCollectionError = message;
    _lastResult = { error: message };
    _lastCollectionResult = _lastResult;
    console.error('[collector] ingestion failed:', message);
    return { error: message };
  } finally {
    _collectionRunning = false;
  }
}

async function executeProcessing(trigger = 'scheduler') {
  if (_processingRunning) {
    console.log(`[scheduler] processing already running, skipping trigger=${trigger}`);
    return { skipped: true, reason: 'processing_in_progress' };
  }
  _processingRunning = true;
  _lastRun = new Date().toISOString();
  _lastProcessingRun = _lastRun;
  _lastError = null;
  _lastProcessingError = null;
  console.log(`[scheduler] starting stored-alert processing trigger=${trigger}`);
  try {
    const result = await runCycle(trigger, { collect: false, process: true });
    _lastResult = result;
    _lastProcessingResult = result;
    console.log('[scheduler] processing complete:', JSON.stringify(result.stats || {}));
    return result;
  } catch (error) {
    const message = publicError(error);
    _lastError = message;
    _lastProcessingError = message;
    _lastResult = { error: message };
    _lastProcessingResult = _lastResult;
    console.error('[scheduler] processing failed:', message);
    return { error: message };
  } finally {
    _processingRunning = false;
  }
}

async function executeRetention(trigger = 'scheduler') {
  if (_retentionRunning) return { skipped:true, reason:'retention_cycle_in_progress' };
  _retentionRunning = true;
  _lastRetentionRun = new Date().toISOString();
  _lastRetentionError = null;
  try {
    const result = await runRetention({
      mode:'policy',
      confirmation:'PURGE DASHBOARD ALERTS',
      actor:`system:${trigger}`,
    });
    _lastRetentionResult = result;
    console.log('[retention] cycle complete:', JSON.stringify(result.deleted || result));
    return result;
  } catch (error) {
    const message = publicError(error);
    _lastRetentionError = message;
    _lastRetentionResult = { error:message };
    console.error('[retention] cycle failed:', message);
    return { error:message };
  } finally {
    _retentionRunning = false;
  }
}

async function start() {
  const settings = await db.getAllSettings();
  const liveCollectionEnabled = settings.live_collection_enabled === 'true';

  if (liveCollectionEnabled) {
    const intervalMs = collectionIntervalMs(settings.live_collection_interval_seconds);
    console.log(`[collector] starting AI-independent live ingestion every ${intervalMs / 1000}s`);
    _collectorTimer = setInterval(() => {
      executeCollection().catch(error => console.error('[collector] unhandled ingestion error:', error));
    }, intervalMs);
    _collectorTimer.unref?.();
    if (process.env.NODE_ENV !== 'test') {
      setImmediate(() => {
        executeCollection().catch(error => console.error('[collector] initial ingestion error:', error));
      });
    }
  } else {
    console.log('[collector] live ingestion disabled');
  }

  if (settings.alert_retention_enabled === 'true') {
    console.log('[retention] starting daily severity-aware retention at 02:17 UTC');
    _retentionTask = cron.schedule('17 2 * * *', () => {
      executeRetention('scheduler').catch(error =>
        console.error('[retention] unhandled cycle error:', error)
      );
    }, { timezone:'UTC' });
  } else {
    console.log('[retention] automatic alert retention disabled');
  }

  if (settings.scheduler_enabled !== 'true') {
    console.log('[scheduler] automatic AI processing disabled');
    return;
  }

  const interval = parseInt(settings.interval_minutes || 5, 10);
  console.log(`[scheduler] starting stored-alert processing every ${interval} min`);
  _processingTask = cron.schedule(cronExpr(interval), () => {
    executeProcessing('scheduler')
      .catch(error => console.error('[scheduler] unhandled processing error:', error));
  });
}

async function restart() {
  if (_processingTask) {
    _processingTask.stop();
    _processingTask = null;
  }
  if (_collectorTimer) {
    clearInterval(_collectorTimer);
    _collectorTimer = null;
  }
  if (_retentionTask) {
    _retentionTask.stop();
    _retentionTask = null;
  }
  await start();
}

async function triggerNow() {
  if (_collectionRunning || _processingRunning) {
    return { skipped: true, reason: 'cycle_in_progress' };
  }
  const collection = await executeCollection('manual');
  if (collection.error || collection.skipped) return collection;
  const processing = await executeProcessing('manual');
  if (processing.error || processing.skipped) return processing;
  return {
    runId: processing.runId,
    collection_run_id: collection.runId,
    processing_run_id: processing.runId,
    stats: Object.fromEntries(
      Object.keys({ ...collection.stats, ...processing.stats }).map(key => [
        key,
        typeof collection.stats?.[key] === 'number' || typeof processing.stats?.[key] === 'number'
          ? Number(collection.stats?.[key] || 0) + Number(processing.stats?.[key] || 0)
          : processing.stats?.[key] ?? collection.stats?.[key],
      ])
    ),
  };
}

function status() {
  return {
    running: Boolean(_processingTask),
    cycle_active: _collectionRunning || _processingRunning,
    collection_running: _collectionRunning,
    processing_running: _processingRunning,
    live_collection_running: Boolean(_collectorTimer),
    retention_scheduled: Boolean(_retentionTask),
    retention_running:_retentionRunning,
    last_run: _lastRun,
    last_result: _lastResult,
    last_error: _lastError,
    last_collection_run: _lastCollectionRun,
    last_collection_result: _lastCollectionResult,
    last_collection_error: _lastCollectionError,
    last_processing_run: _lastProcessingRun,
    last_processing_result: _lastProcessingResult,
    last_processing_error: _lastProcessingError,
    last_retention_run:_lastRetentionRun,
    last_retention_result:_lastRetentionResult,
    last_retention_error:_lastRetentionError,
  };
}

module.exports = {
  collectionIntervalMs,
  executeCollection,
  executeProcessing,
  executeRetention,
  start,
  restart,
  triggerNow,
  status,
};
