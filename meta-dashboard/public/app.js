import { linePlot, barChart, calendarHeatmap, scatterPlot, sparkline, palette, fmt, hideTip } from '/charts.js';

const $ = (sel, root = document) => root.querySelector(sel);
const state = { currency: 'EGP', view: 'pulse', data: {}, status: null, checks: loadChecks() };

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

/** Delta chip: direction is coloured, but the sign and number carry the meaning. */
function delta(value, { goodWhenUp = true, suffix = '' } = {}) {
  if (!Number.isFinite(value)) return '<span class="flat">—</span>';
  const rounded = Math.abs(value) < 0.5 ? 0 : value;
  if (rounded === 0) return `<span class="flat">no change${suffix}</span>`;
  const good = goodWhenUp ? rounded > 0 : rounded < 0;
  return `<span class="${good ? 'up' : 'down'}">${rounded > 0 ? '▲' : '▼'} ${Math.abs(rounded).toFixed(0)}%</span><span class="muted">${suffix}</span>`;
}

const tile = (k, v, d = '') => `<div class="tile"><div class="k">${esc(k)}</div><div class="v">${v}</div><div class="d">${d}</div></div>`;

// ---------------------------------------------------------------------------
// Pulse
// ---------------------------------------------------------------------------
function renderPulse(root, d) {
  const t = d.totals;
  const c = d.compare;
  const darkDays = d.gaps.reduce((s, g) => s + g.days, 0);
  const seeded = d.series.some((s) => s.source === 'seed');

  root.innerHTML = `
    <div class="tiles">
      ${tile('Spend · last ' + d.window.days + 'd', money(t.spend), delta(c.delta.spend, { goodWhenUp: true, suffix: ' vs prior week' }))}
      ${tile('Revenue', money(t.revenue), delta(c.delta.revenue, { suffix: ' vs prior week' }))}
      ${tile('Return on ad spend', fmt.x(t.roas), delta(c.delta.roas, { suffix: ' vs prior week' }))}
      ${tile('Purchases', fmt.num(t.purchases), t.purchases ? delta(c.delta.purchases, { suffix: ' vs prior week' }) : '<span class="muted">awaiting live sync</span>')}
      ${tile('Cost per purchase', t.cpa ? money(t.cpa) : '—', t.cpa ? delta(c.delta.cpa, { goodWhenUp: false, suffix: ' vs prior week' }) : '<span class="muted">awaiting live sync</span>')}
      ${tile('CPM', money(t.cpm), delta(c.delta.cpm, { goodWhenUp: false, suffix: ' vs prior week' }))}
      ${tile('Click-through rate', fmt.pct(t.ctr, 2), delta(c.delta.ctr, { suffix: ' vs prior week' }))}
      ${tile('Dark days · last 60', String(darkDays), darkDays ? '<span class="down">delivery stopped</span>' : '<span class="up">continuous</span>')}
    </div>

    <div class="card">
      <header>
        <h2>Delivery and return, day by day</h2>
        <p class="sub">Two plots, one shared timeline — spend and return are different scales and never share an axis.</p>
      </header>
      <div id="spendPlot"></div>
      <div class="legend"><span><i style="background:var(--series-1)"></i> Daily spend</span></div>
      <div id="roasPlot" style="margin-top:14px"></div>
      <div class="legend">
        <span><i style="background:var(--series-2)"></i> Daily return</span>
        <span><i class="dash" style="color:var(--series-3)"></i> 7-day average</span>
        <span><i class="dash" style="color:var(--status-critical)"></i> Break-even (${d.breakEvenRoas.toFixed(2)}x)</span>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <header><h2>Click-through rate</h2><p class="sub">The earliest signal of creative fatigue — it turns before return does.</p></header>
        <div id="ctrPlot"></div>
        <div class="legend"><span><i style="background:var(--series-1)"></i> Daily</span><span><i class="dash" style="color:var(--series-3)"></i> 7-day average</span></div>
      </div>
      <div class="card">
        <header><h2>Cost per thousand impressions</h2><p class="sub">Rising CPM with flat click-through means auction pressure or a saturating audience.</p></header>
        <div id="cpmPlot"></div>
        <div class="legend"><span><i style="background:var(--series-2)"></i> Daily</span><span><i class="dash" style="color:var(--series-3)"></i> 7-day average</span></div>
      </div>
    </div>

    <div class="card">
      <header>
        <h2>Delivery calendar</h2>
        <p class="sub">Every day the account has existed. Hatched cells are days nothing delivered — each one restarts the learning phase.</p>
      </header>
      <div id="calendar"></div>
      <div class="legend">
        <span><i style="background:#cde2fb;height:11px;width:11px;border-radius:2px"></i> Lower spend</span>
        <span><i style="background:#184f95;height:11px;width:11px;border-radius:2px"></i> Higher spend</span>
        <span><i class="hatch"></i> No delivery</span>
      </div>
    </div>

    <div class="grid grid-2">
      <div class="card">
        <header><h2>Where the money went</h2><p class="sub">Spend by campaign, last ${d.window.days} days.</p></header>
        <div id="spendBars"></div>
      </div>
      <div class="card">
        <header><h2>Live right now</h2><p class="sub">${d.live.adsets} of ${d.live.totalAdsets} ad sets delivering, in ${d.live.campaigns} of ${d.live.totalCampaigns} campaigns.</p></header>
        ${d.live.adsets === 0
          ? '<div class="error-box">Nothing is delivering. The account is dark.</div>'
          : `<ul class="timeline">${d.live.adsetNames.map((n) => `<li><time>delivering</time><div class="what"><span class="dot dot-active" style="display:inline-block;margin-right:6px"></span><b>${esc(n)}</b></div></li>`).join('')}</ul>`}
        ${d.live.adsets === 1 ? '<p class="sub" style="margin-top:10px">One live ad set means one point of failure. See the Mentor tab.</p>' : ''}
      </div>
    </div>
    ${seeded ? '' : ''}
  `;

  const pts = (key) => d.series.map((s) => ({ x: s.date, label: fmt.day(s.date), y: s[key] }));

  linePlot($('#spendPlot', root), {
    series: [{ name: 'Daily spend', points: pts('spend'), color: palette().series[0] }],
    area: true, height: 168, yFormat: (v) => fmt.compact(v), valueFormat: (v) => money(v),
  });
  linePlot($('#roasPlot', root), {
    series: [
      { name: 'Daily return', points: pts('roas'), color: palette().series[1] },
      { name: '7-day average', points: pts('roas7'), color: palette().series[2], dashed: true },
    ],
    height: 168, yFormat: (v) => `${v.toFixed(1)}x`, valueFormat: (v) => fmt.x(v),
    refLine: d.breakEvenRoas, refLabel: 'break-even',
  });
  linePlot($('#ctrPlot', root), {
    series: [
      { name: 'CTR', points: pts('ctr'), color: palette().series[0] },
      { name: '7-day average', points: pts('ctr7'), color: palette().series[2], dashed: true },
    ],
    height: 158, yFormat: (v) => `${v.toFixed(1)}%`, valueFormat: (v) => fmt.pct(v, 2),
  });
  linePlot($('#cpmPlot', root), {
    series: [
      { name: 'CPM', points: pts('cpm'), color: palette().series[1] },
      { name: '7-day average', points: pts('cpm7'), color: palette().series[2], dashed: true },
    ],
    height: 158, yFormat: (v) => fmt.compact(v), valueFormat: (v) => money(v),
  });
  calendarHeatmap($('#calendar', root), { days: state.data.history?.calendar || d.series, currency: state.currency });
  barChart($('#spendBars', root), {
    bars: d.topCampaigns.map((c) => ({
      label: c.name, value: c.spend,
      color: c.status === 'ACTIVE' ? palette().series[0] : palette().series[1],
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
  const r = 42;
  const circ = 2 * Math.PI * r;
  return `<div class="score-ring">
    <svg viewBox="0 0 96 96" width="96" height="96">
      <circle cx="48" cy="48" r="${r}" fill="none" stroke="var(--grid)" stroke-width="8"/>
      <circle cx="48" cy="48" r="${r}" fill="none" stroke="${colour}" stroke-width="8" stroke-linecap="round"
        stroke-dasharray="${(circ * score / 100).toFixed(1)} ${circ.toFixed(1)}" transform="rotate(-90 48 48)"/>
    </svg>
    <div class="num">${score}</div>
  </div>`;
}

function renderMentor(root, d) {
  const order = ['critical', 'high', 'medium', 'low', 'good'];
  const counts = order
    .filter((s) => d.counts[s])
    .map((s) => `<span class="sev sev-${s}">${d.counts[s]} ${s}</span>`)
    .join('');

  root.innerHTML = `
    <div class="card">
      <div class="scorecard">
        ${scoreRing(d.score)}
        <div class="score-meta">
          <h2>${esc(d.verdict.label)}</h2>
          <p>${esc(d.verdict.note)}</p>
          <div class="sev-counts">${counts}</div>
        </div>
        <div class="score-meta" style="min-width:200px">
          <p class="sub" style="margin-bottom:6px">Last 28 days</p>
          <p><b>${money(d.context.spend28)}</b> spent · <b>${fmt.x(d.context.roas28)}</b> return · <b>${d.context.liveAdsets}</b> ad set${d.context.liveAdsets === 1 ? '' : 's'} live</p>
          <p class="sub" style="margin-top:6px">${d.ruleCount} checks run against the account.</p>
        </div>
      </div>
    </div>
    ${d.findings.map((f) => `
      <details class="finding is-${f.severity}" ${f.severity === 'critical' ? 'open' : ''}>
        <summary>
          <span class="sev sev-${f.severity}">${f.severity}</span>
          <span class="ftitle">${esc(f.title)}</span>
          <span class="fcat">${esc(f.category)}</span>
        </summary>
        <div class="body">
          <span class="lbl">What is happening</span>
          <p>${esc(f.finding)}</p>
          <span class="lbl">Why it matters</span>
          <p>${esc(f.why)}</p>
          <div class="fix">
            <span class="lbl">What to do</span>
            <p>${esc(f.fix)}</p>
          </div>
        </div>
      </details>`).join('')}
    <p class="foot">Generated ${new Date(d.generatedAt).toLocaleString('en-GB')}. Findings are recalculated on every sync and their history is kept in the History tab.</p>
  `;
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
function perfRow(e, d) {
  const status = e.effectiveStatus === 'ACTIVE';
  const band = !e.revenue ? '' : e.roas < d.breakEvenRoas ? 'sev-critical' : e.roas < d.targetRoas ? 'sev-medium' : 'sev-good';
  return `<tr>
    <td><div class="name-cell"><span class="dot ${status ? 'dot-active' : 'dot-paused'}"></span>
      <div><div>${esc(e.name || e.id)}</div>
      <div class="muted" style="font-size:11px">${esc(e.objective || e.optimizationGoal || '')}${e.dailyBudget ? ` · ${money(e.dailyBudget)}/day` : ''}</div></div></div></td>
    <td>${money(e.spend)}</td>
    <td>${e.revenue ? money(e.revenue) : '<span class="muted">—</span>'}</td>
    <td>${e.roas ? `<span class="sev ${band}">${fmt.x(e.roas)}</span>` : '<span class="muted">—</span>'}</td>
    <td>${e.purchases ? fmt.num(e.purchases) : '<span class="muted">—</span>'}</td>
    <td>${e.cpa ? money(e.cpa) : '<span class="muted">—</span>'}</td>
    <td>${money(e.cpm)}</td>
    <td>${fmt.pct(e.ctr, 2)}</td>
    <td>${e.frequency ? e.frequency.toFixed(2) : '—'}</td>
    <td>${e.audienceUpper ? fmt.compact(e.audienceUpper) : '<span class="muted">—</span>'}</td>
  </tr>`;
}

function renderCampaigns(root, d) {
  const head = `<tr><th>Name</th><th>Spend</th><th>Revenue</th><th>Return</th><th>Purchases</th><th>Cost/purchase</th><th>CPM</th><th>CTR</th><th>Freq.</th><th>Audience</th></tr>`;
  const withSpend = d.campaigns.filter((c) => c.spend > 0);
  root.innerHTML = `
    <div class="card">
      <header>
        <h2>Efficiency map</h2>
        <p class="sub">Spend against return, last ${d.window.days} days. Circle size is spend. Colour marks the band and every point states it in words on hover.</p>
      </header>
      <div id="scatter"></div>
      <div class="legend">
        <span><i style="background:var(--status-good);height:11px;width:11px;border-radius:99px"></i> Above target (${d.targetRoas}x)</span>
        <span><i style="background:var(--status-warning);height:11px;width:11px;border-radius:99px"></i> Below target, above break-even</span>
        <span><i style="background:var(--status-critical);height:11px;width:11px;border-radius:99px"></i> Below break-even (${d.breakEvenRoas.toFixed(2)}x)</span>
      </div>
    </div>
    <div class="card">
      <header><h2>Campaigns</h2><p class="sub">${withSpend.length} with spend in the window, ${d.campaigns.length} total.</p></header>
      <div class="table-wrap"><table><thead>${head}</thead><tbody>
        ${d.campaigns.map((c) => perfRow(c, d)).join('')}
      </tbody></table></div>
    </div>
    <div class="card">
      <header><h2>Ad sets</h2><p class="sub">Where the actual buying decisions live.</p></header>
      <div class="table-wrap"><table><thead>${head}</thead><tbody>
        ${d.adsets.map((a) => perfRow(a, d)).join('')}
      </tbody></table></div>
    </div>
  `;
  scatterPlot($('#scatter', root), {
    points: withSpend.filter((c) => c.revenue > 0).map((c) => ({ name: c.name, spend: c.spend, roas: c.roas, purchases: c.purchases, cpa: c.cpa })),
    breakEven: d.breakEvenRoas, target: d.targetRoas, currency: state.currency, height: 280,
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

  root.innerHTML = `
    <div class="tiles">
      ${tile('Audiences in account', String(s.total), `${s.usable} usable`)}
      ${tile('Broken or empty', String(s.broken), s.broken ? '<span class="down">cannot be targeted</span>' : '<span class="up">none</span>')}
      ${tile('Ladder rungs live', `${s.liveRungs} / ${s.totalRungs}`, `${s.buildableRungs} buildable now`)}
      ${tile('Blocked rungs', String(s.blockedRungs), s.blockedRungs ? '<span class="down">waiting on data fixes</span>' : '<span class="up">none</span>')}
    </div>

    <div class="card">
      <header>
        <h2>What you own today</h2>
        <p class="sub">Every custom audience in the account, with an honest read on whether it can actually be used.</p>
      </header>
      <div class="aud-health">
        ${d.audiences.map((a) => `
          <div class="aud h-${a.classification.health}">
            <div class="an">${esc(a.name)}</div>
            <div class="as">${esc(a.subtype || '')} · ${a.classification.size ? `~${fmt.num(a.classification.size)} accounts` : 'size not reported'} · ${a.delivery_status === 'ACTIVE' ? 'delivering' : 'not delivering'}</div>
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
          return `<div class="tier">
            <header>
              <h3>${t} · ${esc(tier.label)}</h3>
              <span class="intent">${esc(tier.intent)}</span>
              <span class="share">${Math.round(tier.budgetShare * 100)}% of budget · ${money(b?.daily || 0)}/day</span>
            </header>
            <div class="rungs">
              ${rungsByTier(t).map((r) => `
                <div class="rung">
                  <div class="rid">${r.id}</div>
                  <div>
                    <h4>${esc(r.name)}</h4>
                    <p class="def">${esc(r.definition)}</p>
                    <p class="why">${esc(r.purpose)}</p>
                    ${r.excludes.length ? `<p class="excl"><b>Exclude:</b> ${r.excludes.map(esc).join(' · ')}</p>` : ''}
                    ${r.status === 'blocked' ? `<p class="excl"><b>Blocked by:</b> ${esc(r.prerequisite)}</p>` : ''}
                    ${r.existingName ? `<p class="excl"><b>Using:</b> ${esc(r.existingName)}</p>` : ''}
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
        <header><h2>Finding new customers</h2><p class="sub">The cold tier in build order. Blocked rungs come with the step that unblocks them rather than being hidden.</p></header>
        <ul class="timeline">
          ${d.newCustomerPath.map((st) => `
            <li>
              <time>${st.blocked ? 'unblock first' : `step ${st.order}`}</time>
              <div class="what">
                <b>${esc(st.action)}</b>
                <div class="muted" style="margin-top:3px">${esc(st.rationale)}</div>
              </div>
            </li>`).join('')}
        </ul>
      </div>
      <div class="card">
        <header><h2>Naming convention</h2><p class="sub">${esc(d.naming.why)}</p></header>
        <p><code>${esc(d.naming.pattern)}</code></p>
        <ul class="rulelist">${d.naming.examples.map((e) => `<li><code>${esc(e)}</code></li>`).join('')}</ul>
        ${d.pixel?.eventMatchQuality ? `
          <header style="margin-top:16px"><h3>Signal quality behind these audiences</h3>
          <p class="sub">Match quality decides how many real people land in each pool.</p></header>
          <div class="table-wrap"><table><thead><tr><th>Event</th><th>Match quality</th><th>Email coverage</th></tr></thead><tbody>
            ${Object.entries(d.pixel.eventMatchQuality).sort((a, b) => a[1] - b[1]).map(([ev, score]) => `
              <tr><td>${esc(ev)}</td>
              <td><span class="sev ${score >= 8 ? 'sev-good' : score >= 7 ? 'sev-medium' : 'sev-high'}">${score}/10</span></td>
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
  const spendable = d.allocation.rows.filter((r) => r.spendable);

  root.innerHTML = `
    <div class="tiles">
      ${tile('Average order value', money(e.aov, 2), `<span class="muted">${esc(e.aovSource)}</span>`)}
      ${tile('Cost per purchase', money(e.currentCpa, 2), `<span class="muted">target ${money(e.targetCpa)}</span>`)}
      ${tile('Break-even cost/order', money(e.breakEvenCpa, 2), `<span class="muted">at ${(e.grossMargin * 100).toFixed(0)}% margin</span>`)}
      ${tile('Profit headroom per order', money(e.headroom, 2), e.headroom > 0 ? '<span class="up">room to bid harder</span>' : '<span class="down">losing money per order</span>')}
    </div>

    <div class="card">
      <header>
        <h2>Where the budget should go</h2>
        <p class="sub">${esc(d.allocation.note)}</p>
      </header>
      <div class="table-wrap"><table>
        <thead><tr><th>Tier</th><th>Target share</th><th>Target/day</th><th>Runnable today</th><th>Today/day</th></tr></thead>
        <tbody>
          ${d.allocation.rows.map((r) => `<tr>
            <td><div>${r.tier} · ${esc(r.label)}</div><div class="muted" style="font-size:11px">${esc(r.intent)}</div></td>
            <td>${Math.round(r.targetShare * 100)}%</td>
            <td>${money(r.targetDaily)}</td>
            <td>${r.spendable ? `<span class="sev sev-good">${r.readyRungs} of ${r.totalRungs}</span>` : '<span class="sev sev-critical">none</span>'}</td>
            <td>${r.todayDaily ? money(r.todayDaily) : '<span class="muted">—</span>'}</td>
          </tr>`).join('')}
        </tbody>
      </table></div>
      ${d.allocation.parkedShare > 0 ? `<p class="sub" style="margin-top:10px">${Math.round(d.allocation.parkedShare * 100)}% of the ideal split (${money(d.allocation.parkedMonthly)}/month) has no working audience to spend into and is currently forced into cold prospecting.</p>` : ''}
    </div>

    <div class="card">
      <header>
        <h2>What the month could look like</h2>
        <p class="sub">Same budget, four different states of the account. Orders are budget ÷ cost per purchase; gross profit is revenue × margin − spend.</p>
      </header>
      <div id="scenarioBars"></div>
      <div class="table-wrap" style="margin-top:12px"><table>
        <thead><tr><th>Scenario</th><th>Spend</th><th>Cost/purchase</th><th>Orders</th><th>Revenue</th><th>Return</th><th>Gross profit</th></tr></thead>
        <tbody>${d.scenarios.map((s) => `<tr>
          <td><div>${esc(s.label)}</div><div class="muted" style="font-size:11px">${esc(s.note)}</div></td>
          <td>${money(s.monthlySpend)}</td><td>${money(s.cpa, 2)}</td><td>${fmt.num(s.orders)}</td>
          <td>${money(s.revenue)}</td><td>${fmt.x(s.roas)}</td>
          <td><b>${money(s.grossProfit)}</b></td>
        </tr>`).join('')}</tbody>
      </table></div>
    </div>

    <div class="card">
      <header><h2>The next four weeks</h2><p class="sub">Ordered so the things that unlock other things happen first. Ticks are saved in this browser.</p></header>
      ${d.plan.weeks.map((w) => `
        <div class="week">
          <header>
            <div class="wnum">Week ${w.week}</div>
            <h3>${esc(w.theme)}</h3>
            <p class="goal">${esc(w.goal)}</p>
          </header>
          ${w.actions.map((a, i) => {
            const key = `w${w.week}-${i}`;
            const done = state.checks[key];
            return `<div class="action ${done ? 'done' : ''}">
              <input type="checkbox" class="chk" data-key="${key}" ${done ? 'checked' : ''}>
              <div><div class="t">${esc(a.task)}</div><div class="d">${esc(a.detail)}</div>
              <div class="who">${esc(a.owner)} · ${esc(a.impact)} impact</div></div>
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

  const p = palette();
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
  const closedAlerts = d.alerts.filter((a) => a.resolved_at);

  root.innerHTML = `
    <div class="tiles">
      ${tile('History held', `${d.bounds.days} days`, `<span class="muted">${d.bounds.first} → ${d.bounds.last}</span>`)}
      ${tile('Lifetime spend tracked', money(d.lifetime.spend), `<span class="muted">${fmt.num(d.lifetime.impressions)} impressions</span>`)}
      ${tile('Dark days on record', String(d.gaps.reduce((s, g) => s + g.days, 0)), `${d.gaps.length} separate stops`)}
      ${tile('Open findings', String(openAlerts.length), `${closedAlerts.length} resolved since tracking began`)}
    </div>

    <div class="card">
      <header><h2>Month by month</h2><p class="sub">Rates are recomputed per month from raw counts, never averaged across months.</p></header>
      <div class="table-wrap"><table>
        <thead><tr><th>Month</th><th>Active days</th><th>Spend</th><th>Revenue</th><th>Return</th><th>Purchases</th><th>Cost/purchase</th><th>CPM</th><th>CTR</th></tr></thead>
        <tbody>${d.monthly.map((m) => `<tr>
          <td>${m.month}</td>
          <td>${m.activeDays}${m.activeDays < 25 ? ` <span class="muted">of ${m.days}</span>` : ''}</td>
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

    <div class="card">
      <header><h2>Delivery gaps on record</h2><p class="sub">Every stretch where nothing delivered.</p></header>
      ${d.gaps.length === 0 ? '<p class="sub">No gaps — delivery has been continuous.</p>' : `
        <ul class="timeline">${d.gaps.map((g) => `<li>
          <time>${g.days} day${g.days === 1 ? '' : 's'}</time>
          <div class="what"><b>${g.start}${g.days > 1 ? ` → ${g.end}` : ''}</b><div class="muted">Learning phase restarted when delivery resumed.</div></div>
        </li>`).join('')}</ul>`}
    </div>

    <div class="grid grid-2">
      <div class="card">
        <header><h2>Changes we detected</h2><p class="sub">Budget moves, status flips and new objects, diffed between syncs.</p></header>
        ${d.changelog.length === 0
          ? '<p class="sub">Nothing yet. Changes are recorded from the second live sync onward.</p>'
          : `<ul class="timeline">${d.changelog.slice(0, 40).map((c) => `<li>
              <time>${new Date(c.ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
              <div class="what"><b>${esc(c.entity_name || c.entity_id)}</b> — ${esc(c.field)}
              ${c.old_value != null ? `<span class="muted">${esc(c.old_value)} → </span>` : ''}<b>${esc(c.new_value ?? '')}</b>
              ${c.note ? `<div class="muted">${esc(c.note)}</div>` : ''}</div>
            </li>`).join('')}</ul>`}
      </div>
      <div class="card">
        <header><h2>Meta's activity log</h2><p class="sub">Mirrored locally so it survives Meta's own 90-day window.</p></header>
        ${d.activities.length === 0
          ? '<p class="sub">Nothing yet — this fills in on the first live sync.</p>'
          : `<ul class="timeline">${d.activities.slice(0, 40).map((a) => `<li>
              <time>${a.event_time ? new Date(a.event_time).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''}</time>
              <div class="what"><b>${esc(a.translated || a.event_type || '')}</b>
              <div class="muted">${esc(a.object_name || a.object_id || '')}${a.actor_name ? ` · ${esc(a.actor_name)}` : ''}</div></div>
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

    <div class="card">
      <header><h2>Sync log</h2></header>
      ${d.syncs.length === 0 ? '<p class="sub">No live syncs yet.</p>' : `
        <ul class="timeline">${d.syncs.map((s) => `<li>
          <time>${new Date(s.started_at).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</time>
          <div class="what">${s.ok ? '<b class="up">OK</b>' : '<b class="down">Failed</b>'}
          <span class="muted">${esc(s.error || (s.stats_json ? Object.entries(JSON.parse(s.stats_json)).filter(([k]) => !['accountId', 'days'].includes(k)).map(([k, v]) => `${k} ${v}`).join(' · ') : ''))}</span></div>
        </li>`).join('')}</ul>`}
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Shell
// ---------------------------------------------------------------------------
const VIEWS = {
  pulse: { path: () => '/api/overview?days=28', render: renderPulse, needs: ['history'] },
  mentor: { path: () => '/api/mentor', render: renderMentor },
  campaigns: { path: () => '/api/campaigns?days=28', render: renderCampaigns },
  audiences: { path: () => '/api/audiences', render: renderAudiences },
  planner: { path: () => '/api/planner', render: renderPlanner },
  history: { path: () => '/api/history', render: renderHistory },
};

async function loadView(name, { force = false } = {}) {
  const view = VIEWS[name];
  const root = $(`#view-${name}`);
  try {
    for (const dep of view.needs || []) {
      if (force || !state.data[dep]) state.data[dep] = await get(VIEWS[dep].path());
    }
    if (force || !state.data[name]) state.data[name] = await get(view.path());
    view.render(root, state.data[name]);
  } catch (err) {
    root.innerHTML = `<div class="error-box"><b>Could not load this view.</b><br>${esc(err.message)}</div>`;
  }
}

function switchTo(name) {
  state.view = name;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.view === name));
  }
  for (const v of document.querySelectorAll('.view')) v.hidden = v.id !== `view-${name}`;
  hideTip();
  loadView(name);
  history.replaceState(null, '', `#${name}`);
}

function renderNotices(s) {
  const box = $('#notices');
  const items = [];
  if (!s.tokenConfigured) {
    items.push(`<div class="notice"><b>Running on the seeded baseline.</b>
      <span>The account history captured on ${new Date(s.seed?.capturedAt || Date.now()).toLocaleDateString('en-GB')} is loaded, so every view works — but nothing is refreshing.
      Add <code>META_ACCESS_TOKEN</code> to <code>.env</code> and restart to connect live. Daily account figures in the baseline are exact; per-campaign splits are spread evenly across each campaign's active period until the first live sync replaces them.</span></div>`);
  } else if (s.lastSync && !s.lastSync.ok) {
    items.push(`<div class="notice"><b>Last sync failed.</b><span>${esc(s.lastSync.error?.message || 'Unknown error')} — showing the last good data.</span></div>`);
  }
  if (s.account?.disableReason) {
    items.push(`<div class="notice"><b>Ad account flagged by Meta.</b><span>${esc(String(s.account.disableReason))}</span></div>`);
  }
  box.innerHTML = items.join('');
}

async function refreshStatus() {
  const s = await get('/api/status');
  state.status = s;
  state.currency = s.account?.currency || 'EGP';
  $('#brandSub').textContent = `${s.account?.name || s.account?.id || ''} · ${s.account?.businessName || 'Meta Ads'} · ${state.currency}`;
  const dot = $('#liveDot');
  const text = $('#liveText');
  if (s.tokenConfigured) {
    dot.classList.remove('is-offline');
    text.textContent = s.lastSync?.at ? `live · synced ${new Date(s.lastSync.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : 'live';
  } else {
    dot.classList.add('is-offline');
    text.textContent = 'baseline only';
  }
  renderNotices(s);
  $('#foot').textContent = `${s.ruleCount} mentor checks · history ${s.bounds.first} → ${s.bounds.last} · Graph ${s.apiVersion} · account ${s.account?.id || ''}`;
  return s;
}

async function refreshAll() {
  state.data = {};
  await refreshStatus();
  await loadView(state.view, { force: true });
  const m = await get('/api/mentor').catch(() => null);
  if (m) {
    state.data.mentor = m;
    const open = (m.counts.critical || 0) + (m.counts.high || 0);
    const pill = $('#mentorPill');
    pill.hidden = open === 0;
    pill.textContent = String(open);
  }
}

// Theme: follow the system unless the viewer picks, then remember the pick.
function initTheme() {
  const saved = localStorage.getItem('af-theme');
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
  es.addEventListener('sync', async () => { await refreshAll(); });
  es.onerror = () => { /* EventSource reconnects on its own */ };
}

document.addEventListener('DOMContentLoaded', async () => {
  initTheme();
  $('#tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) switchTo(tab.dataset.view);
  });
  $('#syncBtn').addEventListener('click', async () => {
    const btn = $('#syncBtn');
    btn.disabled = true; btn.textContent = 'Syncing…';
    try { await fetch('/api/sync', { method: 'POST' }); await refreshAll(); }
    finally { btn.disabled = false; btn.textContent = 'Sync now'; }
  });

  const initial = location.hash.slice(1);
  if (VIEWS[initial]) state.view = initial;
  await refreshAll();
  switchTo(state.view);
  initEvents();

  let t;
  window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => loadView(state.view), 180); });
});
