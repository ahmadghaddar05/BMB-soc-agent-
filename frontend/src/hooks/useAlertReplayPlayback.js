import { useCallback, useEffect, useMemo, useState } from 'react';

const SPEEDS = Object.freeze([0.75, 1, 1.5, 2]);

export default function useAlertReplayPlayback(events = []) {
  const [cursor, setCursor] = useState(-1);
  const [status, setStatus] = useState('idle');
  const [speed, setSpeedState] = useState(1);

  useEffect(() => {
    setCursor(-1);
    setStatus('idle');
  }, [events]);

  useEffect(() => {
    if (status !== 'running') return undefined;
    if (!events.length) {
      setStatus('completed');
      return undefined;
    }
    if (cursor >= events.length - 1) {
      setStatus('completed');
      return undefined;
    }
    const currentOffset = cursor >= 0 ? Number(events[cursor]?.timestampOffset || 0) : 0;
    const nextOffset = Number(events[cursor + 1]?.timestampOffset || 0);
    const sourceDelay = cursor < 0 ? 0 : Math.max(600, nextOffset - currentOffset);
    const timer = window.setTimeout(() => setCursor(value => value + 1), sourceDelay / speed);
    return () => window.clearTimeout(timer);
  }, [cursor, events, speed, status]);

  const play = useCallback(() => {
    if (!events.length) return;
    setCursor(current => current >= events.length - 1 ? -1 : current);
    setStatus('running');
  }, [events]);

  const pause = useCallback(() => setStatus(current => current === 'running' ? 'paused' : current), []);
  const restart = useCallback(() => {
    if (!events.length) return;
    setCursor(0);
    setStatus('running');
  }, [events]);
  const previous = useCallback(() => {
    setStatus('paused');
    setCursor(current => Math.max(0, current - 1));
  }, []);
  const next = useCallback(() => {
    setStatus('paused');
    setCursor(current => Math.min(events.length - 1, current + 1));
  }, [events.length]);
  const setSpeed = useCallback(value => {
    const normalized = Number(value);
    if (SPEEDS.includes(normalized)) setSpeedState(normalized);
  }, []);
  const visibleEvents = useMemo(() => events.slice(0, Math.max(0, cursor + 1)), [cursor, events]);

  return {
    cursor,
    status,
    speed,
    visibleEvents,
    currentEvent:cursor >= 0 ? events[cursor] || null : null,
    completed:status === 'completed',
    running:status === 'running',
    play,
    pause,
    restart,
    previous,
    next,
    setSpeed,
  };
}

