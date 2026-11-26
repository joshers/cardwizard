// Pure financial calculations. No DOM access, so this file can be unit-tested in Node.
(function (root) {
  'use strict';

  const EPS = 0.005; // half a cent: treat anything smaller as paid off

  function monthlyRate(apr) {
    return (Number(apr) || 0) / 100 / 12;
  }

  /** Fixed monthly payment that clears `principal` in exactly `months` at `apr`. */
  function paymentToPayoff(principal, apr, months) {
    if (!(principal > 0) || !(months > 0)) return 0;
    const r = monthlyRate(apr);
    if (r === 0) return principal / months;
    return (principal * r) / (1 - Math.pow(1 + r, -months));
  }

  /** Balance transfer fee: percentage of the amount, but never less than the minimum fee. */
  function transferFee(amount, feePct, minFee) {
    if (!(amount > 0)) return 0;
    return Math.max((amount * (Number(feePct) || 0)) / 100, Number(minFee) || 0);
  }

  /**
   * Pay a fixed amount every month on one balance.
   * Stops when paid off or after maxMonths.
   */
  function simulateSingle(balance, apr, payment, maxMonths = 1200) {
    let bal = Math.max(0, Number(balance) || 0);
    const r = monthlyRate(apr);
    const pay = Math.max(0, Number(payment) || 0);
    let interest = 0;
    let months = 0;
    while (bal > EPS && months < maxMonths) {
      const i = bal * r;
      interest += i;
      bal = bal + i - Math.min(pay, bal + i);
      months++;
    }
    const paidOff = bal <= EPS;
    return { months, interest, remaining: paidOff ? 0 : bal, paidOff };
  }

  /**
   * Pay `budget` per month across several debts for up to `months` months.
   * Each month: interest accrues, minimums are paid, and whatever is left goes
   * to the highest-APR balance first (the "avalanche" method).
   */
  function simulateAvalanche(debts, budget, months) {
    const ds = debts.map((d) => ({
      bal: Math.max(0, Number(d.balance) || 0),
      apr: Number(d.apr) || 0,
      r: monthlyRate(d.apr),
      min: Math.max(0, Number(d.minPayment) || 0),
    }));
    let interest = 0;
    let paidOffMonth = null;
    for (let m = 1; m <= months; m++) {
      for (const d of ds) {
        if (d.bal > 0) {
          const i = d.bal * d.r;
          d.bal += i;
          interest += i;
        }
      }
      let left = budget;
      for (const d of ds) {
        const p = Math.min(d.min, d.bal, left);
        d.bal -= p;
        left -= p;
      }
      const byApr = ds.filter((d) => d.bal > 0).sort((a, b) => b.apr - a.apr);
      for (const d of byApr) {
        if (left <= 0) break;
        const p = Math.min(d.bal, left);
        d.bal -= p;
        left -= p;
      }
      if (ds.every((d) => d.bal <= EPS)) {
        paidOffMonth = m;
        break;
      }
    }
    const remaining = ds.reduce((s, d) => s + (d.bal > EPS ? d.bal : 0), 0);
    return { interest, remaining, paidOffMonth };
  }

  const api = { monthlyRate, paymentToPayoff, transferFee, simulateSingle, simulateAvalanche };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CreditCalc = api;
})(typeof window !== 'undefined' ? window : globalThis);
