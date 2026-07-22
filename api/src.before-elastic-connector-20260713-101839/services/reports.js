'use strict';
// PDF report generation (pdfkit). Four reports:
//   alerts-summary, alerts-detailed, incidents-summary, incidents-detailed,
//   plus a single-incident report. Each streams a PDF buffer back to the route.
const PDFDocument = require('pdfkit');
const db = require('../db');

const COLORS = {
  ink: '#1a1d23', muted: '#6b7280', line: '#d1d5db', accent: '#2563eb',
  critical: '#b91c1c', high: '#c2410c', medium: '#a16207', low: '#15803d', informational: '#6b7280',
};
const sevColor = s => COLORS[s] || COLORS.muted;
const fmt = ts => { try { return new Date(ts).toISOString().replace('T',' ').slice(0,19) + ' UTC'; } catch { return String(ts || ''); } };

// ── Document scaffolding ────────────────────────────────────────────────────
function newDoc(title) {
  const doc = new PDFDocument({ size: 'A4', margin: 48, bufferPages: true,
    info: { Title: title, Author: 'SOC Agent', Subject: 'Security Operations Report' } });
  return doc;
}

function header(doc, title, subtitle) {
  doc.fillColor(COLORS.accent).fontSize(18).font('Helvetica-Bold').text('SOC Agent', { continued: true })
     .fillColor(COLORS.muted).font('Helvetica').fontSize(10).text('   security operations report');
  doc.moveDown(0.3);
  doc.fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(15).text(title);
  if (subtitle) doc.fillColor(COLORS.muted).font('Helvetica').fontSize(9).text(subtitle);
  doc.moveDown(0.2);
  doc.strokeColor(COLORS.line).lineWidth(1).moveTo(doc.page.margins.left, doc.y)
     .lineTo(doc.page.width - doc.page.margins.right, doc.y).stroke();
  doc.moveDown(0.6);
}

function sectionTitle(doc, t) {
  if (doc.y > doc.page.height - 120) doc.addPage();
  doc.moveDown(0.4).fillColor(COLORS.ink).font('Helvetica-Bold').fontSize(12).text(t);
  doc.moveDown(0.2);
}

function kvGrid(doc, pairs) {
  doc.font('Helvetica').fontSize(9);
  const colW = (doc.page.width - doc.page.margins.left - doc.page.margins.right) / 2;
  let i = 0;
  for (const [k, v] of pairs) {
    const x = doc.page.margins.left + (i % 2) * colW;
    if (i % 2 === 0 && i > 0) doc.moveDown(0.1);
    const y = doc.y;
    doc.fillColor(COLORS.muted).text(`${k}: `, x, y, { continued: true, width: colW });
    doc.fillColor(COLORS.ink).text(String(v ?? '—'));
    i++;
  }
  doc.x = doc.page.margins.left;
  doc.moveDown(0.4);
}

// Simple table with wrapped cells and page breaks.
function table(doc, columns, rows) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const totalW = right - left;
  const widths = columns.map(c => Math.floor(totalW * c.w));

  const drawHead = () => {
    doc.font('Helvetica-Bold').fontSize(8).fillColor(COLORS.muted);
    let x = left;
    const y = doc.y;
    columns.forEach((c, i) => { doc.text(c.label.toUpperCase(), x + 2, y, { width: widths[i] - 4 }); x += widths[i]; });
    doc.moveDown(0.2);
    doc.strokeColor(COLORS.line).lineWidth(0.5).moveTo(left, doc.y).lineTo(right, doc.y).stroke();
    doc.moveDown(0.2);
  };
  drawHead();

  doc.font('Helvetica').fontSize(8);
  for (const row of rows) {
    const cells = columns.map((c, i) => String(row[c.key] ?? '—'));
    const hs = cells.map((txt, i) => doc.heightOfString(txt, { width: widths[i] - 4 }));
    const rowH = Math.max(...hs, 11);
    if (doc.y + rowH > doc.page.height - doc.page.margins.bottom - 20) { doc.addPage(); drawHead(); doc.font('Helvetica').fontSize(8); }
    let x = left;
    const y = doc.y;
    columns.forEach((c, i) => {
      if (c.key === 'severity') doc.fillColor(sevColor(cells[i]));
      else doc.fillColor(COLORS.ink);
      doc.text(cells[i], x + 2, y, { width: widths[i] - 4 });
      x += widths[i];
    });
    doc.y = y + rowH + 2;
  }
  doc.moveDown(0.3);
}

function footer(doc) {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const y = doc.page.height - 34;
    doc.fontSize(7).fillColor(COLORS.muted).font('Helvetica')
       .text('CONFIDENTIAL — for internal security use only', doc.page.margins.left, y,
             { width: 300, lineBreak: false });
    doc.text(`Page ${i - range.start + 1} of ${range.count}`,
             doc.page.width - doc.page.margins.right - 100, y, { width: 100, align: 'right', lineBreak: false });
  }
}

function finalize(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    footer(doc);
    doc.end();
  });
}

// ── Data helpers ────────────────────────────────────────────────────────────
function hoursClause(hours, col = 'timestamp') {
  return hours ? `AND ${col} >= NOW() - (${parseInt(hours)} || ' hours')::interval` : '';
}

async function alertAggregates(hours) {
  const where = `triage_status='triaged' ${hoursClause(hours)}`;
  const [bySev, byVerdict, byTactic, totals] = await Promise.all([
    db.query(`SELECT verdict->>'severity' s, count(*) n FROM alerts WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`),
    db.query(`SELECT verdict->>'verdict' v, count(*) n FROM alerts WHERE ${where} GROUP BY 1 ORDER BY 2 DESC`),
    db.query(`SELECT t tactic, count(*) n FROM alerts, unnest(COALESCE(mitre_tactics,'{}')) t WHERE ${where} GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    db.query(`SELECT count(*) total, count(*) FILTER (WHERE auto_closed) auto_closed FROM alerts WHERE ${where}`),
  ]);
  return { bySev: bySev.rows, byVerdict: byVerdict.rows, byTactic: byTactic.rows, totals: totals.rows[0] };
}

// ── Reports ─────────────────────────────────────────────────────────────────
async function alertsSummary(hours) {
  const agg = await alertAggregates(hours);
  const doc = newDoc('Alerts Summary');
  header(doc, 'Alerts Summary Report',
    `Generated ${fmt(Date.now())}${hours ? ` · last ${hours}h` : ' · all time'}`);

  kvGrid(doc, [
    ['Total triaged alerts', agg.totals.total],
    ['Auto-closed', agg.totals.auto_closed],
  ]);

  sectionTitle(doc, 'By severity');
  table(doc, [{ label:'Severity', key:'severity', w:0.5 }, { label:'Count', key:'n', w:0.5 }],
    agg.bySev.map(r => ({ severity: r.s || 'unknown', n: r.n })));

  sectionTitle(doc, 'By verdict');
  table(doc, [{ label:'Verdict', key:'v', w:0.5 }, { label:'Count', key:'n', w:0.5 }],
    agg.byVerdict.map(r => ({ v: r.v || 'unknown', n: r.n })));

  sectionTitle(doc, 'Top MITRE ATT&CK tactics');
  table(doc, [{ label:'Tactic', key:'tactic', w:0.7 }, { label:'Alerts', key:'n', w:0.3 }],
    agg.byTactic.length ? agg.byTactic.map(r => ({ tactic: String(r.tactic).replace(/_/g,' '), n: r.n })) : [{ tactic:'(none mapped)', n:0 }]);

  return finalize(doc);
}

async function alertsDetailed(hours, limit = 1000) {
  const where = `triage_status='triaged' ${hoursClause(hours)}`;
  const { rows } = await db.query(
    `SELECT id, timestamp, rule_level, rule_desc, src_ip, username, hostname,
            verdict->>'severity' severity, verdict->>'verdict' verdict,
            array_to_string(mitre_techniques,', ') mitre
     FROM alerts WHERE ${where}
     ORDER BY CASE verdict->>'severity' WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
              timestamp DESC LIMIT $1`, [limit]);

  const doc = newDoc('Alerts Detailed');
  header(doc, 'Alerts Detailed Report',
    `Generated ${fmt(Date.now())}${hours ? ` · last ${hours}h` : ' · all time'} · ${rows.length} alerts`);

  table(doc, [
    { label:'Time', key:'time', w:0.17 },
    { label:'Lvl', key:'rule_level', w:0.05 },
    { label:'Description', key:'rule_desc', w:0.30 },
    { label:'User/Host', key:'who', w:0.16 },
    { label:'Sev', key:'severity', w:0.09 },
    { label:'Verdict', key:'verdict', w:0.13 },
    { label:'MITRE', key:'mitre', w:0.10 },
  ], rows.map(r => ({
    time: fmt(r.timestamp).slice(0,16), rule_level: r.rule_level, rule_desc: r.rule_desc,
    who: [r.username, r.hostname].filter(Boolean).join(' / ') || r.src_ip || '—',
    severity: r.severity || '—', verdict: (r.verdict||'—').replace(/_/g,' '), mitre: r.mitre || '—',
  })));
  return finalize(doc);
}

async function incidentRows(status) {
  const where = status ? `WHERE status=$1` : '';
  const { rows } = await db.query(
    `SELECT * FROM incidents ${where} ORDER BY
       CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
       last_seen DESC`, status ? [status] : []);
  return rows;
}

async function incidentsSummary() {
  const rows = await incidentRows(null);
  const doc = newDoc('Incidents Summary');
  header(doc, 'Incidents Summary Report', `Generated ${fmt(Date.now())} · ${rows.length} incidents`);

  const byStatus = {}, bySev = {};
  rows.forEach(r => { byStatus[r.status] = (byStatus[r.status]||0)+1; bySev[r.severity] = (bySev[r.severity]||0)+1; });

  sectionTitle(doc, 'By status');
  table(doc, [{label:'Status',key:'k',w:0.5},{label:'Count',key:'n',w:0.5}],
    Object.entries(byStatus).map(([k,n]) => ({ k, n })));
  sectionTitle(doc, 'By severity');
  table(doc, [{label:'Severity',key:'severity',w:0.5},{label:'Count',key:'n',w:0.5}],
    Object.entries(bySev).map(([severity,n]) => ({ severity, n })));

  sectionTitle(doc, 'Incidents');
  table(doc, [
    { label:'ID', key:'id', w:0.06 },
    { label:'Title', key:'title', w:0.40 },
    { label:'Sev', key:'severity', w:0.10 },
    { label:'Type', key:'type', w:0.14 },
    { label:'Alerts', key:'alerts', w:0.09 },
    { label:'Status', key:'status', w:0.12 },
  ], rows.map(r => ({
    id: r.id, title: r.title, severity: r.severity, type: r.incident_type || 'correlation',
    alerts: (r.alert_ids||[]).length, status: r.status,
  })));
  return finalize(doc);
}

function renderIncidentBody(doc, inc, alerts) {
  sectionTitle(doc, `#${inc.id} — ${inc.title}`);
  kvGrid(doc, [
    ['Severity', inc.severity], ['Confidence', inc.confidence != null ? `${Math.round(inc.confidence*100)}%` : '—'],
    ['Type', inc.incident_type || 'correlation'], ['Status', inc.status],
    ['First seen', fmt(inc.first_seen)], ['Last seen', fmt(inc.last_seen)],
    ['Attack stages', (inc.attack_stages||[]).map(s=>s.replace(/_/g,' ')).join(', ') || '—'],
    ['Member alerts', (inc.alert_ids||[]).length],
  ]);
  if (inc.narrative) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text('Narrative');
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink).text(inc.narrative, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right });
    doc.moveDown(0.3);
  }
  if ((inc.recommended_actions||[]).length) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.ink).text('Recommended actions');
    doc.font('Helvetica').fontSize(9).fillColor(COLORS.ink);
    inc.recommended_actions.forEach(a => doc.text(`•  ${a}`, { width: doc.page.width - doc.page.margins.left - doc.page.margins.right }));
    doc.moveDown(0.3);
  }
  if (alerts && alerts.length) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(COLORS.muted).text('Member alerts');
    doc.moveDown(0.1);
    table(doc, [
      { label:'Time', key:'time', w:0.20 }, { label:'Lvl', key:'lvl', w:0.07 },
      { label:'Description', key:'desc', w:0.43 }, { label:'Sev', key:'severity', w:0.12 },
      { label:'User/Host', key:'who', w:0.18 },
    ], alerts.map(a => ({
      time: fmt(a.timestamp).slice(0,16), lvl: a.rule_level, desc: a.rule_desc,
      severity: a.severity || '—', who: [a.username,a.hostname].filter(Boolean).join(' / ') || a.src_ip || '—',
    })));
  }
}

async function membersFor(inc) {
  if (!inc.alert_ids?.length) return [];
  const r = await db.query(
    `SELECT id, timestamp, rule_level, rule_desc, username, hostname, src_ip,
            verdict->>'severity' severity FROM alerts WHERE id = ANY($1) ORDER BY timestamp`, [inc.alert_ids]);
  return r.rows;
}

async function incidentsDetailed() {
  const rows = await incidentRows('open');
  const doc = newDoc('Incidents Detailed');
  header(doc, 'Incidents Detailed Report', `Generated ${fmt(Date.now())} · ${rows.length} open incidents`);
  if (!rows.length) doc.font('Helvetica').fontSize(10).fillColor(COLORS.muted).text('No open incidents.');
  for (const inc of rows) renderIncidentBody(doc, inc, await membersFor(inc));
  return finalize(doc);
}

async function singleIncident(id) {
  const r = await db.query('SELECT * FROM incidents WHERE id=$1', [parseInt(id)]);
  if (!r.rows.length) return null;
  const inc = r.rows[0];
  const doc = newDoc(`Incident ${id}`);
  header(doc, `Incident Report — #${inc.id}`, `Generated ${fmt(Date.now())}`);
  renderIncidentBody(doc, inc, await membersFor(inc));
  return finalize(doc);
}

module.exports = { alertsSummary, alertsDetailed, incidentsSummary, incidentsDetailed, singleIncident };
