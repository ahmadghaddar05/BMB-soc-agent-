import { useCallback, useEffect, useRef, useState } from 'react';
import { orderScriptedEvents } from '../lib/securityVisualization';

function immutableSnapshot(value) {
  return Object.freeze({ ...value, events:Object.freeze([...value.events]) });
}

function initialSnapshot(events = []) {
  return immutableSnapshot({
    status:events.length ? 'live' : 'idle',
    runId:0,
    startedAt:null,
    completedAt:null,
    events:[...events],
  });
}

/**
 * Framework-independent event controller used by both Digital Twin and Attack Simulator.
 * Consumers derive every visual pane from the same immutable snapshot.
 */
export function createSynchronizedEventController({
  initialEvents = [],
  onSnapshot = () => {},
  schedule = (callback, delay) => setTimeout(callback, delay),
  cancel = timer => clearTimeout(timer),
  now = () => Date.now(),
} = {}) {
  let snapshot = initialSnapshot(initialEvents);
  let generation = 0;
  let disposed = false;
  const timers = new Set();

  function publish(next) {
    if (disposed) return snapshot;
    snapshot = immutableSnapshot(next);
    onSnapshot(snapshot);
    return snapshot;
  }

  function cancelTimers() {
    timers.forEach(cancel);
    timers.clear();
  }

  function withEmissionTime(event, emittedAt) {
    return Object.freeze({ ...event, emittedAt:new Date(emittedAt).toISOString() });
  }

  function uniqueIncoming(events) {
    const existing = new Set(snapshot.events.map(event => event.id));
    return events.filter(event => {
      if (!event?.id || existing.has(event.id)) return false;
      existing.add(event.id);
      return true;
    });
  }

  function append(eventOrEvents) {
    const incoming = uniqueIncoming(Array.isArray(eventOrEvents) ? eventOrEvents : [eventOrEvents]);
    if (!incoming.length) return snapshot;
    const emittedAt = now();
    return publish({
      ...snapshot,
      status:snapshot.status === 'running' ? 'running' : 'live',
      events:[...snapshot.events, ...incoming.map(event => withEmissionTime(event, emittedAt))],
    });
  }

  function stop({ preserveEvents = true } = {}) {
    generation += 1;
    cancelTimers();
    return publish({
      ...snapshot,
      status:'stopped',
      completedAt:new Date(now()).toISOString(),
      events:preserveEvents ? snapshot.events : [],
    });
  }

  function reset() {
    generation += 1;
    cancelTimers();
    return publish(initialSnapshot());
  }

  function play(scriptedEvents) {
    const ordered = orderScriptedEvents(scriptedEvents);
    generation += 1;
    const currentGeneration = generation;
    cancelTimers();
    const startedAt = now();
    const runId = snapshot.runId + 1;
    publish({ status:'running', runId, startedAt:new Date(startedAt).toISOString(), completedAt:null, events:[] });

    if (!ordered.length) {
      return publish({ ...snapshot, status:'completed', completedAt:new Date(now()).toISOString() });
    }

    const batches = new Map();
    ordered.forEach(event => {
      const batch = batches.get(event.timestampOffset) || [];
      batch.push(event);
      batches.set(event.timestampOffset, batch);
    });
    const offsets = [...batches.keys()].sort((left, right) => left - right);

    offsets.forEach((offset, index) => {
      let timer;
      timer = schedule(() => {
        timers.delete(timer);
        if (disposed || generation !== currentGeneration) return;
        const emittedAt = now();
        const batch = batches.get(offset).map(event => withEmissionTime(event, emittedAt));
        const lastBatch = index === offsets.length - 1;
        publish({
          ...snapshot,
          status:lastBatch ? 'completed' : 'running',
          completedAt:lastBatch ? new Date(emittedAt).toISOString() : null,
          events:[...snapshot.events, ...batch],
        });
      }, offset);
      timers.add(timer);
    });
    return snapshot;
  }

  function dispose() {
    generation += 1;
    cancelTimers();
    disposed = true;
  }

  return {
    append,
    dispose,
    getSnapshot:() => snapshot,
    play,
    reset,
    stop,
  };
}

export default function useSynchronizedEventStream({ initialEvents = [] } = {}) {
  const [snapshot, setSnapshot] = useState(() => initialSnapshot(initialEvents));
  const controllerRef = useRef(null);
  if (!controllerRef.current) {
    controllerRef.current = createSynchronizedEventController({ initialEvents, onSnapshot:setSnapshot });
  }

  useEffect(() => {
    const controller = controllerRef.current;
    return () => controller.dispose();
  }, []);

  const append = useCallback(events => controllerRef.current.append(events), []);
  const play = useCallback(events => controllerRef.current.play(events), []);
  const reset = useCallback(() => controllerRef.current.reset(), []);
  const stop = useCallback(options => controllerRef.current.stop(options), []);

  return { ...snapshot, append, currentEvent:snapshot.events.at(-1) || null, play, reset, stop };
}
