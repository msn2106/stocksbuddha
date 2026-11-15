import type {
  MarketState,
  MarketInstrument,
  ResearchCheck,
} from "@ra/contracts";

/** India calendar dates, independent of the host timezone. */
export function indiaDate(now = new Date()): string {
  return new Date(now.getTime() + 19800000).toISOString().slice(0, 10);
}
/** Shift a validated calendar date without daylight-saving arithmetic. */
export function addDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
/** Starting state carries no implicit compliance attestation. */
export function emptyMarket(): MarketState {
  return {
    version: 0,
    trades: [],
    holdings: [],
    recommendations: [],
    declaration: null,
  };
}
/** Cover gaps since the last attestation, or the full initial thirty-day period. */
export function requiredFrom(state: MarketState, today: string): string {
  return state.declaration
    ? indiaDate(new Date(state.declaration.at))
    : addDays(today, -30);
}
/** Attestations become stale after any new or corrected personal transaction/holding. */
export function declarationCurrent(state: MarketState, today: string): boolean {
  return (
    !!state.declaration &&
    !state.declaration.invalidated &&
    indiaDate(new Date(state.declaration.at)) === today
  );
}
/** Conservative underlying-level matching includes both equity and related derivative contracts. */
export function sameSecurity(
  a: MarketInstrument,
  b: MarketInstrument,
): boolean {
  return a.underlying === b.underlying || a.key === b.key;
}
/** Evaluate publication readiness, without claiming that external trades have been independently verified. */
export function publicationCheck(
  state: MarketState,
  instruments: MarketInstrument[],
  now: Date,
): ResearchCheck {
  const today = indiaDate(now),
    reasons: string[] = [],
    conflicts: ResearchCheck["conflicts"] = [];
  if (!declarationCurrent(state, today))
    reasons.push("current_declaration_required");
  for (const instrument of instruments) {
    if (instrument.expiry && instrument.expiry < today)
      reasons.push("expired_instrument");
    for (const trade of state.trades) {
      if (
        !trade.voidReason &&
        sameSecurity(trade.instrument, instrument) &&
        trade.date >= addDays(today, -30) &&
        trade.date <= today
      )
        conflicts.push({
          id: trade.id,
          symbol: trade.instrument.symbol,
          date: trade.date,
          until: addDays(trade.date, 31),
        });
    }
  }
  if (conflicts.length) reasons.push("personal_trade_lookback");
  return {
    allowed: !reasons.length,
    reasons: [...new Set(reasons)],
    conflicts: [...new Map(conflicts.map((c) => [c.id, c])).values()],
  };
}
/** A late self-declaration records a potential breach instead of suppressing the transaction. */
export function tradeWarnings(
  state: MarketState,
  instrument: MarketInstrument,
  date: string,
  side: "buy" | "sell",
): string[] {
  return state.recommendations
    .filter(
      (r) =>
        sameSecurity(r.instrument, instrument) &&
        ((date >= addDays(r.publishedOn, -30) &&
          date <= addDays(r.publishedOn, 5)) ||
          (date >= r.publishedOn &&
            (!r.closedOn || date <= r.closedOn) &&
            (r.direction === "hold" || r.direction !== side))),
    )
    .map((r) => r.id);
}
