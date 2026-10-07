// DUSTPAN — wallet data + small helpers for the customer pages.
//
// All numbers come from Supabase (see supabase/wallet.sql):
//   wallet_summary        read-only totals, calculated from transactions
//   transactions          read-only for customers (staff credit DUST)
//   app_settings          admin-set DUST -> Naira rate (shown as an ESTIMATE)
//   request_redemption()  the only way a customer spends DUST (creates PENDING)
// Nothing here can change a balance. If a request fails we show "—" and an
// error, never an invented zero.

import { supabase } from './auth.js';

const fail = (what, error) => {
  console.error(`[dustpan] ${what}:`, error);
  throw error;
};

// ---- errors -----------------------------------------------------------------
export function isMissingSetup(error) {
  const text = `${error?.code || ''} ${error?.message || ''}`;
  return /PGRST205|PGRST202|42P01|42883|schema cache|does not exist|Could not find the (table|function)/i.test(text);
}

export function walletError(error) {
  if (isMissingSetup(error)) {
    return "Your wallet isn't switched on yet. Ask Dustpan to finish setup.";
  }
  return "We couldn't load your wallet. Please refresh in a moment.";
}

// ---- reads (always filtered by the signed-in user's id) -----------------------
const num = (v) => Number(v ?? 0) || 0;

export async function loadSummary(userId) {
  const { data, error } = await supabase
    .from('wallet_summary')
    .select('balance_dust, available_dust, total_earned, waste_kg, deposit_count, pending_count')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) fail('wallet_summary', error);
  // No row = no transactions yet = a genuine 0 DUST / 0 kg start.
  return {
    balance: num(data?.balance_dust),
    available: num(data?.available_dust),
    earned: num(data?.total_earned),
    kg: num(data?.waste_kg),
    deposits: num(data?.deposit_count),
    pending: num(data?.pending_count),
  };
}

export async function loadRate() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value_num')
    .eq('key', 'dust_ngn_rate')
    .maybeSingle();
  if (error) {
    console.error('[dustpan] app_settings:', error);
    return null;
  }
  const rate = num(data?.value_num);
  return rate > 0 ? rate : null;
}

export async function loadTransactions(userId, limit = 100) {
  const { data, error } = await supabase
    .from('transactions')
    .select('id, kind, amount_dust, waste_kg, status, description, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail('transactions', error);
  return (data || []).map((t) => ({ ...t, amount_dust: num(t.amount_dust), waste_kg: t.waste_kg == null ? null : num(t.waste_kg) }));
}

export async function loadRedemptions(userId, limit = 10) {
  const { data, error } = await supabase
    .from('redemption_requests')
    .select('id, type, amount_dust, estimated_naira, status, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) fail('redemption_requests', error);
  return data || [];
}

// Summary + rate together. Never throws: returns { summary, rate, error }.
export async function loadWallet(user) {
  try {
    const [summary, rate] = await Promise.all([loadSummary(user.id), loadRate()]);
    return { summary, rate, error: null };
  } catch (err) {
    return { summary: null, rate: null, error: walletError(err) };
  }
}

// ---- the one write: a PENDING redemption request --------------------------------
export async function requestRedemption({ type, amount, destination, note }) {
  const { data, error } = await supabase.rpc('request_redemption', {
    p_type: type,
    p_amount_dust: amount,
    p_destination: destination || null,
    p_note: note || null,
  });
  if (error) {
    console.error('[dustpan] request_redemption:', error);
    if (isMissingSetup(error)) throw new Error("Redeeming isn't switched on yet. Ask Dustpan to finish setup.");
    // The function raises plain-English messages ("Not enough available DUST."); show those as they are.
    throw new Error(error.message || 'We could not send your request. Please try again.');
  }
  return data;
}

// ---- formatting -----------------------------------------------------------------
const dustFmt = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 });
const nairaFmt = new Intl.NumberFormat('en-NG', { maximumFractionDigits: 2 });
export const fmtDust = (n) => dustFmt.format(num(n));
export const fmtKg = (n) => `${dustFmt.format(num(n))} kg`;
export const fmtNaira = (n) => `₦${nairaFmt.format(num(n))}`;
export const estNaira = (dust, rate) => (rate ? fmtNaira(num(dust) * rate) : '—');
export const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: 'numeric' });

const KINDS = { deposit: 'Waste deposit', redeem: 'Redemption', trade: 'Trade', adjustment: 'Adjustment' };
export const txLabel = (t) => t.description || KINDS[t.kind] || 'Activity';

// ---- fill the numbers on a page ---------------------------------------------------
// Elements marked data-w="balance|available|earned|kg|pending|deposits|est".
export function paintWallet(view, root = document) {
  const set = (key, text) => root.querySelectorAll(`[data-w="${key}"]`).forEach((el) => (el.textContent = text));
  const errBox = root.querySelector('[data-w-error]');
  const rateNote = root.querySelector('[data-rate-note]');

  if (view.error) {
    ['balance', 'available', 'earned', 'kg', 'pending', 'deposits', 'est'].forEach((k) => set(k, '—'));
    if (errBox) { errBox.textContent = view.error; errBox.hidden = false; }
    return;
  }
  const s = view.summary;
  set('balance', fmtDust(s.balance));
  set('available', fmtDust(s.available));
  set('earned', fmtDust(s.earned));
  set('kg', fmtKg(s.kg));
  set('pending', String(s.pending));
  set('deposits', String(s.deposits));
  set('est', estNaira(s.balance, view.rate));
  if (rateNote) rateNote.hidden = Boolean(view.rate);
}

// ---- Customer ID copy ---------------------------------------------------------------
export function copyText(text, btn) {
  const done = () => {
    try { localStorage.setItem('dc_copied_cid', '1'); } catch { /* ignore */ }
    if (btn) {
      const old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(() => (btn.textContent = old), 1600);
    }
    document.dispatchEvent(new CustomEvent('dc:copied'));
  };
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => legacyCopy(text, done));
  } else {
    legacyCopy(text, done);
  }
}
function legacyCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try { document.execCommand('copy'); done(); } catch { /* ignore */ }
  ta.remove();
}

// Show the Customer ID in every [data-cid] and wire every [data-copy-cid] button.
export function paintCustomerId(cid) {
  document.querySelectorAll('[data-cid]').forEach((el) => (el.textContent = cid || 'Not set up yet'));
  document.querySelectorAll('[data-copy-cid]').forEach((btn) => {
    if (!cid) { btn.hidden = true; return; }
    btn.addEventListener('click', () => copyText(cid, btn));
  });
}

// ---- recent activity rows (used by dashboard + activity page) ------------------------
export function renderTransactions(listEl, txs) {
  listEl.replaceChildren();
  for (const t of txs) {
    const li = document.createElement('li');
    li.className = 'dc-row';

    const left = document.createElement('div');
    const title = document.createElement('div');
    title.className = 'dc-row-title';
    title.textContent = txLabel(t);
    const meta = document.createElement('div');
    meta.className = 'dc-row-meta';
    meta.textContent = fmtDate(t.created_at) + (t.waste_kg ? ` · ${fmtKg(t.waste_kg)}` : '');
    left.append(title, meta);

    const right = document.createElement('div');
    right.className = 'dc-row-end';
    const amt = document.createElement('div');
    amt.className = 'dc-amt ' + (t.amount_dust >= 0 ? 'dc-pos' : 'dc-neg');
    amt.textContent = `${t.amount_dust >= 0 ? '+' : '−'}${fmtDust(Math.abs(t.amount_dust))} DUST`;
    const badge = document.createElement('span');
    badge.className = `dc-badge ${t.status}`;
    badge.textContent = t.status.charAt(0).toUpperCase() + t.status.slice(1);
    right.append(amt, badge);

    li.append(left, right);
    listEl.append(li);
  }
}

// ---- earnings chart: DUST earned per week, from real completed credits only -----------
export function weeklyEarnings(txs, weeks = 8) {
  const startOfWeek = (d) => {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
    return x;
  };
  const thisWeek = startOfWeek(new Date());
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisWeek);
    d.setDate(d.getDate() - i * 7);
    buckets.push({ start: d, total: 0 });
  }
  for (const t of txs) {
    if (t.status !== 'completed' || t.amount_dust <= 0) continue;
    const w = startOfWeek(new Date(t.created_at));
    const b = buckets.find((x) => x.start.getTime() === w.getTime());
    if (b) b.total += t.amount_dust;
  }
  return buckets.map((b) => ({
    label: b.start.toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }),
    total: Math.round(b.total * 100) / 100,
  }));
}

const NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const n = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  return n;
};
const niceMax = (v) => {
  const p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].map((m) => m * p).find((m) => m >= v);
};

// Draws into `host`. With no earnings it shows an empty state: no sample data, ever.
export function renderEarningsChart(host, buckets) {
  host.replaceChildren();
  const max = Math.max(...buckets.map((b) => b.total));
  if (!(max > 0)) {
    const p = document.createElement('div');
    p.className = 'dc-empty';
    p.innerHTML = '<b>No earnings yet</b><span>Your weekly earnings will appear here after your first verified deposit.</span>';
    host.append(p);
    return;
  }

  const W = 480, H = 210, L = 40, R = 8, T = 10, B = 28;
  const top = niceMax(max);
  const plotW = W - L - R, plotH = H - T - B;
  const slot = plotW / buckets.length;
  const barW = Math.min(26, slot * 0.5);
  const y = (v) => T + plotH - (v / top) * plotH;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': `DUST earned per week over the last ${buckets.length} weeks` });
  for (const g of [0, top / 2, top]) {
    svg.append(el('line', { x1: L, x2: W - R, y1: y(g), y2: y(g), class: 'dc-grid' }));
    const t = el('text', { x: L - 6, y: y(g) + 4, 'text-anchor': 'end', class: 'dc-axis' });
    t.textContent = dustFmt.format(g);
    svg.append(t);
  }

  const tip = document.createElement('div');
  tip.className = 'dc-tip';
  tip.hidden = true;
  const show = (b, x, h) => {
    tip.textContent = `Week of ${b.label}: ${fmtDust(b.total)} DUST`;
    tip.hidden = false;
    tip.style.left = `${(x / W) * 100}%`;
    tip.style.top = `${(h / H) * 100}%`;
  };

  buckets.forEach((b, i) => {
    const cx = L + slot * i + slot / 2;
    const x = cx - barW / 2;
    const h = Math.max(0, (b.total / top) * plotH);
    if (b.total > 0) {
      const r = Math.min(4, h);
      const yy = T + plotH - h;
      const bar = el('path', {
        d: `M${x},${T + plotH} V${yy + r} Q${x},${yy} ${x + r},${yy} H${x + barW - r} Q${x + barW},${yy} ${x + barW},${yy + r} V${T + plotH} Z`,
        class: 'dc-bar', tabindex: '0',
      });
      bar.setAttribute('aria-label', `Week of ${b.label}: ${fmtDust(b.total)} DUST`);
      bar.addEventListener('mouseenter', () => show(b, cx, yy));
      bar.addEventListener('focus', () => show(b, cx, yy));
      bar.addEventListener('mouseleave', () => (tip.hidden = true));
      bar.addEventListener('blur', () => (tip.hidden = true));
      svg.append(bar);
    }
    const t = el('text', { x: cx, y: H - 8, 'text-anchor': 'middle', class: 'dc-axis' });
    t.textContent = b.label;
    svg.append(t);
  });
  svg.append(el('line', { x1: L, x2: W - R, y1: T + plotH, y2: T + plotH, class: 'dc-baseline' }));

  const wrap = document.createElement('div');
  wrap.className = 'dc-chart';
  wrap.append(svg, tip);

  const details = document.createElement('details');
  details.className = 'dc-table-view';
  const sum = document.createElement('summary');
  sum.textContent = 'View as table';
  const table = document.createElement('table');
  table.innerHTML = '<thead><tr><th>Week of</th><th>DUST earned</th></tr></thead>';
  const tb = document.createElement('tbody');
  for (const b of buckets) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${b.label}</td><td>${fmtDust(b.total)}</td>`;
    tb.append(tr);
  }
  table.append(tb);
  details.append(sum, table);

  host.append(wrap, details);
}
