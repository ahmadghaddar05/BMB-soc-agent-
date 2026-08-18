import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AttackSimulator from './AttackSimulator';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe('AttackSimulator', () => {
  let container;
  let root;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-16T09:00:00Z'));
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root.render(
      <MemoryRouter initialEntries={['/attack-simulator?mode=training']}>
        <AttackSimulator />
      </MemoryRouter>
    ));
  });

  afterEach(async () => {
    if (root) await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
  });

  it('supports radio-group keyboard selection and completes one synchronized scenario run', async () => {
    const scenarios = [...container.querySelectorAll('[role="radio"]')];
    expect(scenarios).toHaveLength(3);
    expect(scenarios.map(option => option.tabIndex)).toEqual([0, -1, -1]);

    scenarios[0].focus();
    await act(async () => scenarios[0].dispatchEvent(new window.KeyboardEvent('keydown', {
      key:'End', bubbles:true, cancelable:true,
    })));
    expect(scenarios[2].getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(scenarios[2]);
    expect(scenarios.map(option => option.tabIndex)).toEqual([-1, -1, 0]);

    const runButton = [...container.querySelectorAll('button')]
      .find(button => button.textContent.includes('Run Simulation'));
    await act(async () => runButton.click());
    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(container.textContent).toContain('A test analyst account queried restricted database schemas.');
    expect(container.querySelectorAll('.mitre-kill-chain li')).toHaveLength(5);

    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(container.textContent).toContain('88%');
    expect(container.textContent).toContain('Suspend the test account pending analyst review');
    expect(container.querySelectorAll('.simulation-recommendations li')).toHaveLength(1);
    expect(container.querySelectorAll('.mitre-kill-chain li')[3].classList.contains('is-in-progress')).toBe(true);

    await act(async () => vi.advanceTimersByTimeAsync(7_500));
    expect(container.textContent).toContain('98%');
    expect(container.textContent).toContain('Simulation Complete');
    expect(container.textContent).toContain('Contained in 17.5s · 1 system affected · 0 data loss');
    expect(container.querySelectorAll('.simulation-recommendations li')).toHaveLength(3);
    expect(container.querySelectorAll('.mitre-kill-chain li')[3].classList.contains('is-blocked')).toBe(true);
    expect(container.querySelectorAll('.mitre-kill-chain li')[4].classList.contains('is-cut')).toBe(true);
    expect(runButton.disabled).toBe(false);
    expect(runButton.textContent).toContain('Run Again');
  });
});
