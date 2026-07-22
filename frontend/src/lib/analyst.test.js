import { describe, expect, it } from 'vitest';
import {
  ALERT_VIEW_STORAGE_KEY, createInitialAlertView, normalizeCitations, normalizeTextList,
  readBrowserAlertView, writeBrowserAlertView,
} from './analyst';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
}

describe('analyst alert view integrity', () => {
  it('restores a browser-local view while allowing route filters to take precedence', () => {
    const storage = memoryStorage({
      [ALERT_VIEW_STORAGE_KEY]: JSON.stringify({
        filters: { search:'saved-user', severity:'high', time_range:'10080', source:'email.security' },
        viewMode: 'individual',
      }),
    });
    const searchParams = new URLSearchParams('search=route-user&severity=critical');

    expect(createInitialAlertView({ storage, workspace:'alerts', searchParams })).toEqual({
      filters: {
        search:'route-user', severity:'critical', triage_status:'', source:'email.security',
        time_range:'10080', custom_from:'', custom_to:'',
      },
      viewMode:'individual',
      restored:true,
    });
  });

  it('writes an explicitly browser-local, sanitized saved view', () => {
    const storage = memoryStorage();
    const payload = writeBrowserAlertView(storage, {
      filters: { search:'maya', severity:'invalid', time_range:'invalid' },
      viewMode:'individual',
    });

    expect(payload.scope).toBe('browser-local');
    expect(payload.filters.severity).toBe('');
    expect(payload.filters.time_range).toBe('1440');
    expect(readBrowserAlertView(storage)).toMatchObject({
      filters:{ search:'maya', severity:'', time_range:'1440' },
      viewMode:'individual',
    });
  });

  it('keeps only displayable AI citations and limitations', () => {
    expect(normalizeCitations([
      { type:'alert', id:'alert-1' }, { type:'raw_event', id:42 }, { type:'alert', id:'alert-1' }, { type:'alert' }, null,
    ])).toEqual([
      { type:'alert', id:'alert-1' }, { type:'raw_event', id:'42' },
    ]);
    expect(normalizeTextList(['Missing command line', '', null, '  No process hash  ']))
      .toEqual(['Missing command line', 'No process hash']);
  });
});
