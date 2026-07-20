import { Building2, ChevronRight } from 'lucide-react';
import { asNumber, businessAssetLabel, businessAssetType, humanize } from '../../lib/executive';

export default function BusinessAssetList({ assets = [], onSelect }) {
  const max = Math.max(1, ...assets.map(item => asNumber(item.exposure ?? item.activity_count ?? item.count)));
  return (
    <section className="rounded-2xl border border-[#1d374b] bg-[#0b1722] p-5 shadow-[0_18px_45px_rgba(0,0,0,.14)] md:p-6" aria-labelledby="target-assets-title">
      <div><p className="text-xs font-semibold text-[#8098aa]">Supporting exposure</p><h2 id="target-assets-title" className="mt-1.5 text-lg font-semibold tracking-[-.02em] text-[#f0f6fa]">Most exposed observed assets</h2><p className="mt-1 text-xs leading-5 text-[#8098aa]">Technical hosts, databases, and datasets ranked from stored activity. These are not yet mapped to business services.</p></div>
      <div className="mt-5 space-y-2.5">
        {assets.length ? assets.slice(0,5).map((asset, index) => {
          const value = asNumber(asset.exposure ?? asset.activity_count ?? asset.count);
          const key = asset.asset_key || asset.id || asset.name;
          return <button key={key || index} type="button" onClick={event => onSelect?.(asset, event.currentTarget)} className="group w-full rounded-xl border border-[#1c3447] bg-[#091722] p-3.5 text-left transition hover:border-[#315570] hover:bg-[#0e202e] focus:outline-none focus:ring-2 focus:ring-[#4c9aff]/50">
            <div className="grid grid-cols-[30px_minmax(0,1fr)_auto] items-center gap-3">
              <span className="grid h-8 w-8 place-items-center rounded-lg bg-[#4c9aff]/10 text-[#58a6ff]"><Building2 size={15} /></span>
              <span className="min-w-0"><strong className="block truncate text-sm font-semibold text-[#dbe7ee]">{businessAssetLabel(asset)}</strong><span className="mt-0.5 block truncate text-xs text-[#657f93]">{businessAssetType(asset)}{(asset.business_impact || asset.impact) ? ` · ${humanize(asset.business_impact || asset.impact)} impact` : ''}</span></span>
              <span className="flex items-center gap-2"><b className="text-sm tabular-nums text-[#a9c1d1]">{value}</b><ChevronRight className="h-4 w-4 text-[#46677e] transition group-hover:translate-x-0.5 group-hover:text-[#65acdf]" /></span>
            </div>
            <span className="mt-3 block h-1 overflow-hidden rounded-full bg-[#162d3e]"><i className="block h-full rounded-full bg-gradient-to-r from-[#397eff] to-[#36c5f0]" style={{ width:`${Math.max(4, value / max * 100)}%` }} /></span>
          </button>;
        }) : <div className="grid min-h-[270px] place-items-center rounded-xl border border-dashed border-[#244159] bg-[#09151f]"><div className="max-w-[240px] text-center"><Building2 className="mx-auto mb-3 text-[#365a72]" /><strong className="text-sm text-[#c3d3de]">No mapped technical assets</strong><p className="mt-2 text-xs leading-5 text-[#657e91]">Hostname, database, dataset, or CMDB context is required.</p></div></div>}
      </div>
    </section>
  );
}
