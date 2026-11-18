// Counterparty assessment: pure functions over facts read from the CIS-8004 registry.
// "Active" alone is not trust: the card must hash-match its on-chain anchor, the badge must be
// valid, the payment must go to the wallet the agent declared, and the spend must fit a budget.

export const DEFAULT_POLICY = {
  requireBadge: true, // Concordium Badge = an identity-verified owner stands behind the agent
  requireCardMatch: true,
  minAgeHours: 1, // brand-new agents get REVIEW, not ALLOW
  perPaymentCcd: 5,
  perCounterpartyDailyCcd: 20,
  globalDailyCcd: 50,
};

const H = 3.6e6;

/**
 * facts = { badge: <check_badge result>, wallet: <get_agent_wallet result or address>,
 *           history: <agent_history result>, now }
 * request = { payTo, amountCcd } (optional: assess identity only when omitted)
 */
export function assessCounterparty(facts, request = null, { policy = DEFAULT_POLICY, spent = { counterparty: 0, global: 0 } } = {}) {
  const reasons = [];
  const block = (code, msg) => reasons.push({ level: 'block', code, msg });
  const review = (code, msg) => reasons.push({ level: 'review', code, msg });
  const ok = (code, msg) => reasons.push({ level: 'ok', code, msg });

  const b = facts.badge || {};
  const c = b.checks || {};
  const onChain = b.on_chain || {};

  if (!c.on_chain_agent_found) block('not_registered', 'No CIS-8004 agent found for this id.');
  else if (!c.status_active) block('not_active', `Agent status is ${onChain.status || 'unknown'}, not Active.`);
  else ok('active', 'Registered and Active on the CIS-8004 registry.');

  if (c.on_chain_agent_found) {
    if (!c.has_agent_uri) block('no_card', 'Agent has no card URI.');
    else if (!c.card_fetched) (policy.requireCardMatch ? block : review)('card_unreachable', `Agent Card unreachable (HTTP ${b.http_status ?? '?'}).`);
    else if (!c.hash_matches_on_chain) (policy.requireCardMatch ? block : review)('card_tampered', 'Agent Card does not match its on-chain SHA-256 anchor.');
    else ok('card_match', 'Agent Card matches its on-chain SHA-256 anchor.');

    if (b.badge_valid) ok('badge', 'Valid Concordium Badge: an identity-verified owner is accountable.');
    else (policy.requireBadge ? block : review)('no_badge', c.badge_present ? 'Badge present but invalid.' : 'No Concordium Badge on the card.');
  }

  // Age and history
  const events = facts.history?.events || [];
  const first = events[0]?.timestamp ? Date.parse(events[0].timestamp) : null;
  const ageH = first ? ((facts.now ?? Date.now()) - first) / H : null;
  if (ageH != null && ageH < policy.minAgeHours) review('new_agent', `Registered ${ageH.toFixed(1)} h ago.`);
  const names = events.map((e) => e.event_name || '');
  if (names.some((n) => /Revoke/i.test(n))) review('revoked_before', 'History contains a revocation.');
  const transfers = names.filter((n) => /^Transfer$/i.test(n)).length;
  if (transfers > 0) review('ownership_changed', `NFT ownership changed ${transfers} time(s).`);

  // Payment routing and budget
  const wallet = typeof facts.wallet === 'string' ? facts.wallet : facts.wallet?.agent_wallet ?? facts.wallet?.wallet ?? null;
  if (request) {
    if (!wallet) block('no_wallet', 'Agent has not declared a payment wallet.');
    else if (request.payTo !== wallet) block('wallet_mismatch', `payTo ${short(request.payTo)} is not the agent's declared wallet ${short(wallet)}.`);
    else ok('wallet_match', 'payTo equals the agent wallet declared on-chain.');

    const amt = Number(request.amountCcd) || 0;
    if (amt > policy.perPaymentCcd) block('over_payment_cap', `${amt} CCD exceeds the per-payment cap of ${policy.perPaymentCcd} CCD.`);
    if (spent.counterparty + amt > policy.perCounterpartyDailyCcd) block('over_counterparty_cap', `Would exceed ${policy.perCounterpartyDailyCcd} CCD/day for this counterparty.`);
    if (spent.global + amt > policy.globalDailyCcd) block('over_global_cap', `Would exceed the global ${policy.globalDailyCcd} CCD/day budget.`);
  }

  const blocked = reasons.some((r) => r.level === 'block');
  const reviewed = reasons.some((r) => r.level === 'review');
  const verdict = blocked ? 'BLOCK' : reviewed ? 'REVIEW' : 'ALLOW';
  const okCount = reasons.filter((r) => r.level === 'ok').length;
  const score = Math.max(0, Math.round((okCount / Math.max(1, okCount + reasons.filter((r) => r.level !== 'ok').length)) * 100));
  return {
    verdict,
    score,
    tokenId: b.token_id ?? null,
    tokenAddress: b.token_address ?? null,
    owner: onChain.owner_account ?? null,
    wallet,
    agentUri: b.agent_uri ?? onChain.agent_uri ?? null,
    ageHours: ageH == null ? null : Math.round(ageH * 10) / 10,
    reasons,
  };
}

function short(a) {
  return a ? `${String(a).slice(0, 6)}…${String(a).slice(-4)}` : 'none';
}

/** Daily spend ledger keyed by counterparty token id. Pure: returns a new ledger. */
export function recordSpend(ledger, tokenId, amountCcd, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  const l = ledger && ledger.day === day ? ledger : { day, global: 0, byCounterparty: {} };
  const key = String(tokenId);
  return {
    day,
    global: round6(l.global + amountCcd),
    byCounterparty: { ...l.byCounterparty, [key]: round6((l.byCounterparty[key] || 0) + amountCcd) },
  };
}

export function spentFor(ledger, tokenId, now = Date.now()) {
  const day = new Date(now).toISOString().slice(0, 10);
  if (!ledger || ledger.day !== day) return { counterparty: 0, global: 0 };
  return { counterparty: ledger.byCounterparty[String(tokenId)] || 0, global: ledger.global };
}

const round6 = (x) => Math.round(x * 1e6) / 1e6;

/** Aggregate stats for a registry scan. */
export function summariseScan(rows) {
  const n = rows.length || 1;
  const count = (f) => rows.filter(f).length;
  const pct = (k) => Math.round((k / n) * 1000) / 10;
  const active = count((r) => r.checks?.status_active);
  const fetched = count((r) => r.checks?.card_fetched);
  const matched = count((r) => r.checks?.hash_matches_on_chain);
  const badge = count((r) => r.badge_valid);
  const allow = count((r) => r.verdict === 'ALLOW');
  return {
    scanned: rows.length,
    active, activePct: pct(active),
    cardFetched: fetched, cardFetchedPct: pct(fetched),
    cardMatch: matched, cardMatchPct: pct(matched),
    badgeValid: badge, badgeValidPct: pct(badge),
    allow, allowPct: pct(allow),
    activeButUntrusted: count((r) => r.checks?.status_active && r.verdict !== 'ALLOW'),
  };
}
