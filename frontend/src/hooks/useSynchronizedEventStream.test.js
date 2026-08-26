import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSynchronizedEventController } from './useSynchronizedEventStream';

describe('synchronized event controller', () => {
  afterEach(() => vi.useRealTimers());

  it('publishes one ordered snapshot stream for every subscribing pane', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T08:00:00Z'));
    const snapshots = [];
    const controller = createSynchronizedEventController({ onSnapshot:snapshot => snapshots.push(snapshot) });

    controller.play([
      { id:'hop-2', timestampOffset:100, message:'Second hop' },
      { id:'hop-1', timestampOffset:0, message:'First hop' },
      { id:'hop-3', timestampOffset:100, message:'Same-frame outcome' },
    ]);

    vi.advanceTimersByTime(0);
    expect(controller.getSnapshot().events.map(event => event.id)).toEqual(['hop-1']);
    expect(controller.getSnapshot().status).toBe('running');

    vi.advanceTimersByTime(100);
    const finalSnapshot = controller.getSnapshot();
    expect(finalSnapshot.events.map(event => event.id)).toEqual(['hop-1', 'hop-2', 'hop-3']);
    expect(finalSnapshot.status).toBe('completed');
    expect(Object.isFrozen(finalSnapshot)).toBe(true);
    expect(Object.isFrozen(finalSnapshot.events)).toBe(true);
    expect(snapshots.at(-1)).toBe(finalSnapshot);
  });

  it('cancels future emissions when a run is stopped', () => {
    vi.useFakeTimers();
    const controller = createSynchronizedEventController();
    controller.play([
      { id:'now', timestampOffset:0, message:'Now' },
      { id:'later', timestampOffset:500, message:'Later' },
    ]);
    vi.advanceTimersByTime(0);
    controller.stop();
    vi.advanceTimersByTime(500);
    expect(controller.getSnapshot().events.map(event => event.id)).toEqual(['now']);
    expect(controller.getSnapshot().status).toBe('stopped');
  });
});
