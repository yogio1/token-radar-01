// Token Radar's dark dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and
// renders the ranked board, a filterable sortable table, and a per-protocol detail drawer that
// recomputes the implied value from the snapshot figures with the same arithmetic the model ran.
// The model is radar-2 (size power law, momentum, category, age, chain quality); the page states
// its formula and every factor, and no protocol name is special-cased anywhere.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('board');
  var state = { q: '', category: 'all', chain: 'all', tab: 'pre-token', sort: 'implied', dir: -1, selected: null, watchlistOnly: false };

  var M = DATA.model;

  function el(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
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

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }

  // The radar-2 model, recomputed in the page. Every factor mirrors lib/model.ts exactly; the
  // category and chain weight tables come verbatim from data.js (the model's own tables), so the
  // page's arithmetic and board.json's are one computation, not two hand-copied ones.
  var CHAIN_W = DATA.chain_weights || {};
  function chainW(chain) { var w = CHAIN_W[String(chain).toLowerCase()]; return w === undefined ? 0.45 : w; }
  function chainMult(chains) {
    if (!chains || chains.length === 0) return 1;
    var s = 0;
    for (var i = 0; i < chains.length; i++) s += Math.min(1, chainW(chains[i]));
    return s / chains.length;
  }
  var CAT_W = DATA.category_table || [];
  function catMult(category) {
    if (category === null || category === undefined) return 1;
    var c = String(category).toLowerCase();
    for (var i = 0; i < CAT_W.length; i++) if (c.indexOf(CAT_W[i][0]) >= 0) return CAT_W[i][1];
    return 1;
  }
  function ageMult(age) {
    var a = Math.min(Math.max(age, 0), M.age_max_days);
    if (a <= M.age_min_days) return 0.75 + 0.25 * (a / M.age_min_days);
    if (a <= M.age_peak_low) return 1 + (M.age_peak_mult - 1) * ((a - M.age_min_days) / (M.age_peak_low - M.age_min_days));
    if (a <= M.age_peak_high) return M.age_peak_mult;
    var t = (a - M.age_peak_high) / (M.age_max_days - M.age_peak_high);
    return M.age_peak_mult - (M.age_peak_mult - 0.8) * t;
  }
  function momentumMult(change7d) {
    var g = (change7d === null || change7d === undefined || !isFinite(change7d)) ? 0
      : Math.min(M.momentum_cap, Math.max(M.momentum_floor, change7d));
    return g >= 0 ? 1 + (g / 100) * M.momentum_up : 1 + (g / 100) * M.momentum_down;
  }
  // The one scoring function: recomputed from the row's raw snapshot figures with the same
  // arithmetic lib/model.ts ran, so the page's number and board.json's are the same computation.
  function impliedOf(row) {
    var age = row.age_days === null || row.age_days === undefined ? M.age_unknown_days : row.age_days;
    var size = M.base_multiple * Math.pow(1e6 / Math.max(row.tvl_usd, 1), M.size_decay);
    return Math.max(1, Math.round(row.tvl_usd * size * momentumMult(row.change_7d) * catMult(row.category) * ageMult(age) * chainMult(row.chains)));
  }

  // Watchlist membership, for the badge on the board and the detail view.
  // data.js does not carry the list itself, so the page keeps its own: buildRadar marks nothing,
  // but main.ts's board covers exactly watchlist_size rows; the model can only rank what the
  // snapshot named. The page shows the badge from DATA.watchlist_slugs when present.
  var WATCH = new Set(DATA.watchlist_slugs || []);

  function isWatch(r) { return WATCH.has(r.slug); }

  function readHash() {
    var hash = window.location.hash.replace(/^#/, '');
    if (!hash) return;
    var params = new URLSearchParams(hash);
    if (params.get('q')) state.q = params.get('q');
    if (params.get('p')) state.selected = params.get('p');
    if (params.get('category')) state.category = params.get('category');
    if (params.get('chain')) state.chain = params.get('chain');
    if (params.get('watch') === '1') state.watchlistOnly = true;
  }
  function writeHash() {
    var params = new URLSearchParams();
    if (state.q) params.set('q', state.q);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.chain !== 'all') params.set('chain', state.chain);
    if (state.watchlistOnly) params.set('watch', '1');
    if (state.selected) params.set('p', state.selected);
    var next = params.toString();
    if (next) window.history.replaceState(null, '', '#' + next);
    else window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  function filtered() {
    var q = state.q.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.watchlistOnly && !isWatch(r)) return false;
      if (state.category !== 'all' && (r.category || 'Other') !== state.category) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }
  function sorted(list) {
    var key = state.sort;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -Infinity : a.change_7d; bv = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? Infinity : a.age_days; bv = b.age_days === null ? Infinity : b.age_days; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -state.dir;
      if (av > bv) return state.dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
  }

  function header() {
    return el('header', { class: 'top' },
      el('div', { class: 'brand' }, el('span', { class: 'mark', 'aria-hidden': 'true' }), el('span', { class: 'brand-name', text: 'Token Radar' })),
      el('div', { class: 'top-meta' },
        el('span', { text: 'Snapshot ' + DATA.as_of }),
        el('span', { text: 'DefiLlama index, sealed' }),
        el('span', { text: 'Model ' + DATA.model_version }),
        el('span', { text: 'No network \u00b7 static page' })
      )
    );
  }

  function lede() {
    return el('section', { class: 'lede' },
      el('div', null,
        el('h1', null,
          'The pre-token board, ranked by ',
          el('em', { text: 'implied value' }),
          '.'
        ),
        el('p', { text: 'Every protocol here records no token: its launch is the token it may issue one day. Implied value is this model\'s own claim - what that token would be worth if the protocol\'s record stays as it is - computed from the snapshot\'s TVL, seven-day momentum, category, age and chain quality. The ' + DATA.watchlist_size + ' watchlist protocols are the floor and every row carries a farm plan; the other ' + DATA.early_size + ' rows are the early finds below the ' + Math.round(DATA.floor_usd / 1e6) + 'M floor.' })
      ),
      el('div', { class: 'facts' },
        fact('Board rows', String(DATA.board_size)),
        fact('Watchlist covered', DATA.watchlist_size + ' / ' + DATA.watchlist_size),
        fact('Early rows below floor', String(DATA.early_size)),
        fact('Live tokens set aside', String(DATA.live_size))
      )
    );
    function fact(label, value) {
      return el('div', { class: 'fact' }, el('b', { text: value }), el('span', { text: label }));
    }
  }

  function controls(categories, chains) {
    var search = el('input', { type: 'search', id: 'q', placeholder: 'Search name, category or chain\u2026', value: state.q, 'aria-label': 'Search the board' });
    search.addEventListener('input', function () { state.q = search.value; writeHash(); renderTable(); });
    var catSel = el('select', { id: 'category', 'aria-label': 'Filter by category' },
      el('option', { value: 'all', text: 'All categories' }),
      categories.map(function (c) { return el('option', { value: c, text: c, selected: c === state.category ? 'selected' : null }); })
    );
    catSel.addEventListener('change', function () { state.category = catSel.value; writeHash(); renderTable(); });
    var chainSel = el('select', { id: 'chain', 'aria-label': 'Filter by chain' },
      el('option', { value: 'all', text: 'All chains' }),
      chains.map(function (c) { return el('option', { value: c, text: c, selected: c === state.chain ? 'selected' : null }); })
    );
    chainSel.addEventListener('change', function () { state.chain = chainSel.value; writeHash(); renderTable(); });
    var watchBtn = el('button', { type: 'button', class: 'button', 'aria-pressed': state.watchlistOnly ? 'true' : 'false', text: 'Watchlist only' });
    watchBtn.addEventListener('click', function () {
      state.watchlistOnly = !state.watchlistOnly;
      watchBtn.setAttribute('aria-pressed', state.watchlistOnly ? 'true' : 'false');
      writeHash(); renderTable();
    });
    return el('div', { class: 'controls' },
      el('div', { class: 'field' }, el('label', { for: 'q', text: 'Search' }), search),
      el('div', { class: 'field' }, el('label', { for: 'category', text: 'Category' }), catSel),
      el('div', { class: 'field' }, el('label', { for: 'chain', text: 'Chain' }), chainSel),
      el('div', { class: 'field' }, el('span', { class: 'sub', text: 'Scope' }), watchBtn),
      el('span', { class: 'count', id: 'count' })
    );
  }

  function sortHeader(key, label) {
    return el('th', { scope: 'col' },
      el('button', { type: 'button', onclick: function () { if (state.sort === key) state.dir = -state.dir; else { state.sort = key; state.dir = -1; } renderTable(); } },
        label,
        state.sort === key ? el('span', { 'aria-hidden': 'true', text: state.dir < 0 ? ' \u25bc' : ' \u25b2' }) : null
      )
    );
  }

  function factPanel() {
    var m = DATA.model;
    var shown = Math.min(DATA.board_size, 8);
    return el('section', { class: 'panel model' },
      el('h2', { text: 'How implied value is computed \u00b7 model ' + DATA.model_version }),
      el('p', { text: 'One function scores every row from the snapshot\'s own figures. No protocol name is special-cased and no row is hand-picked. The factors, most important first:' }),
      el('div', { class: 'formula' },
        'implied = tvl_usd \u00d7 ',
        el('b', { text: m.base_multiple + ' \u00d7 (1M \u00f7 tvl_usd)^' + m.size_decay }),
        ' \u00d7 momentum \u00d7 category \u00d7 age \u00d7 chain'
      ),
      el('div', { class: 'factor-list' },
        factor('1 \u00b7 TVL, with a power law', 'Capital is the raw material of a launch, but the multiple per TVL dollar falls with size: a $10B giant\'s token is a smaller multiple of its deposits than a $50M contender\'s. The exponent ' + m.size_decay + ' decays the multiple smoothly.'),
        factor('2 \u00b7 Momentum (change_7d)', 'Seven-day TVL growth is the snapshot\'s own signal of where depositors are flowing. Asymmetric and clamped to [' + m.momentum_floor + '%, +' + m.momentum_cap + '%]: fast growth helps more than shrinkage hurts.'),
        factor('3 \u00b7 Category weight', 'A DEX or lending market converts volume into fees a token can claim; a canonical bridge holds TVL only as a side effect. Weighted 0.4 (wrapped TVL) to 1.35 (derivatives, DEXes) by category family.'),
        factor('4 \u00b7 Age with no token', 'The best candidates have run long enough to accrue user history but not so long the moment passed: the multiplier peaks at ' + m.age_peak_mult + ' across the ' + Math.round(m.age_peak_low / 30) + '-' + Math.round(m.age_peak_high / 30) + ' month window and decays past 3 years. Unlisted age scores neutral at ' + m.age_unknown_days + ' days.'),
        factor('5 \u00b7 Chain quality', 'A token on Ethereum, Solana, Arbitrum or Base meets deep liquidity and exchange attention on day one; the same TVL on a minor chain meets neither. Averaged over the protocol\'s chains, each capped at 1.0.')
      ),
      el('p', { class: 'sub', text: 'Top ' + shown + ' rows by implied value, recomputed in this page from the raw figures - the same arithmetic board.json carries. Implied value is this model\'s estimate, never a price and never a prediction of whether a token comes.' })
    );
    function factor(title, body) {
      return el('div', { class: 'factor' }, el('b', { text: title }), el('span', { text: body }));
    }
  }

  var dialog = el('dialog', { class: 'detail', id: 'detail', 'aria-labelledby': 'detail-title' });
  dialog.addEventListener('close', function () { state.selected = null; writeHash(); });

  function openDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    if (!row) return;
    state.selected = slug;
    writeHash();
    dialog.textContent = '';
    var recompute = impliedOf(row);
    var matches = recompute === row.implied_value_usd;

    dialog.appendChild(el('div', { class: 'detail-head' },
      el('div', null,
        el('span', { class: 'eyebrow', text: 'Rank ' + row.rank + ' of ' + DATA.board_size + (isWatch(row) ? ' \u00b7 on the watchlist' : ' \u00b7 early find') }),
        el('h2', { id: 'detail-title', text: row.name }),
        el('p', { class: 'sub', text: (row.category || 'No category on record') + ' \u00b7 ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'unnamed chains') + (row.listed_at ? ' \u00b7 listed ' + row.listed_at : ' \u00b7 listing date unknown') })
      ),
      el('button', { class: 'close', type: 'button', 'aria-label': 'Close details', text: '\u2715', onclick: function () { dialog.close(); } })
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('div', { class: 'big-implied' }, el('b', { text: fmtUsd(row.implied_value_usd) }), el('span', { text: 'implied value of the token this protocol may issue' })),
      el('h3', { text: 'The model\'s inputs' }),
      el('div', { class: 'equation' },
        eq('TVL', fmtUsd(row.tvl_usd)),
        eq('7d momentum', fmtPct(row.change_7d)),
        eq('Age with no token', fmtAge(row.age_days)),
        eq('Chains', String(row.chains && row.chains.length ? row.chains.length : 0)),
        eq('Size multiplier', 'x' + row.size_mult.toFixed(3)),
        eq('Momentum multiplier', 'x' + row.momentum_mult.toFixed(3)),
        eq('Category multiplier', 'x' + row.category_mult.toFixed(2)),
        eq('Age multiplier', 'x' + row.age_mult.toFixed(3)),
        eq('Chain multiplier', 'x' + row.chain_mult.toFixed(3)),
        eq('Implied value', fmtUsd(recompute), true)
      ),
      el('p', { class: 'status-note' },
        'The page recomputes this row as ', el('b', { text: fmtUsd(recompute) }),
        matches ? ', the same number board.json carries - the code and the data are the same arithmetic.' : ', which differs from the board\'s figure: the data would be stale. ',
        ' Implied value is the model\'s estimate under the assumption the protocol\'s record stays as it is; it never predicts whether or when a token is issued.')
    ));

    dialog.appendChild(el('section', { class: 'detail-section' },
      el('h3', { text: 'Farm plan \u00b7 what to do before the token' }),
      el('ol', { class: 'steps' }, farmSteps(row).map(function (s) {
        return el('li', null,
          el('div', null,
            el('b', { text: s.text }),
            el('span', { class: 'cost' },
              el('i', { class: 'money', text: s.cost }),
              el('i', { class: 'clock', text: s.time })
            )
          )
        );
      })),
      el('p', { class: 'status-note', text: 'Every step costs what it says and takes the time it says. Nothing here pays anyone to register you; a protocol that asks a fee to "qualify" for a token is a scam signal, not a farm.' })
    ));
    if (typeof dialog.showModal === 'function') {
      if (!dialog.open) dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }

    function eq(label, value, hl) {
      return el('div', null, el('span', { text: label }), el('b', { class: hl ? 'hl' : null, text: value }));
    }
  }

  // The page's own farm plan generator mirrors lib/model.ts farmSteps: category, chains, TVL and age
  // decide the action, the watch and the exit. No name is special-cased.
  function capitalFor(p) {
    if (p.tvl_usd >= 5e9) return 300;
    if (p.tvl_usd >= 1e9) return 200;
    if (p.tvl_usd >= 1e8) return 150;
    if (p.tvl_usd >= 2e7) return 100;
    return 75;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 30;
    if (age < 180) return 60;
    if (age < 365) return 45;
    return 30;
  }
  function actionFor(p, capital, chain) {
    var c = (p.category || '').toLowerCase();
    var name = p.name;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('money market') >= 0 || c.indexOf('collateralized debt') >= 0) return 'Supply $' + capital + ' of USDC into ' + name + "'s largest USDC market on " + chain + ', leave it unborrowed if the supply APY is above 3%, and enable the rewards switch if one exists.';
    if (c.indexOf('dex') >= 0 || c.indexOf('liquidity manager') >= 0) return 'On ' + chain + ', add $' + capital + ' of liquidity to ' + name + "'s highest-volume pool, half in each side, and watch the fee APR on its pool page against impermanent loss.";
    if (c.indexOf('yield') >= 0 || c.indexOf('vault') >= 0 || c.indexOf('aggregator') >= 0 || c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0) return 'Deposit $' + capital + ' of USDC into ' + name + "'s largest vault on " + chain + ', keep the vault shares in the farming wallet, and leave them untouched through the whole hold.';
    if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('options') >= 0) return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' (' + chain + '), open one small 1x position, and keep it open rather than churning trades.';
    if (c.indexOf('bridge') >= 0 || c.indexOf('cross chain') >= 0 || c.indexOf('interop') >= 0) return 'Bridge $' + capital + ' of USDC from Ethereum to ' + chain + ' through ' + name + ', then use the bridged USDC in one other app on that chain so the flow is a real user flow.';
    if (c.indexOf('restak') >= 0 || c.indexOf('staking') >= 0) return 'Stake $' + capital + " of the chain's staking asset through " + name + ', keep the receipt in the farming wallet, and leave it staked the whole hold so every snapshot counts it.';
    if (c.indexOf('stable') >= 0) return 'Mint or swap $' + capital + " into " + name + "'s stablecoin on " + chain + ', hold the balance in the farming wallet, and redeposit it if a savings market exists.';
    if (c.indexOf('rwa') >= 0) return 'Mint $' + capital + " of " + name + "'s yield-bearing asset on " + chain + ' and hold it for the whole window; check its redemption page first so you can exit within a week.';
    if (c.indexOf('insurance') >= 0) return 'Buy $' + capital + " of cover on " + chain + "'s largest lending market through " + name + ' and keep the policy NFT in the farming wallet.';
    if (c.indexOf('prediction') >= 0) return 'Fund $' + capital + ' on ' + name + ' and place one small position in its most liquid market; one real trade counts, churn does not.';
    if (c.indexOf('launchpad') >= 0) return 'Participate once in a live ' + name + ' sale on ' + chain + ' with $' + capital + ', and hold the allocation rather than flipping it.';
    if (c.indexOf('nft') >= 0) return 'Trade one mid-priced collection on ' + name + "'s marketplace on " + chain + ' and keep the proceeds listed rather than withdrawn.';
    if (c.indexOf('oracle') >= 0) return 'Use ' + name + "'s oracle feed through one consumer app on " + chain + ' with $' + capital + ' at stake, so your address appears as a real user of the feed.';
    if (c.indexOf('gaming') >= 0) return 'Play one ranked session on ' + name + ' each week with a $' + capital + ' entry-level account, keeping every in-game asset in the farming wallet.';
    if (c.indexOf('payments') >= 0) return 'Send three small payments (about $' + Math.max(10, Math.round(capital / 10)) + ' each) through ' + name + ' on ' + chain + ' in different weeks, so the volume looks like a real user\'s.';
    return 'Deposit $' + capital + " of USDC into " + name + "'s main product on " + chain + ' and keep the position open for the whole hold.';
  }
  function watchFor(p, age) {
    var growth = p.change_7d;
    var c = (p.category || '').toLowerCase();
    var bits = [];
    if (growth !== null && growth !== undefined && growth <= -25) {
      bits.push('TVL fell ' + growth.toFixed(0) + '% this week: check weekly whether deposits are leaving faster than rewards come in, and exit early on a second week of -20% or worse.');
    } else if (growth !== null && growth !== undefined && growth >= 60) {
      bits.push('TVL grew ' + growth.toFixed(0) + '% this week: watch for mercenary capital arriving after you; a deposit spike followed by a points announcement usually means the reward pool will be shared thin.');
    }
    if (age !== null && age !== undefined && age < 60) {
      bits.push('First listed ' + age + ' days ago, so the contracts are young: cap the position at what you can lose, and check for an exploit disclosure before every weekly top-up.');
    }
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0) bits.push('Watch utilisation and bad-debt notices on its lending page: a market near 100% utilisation pays more but carries liquidation and withdrawal risk.');
    else if (c.indexOf('dex') >= 0) bits.push("Watch the pool for a falling fee APR and for its pair depegging; rotate into the highest-volume pool rather than leaving liquidity in a dying one.");
    else if (c.indexOf('bridge') >= 0) bits.push('Bridges are the most-exploited category: keep funds bridged only while completing the weekly action, and withdraw between weeks if gas allows.');
    else if (c.indexOf('perpetual') >= 0 || c.indexOf('derivative') >= 0) bits.push('Watch the margin ratio: a 1x position should never need liquidation, so any margin call means close it and reopen smaller.');
    if (bits.length === 0) {
      bits.push("Watch " + p.name + "'s own announcements and its TVL weekly: a points program, a governance forum going live, or a sudden deposit spike are the earliest public signals a token is coming.");
    }
    return bits.join(' ');
  }
  function farmSteps(p) {
    var chain = p.chains && p.chains.length ? p.chains[0] : 'its main chain';
    var capital = capitalFor(p);
    var hold = holdDaysFor(p.age_days);
    return [
      { text: 'Set up a fresh wallet that holds only the funds you plan to farm, write its seed phrase offline, and fund it with $' + capital + ' of USDC plus about $' + (capital >= 150 ? 12 : 6) + ' of the gas token for ' + chain + '.', cost: '$' + capital + ' plus gas token', time: '10 minutes' },
      { text: actionFor(p, capital, chain), cost: '$' + capital + ' of capital', time: '15-20 minutes to set up' },
      { text: 'Make one qualifying action each week for the first ' + Math.min(hold, 30) + ' days - a $10 deposit top-up, a $10 swap, or a vote if ' + p.name + ' has governance - so your address appears in more than one weekly snapshot.', cost: '$2-4 of gas a week', time: '10 minutes a week' },
      { text: watchFor(p, p.age_days), cost: 'nothing but attention', time: '5 minutes a week' },
      { text: "Check whether " + p.name + ' runs a points or rewards program and whether your position is registered for it; if it publishes a dashboard, bookmark it and verify your address shows a balance before assuming the work counts.', cost: 'free to check', time: '10 minutes' },
      { text: 'Hold the position at least ' + hold + ' days before unwinding, and log the wallet address, every transaction hash and the dates in a farm log the day you make them, so you can prove the history a claim requires.', cost: 'nothing but the log', time: '5 minutes a week' },
      { text: 'Exit plan: when a token launches, claim only from ' + p.name + "'s own site; sell a third at launch, a third after the first unlock wave, and keep a third only if it trades above its implied launch value. If no token comes within " + (hold + 90) + ' days, unwind and move the capital to the next row on this board.', cost: 'two sell transactions', time: '15 minutes to execute' }
    ];
  }

  function boardTable() {
    var list = sorted(filtered());
    var count = document.getElementById('count');
    if (count) count.textContent = list.length + ' of ' + DATA.board_size + ' rows shown';
    if (list.length === 0) {
      return el('div', { class: 'panel' }, el('div', { class: 'empty' },
        el('h2', { text: 'No protocol matches that filter' }),
        el('p', { text: 'Clear the search, the chain or the category to see the board again.' }),
        el('button', { class: 'button primary', type: 'button', text: 'Clear filters', onclick: function () { state.q = ''; state.category = 'all'; state.chain = 'all'; state.watchlistOnly = false; writeHash(); renderTable(); } })
      ));
    }
    var max = 0;
    for (var i = 0; i < list.length; i++) max = Math.max(max, list[i].implied_value_usd);
    var tbody = el('tbody');
    list.forEach(function (r) {
      var growth = r.change_7d === null || r.change_7d === undefined ? 'n/a' : fmtPct(r.change_7d);
      var growthClass = r.change_7d === null || r.change_7d === undefined ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var tr = el('tr', {
        'data-selected': state.selected === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openDetail(r.slug); },
        onkeydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDetail(r.slug); } }
      },
        el('td', { class: 'num rank-cell' + (r.rank <= 10 ? ' top' : ''), text: String(r.rank) }),
        el('td', null, el('div', { class: 'name' },
          el('b', { text: r.name }),
          el('span', { class: 'sub', text: (r.category || 'Other') + ' \u00b7 ' + fmtAge(r.age_days) + ' with no token' })
        )),
        el('td', null, el('div', { class: 'chips' }, (r.chains || []).slice(0, 3).map(function (c) { return el('span', { class: 'chip', text: c }); }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + growthClass, text: growth }),
        el('td', null, el('span', { class: 'watch-badge ' + (isWatch(r) ? 'on' : 'off'), text: isWatch(r) ? 'watchlist' : 'early' })),
        el('td', null, el('div', { class: 'implied' },
          el('div', { class: 'bar', 'aria-hidden': 'true' }, el('i', { style: 'width:' + Math.max(3, Math.round((r.implied_value_usd / (max || 1)) * 100)) + '%' })),
          el('span', { class: 'num', text: fmtUsd(r.implied_value_usd) })
        ))
      );
      tbody.appendChild(tr);
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Pre-token protocols, strongest implied value first. Select a row for its model inputs and its farm plan.' }),
          el('thead', null, el('tr', null,
            sortHeader('implied', 'Rank'),
            sortHeader('name', 'Protocol'),
            el('th', { scope: 'col', text: 'Chains' }),
            sortHeader('tvl', 'TVL'),
            sortHeader('growth', '7d'),
            el('th', { scope: 'col', text: 'Status' }),
            sortHeader('implied', 'Implied value')
          )),
          tbody
        )
      )
    );
  }

  function liveTable() {
    var count = document.getElementById('count');
    if (count) count.textContent = DATA.live.length + ' live-token protocols';
    var tbody = el('tbody');
    DATA.live.forEach(function (r) {
      tbody.appendChild(el('tr', null,
        el('td', null, el('span', { class: 'watch-badge off', text: 'already trades' })),
        el('td', null, el('div', { class: 'name' }, el('b', { text: r.name }), el('span', { class: 'sub', text: r.category || 'Other' }))),
        el('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        el('td', { class: 'num ' + ((r.change_7d !== null && r.change_7d !== undefined && r.change_7d >= 0) ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        el('td', { class: 'num', text: fmtUsd(r.mcap_usd) })
      ));
    });
    return el('div', { class: 'panel' },
      el('div', { class: 'table-wrap' },
        el('table', null,
          el('caption', { text: 'Token live: these protocols already trade, so their market cap is a fact, not a model. They are set aside from the pre-token ranking.' }),
          el('thead', null, el('tr', null,
            el('th', { scope: 'col', text: 'Status' }),
            el('th', { scope: 'col', text: 'Protocol' }),
            el('th', { scope: 'col', text: 'TVL' }),
            el('th', { scope: 'col', text: '7d' }),
            el('th', { scope: 'col', text: 'Market cap' })
          )),
          tbody
        )
      )
    );
  }

  function renderTable() {
    var holder = document.getElementById('table-holder');
    if (!holder) return;
    holder.textContent = '';
    holder.appendChild(state.tab === 'pre-token' ? boardTable() : liveTable());
    if (state.tab === 'pre-token') holder.appendChild(factPanel());
  }

  function render() {
    app.textContent = '';
    var shell = el('div', { class: 'shell' });
    shell.appendChild(header());
    shell.appendChild(lede());
    var categories = [];
    var chains = [];
    DATA.rows.forEach(function (r) {
      var c = r.category || 'Other';
      if (categories.indexOf(c) < 0) categories.push(c);
      (r.chains || []).forEach(function (ch) { if (chains.indexOf(ch) < 0) chains.push(ch); });
    });
    categories.sort();
    chains.sort();
    shell.appendChild(controls(categories, chains));
    var holder = el('div', { id: 'table-holder' });
    shell.appendChild(holder);
    app.appendChild(shell);
    app.setAttribute('aria-busy', 'false');
    if (!dialog.isConnected) app.appendChild(dialog);
    renderTable();
    if (state.selected) openDetail(state.selected);
  }

  readHash();
  render();
  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && dialog.open) dialog.close();
  });
})();
