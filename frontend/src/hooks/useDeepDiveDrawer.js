import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';

const initialState = { status:'closed', selection:null, data:null, error:null };

function reducer(state, action) {
  switch (action.type) {
    case 'close': return initialState;
    case 'loading': return { status:'loading', selection:action.selection, data:action.seed || null, error:null };
    case 'ready': return state.selection?.key === action.selection.key
      ? { status:'ready', selection:action.selection, data:action.data, error:null }
      : state;
    case 'error': return state.selection?.key === action.selection.key
      ? { ...state, status:'error', error:action.error }
      : state;
    default: return state;
  }
}

function selectionFromParams(params) {
  const type = params.get('detail');
  const id = params.get('id');
  if (!type || !id || !['risk-summary','incident','asset','automation'].includes(type)) return null;
  const days = type === 'asset' && [7,30,90].includes(Number(params.get('days'))) ? Number(params.get('days')) : null;
  return { type, id, days, key:`${type}:${id}:${days || ''}` };
}

async function loadSelection(selection, seed, signal) {
  if (selection.type === 'risk-summary') {
    const result = await api('/incidents?status=open&page=1&limit=100', { signal });
    return { ...seed, incidents:result.incidents || [], total:result.total || 0 };
  }
  if (selection.type === 'incident') return api(`/incidents/${encodeURIComponent(selection.id)}`, { signal });
  if (selection.type === 'asset') {
    const windowDays = seed?.window_days || selection.days || 30;
    const from = new Date(Date.now() - (windowDays * 86400000)).toISOString();
    const result = await api(`/alert-groups?page=1&limit=20&from=${encodeURIComponent(from)}&search=${encodeURIComponent(selection.id)}`, { signal });
    return { ...seed, window_days:windowDays, alerts:result.groups || [], total:result.total || 0 };
  }

  let operation = seed;
  if (!operation?.source_id) operation = await api(`/agent/operations/${encodeURIComponent(selection.id)}`, { signal });
  if (!operation) throw new Error('Automation record is no longer available');
  if (operation.source_type === 'case') {
    const incident = await api(`/incidents/${encodeURIComponent(operation.source_id)}`, { signal });
    return { ...operation, incident };
  }
  const alert = await api(`/alerts/${encodeURIComponent(operation.source_id)}`, { signal });
  return { ...operation, alert };
}

export default function useDeepDiveDrawer() {
  const [params, setParams] = useSearchParams();
  const [state, dispatch] = useReducer(reducer, initialState);
  const seeds = useRef(new Map());
  const returnFocus = useRef(null);
  const selection = selectionFromParams(params);

  useEffect(() => {
    if (!selection) {
      dispatch({ type:'close' });
      window.setTimeout(() => returnFocus.current?.focus?.(), 0);
      return undefined;
    }
    const seed = seeds.current.get(selection.key) || null;
    const controller = new globalThis.AbortController();
    dispatch({ type:'loading', selection, seed });
    loadSelection(selection, seed, controller.signal)
      .then(data => dispatch({ type:'ready', selection, data }))
      .catch(error => {
        if (error.name !== 'AbortError') dispatch({ type:'error', selection, error:error.message || 'Unable to load details' });
      });
    return () => controller.abort();
  }, [selection?.key]);

  const open = useCallback((next, trigger = null) => {
    const days = next.type === 'asset' ? next.seed?.window_days || null : null;
    const normalized = { ...next, id:String(next.id), days, key:`${next.type}:${next.id}:${days || ''}` };
    if (next.seed) seeds.current.set(normalized.key, next.seed);
    if (!selection) returnFocus.current = trigger || document.activeElement;
    const updated = new URLSearchParams(params);
    updated.set('detail', normalized.type);
    updated.set('id', normalized.id);
    if (days) updated.set('days', String(days)); else updated.delete('days');
    setParams(updated, { replace:Boolean(selection) });
  }, [params, selection, setParams]);

  const close = useCallback(() => {
    const updated = new URLSearchParams(params);
    updated.delete('detail');
    updated.delete('id');
    updated.delete('days');
    setParams(updated, { replace:true });
    window.setTimeout(() => returnFocus.current?.focus?.(), 0);
  }, [params, setParams]);

  const retry = useCallback(() => {
    if (selection) {
      const seed = seeds.current.get(selection.key) || null;
      const controller = new globalThis.AbortController();
      dispatch({ type:'loading', selection, seed });
      loadSelection(selection, seed, controller.signal)
        .then(data => dispatch({ type:'ready', selection, data }))
        .catch(error => {
          if (error.name !== 'AbortError') dispatch({ type:'error', selection, error:error.message || 'Unable to load details' });
        });
    }
  }, [selection]);

  return { state, open, close, retry };
}
