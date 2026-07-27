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
  if (!type || !id || !['risk-summary','incident','asset','metric'].includes(type)) return null;
  const days = type === 'asset' && [7,30,90].includes(Number(params.get('days'))) ? Number(params.get('days')) : null;
  return { type, id, days, key:`${type}:${id}:${days || ''}` };
}

async function loadSelection(selection, seed, signal) {
  if (selection.type === 'metric') {
    if (seed?.evidence_type === 'risk-summary') {
      const result = await api('/executive/risks?page=1&limit=100', { signal });
      return { ...seed, evidence:result.risks || [], total:result.total || 0 };
    }
    if (seed?.evidence_type === 'assets') return { ...seed, evidence:seed?.overview?.top_assets || [] };
    return { ...seed, evidence:[] };
  }
  if (selection.type === 'risk-summary') {
    const result = await api('/executive/risks?page=1&limit=100', { signal });
    return { ...seed, risks:result.risks || [], total:result.total || 0 };
  }
  if (selection.type === 'incident') {
    return api(`/executive/incidents/${encodeURIComponent(selection.id)}`, { signal });
  }
  if (selection.type === 'asset') {
    const windowDays = seed?.window_days || selection.days || 30;
    const result = await api(`/executive/overview?days=${windowDays}`, { signal });
    const asset = (result.top_assets || []).find(item =>
      String(item.asset_key || item.id || item.name) === String(selection.id)
    );
    return {
      ...(asset || seed || {}),
      window_days:windowDays,
      source_coverage:result.source_coverage || null,
      detail_level:'executive_summary',
    };
  }
  throw new Error('This executive detail type is not supported');
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
