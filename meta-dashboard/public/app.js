import { linePlot, barChart, calendarHeatmap, scatterPlot, sparkArea, palette, fmt, hideTip } from '/charts.js';

const $ = (sel, root = document) => root.querySelector(sel);
const state = { currency: 'EGP', view: 'pulse', days: 28, data: {}, status: null, checks: loadChecks() };

function loadChecks() {
  try { return JSON.parse(localStorage.getItem('af-plan-checks') || '{}'); } catch { return {}; }
}
function saveChecks() {
  try { localStorage.setItem('af-plan-checks', JSON.stringify(state.checks)); } catch { /* private mode */ }
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v, dp = 0) => fmt.money(v, state.currency, dp);

async function get(path) {
  const res = await fetch(path, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${path} → ${res.status}`);
  return res.json();
}

/** Delta chip. Direction is coloured, but the arrow and number carry the meaning. */
function delta(value, { goodWhenUp = true, suffix = '' } = {}) {
  if (!Number.isFinite(value)) return '<span class="flat">—</span>';
  const rounded = Math.abs(value) < 0.5 ? 0 : value;
  if (rounded === 0) return `<span class="flat">no change${suffix}</span>`;
  const good = goodWhenUp ? rounded > 0 : rounded < 0;
  return `<span class="${good ? 'up' : 'down'}">${rounded > 0 ? '▲' : '▼'} ${Math.abs(rounded).toFixed(0)}%</span><span class="muted">${suffix}</span>`;
}

/** Stat tile, optionally with a shape-only trend behind the number. */
function tile(k, v, d = '', spark = null) {
  const back = spark && spark.values?.length > 2
    ? `<div class="sparkwrap">${sparkArea(spark.values, { color: spark.color || palette().series[0] })}</div>`
    : '';
  return `<div class="tile">${back}<div class="k">${esc(k)}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;
}

const skeleton = (cards = 2) => `<div class="skeleton">
  <div class="sk-tiles">${'<div class="sk sk-tile"></div>'.repeat(4)}</div>
  ${'<div class="sk sk-card"></div>'.repeat(cards)}
</div>`;

// ---------------------------------------------------------------------------
// Pulse
// ---------------------------------------------------------------------------
function renderPulse(root, d) {
  const t = d.totals;
  const c = d.compare;
  const darkDays = d.gaps.reduce((s, g) => s + g.days, 0);
  const p = palette();
  const col = (key) => d.series.map((s) => s[key]);

  root.innerHTML = `
    <div class="tiles">
      ${tile('Spend', money(t.spend), delta(c.delta.spend, { suffix: ' vs prior week' }), { values: col('spend'), color: p.series[0] })}
      ${tile('Revenue', money(t.revenue), delta(c.delta.revenue, { suffix: ' vs prior week' }), { values: col('revenue'), color: p.series[2] })}
      ${tile('Return on ad spend', `${t.roas.toFixed(2)}x`, delta(c.delta.roas, { suffix: ' vs prior week' }), { values: col('roas'), color: p.series[1] })}
      ${tile('Dark days · last 60', String(darkDays), darkDays ? '<span class="down">delivery keeps stopping</span>' : '<span class="up">continuous delivery</span>')}
    </div>
    <div class="tiles">
      ${tile('Purchases', t.purchases ? fmt.num(t.purchases) : '<span class="muted">—</span>', t.purchases ? delta(c.delta.purchases, { suffix: ' vs prior week' }) : '<span class="muted">per-day counts arrive on first live sync</span>', { values: col('purchases'), color: p.series[2] })}
      ${tile('Cost per purchase', t.cpa ? money(t.cpa) : '<span class="muted">—</span>', t.cpa ? delta(c.delta.cpa, { goodWhenUp: false, suffix: ' vs prior week' }) : '<span class="muted">needs purchase counts</span>')}
      ${tile('CPM', money(t.cpm), delta(c.delta.cpm, { goodWhenUp: false, suffix: ' vs prior week' }), { values: col('cpm'), color: p.series[1] })}
      ${tile('Click-through rate', fmt.pct(t.ctr, 2), delta(c.delta.ctr, { suffix: ' vs prior week' }), { values: col('ctr'), color: p.series[0] })}
    </div>

    <div class="card">
      <header>
        <h2>Delivery and return</h2>
        <p class="sub">Two plots, one shared timeline — different scales never share an axis.</p>
      </header>
      <div id="spendPlot"></div>
      <div class="legend"><span><i style="background:var(--series-1)"></i> Daily spend</span></div>
      <div id="roasPlot" style="margin-top:18px"></div>
      <div class="legend">
        <span><i style="background:var(--series-2)"></i> Daily return</span>
        <span><i class="dash" style="color:var(--series-3)"></i> 7-day average</span>
        <span><i class="dash" style="color:var(--status-critical)"></i> Break-even (${d.breakEvenRoas.toFixed(2)}x)</span>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <header><h2>Click-through rate</h2><p class="sub">The earliest honest signal of creative fatigue — it turns before return does.</p></header>
        <div id="ctrPlot"></div>
        <div class="legend"><span><i style="background:var(--series-1)"></i> Daily</span><span><i class="dash" style="color:var(--series-3)"></i> 7-day average</span></div>
      </div>
      <div class="card">
        <header><h2>Cost per thousand impressions</h2><p class="sub">Rising CPM with flat click-through means auction pressure or a saturating audience.</p></header>
        <div id="cpmPlot"></div>
        <div class="legend"><span><i style="background:var(--series-2)"></i> Daily</span><span><i class="dash" style="color:var(--series-3)"></i> 7-day average</span></div>
      </div>
    </div>

    <div class="grid grid-cal">
      <div class="card">
        <header><h2>Delivery calendar</h2><p class="sub">Every day on record. Hatched cells are days nothing delivered — each one restarts the learning phase.</p></header>
        <div id="calendar"></div>
        <div class="legend">
          <span><i class="sq" style="background:#cde2fb"></i> Lower spend</span>
          <span><i class="sq" style="background:#184f95"></i> Higher spend</span>
          <span><i class="hatch"></i> No delivery</span>
        </div>
      </div>
      <div class="card">
        <header><h2>Live right now</h2><p class="sub">${d.live.adsets} of ${d.live.totalAdsets} ad sets delivering, across ${d.live.campaigns} of ${d.live.totalCampaigns} campaigns.</p></header>
        ${d.live.adsets === 0
          ? '<div class="error-box"><b>Nothing is delivering.</b> The account is dark.</div>'
          : `<div class="livelist">${(d.live.adsetDetail || []).map((a) => `
              <div class="liveset">
                <div class="lhead"><span class="dot dot-active"></span><b>${esc(a.name)}</b>
                  ${a.dailyBudget ? `<span class="tag">${money(a.dailyBudget)}/day</span>` : ''}</div>
                <div class="metricgrid">
                  <div><div class="mk">Spend</div><div class="mv">${money(a.spend)}</div></div>
                  <div><div class="mk">Return</div><div class="mv">${a.roas ? fmt.x(a.roas) : '—'}</div></div>
                  <div><div class="mk">Purchases</div><div class="mv">${a.purchases ? fmt.num(a.purchases) : '—'}</div></div>
                  <div><div class="mk">Cost/purch.</div><div class="mv">${a.cpa ? money(a.cpa) : '—'}</div></div>
                  <div><div class="mk">Frequency</div><div class="mv ${a.frequency >= 3 ? 'warn' : ''}">${a.frequency ? a.frequency.toFixed(2) : '—'}</div></div>
                  <div><div class="mk">Audience</div><div class="mv ${a.audienceUpper && a.audienceUpper < 500000 ? 'warn' : ''}">${a.audienceUpper ? fmt.compact(a.audienceUpper) : '—'}</div></div>
                </div>
              </div>`).join('')}</div>`}
        ${d.live.adsets === 1 ? '<p class="sub" style="margin-top:12px">A single live ad set is a single point of failure. See the Mentor tab.</p>' : ''}
      </div>
    </div>

    <div class="card">
      <header><h2>Where the money went</h2><p class="sub">Spend by campaign over the last ${d.window.days} days.</p></header>
      <div id="spendBars"></div>
      <div class="legend">
        <span><i class="sq" style="background:var(--series-1)"></i> Delivering</span>
        <span><i class="sq" style="background:var(--series-2)"></i> Paused</span>
      </div>
    </div>
  `;

  const pts = (key) => d.series.map((s) => ({ x: s.date, label: fmt.day(s.date), y: s[key] }));

  linePlot($('#spendPlot', root), {
    series: [{ name: 'Daily spend', points: pts('spend'), color: p.series[0] }],
    area: true, height: 172, yFormat: (v) => fmt.compact(v), valueFormat: (v) => money(v),
  });
  linePlot($('#roasPlot', root), {
    series: [
      { name: 'Daily return', points: pts('roas'), color: p.series[1] },
      { name: '7-day average', points: pts('roas7'), color: p.series[2], dashed: true },
    ],
    height: 172, yFormat: (v) => `${v.toFixed(1)}x`, valueFormat: (v) => fmt.x(v),
    refLine: d.breakEvenRoas, refLabel: 'break-even',
  });
  linePlot($('#ctrPlot', root), {
    series: [
      { name: 'CTR', points: pts('ctr'), color: p.series[0] },
      { name: '7-day average', points: pts('ctr7'), color: p.series[2], dashed: true },
    ],
    height: 160, yFormat: (v) => `${v.toFixed(1)}%`, valueFormat: (v) => fmt.pct(v, 2),
  });
  linePlot($('#cpmPlot', root), {
    series: [
      { name: 'CPM', points: pts('cpm'), color: p.series[1] },
      { name: '7-day average', points: pts('cpm7'), color: p.series[2], dashed: true },
    ],
    height: 160, yFormat: (v) => fmt.compact(v), valueFormat: (v) => money(v),
  });
  calendarHeatmap($('#calendar', root), { days: state.data.history?.calendar || d.series, currency: state.currency });
  barChart($('#spendBars', root), {
    bars: d.topCampaigns.map((c) => ({
      label: c.name, value: c.spend,
      color: c.status === 'ACTIVE' ? p.series[0] : p.series[1],
      tip: `<div class="tip-head">${esc(c.name)}</div>
        <div class="tip-row">Spend<b>${money(c.spend)}</b></div>
        <div class="tip-row">Return<b>${c.roas ? fmt.x(c.roas) : '—'}</b></div>
        <div class="tip-row">Purchases<b>${fmt.num(c.purchases)}</b></div>
        <div class="tip-row tip-band"><b>${c.status === 'ACTIVE' ? 'Delivering' : 'Paused'}</b></div>`,
    })),
    valueFormat: (v) => money(v),
  });
}

// ---------------------------------------------------------------------------
// Mentor
// ---------------------------------------------------------------------------
function scoreRing(score) {
  const p = palette();
  const colour = score >= 70 ? p.good : score >= 40 ? p.warning : p.critical;
  const r = 45;
  const circ = 2 * Math.PI * r;
  return `<div class="score-ring">
    <svg viewBox="0 0 104 104" width="104" height="104">
      <circle cx="52" cy="52" r="${r}" fill="none" stroke="var(--surface-3)" stroke-width="8"/>
      <circle cx="52" cy="52" r="${r}" fill="none" stroke="${colour}" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${(circ * score / 100).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 52 52)"/>
    </svg>
    <div class="num">${score}<small>OF 100</small></div>
  </div>`;
}

const CHEVRON = '<svg class="chev" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="m9 18 6-6-6-6"/></svg>';

function renderMentor(root, d) {
  const order = ['critical', 'high', 'medium', 'low', 'good'];
  const counts = order.filter((s) => d.counts[s])
    .map((s) => `<span class="sev sev-${s}">${d.counts[s]} ${s}</span>`).join('');

  root.innerHTML = `
    <div class="card">
      <div class="scorecard">
        ${scoreRing(d.score)}
        <div class="score-meta">
          <h2>${esc(d.verdict.label)}</h2>
          <p>${esc(d.verdict.note)}</p>
          <div class="sev-counts">${counts}</div>
        </div>
        <div class="score-side">
          <div class="row"><span>Spend · 28d</span><b>${money(d.context.spend28)}</b></div>
          <div class="row"><span>Return</span><b>${fmt.x(d.context.roas28)}</b></div>
          <div class="row"><span>Break-even</span><b>${d.context.breakEvenRoas.toFixed(2)}x</b></div>
          <div class="row"><span>Ad sets live</span><b>${d.context.liveAdsets}</b></div>
          <div class="row"><span>Checks run</span><b>${d.ruleCount}</b></div>
        </div>
      </div>
    </div>
    <div class="findings">
    ${d.findings.map((f) => `
      <details class="finding is-${f.severity}" ${f.severity === 'critical' ? 'open' : ''}>
        <summary>
          <span class="sev sev-${f.severity}">${f.severity}</span>
          <span class="ftitle">${esc(f.title)}</span>
          <span class="fcat">${esc(f.category)}</span>
          ${CHEVRON}
        </summary>
        <div class="body">
          <div><span class="lbl">What is happening</span><p>${esc(f.finding)}</p></div>
          <div><span class="lbl">Why it matters</span><p>${esc(f.why)}</p></div>
          <div class="fix"><span class="lbl">What to do</span><p>${esc(f.fix)}</p></div>
        </div>
      </details>`).join('')}
    </div>
    <p class="foot">Generated ${new Date(d.generatedAt).toLocaleString('en-GB')}. Findings are recalculated on every sync; their history is in the History tab.</p>
  `;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
function perfRow(e, d) {
  const live = e.effectiveStatus === 'ACTIVE';
  const band = !e.revenue ? '' : e.roas < d.breakEvenRoas ? 'sev-critical' : e.roas < d.targetRoas ? 'sev-medium' : 'sev-good';
  return `<tr>
    <td><div class="name-cell"><span class="dot ${live ? 'dot-active' : 'dot-paused'}"></span>
      <div><div>${esc(e.name || e.id)}</div>
      <div class="meta">${esc(e.objective || e.optimizationGoal || '—')}${e.dailyBudget ? ` · ${money(e.dailyBudget)}/day` : ''}</div></div></div></td>
    <td>${money(e.spend)}</td>
    <td>${e.revenue ? money(e.revenue) : '<span class="muted">—</span>'}</td>
    <td>${e.roas ? `<span class="sev sev-num ${band}">${fmt.x(e.roas)}</span>` : '<span class="muted">—</span>'}</td>
    <td>${e.purchases ? fmt.num(e.purchases) : '<span class="muted">—</span>'}</td>
    <td>${e.cpa ? money(e.cpa) : '<span class="muted">—</span>'}</td>
    <td>${money(e.cpm)}</td>
    <td>${fmt.pct(e.ctr, 2)}</td>
    <td>${e.frequency ? `<span class="${e.frequency >= 3 ? 'freq-warn' : ''}">${e.frequency.toFixed(2)}</span>` : '—'}</td>
    <td>${e.audienceUpper ? fmt.compact(e.audienceUpper) : '<span class="muted">—</span>'}</td>
  </tr>`;
}

function renderCampaigns(root, d) {
  const head = '<tr><th>Name</th><th>Spend</th><th>Revenue</th><th>Return</th><th>Purchases</th><th>Cost/purchase</th><th>CPM</th><th>CTR</th><th>Freq.</th><th>Audience</th></tr>';
  const withSpend = d.campaigns.filter((c) => c.spend > 0);
  const liveSets = d.adsets.filter((a) => a.effectiveStatus === 'ACTIVE').length;
  root.innerHTML = `
    <div class="card">
      <header>
        <h2>Efficiency map</h2>
        <p class="sub">Spend against return over the last ${d.window.days} days. Circle size is spend; colour marks the band, and every point states that band in words on hover.</p>
      </header>
      <div id="scatter"></div>
      <div class="legend">
        <span><i class="round" style="background:var(--status-good)"></i> Above target (${d.targetRoas}x)</span>
        <span><i class="round" style="background:var(--status-warning)"></i> Below target, above break-even</span>
        <span><i class="round" style="background:var(--status-critical)"></i> Below break-even (${d.breakEvenRoas.toFixed(2)}x)</span>
      </div>
    </div>
    <div class="card">
      <header><h2>Campaigns</h2><p class="sub">${withSpend.length} spent in this window, ${d.campaigns.length} on record.</p></header>
      <div class="table-wrap"><table><thead>${head}</thead><tbody>${d.campaigns.map((c) => perfRow(c, d)).join('')}</tbody></table></div>
    </div>
    <div class="card">
      <header><h2>Ad sets</h2><p class="sub">Where the buying decisions actually live — ${liveSets} delivering.</p></header>
      <div class="table-wrap"><table><thead>${head}</thead><tbody>${d.adsets.map((a) => perfRow(a, d)).join('')}</tbody></table></div>
    </div>
  `;
  scatterPlot($('#scatter', root), {
    points: withSpend.filter((c) => c.revenue > 0).map((c) => ({ name: c.name, spend: c.spend, roas: c.roas, purchases: c.purchases, cpa: c.cpa })),
    breakEven: d.breakEvenRoas, target: d.targetRoas, currency: state.currency, height: 300,
  });
}

// ---------------------------------------------------------------------------
// Audiences
// ---------------------------------------------------------------------------
function renderAudiences(root, d) {
  const s = d.summary;
  const tierOrder = ['T0', 'T1', 'T2', 'T3', 'T4'];
  const rungsByTier = (t) => d.plan.filter((r) => r.tier === t).sort((a, b) => a.priority - b.priority);
  const budgetFor = (t) => d.budgetSplit.find((b) => b.tier === t);
  const healthOrder = { broken: 0, weak: 1, ok: 2, strong: 3 };
  const sorted = [...d.audiences].sort((a, b) => healthOrder[a.classification.health] - healthOrder[b.classification.health]);

  root.innerHTML = `
    <div class="tiles">
      ${tile('Audiences in account', String(s.total), `${s.usable} usable · ${s.broken} broken`)}
      ${tile('Broken or empty', String(s.broken), s.broken ? '<span class="down">cannot be targeted</span>' : '<span class="up">none</span>')}
      ${tile('Ladder rungs live', `${s.liveRungs}<small> / ${s.totalRungs}</small>`, `${s.buildableRungs} buildable today`)}
      ${tile('Blocked rungs', String(s.blockedRungs), s.blockedRungs ? '<span class="down">waiting on data fixes</span>' : '<span class="up">none</span>')}
    </div>

    <div class="card">
      <header><h2>What you own today</h2><p class="sub">Every custom audience in the account, worst first, with an honest read on whether it can actually be used.</p></header>
      <div class="aud-health">
        ${sorted.map((a) => `
          <div class="aud h-${a.classification.health}">
            <div class="an">${esc(a.name)}</div>
            <div class="as">
              <span class="tag">${esc(a.subtype || '—')}</span>
              <span class="delivery ${a.delivery_status === 'ACTIVE' ? 'on' : 'off'}">${a.delivery_status === 'ACTIVE' ? 'delivering' : 'not delivering'}</span>
              <span>${a.classification.size ? `~${fmt.num(a.classification.size)} accounts` : 'size not reported'}</span>
            </div>
            <div class="anote">${esc(a.classification.healthNote)}</div>
          </div>`).join('')}
      </div>
    </div>

    <div class="card">
      <header>
        <h2>The audience ladder</h2>
        <p class="sub">The structure this account should be running. Each rung is one ad set: what it targets, what it must exclude so the tiers do not bid against each other, and whether it can be built today.</p>
      </header>
      <div class="ladder">
        ${tierOrder.map((t) => {
          const tier = d.tiers[t];
          const b = budgetFor(t);
          return `<div class="tier tier-${t}">
            <header>
              <span class="tier-key">${t}</span>
              <h3>${esc(tier.label)}</h3>
              <span class="intent">${esc(tier.intent)}</span>
              <span class="share">${Math.round(tier.budgetShare * 100)}% · ${money(b?.daily || 0)}/day</span>
            </header>
            <div class="rungs">
              ${rungsByTier(t).map((r) => `
                <div class="rung">
                  <div class="rid">${r.id}</div>
                  <div>
                    <h4>${esc(r.name)}</h4>
                    <p class="def">${esc(r.definition)}</p>
                    <p class="why">${esc(r.purpose)}</p>
                    ${r.excludes.length ? `<p class="kv"><b>Exclude</b> ${r.excludes.map((x) => `<span class="tag">${esc(x)}</span>`).join(' ')}</p>` : ''}
                    ${r.status === 'blocked' ? `<p class="kv"><b>Blocked by</b> ${esc(r.prerequisite)}</p>` : ''}
                    ${r.existingName ? `<p class="kv"><b>Using</b> <span class="tag">${esc(r.existingName)}</span></p>` : ''}
                  </div>
                  <span class="sev status-${r.status}">${r.status}</span>
                </div>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <header><h2>Finding new customers</h2><p class="sub">The cold tier in build order. Blocked rungs carry the step that unblocks them rather than being hidden.</p></header>
        <ol class="steps">
          ${d.newCustomerPath.map((st) => `
            <li data-n="${st.order}" class="${st.blocked ? 'blocked' : ''}">
              <div class="sa">${esc(st.action)}</div>
              <div class="sr">${esc(st.rationale)}</div>
            </li>`).join('')}
        </ol>
      </div>
      <div class="card">
        <header><h2>Naming convention</h2><p class="sub">${esc(d.naming.why)}</p></header>
        <p><span class="tag" style="font-size:12px;padding:5px 9px">${esc(d.naming.pattern)}</span></p>
        <ul class="rulelist">${d.naming.examples.map((e) => `<li>${esc(e)}</li>`).join('')}</ul>
        ${d.pixel?.eventMatchQuality ? `
          <header style="margin:22px 0 12px"><h3>Signal quality behind these audiences</h3>
          <p class="sub">Match quality decides how many real accounts land in each pool.</p></header>
          <div class="table-wrap"><table><thead><tr><th>Event</th><th>Match quality</th><th>Email coverage</th></tr></thead><tbody>
            ${Object.entries(d.pixel.eventMatchQuality).sort((a, b) => a[1] - b[1]).map(([ev, score]) => `
              <tr><td>${esc(ev)}</td>
              <td><span class="sev sev-num ${score >= 8 ? 'sev-good' : score >= 7 ? 'sev-medium' : 'sev-high'}">${score} / 10</span></td>
              <td>${d.pixel.emailCoverage?.[ev] != null ? fmt.pct(d.pixel.emailCoverage[ev], 0) : '<span class="muted">—</span>'}</td></tr>`).join('')}
          </tbody></table></div>` : ''}
      </div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------
function renderPlanner(root, d) {
  const e = d.economics;
  const p = palette();

  root.innerHTML = `
    <div class="tiles">
      ${tile('Average order value', money(e.aov, 2), `<span class="muted">${esc(e.aovSource)}</span>`)}
      ${tile('Cost per purchase', money(e.currentCpa, 2), `<span class="muted">target ${money(e.targetCpa)}</span>`)}
      ${tile('Break-even cost/order', money(e.breakEvenCpa, 2), `<span class="muted">at ${(e.grossMargin * 100).toFixed(0)}% gross margin</span>`)}
      ${tile('Headroom per order', money(e.headroom, 2), e.headroom > 0 ? '<span class="up">room to bid harder</span>' : '<span class="down">losing money per order</span>')}
    </div>

    <div class="card">
      <header><h2>Where the budget should go</h2><p class="sub">${esc(d.allocation.note)}</p></header>
      <div class="table-wrap"><table>
        <thead><tr><th>Tier</th><th>Target share</th><th>Target/day</th><th>Runnable today</th><th>Today/day</th></tr></thead>
        <tbody>
          ${d.allocation.rows.map((r) => `<tr>
            <td><div class="name-cell"><span class="tier-key tier-${r.tier}" style="background:var(--${r.tier === 'T0' ? 'series-1' : r.tier === 'T1' ? 'series-3' : r.tier === 'T2' ? 'series-2' : r.tier === 'T3' ? 'status-good' : 'ink-muted'})">${r.tier}</span>
            <div><div>${esc(r.label)}</div><div class="meta">${esc(r.intent)}</div></div></div></td>
            <td>${Math.round(r.targetShare * 100)}%</td>
            <td>${money(r.targetDaily)}</td>
            <td>${r.spendable ? `<span class="sev sev-good">${r.readyRungs} of ${r.totalRungs}</span>` : '<span class="sev sev-critical">none</span>'}</td>
            <td>${r.todayDaily ? money(r.todayDaily) : '<span class="muted">—</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      ${d.allocation.parkedShare > 0 ? `<p class="sub" style="margin-top:12px">${Math.round(d.allocation.parkedShare * 100)}% of the ideal split (${money(d.allocation.parkedMonthly)}/month) has no working audience to spend into, so it is currently forced into cold prospecting.</p>` : ''}
    </div>

    <div class="card">
      <header><h2>What the month could look like</h2><p class="sub">The same budget, four states of the account. Orders are budget ÷ cost per purchase; gross profit is revenue × margin − spend.</p></header>
      <div id="scenarioBars"></div>
      <div class="table-wrap" style="margin-top:16px"><table>
        <thead><tr><th>Scenario</th><th>Spend</th><th>Cost/purchase</th><th>Orders</th><th>Revenue</th><th>Return</th><th>Gross profit</th></tr></thead>
        <tbody>${d.scenarios.map((s) => `<tr>
          <td><div>${esc(s.label)}</div><div class="meta">${esc(s.note)}</div></td>
          <td>${money(s.monthlySpend)}</td><td>${money(s.cpa, 2)}</td><td>${fmt.num(s.orders)}</td>
          <td>${money(s.revenue)}</td><td>${fmt.x(s.roas)}</td>
          <td><b style="color:var(--ink-primary)">${money(s.grossProfit)}</b></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card">
      <header><h2>The next four weeks</h2><p class="sub">Ordered so the things that unlock other things happen first. Ticks are saved in this browser.</p></header>
      ${d.plan.weeks.map((w) => `
        <div class="week">
          <header>
            <span class="wnum">Week ${w.week}</span>
            <h3>${esc(w.theme)}</h3>
            <p class="goal">${esc(w.goal)}</p>
          </header>
          ${w.actions.map((a, i) => {
            const key = `w${w.week}-${i}`;
            const done = state.checks[key];
            return `<div class="action ${done ? 'done' : ''}">
              <input type="checkbox" class="chk" data-key="${key}" ${done ? 'checked' : ''}>
              <div style="min-width:0"><div class="t">${esc(a.task)}</div><div class="d">${esc(a.detail)}</div>
              <div class="who"><span class="tag">${esc(a.owner)}</span><span class="sev sev-${a.impact === 'critical' ? 'critical' : a.impact === 'high' ? 'high' : 'low'}">${esc(a.impact)} impact</span></div></div>
            </div>`;
          }).join('')}
        </div>`).join('')}
    </div>

    <div class="grid grid-2">
      ${Object.entries(d.plan.rules).map(([name, items]) => `
        <div class="card">
          <header><h2>${esc(name[0].toUpperCase() + name.slice(1))} rules</h2></header>
          <ul class="rulelist">${items.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>
        </div>`).join('')}
    </div>
  `;

  barChart($('#scenarioBars', root), {
    bars: d.scenarios.map((s) => ({
      label: s.label, value: s.grossProfit,
      color: s.key === 'stalled' ? p.critical : s.key === 'current' ? p.series[0] : p.good,
      tip: `<div class="tip-head">${esc(s.label)}</div>
        <div class="tip-row">Orders<b>${fmt.num(s.orders)}</b></div>
        <div class="tip-row">Revenue<b>${money(s.revenue)}</b></div>
        <div class="tip-row">Gross profit<b>${money(s.grossProfit)}</b></div>`,
    })),
    valueFormat: (v) => money(v),
  });

  root.querySelectorAll('.chk').forEach((box) => {
    box.addEventListener('change', () => {
      state.checks[box.dataset.key] = box.checked;
      saveChecks();
      box.closest('.action').classList.toggle('done', box.checked);
    });
  });
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
function renderHistory(root, d) {
  const openAlerts = d.alerts.filter((a) => !a.resolved_at);
  const closed = d.alerts.filter((a) => a.resolved_at);
  const stamp = (v) => new Date(v).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

  root.innerHTML = `
    <div class="tiles">
      ${tile('History held', `${d.bounds.days}<small> days</small>`, `<span class="muted">${d.bounds.first} → ${d.bounds.last}</span>`)}
      ${tile('Spend tracked', money(d.lifetime.spend), `<span class="muted">${fmt.compact(d.lifetime.impressions)} impressions</span>`)}
      ${tile('Dark days on record', String(d.gaps.reduce((s, g) => s + g.days, 0)), `${d.gaps.length} separate stops`)}
      ${tile('Open findings', String(openAlerts.length), `${closed.length} resolved since tracking began`)}
    </div>

    <div class="card">
      <header><h2>Month by month</h2><p class="sub">Rates are recomputed per month from raw counts, never averaged across months.</p></header>
      <div class="table-wrap"><table>
        <thead><tr><th>Month</th><th>Active days</th><th>Spend</th><th>Revenue</th><th>Return</th><th>Purchases</th><th>Cost/purchase</th><th>CPM</th><th>CTR</th></tr></thead>
        <tbody>${d.monthly.map((m) => `<tr>
          <td>${m.month}</td>
          <td>${m.activeDays}${m.activeDays < m.days ? ` <span class="muted">of ${m.days}</span>` : ''}</td>
          <td>${money(m.spend)}</td>
          <td>${m.revenue ? money(m.revenue) : '<span class="muted">—</span>'}</td>
          <td>${m.roas ? fmt.x(m.roas) : '<span class="muted">—</span>'}</td>
          <td>${m.purchases ? fmt.num(m.purchases) : '<span class="muted">—</span>'}</td>
          <td>${m.cpa ? money(m.cpa) : '<span class="muted">—</span>'}</td>
          <td>${money(m.cpm)}</td>
          <td>${fmt.pct(m.ctr, 2)}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <header><h2>Delivery gaps</h2><p class="sub">Every stretch where nothing delivered.</p></header>
        ${d.gaps.length === 0 ? '<p class="empty-state">No gaps — delivery has been continuous.</p>' : `
          <ul class="timeline">${d.gaps.map((g) => `<li>
            <time>${g.days} day${g.days === 1 ? '' : 's'}</time>
            <div class="what"><b>${g.start}${g.days > 1 ? ` → ${g.end}` : ''}</b><div class="muted">Learning restarted when delivery resumed.</div></div>
          </li>`).join('')}</ul>`}
      </div>
      <div class="card">
        <header><h2>Changes we detected</h2><p class="sub">Budget moves, status flips and new objects, diffed between syncs.</p></header>
        ${d.changelog.length === 0
          ? '<p class="empty-state">Nothing yet. Changes are recorded from the second live sync onward.</p>'
          : `<ul class="timeline">${d.changelog.slice(0, 30).map((c) => `<li>
              <time>${stamp(c.ts)}</time>
              <div class="what"><b>${esc(c.entity_name || c.entity_id)}</b> — ${esc(c.field)}
              ${c.old_value != null ? `<span class="muted">${esc(c.old_value)} → </span>` : ''}<b>${esc(c.new_value ?? '')}</b>
              ${c.note ? `<div class="muted">${esc(c.note)}</div>` : ''}</div>
            </li>`).join('')}</ul>`}
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <header><h2>Meta's activity log</h2><p class="sub">Mirrored locally so it survives Meta's own 90-day window.</p></header>
        ${d.activities.length === 0
          ? '<p class="empty-state">Nothing yet — this fills in on the first live sync.</p>'
          : `<ul class="timeline">${d.activities.slice(0, 30).map((a) => `<li>
              <time>${a.event_time ? stamp(a.event_time) : ''}</time>
              <div class="what"><b>${esc(a.translated || a.event_type || '')}</b>
              <div class="muted">${esc(a.object_name || a.object_id || '')}${a.actor_name ? ` · ${esc(a.actor_name)}` : ''}</div></div>
            </li>`).join('')}</ul>`}
      </div>
      <div class="card">
        <header><h2>Sync log</h2><p class="sub">Every pull, and what it brought back.</p></header>
        ${d.syncs.length === 0 ? '<p class="empty-state">No live syncs yet.</p>' : `
          <ul class="timeline">${d.syncs.map((s) => `<li>
            <time>${stamp(s.started_at)}</time>
            <div class="what">${s.ok ? '<b class="up">OK</b>' : '<b class="down">Failed</b>'}
            <span class="muted">${esc(s.error || (s.stats_json ? Object.entries(JSON.parse(s.stats_json)).filter(([k]) => !['accountId', 'days'].includes(k)).map(([k, v]) => `${k} ${v}`).join(' · ') : ''))}</span></div>
          </li>`).join('')}</ul>`}
      </div>
    </div>

    <div class="card">
      <header><h2>Finding history</h2><p class="sub">When each problem was first seen, and whether it is still open.</p></header>
      <div class="table-wrap"><table>
        <thead><tr><th>Finding</th><th>Severity</th><th>First seen</th><th>Last seen</th><th>State</th></tr></thead>
        <tbody>${d.alerts.map((a) => `<tr>
          <td>${esc(a.title)}</td>
          <td><span class="sev sev-${a.severity}">${a.severity}</span></td>
          <td>${new Date(a.first_seen).toLocaleDateString('en-GB')}</td>
          <td>${new Date(a.last_seen).toLocaleDateString('en-GB')}</td>
          <td>${a.resolved_at ? '<span class="sev sev-good">resolved</span>' : '<span class="sev sev-medium">open</span>'}</td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
const VIEWS = {
  pulse: {
    title: 'Pulse', ranged: true, needs: ['history'],
    sub: 'What the account is doing right now, and which way it is heading.',
    path: () => `/api/overview?days=${state.days}`, render: renderPulse,
  },
  mentor: {
    title: 'Mentor', ranged: false,
    sub: 'What is wrong, ranked by what it costs you — with the numbers behind each call and the fix.',
    path: () => '/api/mentor', render: renderMentor,
  },
  campaigns: {
    title: 'Campaigns', ranged: true,
    sub: 'Every campaign and ad set measured against break-even and target.',
    path: () => `/api/campaigns?days=${state.days}`, render: renderCampaigns,
  },
  audiences: {
    title: 'Audiences', ranged: false,
    sub: 'What you own, whether it can be used, and the ladder you should be running to find new customers.',
    path: () => '/api/audiences', render: renderAudiences,
  },
  planner: {
    title: 'Planner', ranged: false,
    sub: 'Your unit economics, where the budget belongs, and the next four weeks of work.',
    path: () => '/api/planner', render: renderPlanner,
  },
  history: {
    title: 'History', ranged: false,
    sub: 'What has happened, what changed, and when each problem opened and closed.',
    path: () => '/api/history', render: renderHistory,
  },
};

async function loadView(name, { force = false } = {}) {
  const view = VIEWS[name];
  const root = $(`#view-${name}`);
  if (!root.dataset.loaded || force) root.innerHTML = skeleton(name === 'pulse' ? 3 : 2);
  try {
    for (const dep of view.needs || []) {
      if (force || !state.data[dep]) state.data[dep] = await get(VIEWS[dep].path());
    }
    if (force || !state.data[name]) state.data[name] = await get(view.path());
    view.render(root, state.data[name]);
    root.dataset.loaded = '1';
  } catch (err) {
    root.innerHTML = `<div class="error-box"><b>Could not load this view.</b><br>${esc(err.message)}</div>`;
  }
}

function switchTo(name) {
  state.view = name;
  for (const item of document.querySelectorAll('.navitem')) {
    item.setAttribute('aria-selected', String(item.dataset.view === name));
  }
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${name}`;
  $('#pageTitle').textContent = VIEWS[name].title;
  $('#pageSub').textContent = VIEWS[name].sub;
  $('#rangeCtl').hidden = !VIEWS[name].ranged;
  hideTip();
  loadView(name);
  history.replaceState(null, '', `#${name}`);
}

function setRange(days) {
  if (state.days === days) return;
  state.days = days;
  for (const b of document.querySelectorAll('#rangeCtl button')) {
    b.setAttribute('aria-pressed', String(Number(b.dataset.days) === days));
  }
  // Only the windowed views change; the rest are window-independent.
  delete state.data.pulse;
  delete state.data.campaigns;
  loadView(state.view, { force: true });
}

function renderNotices(s) {
  const box = $('#notices');
  const items = [];
  if (!s.tokenConfigured) {
    items.push(`<div class="notice"><div><b>Running on the seeded baseline.</b>
      The account history captured on ${new Date(s.seed?.capturedAt || Date.now()).toLocaleDateString('en-GB')} is loaded, so every view works — but nothing is refreshing.
      Add <code>META_ACCESS_TOKEN</code> to <code>.env</code> and restart to connect live. Daily account figures in the baseline are exact; per-campaign splits are spread evenly across each campaign's active period until the first live sync replaces them.</div></div>`);
  } else if (s.lastSync && !s.lastSync.ok) {
    items.push(`<div class="notice"><div><b>Last sync failed.</b> ${esc(s.lastSync.error?.message || 'Unknown error')} — showing the last good data.</div></div>`);
  }
  if (s.account?.disableReason) {
    items.push(`<div class="notice"><div><b>Ad account flagged by Meta.</b> ${esc(String(s.account.disableReason))}</div></div>`);
  }
  box.innerHTML = items.join('');
}

async function refreshStatus() {
  const s = await get('/api/status');
  state.status = s;
  state.currency = s.account?.currency || 'EGP';
  $('#brandSub').textContent = `${s.account?.businessName || 'Meta Ads'} · ${state.currency}`;
  const rail = $('#railStatus');
  if (s.tokenConfigured) {
    rail.classList.remove('is-offline');
    $('#statusTitle').textContent = 'Live';
    $('#statusSub').textContent = s.lastSync?.at
      ? `synced ${new Date(s.lastSync.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
      : `every ${s.syncIntervalMinutes} min`;
  } else {
    rail.classList.add('is-offline');
    $('#statusTitle').textContent = 'Baseline only';
    $('#statusSub').textContent = 'no token configured';
  }
  renderNotices(s);
  $('#foot').textContent = `${s.ruleCount} mentor checks · history ${s.bounds.first} → ${s.bounds.last} · Graph ${s.apiVersion} · account ${s.account?.id || ''}`;
  return s;
}

async function refreshAll() {
  state.data = {};
  for (const v of document.querySelectorAll('.view')) delete v.dataset.loaded;
  await refreshStatus();
  await loadView(state.view, { force: true });
  const m = await get('/api/mentor').catch(() => null);
  if (m) {
    state.data.mentor = m;
    const open = (m.counts.critical || 0) + (m.counts.high || 0);
    const badge = $('#mentorCount');
    badge.hidden = open === 0;
    badge.textContent = String(open);
  }
}

/** Theme follows the system until the viewer picks; then the pick is remembered. */
function initTheme() {
  // ?theme=dark|light forces a theme for this load - handy for screenshots and
  // for embedding the page somewhere with a fixed appearance.
  const forced = new URLSearchParams(location.search).get('theme');
  const saved = forced === 'dark' || forced === 'light' ? forced : localStorage.getItem('af-theme');
  if (saved) document.documentElement.setAttribute('data-theme', saved);
  $('#themeBtn').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme')
      || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    const next = current === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    try { localStorage.setItem('af-theme', next); } catch { /* private mode */ }
    loadView(state.view, { force: false });
  });
}

function initEvents() {
  // ?live=0 disables the push stream. Useful when driving the page from a
  // headless browser, where an open stream keeps the page from ever going idle.
  if (new URLSearchParams(location.search).get('live') === '0') return;
  const es = new EventSource('/api/events');
  es.addEventListener('sync', () => { refreshAll(); });
  es.onerror = () => { /* EventSource reconnects on its own */ };
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  $('#nav').addEventListener('click', (e) => {
    const item = e.target.closest('.navitem');
    if (item) switchTo(item.dataset.view);
  });
  $('#rangeCtl').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setRange(Number(b.dataset.days));
  });
  $('#syncBtn').addEventListener('click', async () => {
    const btn = $('#syncBtn');
    btn.disabled = true;
    try { await fetch('/api/sync', { method: 'POST' }); await refreshAll(); }
    finally { btn.disabled = false; }
  });

  const initial = location.hash.slice(1);
  if (VIEWS[initial]) state.view = initial;
  switchTo(state.view);
  await refreshAll();
  initEvents();

  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => loadView(state.view), 180); });
});
