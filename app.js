'use strict';

// ============ Supabase Config ============
// 收到 URL / anon key 後貼到這裡，其餘程式自動切換為雲端模式。
// 留空時 → 降級為 localStorage（單機模式），站點仍可用。
const SUPABASE_URL = 'https://peisbkgpygtjnarqeyeo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBlaXNia2dweWd0am5hcnFleWVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY4MjM2MTQsImV4cCI6MjA5MjM5OTYxNH0.6-i8KuRBpfeAj1gS4gi5DhvQRNrQXC0AT9NG4hdwXEU';

const LS_KEY = 'sort_dashboard_v1';
const VARIANCE_THRESHOLD = 10000;
const AUTH_KEY = 'sort_dashboard_auth_v1';
const ADMIN_USER = 'admin';
const ADMIN_PASS = 'admin'; // localStorage fallback only
const ADMIN_EMAIL_ALIAS = 'miaofang0814@gmail.com'; // 輸入「admin」時對應到此 Supabase 帳號

const WEEKDAY_TW = ['日','一','二','三','四','五','六'];

// camelCase (JS) <-> snake_case (DB)
const FIELDS_TO_ROW = {
  estPicks: 'est_picks', estBoxes: 'est_boxes', estEnd: 'est_end',
  totalPicks: 'total_picks', totalBoxes: 'total_boxes', totalEnd: 'total_end',
  aStations: 'a_stations', bStations: 'b_stations', varianceNote: 'variance_note',
};
const FIELDS_TO_JS = Object.fromEntries(
  Object.entries(FIELDS_TO_ROW).map(([k, v]) => [v, k])
);
function rowToEntry(row) {
  const e = {};
  for (const [dbKey, jsKey] of Object.entries(FIELDS_TO_JS)) {
    if (row[dbKey] != null) e[jsKey] = row[dbKey];
  }
  return e;
}
function patchToRow(patch) {
  const r = {};
  for (const [jsKey, dbKey] of Object.entries(FIELDS_TO_ROW)) {
    if (jsKey in patch) r[dbKey] = patch[jsKey];
  }
  return r;
}

// ============ Storage Layer ============
let userCache = {}; // date -> entry (merge result shown to UI)
let supa = null;    // Supabase client (null = LS mode)
const USE_SUPABASE = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

function loadUser() { return userCache; }

function saveUserCacheLS() {
  localStorage.setItem(LS_KEY, JSON.stringify(userCache));
}

async function initUserData() {
  if (USE_SUPABASE) {
    supa = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    try {
      const { data, error } = await supa.from('entries').select('*');
      if (error) throw error;
      userCache = Object.fromEntries((data || []).map(r => [r.date, rowToEntry(r)]));
    } catch (e) {
      console.error('Supabase 讀取失敗，降級為本機模式:', e);
      supa = null;
      loadUserFromLS();
    }
    if (supa) subscribeRealtime();
  } else {
    loadUserFromLS();
  }
}

function loadUserFromLS() {
  try { userCache = JSON.parse(localStorage.getItem(LS_KEY)) || {}; }
  catch { userCache = {}; }
}

function subscribeRealtime() {
  supa.channel('entries-sync')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'entries' }, (payload) => {
      const row = payload.new || payload.old;
      if (!row?.date) return;
      if (payload.eventType === 'DELETE') delete userCache[row.date];
      else userCache[row.date] = rowToEntry(payload.new);
      renderAll();
      renderForecast();
      renderActualForm();
    })
    .subscribe();
}

function getUserEntry(date) { return userCache[date] || {}; }

async function upsertUserEntry(date, patch) {
  userCache[date] = { ...(userCache[date] || {}), ...patch };
  if (supa) {
    const { error } = await supa.from('entries').upsert({ date, ...patchToRow(patch) });
    if (error) { alert('儲存失敗：' + error.message); throw error; }
  } else {
    saveUserCacheLS();
  }
}

// ============ Auth ============
let authCache = { logged: false, user: null };

function isLoggedIn() { return authCache.logged; }

async function refreshAuth() {
  if (supa) {
    const { data: { session } } = await supa.auth.getSession();
    authCache.logged = Boolean(session);
    authCache.user = session?.user?.email?.split('@')[0] || null;
  } else {
    const v = sessionStorage.getItem(AUTH_KEY);
    authCache.logged = v === ADMIN_USER;
    authCache.user = authCache.logged ? ADMIN_USER : null;
  }
  applyAuthState();
}

function applyAuthState() {
  const logged = authCache.logged;
  document.getElementById('loginBtn').classList.toggle('hidden', logged);
  document.getElementById('authStatus').classList.toggle('hidden', !logged);
  if (logged) document.getElementById('authUser').textContent = authCache.user || ADMIN_USER;

  document.querySelectorAll('.lock-form').forEach(form => {
    form.classList.toggle('locked', !logged);
    form.querySelectorAll('input, textarea, select, button').forEach(el => {
      el.disabled = !logged;
    });
  });
}

function openLoginModal() {
  document.getElementById('loginError').classList.add('hidden');
  document.getElementById('loginForm').reset();
  document.getElementById('loginModal').classList.remove('hidden');
  setTimeout(() => document.getElementById('loginUser').focus(), 0);
}

function closeLoginModal() {
  document.getElementById('loginModal').classList.add('hidden');
}

async function handleLoginSubmit(e) {
  e.preventDefault();
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const errEl = document.getElementById('loginError');
  errEl.classList.add('hidden');

  if (supa) {
    const email = u.includes('@') ? u : ADMIN_EMAIL_ALIAS;
    const { error } = await supa.auth.signInWithPassword({ email, password: p });
    if (error) {
      errEl.textContent = '登入失敗：' + error.message;
      errEl.classList.remove('hidden');
      return;
    }
    authCache.logged = true;
    authCache.user = u;
    closeLoginModal();
    applyAuthState();
  } else {
    if (u === ADMIN_USER && p === ADMIN_PASS) {
      sessionStorage.setItem(AUTH_KEY, u);
      authCache = { logged: true, user: u };
      closeLoginModal();
      applyAuthState();
    } else {
      errEl.textContent = '帳號或密碼錯誤';
      errEl.classList.remove('hidden');
    }
  }
}

async function handleLogout() {
  if (supa) await supa.auth.signOut();
  sessionStorage.removeItem(AUTH_KEY);
  authCache = { logged: false, user: null };
  applyAuthState();
}

// ============ Time helpers ============
function parseHHMM(s) {
  if (!s) return null;
  const [h, m] = s.split(':').map(Number);
  if (isNaN(h) || isNaN(m)) return null;
  return h * 60 + m;
}

function formatMins(mins) {
  if (mins == null || isNaN(mins)) return '—';
  mins = Math.round(mins);
  const overnight = mins >= 24 * 60;
  const m = ((mins % (24 * 60)) + 24 * 60) % (24 * 60);
  const hh = String(Math.floor(m / 60)).padStart(2, '0');
  const mm = String(m % 60).padStart(2, '0');
  return overnight ? `${hh}:${mm} (+1)` : `${hh}:${mm}`;
}

function fmtNum(n, digits = 0) {
  if (n == null || isNaN(n)) return '—';
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

function fmtDateLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return `${dateStr} (週${WEEKDAY_TW[d.getDay()]})`;
}

// ============ Data merge ============
function getAllRecords() {
  const user = loadUser();
  const map = {};
  for (const r of window.SEED.records) map[r.date] = JSON.parse(JSON.stringify(r));
  for (const [date, u] of Object.entries(user)) {
    if (!map[date]) {
      const d = new Date(date + 'T00:00:00');
      map[date] = { date, weekday: d.getDay() };
    }
    Object.assign(map[date], u);
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

function getRecord(date) {
  return getAllRecords().find(r => r.date === date) || null;
}

// ============ Prediction ============
function addDays(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function predict(estPicks, targetDate) {
  // 固定取「targetDate 往前 30 個自然日」的範圍：[targetDate-30, targetDate-1]
  const windowStart = addDays(targetDate, -30);
  const last30 = getAllRecords().filter(r =>
    r.date >= windowStart && r.date < targetDate && r.totalPicks && r.totalBoxes
  );
  if (last30.length === 0) return { estBoxes: null, estEnd: null, avgPcsPerBox: null, ratioBasis: 0, endBasis: 0, windowStart, windowEnd: addDays(targetDate, -1) };

  const avgPcsPerBox = last30.reduce((s, r) => s + r.totalPicks / r.totalBoxes, 0) / last30.length;
  const estBoxes = Math.round(estPicks / avgPcsPerBox);

  const startRef = parseHHMM(window.SEED.standards.A_start || '12:00'); // 標準理貨開始 12:00

  // 線性迴歸：以 30 日全樣本擬合「揀次 → 理貨分鐘」的直線，估今日結束時間
  // 過濾異常值：理貨時數 >= 20 小時者（1200 分鐘）多為資料異常（例如站點時間填成隔日上午），會嚴重拉偏迴歸
  const regressPool = last30
    .filter(r => r.totalEnd && r.totalPicks)
    .map(r => {
      let m = parseHHMM(r.totalEnd);
      if (m != null && m < startRef) m += 24 * 60;
      return { x: r.totalPicks, y: m - startRef };
    })
    .filter(p => p.y < 1200);

  const reg = linearRegress(regressPool);
  let estEnd = null;
  let endBasis = 0;
  let regressInfo = null;

  if (reg) {
    const estTallyMins = reg.a + reg.b * estPicks;
    const estMins = startRef + estTallyMins;
    estEnd = formatMins(estMins);
    endBasis = reg.n;
    regressInfo = reg;
  }

  return {
    estBoxes, estEnd, avgPcsPerBox,
    ratioBasis: last30.length, endBasis,
    windowStart, windowEnd: addDays(targetDate, -1),
    regressInfo,
  };
}

function linearRegress(pairs) {
  if (!pairs || pairs.length < 2) return null;
  const n = pairs.length;
  const meanX = pairs.reduce((s, p) => s + p.x, 0) / n;
  const meanY = pairs.reduce((s, p) => s + p.y, 0) / n;
  let num = 0, den = 0;
  for (const p of pairs) {
    num += (p.x - meanX) * (p.y - meanY);
    den += (p.x - meanX) ** 2;
  }
  if (den === 0) return { a: meanY, b: 0, n, r2: 0 };
  const b = num / den;
  const a = meanY - b * meanX;
  // r² coefficient of determination
  let ssRes = 0, ssTot = 0;
  for (const p of pairs) {
    const yHat = a + b * p.x;
    ssRes += (p.y - yHat) ** 2;
    ssTot += (p.y - meanY) ** 2;
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot;
  return { a, b, n, r2 };
}

// ============ Delay check ============
function getStandardTotalEnd() {
  // 最晚一站作為總結束時間標準 (大溪3 = 23:30)
  const stations = window.SEED.standards.stations;
  let maxMin = 0;
  for (const s of Object.keys(stations)) {
    const m = parseHHMM(stations[s].A);
    if (m != null && m > maxMin) maxMin = m;
  }
  return maxMin;
}

function checkDelayed(totalEnd) {
  if (!totalEnd) return { status: 'nodata', diff: null };
  const stdMin = getStandardTotalEnd();
  let actualMin = parseHHMM(totalEnd);
  if (actualMin == null) return { status: 'nodata', diff: null };
  // Handle next-day wrap (e.g., 00:30 after 23:30)
  if (actualMin < 12 * 60) actualMin += 24 * 60;
  const diff = actualMin - stdMin;
  return { status: diff > 0 ? 'delayed' : 'ontime', diff };
}

// ============ Rendering ============
let picksChart, boxesChart, ratioChart;

function renderCharts(records, viewDate) {
  const upToView = viewDate ? records.filter(r => r.date <= viewDate) : records;
  const last7 = upToView.slice(-7);
  const labels = last7.map(r => r.date.slice(5));
  const picks = last7.map(r => r.totalPicks || null);
  const boxes = last7.map(r => r.totalBoxes || null);
  const ratio = last7.map(r => (r.totalPicks && r.totalBoxes) ? r.totalPicks / r.totalBoxes : null);

  const common = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { display: false },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      x: { grid: { display: false }, ticks: { font: { size: 11 } } },
      y: { beginAtZero: true, ticks: { font: { size: 11 } } },
    },
  };

  const mkLine = (canvas, label, data, color) => new Chart(canvas, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label, data,
        borderColor: color,
        backgroundColor: color + '22',
        tension: 0.3,
        borderWidth: 2,
        pointRadius: 4,
        pointHoverRadius: 6,
        fill: true,
      }],
    },
    options: { ...common, plugins: { ...common.plugins, title: { display: true, text: label, font: { size: 13, weight: '600' } } } },
  });

  if (picksChart) picksChart.destroy();
  if (boxesChart) boxesChart.destroy();
  if (ratioChart) ratioChart.destroy();

  picksChart = mkLine(document.getElementById('picksChart'), '總揀次', picks, '#2563eb');
  boxesChart = mkLine(document.getElementById('boxesChart'), '總箱數', boxes, '#0891b2');
  ratioChart = mkLine(document.getElementById('ratioChart'), 'pcs/箱', ratio, '#16a34a');
}

function renderKPIs(records, viewDate) {
  const cur = records.find(r => r.date === viewDate);
  const hasData = cur?.totalPicks != null;
  const statusCard = document.getElementById('statusCard');

  if (!hasData) {
    ['kpiPicks','kpiBoxes','kpiRatio'].forEach(id => {
      document.getElementById(id).textContent = '無資料';
    });
    ['kpiPicksTrend','kpiBoxesTrend','kpiRatioTrend'].forEach(id => {
      const el = document.getElementById(id);
      el.className = 'kpi-trend';
      el.textContent = '此日期尚無資料';
    });
    statusCard.className = 'card kpi-card status-card nodata';
    document.getElementById('statusText').textContent = '無資料';
    document.getElementById('statusDetail').textContent = '此日期尚無結束時間';
    statusCard.onclick = null;
    return;
  }

  const prev = (() => {
    const pool = records.filter(r => r.date < viewDate && r.totalPicks != null);
    return pool.length ? pool[pool.length - 1] : null;
  })();

  const picks = cur.totalPicks;
  const boxes = cur.totalBoxes;
  const ratio = (picks && boxes) ? picks / boxes : null;

  document.getElementById('kpiPicks').textContent = fmtNum(picks);
  document.getElementById('kpiBoxes').textContent = fmtNum(boxes);
  document.getElementById('kpiRatio').textContent = ratio != null ? fmtNum(ratio, 1) : '—';

  const trend = (cur, prev, key) => {
    if (!cur?.[key] || !prev?.[key]) return '';
    const delta = cur[key] - prev[key];
    const pct = (delta / prev[key]) * 100;
    const arrow = delta > 0 ? '▲' : delta < 0 ? '▼' : '—';
    const cls = delta > 0 ? 'up' : delta < 0 ? 'down' : '';
    return { text: `${arrow} ${fmtNum(Math.abs(delta))} (${pct.toFixed(1)}%)`, cls };
  };

  const setTrend = (el, t) => {
    el.className = 'kpi-trend';
    if (!t) { el.textContent = '—'; return; }
    el.textContent = t.text;
    if (t.cls) el.classList.add(t.cls);
  };

  setTrend(document.getElementById('kpiPicksTrend'), trend(cur, prev, 'totalPicks'));
  setTrend(document.getElementById('kpiBoxesTrend'), trend(cur, prev, 'totalBoxes'));
  const curRatio = (cur?.totalPicks && cur?.totalBoxes) ? cur.totalPicks / cur.totalBoxes : null;
  const prevRatio = (prev?.totalPicks && prev?.totalBoxes) ? prev.totalPicks / prev.totalBoxes : null;
  if (curRatio != null && prevRatio != null) {
    const delta = curRatio - prevRatio;
    const el = document.getElementById('kpiRatioTrend');
    el.className = 'kpi-trend ' + (delta > 0 ? 'up' : delta < 0 ? 'down' : '');
    el.textContent = `${delta > 0 ? '▲' : delta < 0 ? '▼' : '—'} ${fmtNum(Math.abs(delta), 2)}`;
  } else {
    document.getElementById('kpiRatioTrend').textContent = '—';
  }

  const statusText = document.getElementById('statusText');
  const statusDetail = document.getElementById('statusDetail');
  statusCard.className = 'card kpi-card status-card';

  const chk = checkDelayed(cur?.totalEnd);
  if (chk.status === 'nodata') {
    statusCard.classList.add('nodata');
    statusText.textContent = '無資料';
    statusDetail.textContent = '尚未回填實際結束時間';
  } else if (chk.status === 'ontime') {
    statusCard.classList.add('ontime', 'clickable');
    statusText.textContent = '準時完成';
    statusDetail.textContent = `實際 ${cur.totalEnd} · 標準 ${formatMins(getStandardTotalEnd())}（點擊查看節點明細）`;
    statusCard.onclick = () => openStationModal(cur);
  } else {
    statusCard.classList.add('delayed');
    statusText.textContent = `延遲 ${chk.diff} 分`;
    statusDetail.textContent = `實際 ${cur.totalEnd} · 標準 ${formatMins(getStandardTotalEnd())}（點擊查看節點明細）`;
    statusCard.onclick = () => openStationModal(cur);
  }
}

function renderHistory(records) {
  const tbody = document.getElementById('historyBody');
  const last30 = records.slice(-30).slice().reverse();
  tbody.innerHTML = last30.map(r => {
    const chk = checkDelayed(r.totalEnd);
    const ratio = (r.totalPicks && r.totalBoxes) ? (r.totalPicks / r.totalBoxes).toFixed(1) : '—';
    const variance = (r.estPicks && r.totalPicks) ? r.totalPicks - r.estPicks : null;
    const varClass = (variance != null && Math.abs(variance) >= VARIANCE_THRESHOLD) ? 'high' : '';
    const varText = variance != null ? `${variance > 0 ? '+' : ''}${fmtNum(variance)}` : '—';
    let statusPill;
    if (chk.status === 'ontime') statusPill = `<span class="status-pill ontime">準時</span>`;
    else if (chk.status === 'delayed') statusPill = `<span class="status-pill delayed" data-date="${r.date}">延遲 ${chk.diff}分</span>`;
    else statusPill = `<span class="status-pill nodata">—</span>`;
    return `<tr>
      <td>${r.date}</td>
      <td>週${WEEKDAY_TW[r.weekday]}</td>
      <td>${fmtNum(r.estPicks)}</td>
      <td>${fmtNum(r.totalPicks)}</td>
      <td class="variance-cell ${varClass}">${varText}</td>
      <td>${fmtNum(r.totalBoxes)}</td>
      <td>${ratio}</td>
      <td>${r.totalEnd || '—'}</td>
      <td>${statusPill}</td>
      <td class="note-cell" title="${(r.varianceNote || '').replace(/"/g,'&quot;')}">${r.varianceNote || ''}</td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('.status-pill.delayed').forEach(el => {
    el.addEventListener('click', () => {
      const date = el.dataset.date;
      openStationModal(getRecord(date));
    });
  });
}

function openStationModal(rec) {
  if (!rec) return;
  const stations = window.SEED.stations;
  const std = window.SEED.standards.stations;
  document.getElementById('modalTitle').textContent = `${fmtDateLabel(rec.date)} — 各節點結束時間 vs 標準`;

  const mkCell = (actual, stdTime) => {
    if (!actual) return `<td class="muted">—</td><td class="muted">—</td>`;
    const a = parseHHMM(actual);
    const s = parseHHMM(stdTime);
    let aAdj = a, sAdj = s;
    if (aAdj != null && aAdj < 12 * 60) aAdj += 24 * 60;
    if (sAdj != null && sAdj < 12 * 60) sAdj += 24 * 60;
    const diff = aAdj - sAdj;
    const cls = diff > 0 ? 'delayed-time' : 'ontime-time';
    const label = diff > 0 ? `+${diff}分` : `${diff}分`;
    return `<td class="${cls}">${actual}</td><td class="${cls}">${label}</td>`;
  };

  const tbody = document.getElementById('stationTableBody');
  tbody.innerHTML = stations.map(s => {
    const stdA = std[s]?.A;
    const stdB = std[s]?.B;
    const aVal = rec.aStations?.[s];
    const bVal = rec.bStations?.[s];
    return `<tr>
      <td><strong>${s}</strong></td>
      <td>${stdA || '—'}</td>
      ${mkCell(aVal, stdA)}
      ${mkCell(bVal, stdB)}
    </tr>`;
  }).join('');

  document.getElementById('modal').classList.remove('hidden');
}

function closeModal() {
  document.getElementById('modal').classList.add('hidden');
}

// ============ Forecast form ============
// 預估固定以「今天（系統日期）」為目標日，資料基準＝今天往前 30 個自然日
function getForecastTargetDate() {
  return window.SEED.today;
}

function renderForecast() {
  const date = getForecastTargetDate();
  const rec = getRecord(date) || {};
  const pred = predict(0, date);
  if (pred.avgPcsPerBox) {
    const reg = pred.regressInfo;
    const regText = reg
      ? `，迴歸樣本 ${reg.n} 筆（R²=${reg.r2.toFixed(2)}）`
      : '';
    document.getElementById('forecastMeta').textContent =
      `基準：${pred.windowStart} ~ ${pred.windowEnd}（有效樣本 ${pred.ratioBasis} 日），平均 pcs/箱 = ${pred.avgPcsPerBox.toFixed(1)}${regText}`;
  } else {
    document.getElementById('forecastMeta').textContent = '資料不足';
  }

  if (rec.estPicks) {
    document.getElementById('estPicks').value = rec.estPicks;
    // 直接顯示已存的預測結果（未登入也看得到），不觸發新的寫入
    if (rec.estBoxes != null && rec.estEnd) {
      document.getElementById('resBoxes').textContent = fmtNum(rec.estBoxes);
      document.getElementById('resEnd').textContent = rec.estEnd;
      const chk = checkDelayed(rec.estEnd.replace(' (+1)', ''));
      let statusLabel = '—';
      if (chk.status === 'ontime') statusLabel = '預計準時';
      else if (chk.status === 'delayed') statusLabel = `預計延遲 ${chk.diff} 分`;
      document.getElementById('resStatus').textContent = statusLabel;
      document.getElementById('forecastResult').classList.remove('hidden');
    }
  } else {
    document.getElementById('estPicks').value = '';
    document.getElementById('forecastResult').classList.add('hidden');
  }
}

async function runForecast() {
  if (!isLoggedIn()) { openLoginModal(); return; }
  const date = getForecastTargetDate();
  const estPicks = parseInt(document.getElementById('estPicks').value, 10);
  if (!estPicks || !date) return;
  const pred = predict(estPicks, date);
  await upsertUserEntry(date, { estPicks, estBoxes: pred.estBoxes, estEnd: pred.estEnd });

  document.getElementById('resBoxes').textContent = fmtNum(pred.estBoxes);
  document.getElementById('resEnd').textContent = pred.estEnd || '—';
  const chk = checkDelayed(pred.estEnd ? pred.estEnd.replace(' (+1)', '') : null);
  let statusLabel = '—';
  if (chk.status === 'ontime') statusLabel = '預計準時';
  else if (chk.status === 'delayed') statusLabel = `預計延遲 ${chk.diff} 分`;
  document.getElementById('resStatus').textContent = statusLabel;
  document.getElementById('forecastResult').classList.remove('hidden');

  // 提交預估後，實際回填日期自動對齊到預估的那一天
  document.getElementById('actualDate').value = date;
  renderActualForm();
  renderAll();
}

// ============ Actual form ============
function renderActualForm() {
  const date = document.getElementById('actualDate').value;
  if (!date) return;
  const rec = getRecord(date) || {};
  document.getElementById('actPicks').value = rec.totalPicks ?? '';
  document.getElementById('actBoxes').value = rec.totalBoxes ?? '';
  document.getElementById('actTotalEnd').value = rec.totalEnd ?? '';
  renderStationInputs(rec);
  renderVarianceWarning(rec);
  document.getElementById('varianceNote').value = rec.varianceNote ?? '';
}

function renderStationInputs(rec) {
  const stations = window.SEED.stations;
  const std = window.SEED.standards.stations;
  const root = document.getElementById('stationInputs');
  root.innerHTML = `<div class="station-header"><span>節點</span><span>A班 (標準/實際)</span><span>B班 (標準/實際)</span></div>` +
    stations.map(s => `
      <div class="station-row">
        <span><strong>${s}</strong></span>
        <span>
          <small class="muted">${std[s]?.A || ''}</small>
          <input type="time" data-station="${s}" data-class="A" value="${rec.aStations?.[s] || ''}">
        </span>
        <span>
          <small class="muted">${std[s]?.B || ''}</small>
          <input type="time" data-station="${s}" data-class="B" value="${rec.bStations?.[s] || ''}">
        </span>
      </div>
    `).join('');
}

function collectStationInputs() {
  const a = {}, b = {};
  document.querySelectorAll('#stationInputs input[type="time"]').forEach(inp => {
    const s = inp.dataset.station;
    const c = inp.dataset.class;
    const v = inp.value || null;
    if (c === 'A') a[s] = v;
    else b[s] = v;
  });
  return { a, b };
}

function renderVarianceWarning(rec) {
  const warn = document.getElementById('varianceWarn');
  const actPicks = parseInt(document.getElementById('actPicks').value, 10);
  if (!rec.estPicks || !actPicks) {
    warn.classList.add('hidden');
    return;
  }
  const diff = actPicks - rec.estPicks;
  if (Math.abs(diff) >= VARIANCE_THRESHOLD) {
    warn.classList.remove('hidden');
    document.getElementById('varianceTitle').textContent = `⚠ 揀次差異 ${diff > 0 ? '+' : ''}${fmtNum(diff)}（預估 ${fmtNum(rec.estPicks)} → 實際 ${fmtNum(actPicks)}）`;
    document.getElementById('varianceDetail').textContent = `超過門檻 ${fmtNum(VARIANCE_THRESHOLD)} 揀次，請填寫差異原因。`;
  } else {
    warn.classList.add('hidden');
  }
}

async function saveActualForm(e) {
  e.preventDefault();
  if (!isLoggedIn()) { openLoginModal(); return; }
  const date = document.getElementById('actualDate').value;
  if (!date) return;
  const actPicks = parseInt(document.getElementById('actPicks').value, 10) || null;
  const actBoxes = parseInt(document.getElementById('actBoxes').value, 10) || null;
  const totalEnd = document.getElementById('actTotalEnd').value || null;
  const { a, b } = collectStationInputs();
  const varianceNote = document.getElementById('varianceNote').value || '';

  const patch = {
    totalPicks: actPicks,
    totalBoxes: actBoxes,
    totalEnd,
    aStations: a,
    bStations: b,
    varianceNote,
  };
  // Auto-derive total end if not provided (跨午夜校正：<12:00 視為隔日)
  if (!totalEnd) {
    const allTimes = [...Object.values(a), ...Object.values(b)].filter(Boolean);
    if (allTimes.length) {
      const toMin = t => {
        let m = parseHHMM(t);
        return m < 12 * 60 ? m + 24 * 60 : m;
      };
      patch.totalEnd = allTimes.reduce((best, t) => toMin(t) > toMin(best) ? t : best);
    }
  }
  await upsertUserEntry(date, patch);
  renderAll();
  alert('已儲存 ' + date + ' 的資料');
}

// ============ Bootstrap ============
function renderAll() {
  const records = getAllRecords();
  const viewDate = document.getElementById('viewDate').value;
  renderCharts(records, viewDate);
  renderKPIs(records, viewDate);
  renderHistory(records);
}

async function init() {
  const seed = window.SEED;
  document.getElementById('stdPicks').textContent = fmtNum(seed.standards.picks);
  document.getElementById('stdBoxes').textContent = fmtNum(seed.standards.boxes);
  document.getElementById('stdEnd').textContent = formatMins(getStandardTotalEnd());

  // 先載入雲端資料 & 還原登入狀態（雲端模式首次打開約 < 1s）
  await initUserData();
  await refreshAuth();

  // 檢視日期預設＝最新一筆有資料的日期；實際回填日期錨定於今日
  const records = getAllRecords();
  const withData = records.filter(r => r.totalPicks != null);
  const latestDataDate = withData.length ? withData[withData.length - 1].date : seed.today;
  const viewDateEl = document.getElementById('viewDate');
  viewDateEl.value = latestDataDate;
  document.getElementById('todayLabel').textContent = `系統日期 ${fmtDateLabel(seed.today)}`;
  document.getElementById('actualDate').value = seed.today;

  viewDateEl.addEventListener('change', () => {
    closeModal();
    renderAll();
  });

  document.getElementById('forecastForm').addEventListener('submit', (e) => {
    e.preventDefault();
    runForecast();
  });

  document.getElementById('actualForm').addEventListener('submit', saveActualForm);
  document.getElementById('actualDate').addEventListener('change', renderActualForm);
  document.getElementById('actPicks').addEventListener('input', () => {
    const rec = getRecord(document.getElementById('actualDate').value) || {};
    renderVarianceWarning(rec);
  });

  document.getElementById('modalClose').addEventListener('click', closeModal);
  document.getElementById('modal').addEventListener('click', (e) => {
    if (e.target.id === 'modal') closeModal();
  });

  // Auth 綁定
  document.getElementById('loginBtn').addEventListener('click', openLoginModal);
  document.getElementById('logoutBtn').addEventListener('click', handleLogout);
  document.getElementById('loginClose').addEventListener('click', closeLoginModal);
  document.getElementById('loginModal').addEventListener('click', (e) => {
    if (e.target.id === 'loginModal') closeLoginModal();
  });
  document.getElementById('loginForm').addEventListener('submit', handleLoginSubmit);

  renderAll();
  renderForecast();
  renderActualForm();
}

document.addEventListener('DOMContentLoaded', init);
