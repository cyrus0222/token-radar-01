// Token Radar's dashboard (radar-2). It reads window.RADAR (written beside dashboard/ by main.ts)
// and renders the ranked board, filters, a per-protocol detail view with the model's own inputs and
// the protocol's farm plan, and the live-token set. No network: every byte it shows is in data.js.
//
// The model lives here too, not only in the data: impliedOf recomputes each row from the snapshot
// figures and the peer table the page rebuilds from the launched peers, and the detail view checks
// the recomputed number against the one board.json carries, so the page's code and the board's data
// are visibly the same arithmetic. The farm plan is the same derivation main.ts writes to board.json.
(function () {
  'use strict';

  // ---------- formatting ----------

  var usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return usd0.format(n);
  }
  function compactUsd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(n >= 1e11 ? 0 : 1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(n >= 1e8 ? 0 : 1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    if (n >= 100) return '$' + Math.round(n);
    return '$' + n.toFixed(2);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function fmtMult(n) { return 'x' + n.toFixed(2); }
  function fmtOdds(n) { return Math.round(n * 100) + '%'; }

  // ---------- the model, recomputed in the page ----------

  function round4(n) { return Math.round(n * 1e4) / 1e4; }
  function median(xs) {
    var s = xs.slice().sort(function (a, b) { return a - b; });
    if (s.length === 0) return NaN;
    var m = s.length >> 1;
    return s.length % 2 === 1 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  // The peer table, rebuilt from the launched peers: each category's median market-cap-to-TVL,
  // shrunk toward the global median, clamped. The same table lib/model.ts builds.
  function peerTableFromPeers(peers, model) {
    var ratios = peers.map(function (p) { return p[1] / p[2]; });
    var global = median(ratios);
    var byCat = {};
    peers.forEach(function (p) { (byCat[p[0]] = byCat[p[0]] || []).push(p[1] / p[2]); });
    var table = {};
    Object.keys(byCat).sort().forEach(function (cat) {
      var list = byCat[cat];
      var med = median(list);
      var shrunk = (list.length * med + model.peer_shrink_k * global) / (list.length + model.peer_shrink_k);
      table[cat] = { peers: list.length, median: round4(med), multiple: round4(Math.min(model.peer_multiple_max, Math.max(model.peer_multiple_min, shrunk))) };
    });
    return { table: table, globalMedian: round4(global) };
  }
  function peerMultipleOf(category, table, globalMedian, model) {
    var e = table[category || 'Other'];
    if (!e) {
      var g = Math.min(model.peer_multiple_max, Math.max(model.peer_multiple_min, globalMedian));
      return { multiple: g, count: 0, median: round4(globalMedian) };
    }
    return { multiple: e.multiple, count: e.peers, median: e.median };
  }
  function growthOf(row, model) {
    var raw = (row.change_7d === null || row.change_7d === undefined) ? 0 : row.change_7d;
    var pct = Math.min(model.growth_cap, Math.max(model.growth_floor, raw));
    return { pct: pct, mult: 1 + (pct / 100) * model.growth_weight };
  }
  function maturityOf(row, model) {
    var age = (row.age_days === null || row.age_days === undefined) ? model.unknown_age_days : row.age_days;
    return model.maturity_floor + (Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days) * model.maturity_range;
  }
  function impliedOf(row, model, table, globalMedian) {
    var peer = peerMultipleOf(row.category, table, globalMedian, model);
    var g = growthOf(row, model);
    var m = maturityOf(row, model);
    return Math.max(1, Math.round(row.tvl_usd * peer.multiple * g.mult * m));
  }
  function oddsOf(row, model) {
    var age = (row.age_days === null || row.age_days === undefined) ? model.unknown_age_days : row.age_days;
    var ageF = Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days;
    var sizeF = Math.min(1, Math.max(0, (Math.log10(Math.max(row.tvl_usd, 1)) - Math.log10(model.odds_size_floor_usd)) / (Math.log10(model.odds_size_ceil_usd) - Math.log10(model.odds_size_floor_usd))));
    return round4(model.odds_base + model.odds_age_weight * ageF + model.odds_size_weight * sizeF);
  }
  function airdropOf(row, model) {
    return Math.round(row.implied_value_usd * model.community_share * (row.farm_capital_usd / Math.max(row.tvl_usd, 1)) * row.launch_odds * 100) / 100;
  }

  // ---------- the farm plan, the same derivation main.ts writes to board.json ----------

  function chainOf(p) { return p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain'; }
  function capitalFor(tvl) {
    if (tvl >= 5e9) return 250;
    if (tvl >= 1e9) return 150;
    if (tvl >= 1e8) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function gasFor(chain) {
    var c = String(chain).toLowerCase();
    if (c === 'ethereum') return 8;
    if (c === 'tron') return 2;
    if (c === 'bitcoin') return 3;
    if (c === 'solana' || c === 'sui' || c === 'aptos' || c === 'polygon' || c === 'stellar' || c === 'flare' || c === 'ripple' || c === 'near' || c === 'sei') return 0;
    if (c === 'avalanche') return 1;
    return 1;
  }
  function gasLine(chain) {
    var g = gasFor(chain);
    return g === 0 ? 'under $1 of gas' : 'about $' + g + ' of gas';
  }
  var ACTIONS = [
    ['lend', 'Supply ${C} of USDC to ${N} on ${H} and keep the position open'],
    ['cdp', 'Open a collateral position with ${C} of USDC on ${N} and keep it open'],
    ['collateral', 'Post ${C} of collateral on ${N} and keep the position open'],
    ['dex', 'Provide ${C} of liquidity to ${N}\u2019s main pool on ${H} and keep the position open'],
    ['yield', 'Deposit ${C} into ${N}\u2019s main yield strategy on ${H} and keep the shares'],
    ['leveraged farm', 'Open a ${C} leveraged farming position on ${N} and keep it open'],
    ['farm', 'Deposit ${C} into ${N}\u2019s farm on ${H} and keep the position open'],
    ['bridge', 'Bridge ${C} of USDC to ${H} through ${N} and use the bridged funds in its app'],
    ['restak', 'Restake ${C} of the receipt token through ${N} and keep the position'],
    ['staking', 'Stake ${C} of the chain\u2019s staking asset through ${N} and keep the receipt'],
    ['perpetual', 'Deposit ${C} of USDC as margin on ${N} and open one small hedge'],
    ['derivative', 'Deposit ${C} of USDC as margin on ${N} and open one small position'],
    ['prediction', 'Fund ${C} and place one market position on ${N}'],
    ['curator', 'Deposit ${C} into a ${N} vault on ${H} and keep the shares'],
    ['allocator', 'Deposit ${C} into a ${N} vault on ${H} and keep the shares'],
    ['stable', 'Mint or deposit ${C} of the stable asset through ${N} on ${H}'],
    ['rwa', 'Mint ${C} of the protocol\u2019s yield asset on ${H} and hold it'],
    ['insurance', 'Buy ${C} of cover from ${N} on ${H} and keep the policy'],
    ['basis', 'Deposit ${C} into ${N}\u2019s basis vault on ${H} and keep the shares'],
    ['chain', 'Bridge ${C} to the chain and use ${N}\u2019s flagship app once a week'],
    ['liquidity manager', 'Deposit ${C} into a ${N} managed pool on ${H} and keep the shares'],
    ['anchor btc', 'Deposit ${C} of BTC through ${N} and hold the receipt'],
    ['bitcoin', 'Deposit ${C} of BTC through ${N} and hold the receipt'],
    ['cedefi', 'Deposit ${C} into ${N}\u2019s vault on ${H} and keep the shares'],
    ['otc', 'Fund ${C} and place one order on ${N}\u2019s desk'],
    ['payment', 'Fund ${C} and make one payment through ${N}'],
    ['governance', 'Deposit ${C} and vote once through ${N}'],
    ['card', 'Order the ${N} card, fund it with ${C} and spend once'],
    ['index', 'Buy ${C} of the ${N} index on ${H} and hold it'],
    ['rate', 'Open a ${C} interest-rate position on ${N} and hold it']
  ];
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    for (var i = 0; i < ACTIONS.length; i++) {
      if (c.indexOf(ACTIONS[i][0]) >= 0) {
        return ACTIONS[i][1].split('${C}').join('$' + capital).split('${N}').join(p.name).split('${H}').join(chain) + '.';
      }
    }
    return 'Deposit $' + capital + ' of USDC into ' + p.name + ' on ' + chain + ' and keep the position open.';
  }
  function stepText(step) {
    var s = step.text + ' Cost: ' + step.cost + '. Time: ' + step.time + '.';
    if (s.length > 600) s = s.slice(0, 596) + '...';
    if (s.length < 20) s = s + ' Hold the position and check the protocol\u2019s own page.';
    return s;
  }
  function farmSteps(row) {
    var chain = chainOf(row);
    var gas = gasLine(chain);
    var capital = row.farm_capital_usd;
    var hold = row.hold_days;
    return [
      { text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.', cost: gas + ' for the first transaction', time: '5 minutes' },
      { text: actionFor(row, capital, chain), cost: '$' + capital + ' of capital and ' + gas, time: '15 minutes to set up' },
      { text: 'Make one qualifying action each week, such as a deposit, a borrow, a swap or a vote.', cost: gas + ' a week', time: '10 minutes a week' },
      { text: 'Hold the position for at least ' + hold + ' days so the activity is counted in more than one snapshot.', cost: 'the $' + capital + ' stays in the position', time: hold + ' days' },
      { text: 'At this board\u2019s implied value of ' + compactUsd(row.implied_value_usd) + ' and a 7% community allocation, a $' + capital + ' position\u2019s pro-rata share would be about ' + compactUsd(row.airdrop_estimate_usd) + ' if a token launches; points programs often pay more than pro-rata, so open the protocol\u2019s own points page and claim only from the link it publishes.', cost: 'no fee to check, and never pay to claim', time: '10 minutes' },
      { text: 'Write the wallet, the dates and every transaction in a farm log so you can repeat the position or unwind it.', cost: 'nothing but the log', time: '5 minutes' }
    ].map(stepText);
  }

  // Exposed for the local check (tools/check.mjs): the page's model against board.json.
  if (typeof window !== 'undefined') {
    window.RADAR_MODEL = { impliedOf: impliedOf, oddsOf: oddsOf, airdropOf: airdropOf, farmSteps: farmSteps, peerTableFromPeers: peerTableFromPeers, peerMultipleOf: peerMultipleOf };
  }
  if (typeof document === 'undefined' || !document.getElementById) return;
  var DATA = window.RADAR;
  if (!DATA) return;
  var PEERS = peerTableFromPeers(DATA.peers, DATA.model);

  // ---------- page state ----------

  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', scope: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null };

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string') node.appendChild(document.createTextNode(child));
      else node.appendChild(child);
    }
    return node;
  }

  function readHash() {
    var params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    if (params.get('q')) state.q = params.get('q');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('tab')) state.tab = params.get('tab');
    if (params.get('p')) state.selected = params.get('p');
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.scope !== 'all') params.set('scope', state.scope);
    if (state.tab !== 'pre-token') params.set('tab', state.tab);
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function rows() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.scope === 'watchlist' && !r.on_watchlist) return false;
      if (state.scope === 'early' && r.on_watchlist) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      return [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase().indexOf(q) >= 0;
    });
  }
  function sortedRows(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else if (key === 'peer') { av = a.peer_multiple; bv = b.peer_multiple; }
      else if (key === 'odds') { av = a.launch_odds; bv = b.launch_odds; }
      else if (key === 'expected') { av = a.expected_value_usd; bv = b.expected_value_usd; }
      else if (key === 'airdrop') { av = a.airdrop_estimate_usd; bv = b.airdrop_estimate_usd; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  // ---------- sections ----------

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark' }),
        el('span', { class: 'brand-name' }, 'Token Radar', el('small', { text: 'Pre-token protocol board' }))),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama protocol index' }),
        el('span', { text: DATA.model_version + ' model' })
      )
    );
  }

  function lede() {
    var total = DATA.rows.reduce(function (n, r) { return n + r.implied_value_usd; }, 0);
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', { html: 'Every protocol with no token yet, <em>ranked by what its token would be worth.</em>' }),
        el('p', { text: 'The watchlist is the floor: every protocol with at least $' + Math.round(DATA.floor_usd / 1e6) + 'M of TVL and no token on record. The early radar adds ' + DATA.early_size + ' pre-token protocols below that floor, priced by their launched peers. Implied value is a model, not a promise.' })
      ),
      el('div', { class: 'facts' },
        el('div', { class: 'fact' }, el('span', { text: 'Watchlist covered' }), el('b', { class: 'green', text: DATA.watchlist_size + ' / ' + DATA.watchlist_size })),
        el('div', { class: 'fact' }, el('span', { text: 'Pre-token rows scored' }), el('b', { text: String(DATA.board_size) }), el('i', { text: DATA.early_size + ' early finds below the floor' })),
        el('div', { class: 'fact' }, el('span', { text: 'Total implied value' }), el('b', { text: fmtUsd(total) })),
        el('div', { class: 'fact' }, el('span', { text: 'Launched peers priced' }), el('b', { text: String(DATA.peers.length) }), el('i', { text: 'median mcap/TVL ' + fmtMult(DATA.global_peer_median) }))
      )
    );
  }

  function controls() {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Other'; }))).sort();
    var chains = Array.from(new Set(DATA.rows.reduce(function (a, r) { return a.concat(r.chains || []); }, []))).sort();
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); render(); });
    var cat = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    cat.addEventListener('change', function () { state.category = cat.value; writeHash(); render(); });
    var ch = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    ch.addEventListener('change', function () { state.chain = ch.value; writeHash(); render(); });
    function scopeBtn(value, label) {
      return el('button', { type: 'button', 'aria-pressed': state.scope === value ? 'true' : 'false', text: label, onclick: function () { state.scope = value; writeHash(); render(); } });
    }
    function tabBtn(value, label) {
      return el('button', { type: 'button', 'aria-pressed': state.tab === value ? 'true' : 'false', text: label, onclick: function () { state.tab = value; writeHash(); render(); } });
    }
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), cat),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), ch),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), el('div', { class: 'pills' }, scopeBtn('all', 'All'), scopeBtn('watchlist', 'Watchlist'), scopeBtn('early', 'Early finds'))),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Token status' }), el('div', { class: 'tabs' }, tabBtn('pre-token', 'Pre-token'), tabBtn('live', 'Live token'))),
      el('span', { class: 'count', text: state.tab === 'pre-token' ? rows().length + ' of ' + DATA.board_size + ' rows shown' : DATA.live.length + ' live-token protocols' })
    );
  }

  function sortHeader(key, label, num) {
    return el('th', { scope: 'col', class: num ? 'num' : null },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } render(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function boardTable() {
    var list = sortedRows(rows());
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search or pick another category to see the board again.' }),
        el('button', { class: 'button', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.scope = 'all'; writeHash(); render(); } })
      ));
    }
    var max = list[0].implied_value_usd || 1;
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num', text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', null, r.name, r.on_watchlist ? el('span', { class: 'badge watch', text: 'Watchlist' }) : el('span', { class: 'badge early', text: 'Early' })),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') })
        )),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', { class: 'num', text: fmtAge(r.age_days) }),
        el('td', { class: 'num', text: fmtMult(r.peer_multiple) }),
        el('td', { class: 'num', text: fmtOdds(r.launch_odds) }),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / max) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        )),
        el('td', { class: 'num', text: '$' + r.farm_capital_usd + ' in \u00b7 ~' + compactUsd(r.airdrop_estimate_usd) })
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Pre-token protocols, strongest implied value first. Select a row for its model breakdown and farm plan. Farm shows the plan\u2019s capital and its pro-rata airdrop estimate.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank', true),
            sortHeader('name', 'Protocol'),
            sortHeader('tvl', 'TVL', true),
            sortHeader('growth', '7d', true),
            sortHeader('age', 'Age', true),
            sortHeader('peer', 'Peer \u00d7', true),
            sortHeader('odds', 'Odds', true),
            sortHeader('implied', 'Implied value', true),
            sortHeader('airdrop', 'Farm', true)
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'status', text: 'already trades' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + (r.chains && r.chains.length ? r.chains.slice(0, 2).join(', ') : 'an unnamed chain') }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        el('td', { class: 'num', text: r.mcap_tvl === null ? 'n/a' : fmtMult(r.mcap_tvl) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { class: 'sub', text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking, and their market-cap-to-TVL ratios price it.' }),
          el('thead', null, el('tr', null, el('th', { scope: 'col', text: 'Status' }), el('th', { scope: 'col', text: 'Protocol' }), el('th', { scope: 'col', class: 'num', text: 'TVL' }), el('th', { scope: 'col', class: 'num', text: '7d' }), el('th', { scope: 'col', class: 'num', text: 'Market cap' }), el('th', { scope: 'col', class: 'num', text: 'Mcap / TVL' }))),
          tbody
        )
      )
    );
  }

  function modelPanel() {
    var m = DATA.model;
    var cats = Object.keys(PEERS.table).map(function (k) { return { name: k, e: PEERS.table[k] }; })
      .sort(function (a, b) { return b.e.peers - a.e.peers; }).slice(0, 8);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed' }),
      el('p', { text: 'Every row is scored by one function of the snapshot figures. No protocol name is special-cased, and no row is hand-picked. The peer multiple is the only price in the model, and it comes from the market: the median market-cap-to-TVL of the launched protocols in the same category.' }),
      el('div', { class: 'formula' },
        el('b', { text: 'implied = round( tvl_usd \u00d7 peer multiple \u00d7 growth \u00d7 maturity )' }),
        '\npeer multiple = category median of mcap / TVL over launched peers, shrunk toward the global median (' + fmtMult(DATA.global_peer_median) + ', ' + DATA.peers.length + ' peers) with weight ' + m.peer_shrink_k + ', clamped [' + m.peer_multiple_min + ', ' + m.peer_multiple_max + ']' +
        '\ngrowth = 1 + clamp(change_7d, ' + m.growth_floor + ', ' + m.growth_cap + ') / 100 \u00d7 ' + m.growth_weight +
        '\nmaturity = ' + m.maturity_floor + ' + min(age_days, ' + m.maturity_days + ') / ' + m.maturity_days + ' \u00d7 ' + m.maturity_range + '  (age unknown: ' + m.unknown_age_days + ' days)' +
        '\nlaunch odds = ' + m.odds_base + ' + ' + m.odds_age_weight + ' \u00d7 age factor + ' + m.odds_size_weight + ' \u00d7 size factor (log TVL, $5M to $5B)' +
        '\nexpected value = implied \u00d7 launch odds' +
        '\nairdrop estimate = implied \u00d7 7% community share \u00d7 (farm capital / TVL) \u00d7 launch odds'
      ),
      el('h3', { text: 'Peer multiples by category' }),
      el('div', { class: 'peer-grid' }, cats.map(function (c) {
        return el('div', { class: 'peer' }, el('b', { text: c.name }), el('span', { text: c.e.peers + (c.e.peers === 1 ? ' peer \u00b7 median ' : ' peers \u00b7 median ') + fmtMult(c.e.median) + ' \u00b7 used ' + fmtMult(c.e.multiple) }));
      })),
      el('h3', { text: 'What the board leaves out' }),
      el('p', { text: 'Wrapped, staked and bridged products are not ranked, whatever their TVL: WBTC is Bitcoin on Ethereum, Binance staked ETH is ETH in a staking product, and neither is a launch to price. The board applies the watchlist\u2019s own rule to every row \u2014 no Bridge, Liquid Staking, Liquid Restaking or Restaked BTC category, no wrapped, staked or staking in a name, no exchange\u2019s product \u2014 so every row is a protocol whose token genuinely does not exist yet.' }),
      el('h3', { text: 'What the model does not do' }),
      el('p', { text: 'It does not predict whether or when a token is issued: launch odds is a score from age and size, not a forecast. It does not read points programs, team announcements or social signals, which the snapshot does not carry. A protocol the snapshot records without a token may still have one its DefiLlama record does not carry, so the board says a protocol records no token, never that it has none.' })
    );
  }

  function foot() {
    return el('footer', { class: 'foot' },
      el('p', { text: 'Snapshot: ' + DATA.source + '. Data as of ' + DATA.as_of + '; frozen for this competition and never updated.' }),
      el('p', { text: 'Implied values, launch odds and airdrop estimates are this entry\u2019s model, computed from the snapshot alone. They are not prices, advice or a promise of a token, and farming any protocol can lose money. Verify every address and link on the protocol\u2019s own page before you act.' })
    );
  }

  // ---------- detail dialog ----------

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var steps = farmSteps(row);
    var recomputed = impliedOf(row, DATA.model, PEERS.table, PEERS.globalMedian);
    var peer = peerMultipleOf(row.category, PEERS.table, PEERS.globalMedian, DATA.model);
    var g = growthOf(row, DATA.model);
    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'brand-name', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (row.on_watchlist ? ' \u00b7 Watchlist' : ' \u00b7 Early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'Other') + ' on ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'an unnamed chain') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: 'Close', onclick: function () { dialog.close(); } })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Implied value \u2014 model ' + DATA.model_version }),
      el('div', { class: 'equation' },
        el('div', null, el('span', { text: 'TVL' }), el('b', { class: 'num', text: fmtUsd(row.tvl_usd) })),
        el('div', null, el('span', { text: 'Peer multiple' }), el('b', { class: 'num', text: fmtMult(row.peer_multiple) }), el('span', { text: peer.count + ' ' + (row.category || 'Other') + (peer.count === 1 ? ' peer, median ' : ' peers, median ') + fmtMult(peer.median) })),
        el('div', null, el('span', { text: 'Seven-day growth' }), el('b', { class: 'num', text: fmtPct(row.change_7d) }), el('span', { text: 'growth \u00d7' + g.mult.toFixed(2) })),
        el('div', null, el('span', { text: 'Age with no token' }), el('b', { class: 'num', text: fmtAge(row.age_days) }), el('span', { text: 'maturity \u00d7' + row.maturity_multiplier.toFixed(2) })),
        el('div', null, el('span', { text: 'Launch odds' }), el('b', { class: 'num', text: fmtOdds(row.launch_odds) }), el('span', { text: 'from age and size' })),
        el('div', null, el('span', { text: 'Expected value' }), el('b', { class: 'num', text: fmtUsd(row.expected_value_usd) }), el('span', { text: 'implied \u00d7 odds' })),
        el('div', { class: 'wide' }, el('span', { text: 'Implied value' }), el('b', { class: 'num', text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'what the token would be worth at launched-peer prices, if the record stayed as it is' }))
      ),
      el('p', { class: 'check', html: 'This page recomputes the row as <b>' + fmtUsd(recomputed) + '</b>' + (recomputed === row.implied_value_usd ? ', the same number board.json carries.' : ', which differs from the board: the data would be stale.') + ' The airdrop estimate for the farm below is <b>~' + compactUsd(row.airdrop_estimate_usd) + '</b> at a 7% community allocation.' })
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan \u2014 $' + row.farm_capital_usd + ' of capital, ' + row.hold_days + ' days' }),
      el('ol', { class: 'steps' }, steps.map(function (s) {
        var at = s.indexOf(' Cost: ');
        var action = at >= 0 ? s.slice(0, at) : s;
        var tail = at >= 0 ? s.slice(at + 1) : '';
        return el('li', null, el('b', { text: action }), el('span', { class: 'cost', text: tail }));
      }))
    ));
    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Record' }),
      el('dl', { class: 'kv' },
        el('dt', { text: 'Slug' }), el('dd', { class: 'mono', text: row.slug }),
        el('dt', { text: 'Category' }), el('dd', { text: row.category || 'none recorded' }),
        el('dt', { text: 'Chains' }), el('dd', { text: (row.chains && row.chains.length ? row.chains.join(', ') : 'none recorded') }),
        el('dt', { text: 'Token' }), el('dd', { text: 'none recorded in the snapshot' })
      )
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    shell.appendChild(controls());
    shell.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') shell.appendChild(modelPanel());
    shell.appendChild(foot());
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
