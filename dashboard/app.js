(function () {
  var RADAR = window.RADAR;
  var M = window.TokenRadarModel;
  if (!RADAR || !M) return;
  var rows = RADAR.rows;
  var model = RADAR.model;
  var asOf = model.as_of;
  var curve = model.curve;
  var oddsModel = {
    weights: model.odds.weights, bias: model.odds.bias,
    means: model.odds.means, sds: model.odds.sds,
    baseRate: model.odds.baseRate, medianAge: model.odds.medianAge
  };
  var sd = model.residualSd;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(v) {
    if (v == null || !isFinite(v)) return '—';
    var sign = v < 0 ? '-' : '';
    var a = Math.abs(v);
    if (a >= 1e9) return sign + '$' + (a / 1e9).toFixed(2) + 'B';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e3) return sign + '$' + (a / 1e3).toFixed(2) + 'K';
    return sign + '$' + a.toFixed(2);
  }
  function money2(v) {
    if (v == null || !isFinite(v)) return '—';
    var sign = v < 0 ? '-$' : '$';
    return sign + Math.abs(v).toFixed(2);
  }
  function moneyFull(v) {
    if (v == null || !isFinite(v)) return '—';
    return '$' + Math.round(v).toLocaleString('en-US');
  }
  function pct(v, digits) {
    if (v == null || !isFinite(v)) return '—';
    return (v >= 0 ? '+' : '') + v.toFixed(digits == null ? 1 : digits) + '%';
  }
  function pseudo(row) {
    var listed = null;
    if (row.age_days !== null && row.age_days !== undefined) {
      listed = new Date(new Date(asOf).getTime() - row.age_days * 86400000).toISOString().slice(0, 10);
    }
    return {
      slug: row.slug, name: row.name, category: row.category, chains: row.chains,
      tvl_usd: row.tvl_usd, change_7d: row.change_7d, mcap_usd: null,
      listed_at: listed, gecko_id: null, symbol: null
    };
  }
  function recompute(row) {
    return M.impliedDetail(pseudo(row), curve, oddsModel, sd, asOf);
  }
  function agrees(row, d) {
    return d.implied === row.implied_value_usd &&
      Math.abs(d.odds - row.odds) < 1e-9 &&
      d.rangeLo === row.range_lo && d.rangeHi === row.range_hi &&
      Math.round(d.valueIfLaunches) === row.value_if_launches;
  }

  // ---- snapshot line + stats ----
  document.getElementById('asof-line').textContent =
    'Snapshot ' + asOf + ' · ' + RADAR.counts.total + ' protocols · floor $50M TVL · ' +
    RADAR.counts.board + ' ranked · ' + RADAR.counts.live + ' live tokens shown.';
  var stats = [
    ['Protocols', RADAR.counts.total],
    ['Watchlist', RADAR.counts.watchlist],
    ['Board rows', RADAR.counts.board],
    ['Early (not watchlist)', RADAR.counts.early],
    ['Live tokens', RADAR.counts.live],
    ['Excluded', RADAR.counts.excluded]
  ];
  document.getElementById('stats').innerHTML = stats.map(function (s) {
    return '<div><span>' + s[0] + ': </span><b>' + s[1] + '</b></div>';
  }).join('');

  // ---- KPI strip ----
  var top = rows[0];
  var bestFarm = rows.slice().sort(function (a, b) { return b.net_usd - a.net_usd; })[0];
  var wf = model.backtest.value.walkForward[0];
  var kpis = [
    ['Board rows', rows.length, 'FARM ' + model.verdictCounts.FARM + ' · MARGINAL ' + model.verdictCounts.MARGINAL],
    ['Top implied', money(top.implied_value_usd), top.slug],
    ['Best farm net', money2(bestFarm.net_usd), bestFarm.slug + ' · ' + money2(bestFarm.net_per_hour) + '/h'],
    ['WF 2024 miss', wf.miss.toFixed(2) + 'x', 'flat ' + wf.missFlat.toFixed(2) + 'x · holds ' + wf.holdsPct.toFixed(1) + '%'],
    ['Odds Brier', model.odds.cvBrier.toFixed(4), 'base ' + model.odds.baseBrier.toFixed(4) + ' · holdout ' + model.odds.holdoutBrier.toFixed(4)]
  ];
  document.getElementById('kpis').innerHTML = kpis.map(function (k) {
    return '<div class="kpi"><div class="k-label">' + k[0] + '</div><div class="k-value">' + esc(k[1]) + '</div><div class="k-sub">' + esc(k[2]) + '</div></div>';
  }).join('');

  // ---- self-check badges (all computed live) ----
  var agreeCount = 0;
  for (var i = 0; i < rows.length; i++) if (agrees(rows[i], recompute(rows[i]))) agreeCount++;
  var rankOk = rows.every(function (r, idx) { return r.rank === idx + 1; });
  var monoOk = rows.every(function (r, idx) { return idx === 0 || r.implied_value_usd <= rows[idx - 1].implied_value_usd; });
  var ledger = model.ledger;
  var setAside = ledger.setAside.reduce(function (s, e) { return s + e.count; }, 0);
  var ledgerOk = ledger.ranked + ledger.tokenTrades + setAside === RADAR.counts.total;
  var watchOk = rows.filter(function (r) { return r.watchlist; }).length === 40 &&
    RADAR.counts.watchlist === 40;
  var pageFits = document.documentElement.scrollWidth <= window.innerWidth;
  var badges = [
    ['rank order 1–' + rows.length, rankOk],
    ['monotonic order', monoOk],
    ['ledger ' + ledger.ranked + '+' + ledger.tokenTrades + '+' + setAside + '=' + RADAR.counts.total, ledgerOk],
    ['watchlist 40/40', watchOk],
    ['recompute ' + agreeCount + '/' + rows.length + ' agree', agreeCount === rows.length],
    ['checksum ' + model.checksum, /^[0-9a-f]{8}$/.test(model.checksum)],
    ['page fits', pageFits]
  ];
  document.getElementById('badges').innerHTML = badges.map(function (b) {
    return '<span class="badge' + (b[1] ? '' : ' fail') + '">' + (b[1] ? '✓ ' : '✗ ') + esc(b[0]) + '</span>';
  }).join('');

  // ---- filters ----
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
    r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
  });
  cats.sort(); chains.sort();
  var catSel = document.getElementById('f-cat');
  var chainSel = document.getElementById('f-chain');
  cats.forEach(function (c) { catSel.insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });
  chains.forEach(function (c) { chainSel.insertAdjacentHTML('beforeend', '<option>' + esc(c) + '</option>'); });

  function filteredRows() {
    var q = document.getElementById('q').value.trim().toLowerCase();
    var cat = catSel.value, chain = chainSel.value;
    var watchOnly = document.getElementById('f-watch').checked;
    var verdict = document.getElementById('f-verdict').value;
    var sort = document.getElementById('f-sort').value;
    var list = rows.filter(function (r) {
      if (q && r.slug.toLowerCase().indexOf(q) === -1 && r.name.toLowerCase().indexOf(q) === -1) return false;
      if (cat && r.category !== cat) return false;
      if (chain && r.chains.indexOf(chain) === -1) return false;
      if (watchOnly && !r.watchlist) return false;
      if (verdict && r.verdict !== verdict) return false;
      return true;
    });
    if (sort === 'net') list.sort(function (a, b) { return b.net_usd - a.net_usd; });
    else if (sort === 'odds') list.sort(function (a, b) { return b.odds - a.odds; });
    else if (sort === 'tvl') list.sort(function (a, b) { return b.tvl_usd - a.tvl_usd; });
    else if (sort === 'name') list.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
    else list.sort(function (a, b) { return a.rank - b.rank; });
    return list;
  }

  function rowHtml(r) {
    return '<tr data-slug="' + esc(r.slug) + '"><td>' + r.rank + '</td>' +
      '<td class="slug">' + esc(r.slug) + ' <span class="pname">(' + esc(r.name) + ')</span></td>' +
      '<td>' + esc(r.category) + '</td>' +
      '<td>' + esc(r.chains.join(', ')) + '</td>' +
      '<td class="num">' + money(r.tvl_usd) + '</td>' +
      '<td class="num">' + money(r.implied_value_usd) + '</td>' +
      '<td class="num">' + r.odds.toFixed(3) + '</td>' +
      '<td class="num">' + money(r.value_if_launches) + '</td>' +
      '<td class="num">' + money(r.range_lo) + ' – ' + money(r.range_hi) + '</td>' +
      '<td><span class="verdict ' + r.verdict + '">' + r.verdict + '</span></td>' +
      '<td class="num">' + money2(r.net_usd) + '</td>' +
      '<td class="num">' + money2(r.net_per_hour) + '</td>' +
      '<td class="num">' + money2(r.gas_usd) + '</td></tr>';
  }

  function renderBoard() {
    var list = filteredRows();
    document.getElementById('board-body').innerHTML = list.map(rowHtml).join('');
    document.getElementById('row-count').textContent = 'Showing ' + list.length + ' of ' + rows.length + ' rows';
  }
  document.getElementById('q').addEventListener('input', renderBoard);
  ['f-cat', 'f-chain', 'f-watch', 'f-verdict', 'f-sort'].forEach(function (id) {
    document.getElementById(id).addEventListener('change', renderBoard);
  });
  renderBoard();
  document.getElementById('board-body').addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) openDialog(tr.getAttribute('data-slug'));
  });

  // ---- tabs ----
  var tabBoard = document.getElementById('tab-board');
  var tabLive = document.getElementById('tab-live');
  function showTab(which) {
    var board = which === 'board';
    tabBoard.classList.toggle('active', board);
    tabLive.classList.toggle('active', !board);
    document.getElementById('board-section').hidden = !board;
    document.getElementById('live-section').hidden = board;
  }
  tabBoard.addEventListener('click', function () { showTab('board'); });
  tabLive.addEventListener('click', function () { showTab('live'); });

  // ---- live table ----
  document.getElementById('live-body').innerHTML = RADAR.live.map(function (p, idx) {
    return '<tr><td>' + (idx + 1) + '</td>' +
      '<td class="slug">' + esc(p.slug) + ' <span class="pname">(' + esc(p.name) + ')</span></td>' +
      '<td>' + esc(p.category) + '</td>' +
      '<td>' + esc(p.chains.join(', ')) + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + pct(p.change_7d) + '</td>' +
      '<td>' + esc(p.listed_at || '—') + '</td></tr>';
  }).join('');

  // ---- ledger ----
  var ledgerRows = ledger.setAside.map(function (e) {
    return '<tr><td>' + esc(e.reason) + '</td><td class="num">' + e.count + '</td></tr>';
  }).join('');
  document.getElementById('ledger').innerHTML =
    '<table><thead><tr><th>Bucket</th><th>Count</th></tr></thead><tbody>' +
    '<tr><td>Ranked on the board</td><td class="num">' + ledger.ranked + '</td></tr>' +
    '<tr><td>Already trading a token</td><td class="num">' + ledger.tokenTrades + '</td></tr>' +
    ledgerRows +
    '<tr><td><strong>Total</strong></td><td class="num"><strong>' + RADAR.counts.total + '</strong></td></tr>' +
    '</tbody></table>';

  // ---- farm next ----
  var farmTop = rows.slice().sort(function (a, b) { return b.net_usd - a.net_usd; }).slice(0, 5);
  document.getElementById('farm-next').innerHTML =
    '<div class="farm-cards">' + farmTop.map(function (r) {
      return '<div class="farm-card" data-slug="' + esc(r.slug) + '">' +
        '<div class="f-slug">' + esc(r.slug) + '</div>' +
        '<div class="f-net">' + money2(r.net_usd) + '</div>' +
        '<div class="f-sub">' + money2(r.net_per_hour) + '/h · gas ' + money2(r.gas_usd) + ' · odds ' + r.odds.toFixed(3) + '</div></div>';
    }).join('') + '</div>';
  document.getElementById('farm-next').addEventListener('click', function (e) {
    var card = e.target.closest('.farm-card');
    if (card) openDialog(card.getAttribute('data-slug'));
  });

  // ---- scatter (log-log, 128 live tokens) ----
  (function scatter() {
    var pts = RADAR.liveAll;
    var xs = pts.map(function (p) { return Math.log10(p.tvl_usd); });
    var ys = pts.map(function (p) { return Math.log10(p.mcap_usd); });
    var x0 = Math.floor(Math.min.apply(null, xs)), x1 = Math.ceil(Math.max.apply(null, xs));
    var y0 = Math.floor(Math.min.apply(null, ys)), y1 = Math.ceil(Math.max.apply(null, ys));
    var W = 1000, H = 420, L = 60, R = 20, T = 16, B = 44;
    function X(v) { return L + (v - x0) / (x1 - x0) * (W - L - R); }
    function Y(v) { return T + (1 - (v - y0) / (y1 - y0)) * (H - T - B); }
    var out = '<svg viewBox="0 0 ' + W + ' ' + H + '">';
    for (var gx = x0; gx <= x1; gx++) {
      out += '<line x1="' + X(gx) + '" y1="' + Y(y0) + '" x2="' + X(gx) + '" y2="' + Y(y1) + '" stroke="#2a3342" stroke-width="1"/>';
      out += '<text x="' + X(gx) + '" y="' + (H - 24) + '" fill="#9aa7b8" font-size="11" text-anchor="middle">$' + (gx >= 9 ? (gx - 9) + 'B' : gx >= 6 ? (gx - 6) + 'M' : '10^' + gx) + '</text>';
    }
    for (var gy = y0; gy <= y1; gy++) {
      out += '<line x1="' + X(x0) + '" y1="' + Y(gy) + '" x2="' + X(x1) + '" y2="' + Y(gy) + '" stroke="#2a3342" stroke-width="1"/>';
      out += '<text x="52" y="' + (Y(gy) + 4) + '" fill="#9aa7b8" font-size="11" text-anchor="end">$' + (gy >= 9 ? (gy - 9) + 'B' : gy >= 6 ? (gy - 6) + 'M' : '10^' + gy) + '</text>';
    }
    out += '<text x="' + ((W - L - R) / 2 + L) + '" y="' + (H - 6) + '" fill="#9aa7b8" font-size="12" text-anchor="middle">TVL (log)</text>';
    out += '<text x="14" y="' + ((H - T - B) / 2 + T) + '" fill="#9aa7b8" font-size="12" text-anchor="middle" transform="rotate(-90 14 ' + ((H - T - B) / 2 + T) + ')">Market cap (log)</text>';
    var band = 0.6745 * sd;
    var bandUp = '', bandDn = '', line = '';
    for (var tx = x0; tx <= x1; tx += 0.1) {
      var mult = Math.log10(M.sizeMultiple(Math.pow(10, tx), curve, 0));
      var mid = tx + mult;
      bandUp += (bandUp ? ' L' : 'M') + X(tx).toFixed(1) + ' ' + Y(mid + band).toFixed(1);
      bandDn += (bandDn ? ' L' : 'M') + X(tx).toFixed(1) + ' ' + Y(mid - band).toFixed(1);
      line += (line ? ' L' : 'M') + X(tx).toFixed(1) + ' ' + Y(mid).toFixed(1);
    }
    out += '<path d="' + bandUp + '" fill="none" stroke="#d29922" stroke-width="1" stroke-dasharray="4 4"/>';
    out += '<path d="' + bandDn + '" fill="none" stroke="#d29922" stroke-width="1" stroke-dasharray="4 4"/>';
    out += '<path d="' + line + '" fill="none" stroke="#58a6ff" stroke-width="1.5"/>';
    pts.forEach(function (p) {
      out += '<circle cx="' + X(Math.log10(p.tvl_usd)).toFixed(1) + '" cy="' + Y(Math.log10(p.mcap_usd)).toFixed(1) + '" r="3" fill="#3fb950"><title>' + esc(p.slug) + '</title></circle>';
    });
    out += '</svg>';
    document.getElementById('scatter').innerHTML = out;
  })();

  // ---- model panel ----
  (function modelPanel() {
    var vb = model.backtest.value;
    var ob = model.odds;
    var bt = model.backtest.bootstrap;
    function sizeRow(tvl, label) {
      return '<tr><td>' + label + '</td><td class="num">' + M.sizeMultiple(tvl, curve, 0).toFixed(3) + '</td><td class="num">' + M.sizeMultiple(tvl, curve, 1).toFixed(3) + '</td></tr>';
    }
    var wfRows = vb.walkForward.map(function (w) {
      return '<tr><td>' + w.cutoff + '</td><td class="num">' + w.train + '</td><td class="num">' + w.test + '</td><td class="num">' + w.miss.toFixed(2) + 'x</td><td class="num">' + w.missFlat.toFixed(2) + 'x</td><td class="num">' + w.holdsPct.toFixed(1) + '%</td></tr>';
    }).join('');
    var ab = ob.ablations;
    var abRows = [
      ['Drop age', ab.dropAge], ['Drop category flags', ab.dropCatFlags],
      ['Drop missing-listing flag', ab.dropListedNull], ['Drop log-TVL', ab.dropLogTvl],
      ['Drop chain count', ab.dropChains], ['Drop high-category flag', ab.dropHighCat],
      ['Drop low-category flag', ab.dropLowCat], ['Drop high-rate-chain flag', ab.dropHighChain]
    ].map(function (r) {
      return '<tr><td>' + r[0] + '</td><td class="num">' + r[1].toFixed(4) + '</td></tr>';
    }).join('');
    document.getElementById('model-body').innerHTML =
      '<p class="formula">' + esc(model.formula) + '</p>' +
      '<p>Residual SD (log10): <strong>' + sd.toFixed(4) + '</strong> · Checksum: <strong>' + model.checksum + '</strong> · As of: <strong>' + asOf + '</strong></p>' +
      '<h3>Size curve — log10(mcap/TVL) = a + b·log10(TVL) + c·[infra]</h3>' +
      '<p>a = ' + curve.intercept.toFixed(4) + ' · b = ' + curve.slope.toFixed(4) + ' · c = ' + curve.infraCoef.toFixed(4) + ' · n = ' + curve.n + ' · clamp [' + curve.clampMin + ', ' + curve.clampMax + '] · slope bootstrap p25 ' + bt.p25.toFixed(3) + ', p75 ' + bt.p75.toFixed(3) + ' (n=' + bt.n + ')</p>' +
      '<table><thead><tr><th>TVL</th><th>Multiple</th><th>Multiple (infra)</th></tr></thead><tbody>' +
      sizeRow(1e7, '$10M') + sizeRow(1e8, '$100M') + sizeRow(1e9, '$1B') + sizeRow(1e10, '$10B') +
      '</tbody></table>' +
      '<h3>Launch odds — 12 features, logistic, full-batch GD (lr 0.1, 3000 iters, L2 0.02)</h3>' +
      '<p>Weights: [' + oddsModel.weights.map(function (w) { return w.toFixed(3); }).join(', ') + '] · bias ' + oddsModel.bias.toFixed(3) + ' · base rate ' + oddsModel.baseRate.toFixed(3) + ' · median age ' + oddsModel.medianAge + ' days</p>' +
      '<p>Brier: CV <strong>' + ob.cvBrier.toFixed(4) + '</strong> (train-only CV 0.1978) · holdout ' + ob.holdoutBrier.toFixed(4) + ' · base ' + ob.baseBrier.toFixed(4) + '</p>' +
      '<table><thead><tr><th>Ablation (5-fold Brier)</th><th>Score</th></tr></thead><tbody>' + abRows + '</tbody></table>' +
      '<h3>Value backtest</h3>' +
      '<p>5-fold CV miss ' + vb.cvCurve.toFixed(2) + 'x (flat ' + vb.cvFlat.toFixed(2) + 'x) · leave-one-out ' + vb.looCurve.toFixed(2) + 'x (flat ' + vb.looFlat.toFixed(2) + 'x)</p>' +
      '<table><thead><tr><th>Cutoff</th><th>Train</th><th>Test</th><th>Miss</th><th>Miss (flat)</th><th>Holds</th></tr></thead><tbody>' + wfRows + '</tbody></table>';
  })();

  // ---- detail dialog ----
  var backdrop = document.getElementById('dialog-backdrop');
  var currentSlug = null;
  function openDialog(slug) {
    var row = rows.find(function (r) { return r.slug === slug; });
    if (!row) return;
    currentSlug = slug;
    var d = recompute(row);
    var ok = agrees(row, d);
    document.getElementById('dlg-title').textContent = row.slug + ' (' + row.name + ')';
    document.getElementById('dlg-body').innerHTML =
      '<dl>' +
      '<dt>Recompute</dt><dd>' + (ok ? '<span class="agree-yes">agree: yes</span>' : '<span class="agree-no">agree: no</span>') + ' — live recompute ' + agreeCount + '/' + rows.length + ' agree</dd>' +
      '<dt>Category</dt><dd>' + esc(row.category) + '</dd>' +
      '<dt>Chains</dt><dd>' + esc(row.chains.join(', ')) + '</dd>' +
      '<dt>TVL</dt><dd>' + moneyFull(row.tvl_usd) + ' · 7d ' + pct(row.change_7d) + ' · age ' + (row.age_days == null ? '—' : row.age_days + 'd') + '</dd>' +
      '<dt>Watchlist</dt><dd>' + (row.watchlist ? 'yes' : 'no') + ' · rank ' + row.rank + ' of ' + rows.length + '</dd>' +
      '<dt>Size multiple</dt><dd>' + row.size_multiple.toFixed(4) + ' · growth ' + row.growth_mult.toFixed(4) + ' · maturity ' + row.maturity_mult.toFixed(4) + '</dd>' +
      '<dt>Value if launches</dt><dd>' + moneyFull(row.value_if_launches) + '</dd>' +
      '<dt>Launch odds</dt><dd>' + row.odds.toFixed(3) + '</dd>' +
      '<dt>Implied value</dt><dd>' + moneyFull(row.implied_value_usd) + '</dd>' +
      '<dt>Range (P25–P75)</dt><dd>' + moneyFull(row.range_lo) + ' – ' + moneyFull(row.range_hi) + '</dd>' +
      '<dt>Verdict</dt><dd>' + row.verdict + ' · net ' + money2(row.net_usd) + ' · net/h ' + money2(row.net_per_hour) + ' · gas ' + money2(row.gas_usd) + '</dd>' +
      '</dl>' +
      '<h3>Farm plan — 6 steps</h3><ol>' + row.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') + '</ol>' +
      '<h3>What-if</h3>' +
      '<div class="whatif">' +
      '<div><label for="wi-deposit">Deposit ($)</label><input id="wi-deposit" type="number" value="2000" min="0" step="100"></div>' +
      '<div><label for="wi-drop">Airdrop share</label><input id="wi-drop" type="number" value="0.1" min="0" max="1" step="0.01"></div>' +
      '<div><label for="wi-horizon">Horizon (days)</label><input id="wi-horizon" type="number" value="90" min="1" step="1"></div>' +
      '<div><label for="wi-tbill">T-bill rate</label><input id="wi-tbill" type="number" value="0.045" min="0" max="1" step="0.005"></div>' +
      '</div><p class="whatif-out" id="wi-out"></p>';
    backdrop.hidden = false;
    updateWhatIf(row);
    ['wi-deposit', 'wi-drop', 'wi-horizon', 'wi-tbill'].forEach(function (id) {
      document.getElementById(id).addEventListener('input', function () { updateWhatIf(row); });
    });
  }
  function updateWhatIf(row) {
    var dep = parseFloat(document.getElementById('wi-deposit').value);
    var drop = parseFloat(document.getElementById('wi-drop').value);
    var hor = parseFloat(document.getElementById('wi-horizon').value);
    var tb = parseFloat(document.getElementById('wi-tbill').value);
    if (!isFinite(dep) || dep < 0) dep = 2000;
    if (!isFinite(drop) || drop < 0 || drop > 1) drop = 0.1;
    if (!isFinite(hor) || hor < 1) hor = 90;
    if (!isFinite(tb) || tb < 0 || tb > 1) tb = 0.045;
    var w = M.whatIfFarm(pseudo(row), row.implied_value_usd, { depositUsd: dep, dropShare: drop, horizonDays: hor, tbillRate: tb });
    document.getElementById('wi-out').textContent =
      w.verdict + ' · net ' + money2(w.netUsd) + ' · net/h ' + money2(w.netPerHour) + ' · gas ' + money2(w.gasUsd) + ' · reward ' + money2(w.rewardUsd);
  }
  function closeDialog() {
    backdrop.hidden = true;
    currentSlug = null;
  }
  document.getElementById('dlg-close').addEventListener('click', closeDialog);
  backdrop.addEventListener('click', function (e) { if (e.target === backdrop) closeDialog(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !backdrop.hidden) closeDialog(); });
})();
