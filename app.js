(function () {
  'use strict';

  const C = window.CreditCalc;
  const STORAGE_KEY = 'creditWizard.v1';

  // ---------- helpers ----------
  const $ = (sel, el = document) => el.querySelector(sel);
  const money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const fmt = (v) => money.format(Number.isFinite(v) ? v : 0);
  const num = (v) => {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };
  const sum = (arr, f) => arr.reduce((s, x) => s + f(x), 0);
  const uid = () => Math.random().toString(36).slice(2, 10);
  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  function duration(months) {
    if (months === Infinity) return 'Never';
    if (!months) return '—';
    const y = Math.floor(months / 12);
    const m = months % 12;
    return [y ? `${y} yr` : '', m ? `${m} mo` : ''].filter(Boolean).join(' ');
  }
  function monthsFromNow(n) {
    const d = new Date();
    d.setMonth(d.getMonth() + n);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  // ---------- state ----------
  let state = load();

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (s && Array.isArray(s.cards) && Array.isArray(s.offers)) return s;
    } catch (_) { /* fall through */ }
    return { cards: [], offers: [] };
  }
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }
  const findCard = (id) => state.cards.find((c) => c.id === id);
  const findOffer = (id) => state.offers.find((o) => o.id === id);

  function newCard() {
    return { id: uid(), name: '', balance: '', apr: '', minPayment: '' };
  }
  function newOffer() {
    return {
      id: uid(), name: '', feePct: 3, minFee: 5, promoMonths: 18, promoApr: 0,
      postApr: '', creditLimit: '', plannedPayment: '', transfers: {},
    };
  }

  function sampleData() {
    const cards = [
      { id: uid(), name: 'Rewards Visa', balance: 6200, apr: 27.49, minPayment: 186 },
      { id: uid(), name: 'Store card', balance: 1450, apr: 31.99, minPayment: 58 },
      { id: uid(), name: 'Travel Mastercard', balance: 3800, apr: 22.24, minPayment: 95 },
    ];
    const offers = [
      { ...newOffer(), name: 'Offer A: 21 months, 5% fee', feePct: 5, minFee: 5, promoMonths: 21, postApr: 24.99, creditLimit: 12000,
        transfers: { [cards[0].id]: '', [cards[1].id]: '', [cards[2].id]: '' } },
      { ...newOffer(), name: 'Offer B: 15 months, 3% fee', feePct: 3, minFee: 5, promoMonths: 15, postApr: 26.24, creditLimit: 8000,
        transfers: { [cards[0].id]: '', [cards[1].id]: '' } },
    ];
    return { cards, offers };
  }

  // ---------- tabs ----------
  function showTab(name) {
    if (name !== 'offers') name = 'cards';
    document.querySelectorAll('[role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
    $('#tab-cards').hidden = name !== 'cards';
    $('#tab-offers').hidden = name !== 'offers';
    if (name === 'offers') renderOffers();
    else renderCards();
    if (location.hash !== '#' + name) history.replaceState(null, '', '#' + name);
  }

  // ---------- cards tab ----------
  function numberInput(field, value, label, step = '0.01') {
    return `<input data-field="${field}" type="number" min="0" step="${step}" inputmode="decimal" value="${esc(value)}" placeholder="0.00" aria-label="${label}">`;
  }

  function cardRow(c) {
    return `<tr data-card="${c.id}">
      <td><input data-field="name" value="${esc(c.name)}" placeholder="Card name" aria-label="Card name"></td>
      <td>${numberInput('balance', c.balance, 'Balance')}</td>
      <td>${numberInput('apr', c.apr, 'APR percent')}</td>
      <td>${numberInput('minPayment', c.minPayment, 'Minimum payment')}</td>
      <td class="num" data-out="interest"></td>
      <td data-out="payoff"></td>
      <td><button type="button" class="icon" data-action="delete-card" aria-label="Delete card" title="Delete card">✕</button></td>
    </tr>`;
  }

  function renderCards() {
    const body = $('#cards-body');
    if (!state.cards.length) {
      body.innerHTML = `<tr class="empty"><td colspan="7">No cards yet. Add one below, or
        <button type="button" class="link" data-action="sample">load sample data</button> to try it out.</td></tr>`;
    } else {
      body.innerHTML = state.cards.map(cardRow).join('');
      body.querySelectorAll('tr[data-card]').forEach(updateCardRow);
    }
    renderCardSummary();
  }

  function updateCardRow(tr) {
    const c = findCard(tr.dataset.card);
    if (!c) return;
    const bal = num(c.balance);
    const apr = num(c.apr);
    const pay = num(c.minPayment);
    tr.querySelector('[data-out=interest]').textContent = bal > 0 ? fmt(bal * C.monthlyRate(apr)) : '—';
    const out = tr.querySelector('[data-out=payoff]');
    if (!(bal > 0)) {
      out.innerHTML = '<span class="muted">—</span>';
    } else if (!(pay > 0)) {
      out.innerHTML = '<span class="muted">Enter a minimum payment</span>';
    } else {
      const sim = C.simulateSingle(bal, apr, pay);
      out.innerHTML = sim.paidOff
        ? `${duration(sim.months)}<small>${fmt(sim.interest)} total interest</small>`
        : '<span class="bad">Never</span><small>The payment doesn\'t cover the interest</small>';
    }
  }

  function tile(label, value, sub = '', cls = '') {
    return `<div class="tile ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  }

  function renderCardSummary() {
    const cards = state.cards;
    const total = sum(cards, (c) => num(c.balance));
    const mins = sum(cards, (c) => num(c.minPayment));
    const interest = sum(cards, (c) => num(c.balance) * C.monthlyRate(num(c.apr)));
    const wApr = total ? sum(cards, (c) => num(c.balance) * num(c.apr)) / total : 0;
    const share = mins > 0 ? Math.min(100, (interest / mins) * 100) : 0;
    const n = cards.filter((c) => num(c.balance) > 0).length;
    $('#card-summary').innerHTML = [
      tile('Total minimum payments', fmt(mins), 'per month, across all cards', 'hero'),
      tile('Total balance', fmt(total), `${n} card${n === 1 ? '' : 's'} with a balance`),
      tile('Interest this month', fmt(interest), mins > 0 ? `${share.toFixed(0)}% of your minimums goes to interest` : 'estimated'),
      tile('Average APR', `${wApr.toFixed(2)}%`, 'weighted by balance'),
    ].join('');
  }

  function bindCards() {
    const body = $('#cards-body');
    body.addEventListener('input', (e) => {
      const field = e.target.dataset.field;
      const tr = e.target.closest('tr[data-card]');
      if (!field || !tr) return;
      const c = findCard(tr.dataset.card);
      c[field] = e.target.value;
      save();
      updateCardRow(tr);
      renderCardSummary();
    });
    body.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      if (btn.dataset.action === 'sample') {
        state = sampleData();
        save();
        renderCards();
      } else if (btn.dataset.action === 'delete-card') {
        const id = btn.closest('tr').dataset.card;
        const c = findCard(id);
        if (!confirm(`Delete ${c.name || 'this card'}?`)) return;
        state.cards = state.cards.filter((x) => x.id !== id);
        state.offers.forEach((o) => delete o.transfers[id]);
        save();
        renderCards();
      }
    });
    $('#add-card').addEventListener('click', () => {
      state.cards.push(newCard());
      save();
      renderCards();
      const rows = body.querySelectorAll('tr[data-card]');
      rows[rows.length - 1].querySelector('input').focus();
    });
  }

  // ---------- offers tab ----------
  function computeOffer(o) {
    const feePct = num(o.feePct);
    const minFee = num(o.minFee);
    const items = Object.entries(o.transfers || {})
      .map(([id, amt]) => {
        const card = findCard(id);
        if (!card) return null;
        const bal = num(card.balance);
        const amount = amt === '' || amt == null ? bal : Math.min(Math.max(num(amt), 0), bal);
        return { card, amount, share: bal > 0 ? amount / bal : 0, fee: C.transferFee(amount, feePct, minFee) };
      })
      .filter((i) => i && i.amount > 0);

    const months = Math.max(0, Math.round(num(o.promoMonths)));
    const promoApr = num(o.promoApr);
    const transferred = sum(items, (i) => i.amount);
    const fee = sum(items, (i) => i.fee);
    const newBalance = transferred + fee;
    const needed = C.paymentToPayoff(newBalance, promoApr, months);
    const promoInterest = months > 0 && newBalance > 0 ? needed * months - newBalance : 0;
    const currentMins = sum(items, (i) => num(i.card.minPayment) * i.share);

    // What happens if you keep these balances where they are and pay the same amount each month?
    const baseline = C.simulateAvalanche(
      items.map((i) => ({ balance: i.amount, apr: num(i.card.apr), minPayment: num(i.card.minPayment) * i.share })),
      needed,
      months
    );
    const savings = baseline.interest - fee - promoInterest;

    const limit = num(o.creditLimit);
    const overLimit = limit > 0 && newBalance > limit + 0.005;
    const maxTransfer = limit > 0 ? limit / (1 + feePct / 100) : 0;

    let plan = null;
    const planned = num(o.plannedPayment);
    if (planned > 0 && newBalance > 0 && months > 0) {
      const during = C.simulateSingle(newBalance, promoApr, planned, months);
      const after = during.paidOff ? null : C.simulateSingle(during.remaining, num(o.postApr), planned);
      plan = { planned, during, after };
    }

    return {
      items, months, promoApr, transferred, fee, newBalance, needed, promoInterest,
      currentMins, baseline, savings, limit, overLimit, maxTransfer, plan,
      ready: items.length > 0 && months > 0,
    };
  }

  function offerPanel(o) {
    const field = (key, label, opts = {}) => `
      <label>${label}
        <input data-field="${key}" type="number" min="0" step="${opts.step || '0.01'}" inputmode="decimal"
          value="${esc(o[key])}" placeholder="${opts.placeholder || ''}">
        ${opts.hint ? `<span class="hint">${opts.hint}</span>` : ''}
      </label>`;

    const rows = state.cards.length
      ? state.cards
          .map((c) => {
            const on = Object.prototype.hasOwnProperty.call(o.transfers, c.id);
            const amt = on ? o.transfers[c.id] : '';
            return `<div class="transfer-row">
              <input type="checkbox" data-card-toggle="${c.id}" ${on ? 'checked' : ''} aria-label="Transfer ${esc(c.name || 'card')}">
              <div>
                <div class="name">${esc(c.name || 'Unnamed card')}</div>
                <div class="meta">${fmt(num(c.balance))} at ${num(c.apr).toFixed(2)}% · min ${fmt(num(c.minPayment))}</div>
              </div>
              <input type="number" min="0" step="0.01" inputmode="decimal" data-card-amount="${c.id}"
                value="${esc(amt)}" placeholder="Full balance" aria-label="Amount to transfer" ${on ? '' : 'disabled'}>
            </div>`;
          })
          .join('')
      : '<p class="muted" style="padding:0 8px">Add your cards on the <strong>My cards</strong> tab first.</p>';

    return `<article class="offer" data-offer="${o.id}">
      <div class="offer-head">
        <input data-field="name" value="${esc(o.name)}" placeholder="Offer name, e.g. Bank X, 18 mo at 0%" aria-label="Offer name">
        <button type="button" class="icon" data-action="delete-offer" title="Delete offer">✕</button>
      </div>
      <div class="offer-grid">
        ${field('feePct', 'Transfer fee %', { placeholder: '3' })}
        ${field('minFee', 'Minimum fee $', { placeholder: '5', hint: 'per transfer' })}
        ${field('promoMonths', 'Promo length (months)', { step: '1', placeholder: '18' })}
        ${field('promoApr', 'Promo APR %', { placeholder: '0' })}
        ${field('postApr', 'APR after promo %', { placeholder: 'e.g. 24.99' })}
        ${field('creditLimit', 'Credit limit $', { placeholder: 'optional' })}
        ${field('plannedPayment', 'What if I pay $/mo', { placeholder: 'optional' })}
      </div>
      <div class="offer-body">
        <div class="transfer-list">
          <h3>Cards to move to this offer</h3>
          ${rows}
        </div>
        <div class="offer-results" data-results></div>
      </div>
    </article>`;
  }

  function offerResultsHTML(r, o) {
    if (!state.cards.length) return '<p class="muted">Add your cards first, then come back to try offers.</p>';
    if (!r.items.length) return '<p class="muted">Tick the cards on the left that you would move to this offer.</p>';
    if (!r.months) return '<p class="muted">Enter how many months the promo rate lasts.</p>';

    const parts = [];
    parts.push(`<div class="answer">
      <div class="big">${fmt(r.needed)}<small> / month</small></div>
      <p>for ${r.months} months pays off ${fmt(r.newBalance)} by <strong>${monthsFromNow(r.months)}</strong>, assuming the promo starts this month.</p>
    </div>`);

    parts.push(`<dl class="breakdown">
      <dt>Amount moved</dt><dd>${fmt(r.transferred)}</dd>
      <dt>Transfer fee</dt><dd>${fmt(r.fee)}</dd>
      ${r.promoInterest > 0.005 ? `<dt>Interest at ${r.promoApr}% promo APR</dt><dd>${fmt(r.promoInterest)}</dd>` : ''}
      <dt class="total">Total you'd pay</dt><dd class="total">${fmt(r.newBalance + r.promoInterest)}</dd>
      <dt>Current minimums on these balances</dt><dd>${fmt(r.currentMins)} / mo</dd>
    </dl>`);

    const b = r.baseline;
    if (r.savings > 0.5) {
      parts.push(`<div class="callout good">If you skip the transfer and pay ${fmt(r.needed)}/mo where the balances are now
        (highest APR first), you'd pay about <strong>${fmt(b.interest)}</strong> in interest over ${r.months} months
        ${b.remaining > 0.5 ? `and still owe <strong>${fmt(b.remaining)}</strong> at the end, compared with $0 on this offer` : ''}.
        Net of fees, this offer saves you about <strong>${fmt(r.savings)}</strong>.</div>`);
    } else {
      parts.push(`<div class="callout warn">The fee is more than the interest you'd save:
        paying ${fmt(r.needed)}/mo where the balances are now costs about ${fmt(b.interest)} in interest,
        compared with ${fmt(r.fee + r.promoInterest)} for this offer.</div>`);
    }

    if (r.overLimit) {
      parts.push(`<div class="callout warn"><strong>Over the credit limit.</strong> ${fmt(r.newBalance)} including the fee is more than the
        ${fmt(r.limit)} limit. You can move about <strong>${fmt(r.maxTransfer)}</strong> at most. Enter smaller amounts on the left.</div>`);
    }

    if (r.plan) {
      const { planned, during, after } = r.plan;
      if (during.paidOff) {
        parts.push(`<div class="callout info">At <strong>${fmt(planned)}/mo</strong> you'd be paid off in
          ${duration(during.months)}, before the promo ends.</div>`);
      } else {
        const postApr = num(o.postApr);
        let tail;
        if (!after) tail = '';
        else if (!after.paidOff) tail = ` At ${postApr}% that payment never pays off the rest.`;
        else if (postApr > 0) tail = ` At ${postApr}% after the promo, paying it off takes another ${duration(after.months)} and about <strong>${fmt(after.interest)}</strong> in interest.`;
        else tail = ' Enter the APR after the promo to see what the rest would cost.';
        parts.push(`<div class="callout warn">At <strong>${fmt(planned)}/mo</strong> you'd still owe
          <strong>${fmt(during.remaining)}</strong> when the promo ends.${tail}</div>`);
      }
    }
    return parts.join('');
  }

  function updateOfferResults(id) {
    const o = findOffer(id);
    const el = document.querySelector(`.offer[data-offer="${id}"] [data-results]`);
    if (o && el) el.innerHTML = offerResultsHTML(computeOffer(o), o);
    renderCompare();
  }

  function renderCompare() {
    const rows = state.offers.map((o) => ({ o, r: computeOffer(o) })).filter((x) => x.r.ready);
    const el = $('#offer-compare');
    if (rows.length < 2) {
      el.innerHTML = '';
      return;
    }
    const best = rows.reduce((a, b) => (b.r.savings > a.r.savings ? b : a));
    el.innerHTML = `<div class="panel compare">
      <h2>Offers side by side</h2>
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Offer</th><th class="num">Moving</th><th class="num">Fee</th><th class="num">Promo</th>
          <th class="num">Needed / mo</th><th class="num">Est. savings</th><th></th>
        </tr></thead>
        <tbody>${rows
          .map(({ o, r }) => `<tr>
            <td>${esc(o.name || 'Untitled offer')}${o === best.o && r.savings > 0 ? '<span class="badge">Best savings</span>' : ''}</td>
            <td class="num">${fmt(r.transferred)}</td>
            <td class="num">${fmt(r.fee)}</td>
            <td class="num">${r.months} mo</td>
            <td class="num"><strong>${fmt(r.needed)}</strong></td>
            <td class="num ${r.savings > 0 ? 'good' : 'bad'}">${fmt(r.savings)}</td>
            <td>${r.overLimit ? '<span class="badge warn">Over limit</span>' : ''}</td>
          </tr>`)
          .join('')}</tbody>
      </table></div>
    </div>`;
  }

  function renderOffers() {
    const list = $('#offers-list');
    list.innerHTML = state.offers.length
      ? state.offers.map(offerPanel).join('')
      : `<div class="panel"><p class="muted" style="padding:8px">No offers yet. Add a balance transfer offer you're
        considering, then pick which cards to move to it.</p></div>`;
    state.offers.forEach((o) => updateOfferResults(o.id));
    renderCompare();
  }

  function bindOffers() {
    const list = $('#offers-list');
    list.addEventListener('input', (e) => {
      const panel = e.target.closest('.offer[data-offer]');
      if (!panel) return;
      const o = findOffer(panel.dataset.offer);
      const t = e.target;
      if (t.dataset.field) {
        o[t.dataset.field] = t.value;
        if (t.dataset.field === 'name') { save(); renderCompare(); return; }
      } else if (t.dataset.cardAmount) {
        o.transfers[t.dataset.cardAmount] = t.value;
      } else {
        return;
      }
      save();
      updateOfferResults(o.id);
    });
    list.addEventListener('change', (e) => {
      const id = e.target.dataset.cardToggle;
      if (!id) return;
      const panel = e.target.closest('.offer[data-offer]');
      const o = findOffer(panel.dataset.offer);
      const amountInput = panel.querySelector(`[data-card-amount="${id}"]`);
      if (e.target.checked) {
        o.transfers[id] = amountInput.value;
        amountInput.disabled = false;
      } else {
        delete o.transfers[id];
        amountInput.disabled = true;
      }
      save();
      updateOfferResults(o.id);
    });
    list.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-action=delete-offer]');
      if (!btn) return;
      const o = findOffer(btn.closest('.offer').dataset.offer);
      if (!confirm(`Delete ${o.name || 'this offer'}?`)) return;
      state.offers = state.offers.filter((x) => x !== o);
      save();
      renderOffers();
    });
    $('#add-offer').addEventListener('click', () => {
      const o = newOffer();
      // Start with every card that has a balance ticked: the common case is "move everything".
      state.cards.forEach((c) => { if (num(c.balance) > 0) o.transfers[c.id] = ''; });
      state.offers.push(o);
      save();
      renderOffers();
      document.querySelector(`.offer[data-offer="${o.id}"] input`).focus();
    });
  }

  // ---------- import / export ----------
  function bindBackup() {
    $('#export-btn').addEventListener('click', () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `credit-wizard-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    });
    $('#import-input').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!Array.isArray(data.cards) || !Array.isArray(data.offers)) throw new Error('bad shape');
        data.offers.forEach((o) => { o.transfers = o.transfers || {}; });
        if (!confirm(`Replace your current data with ${data.cards.length} cards and ${data.offers.length} offers from this file?`)) return;
        state = data;
        save();
        showTab(location.hash.slice(1));
      } catch (_) {
        alert("That file doesn't look like a Credit Wizard backup.");
      }
    });
  }

  // ---------- boot ----------
  document.querySelectorAll('[role=tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
  window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));
  bindCards();
  bindOffers();
  bindBackup();
  showTab(location.hash.slice(1));
})();
