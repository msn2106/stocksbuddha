# Research Phase 1: Market Setup

RA owners open **Workspace → Market Setup** (`/ra/:slug/workspace/market`). Phase 1 provides shared reference instruments, private declarations and recommendation history, restriction previews and research offering configuration. [Phase 2](RECOMMENDATIONS.md) adds the recommendation editor, publication and investor feed; [Telegram delivery](TELEGRAM.md) is available for linked investors; broker connections remain future work.

## Setup and daily refresh

Apply migrations through `1794614400001` and retain `ONBOARDING_DATA_KEY` with database backups. Existing onboarding installations use the same encryption key. No Upstox account, API key or demat account is required for the public instrument files.

```sh
npm run db:migrate -- --target dev
npm run market:import -- --local /absolute/path/to/saved-instrument-folder
# Or download the public NSE/BSE files:
npm run market:import -- --download
```

The local folder needs `NSE.json.gz`, `BSE.json.gz` and the saved `download-manifest.json` for source timestamps. The normalized, compressed snapshot lives in ignored `.data/instruments/current.json.gz` by default. Set `MARKET_CATALOGUE_DIR` to an absolute persistent directory in deployment. Back up the directory and encryption key separately from code.

Set `MARKET_SYNC_ENABLED=true` to run the in-process worker at 06:30 and 08:30 IST. A running process checks once per minute, catches up to the latest due slot at startup and retries failed slots. Run one enabled worker per shared catalogue directory; other instances may read the atomic snapshot. This requires a continuously running Node process. The second slot is a retry/refresh opportunity, not a provider freshness guarantee. Production downloads also require `MARKET_DATA_USAGE_APPROVED=true` following review of provider/exchange permissions for the intended use; a public download URL does not establish redistribution rights.

[Upstox's instrument documentation](https://upstox.com/developer/api-documentation/instruments/) lists the public gzip JSON URLs. The importer supports NSE/BSE equities, futures, calls and puts, with indices for underlying identification. It excludes commodity/currency contracts and non-equity instruments. It imports contract name, symbol, key, exchange, underlying, strike, expiry, lot size and tick size. These are reference contracts, not live option-chain prices, volume, OI, Greeks or investment targets. Rationale, entry, stop and targets belong to RA research, not the instrument master.

Downloads are bounded and parsed before atomic replacement; corrupt, duplicate and unexpectedly small replacements are rejected. The last valid snapshot survives failures. UI separates provider Last-Modified and local import time. Unknown source date or source age over 72 hours blocks restriction approval; no successful download is treated as proof of new source data. Expired contracts are excluded from new searches. Saved records retain their instrument snapshot when contracts later disappear. Historical contracts absent from both the current catalogue and saved records cannot currently be entered: resolve such gaps before confirming completeness. The 72-hour threshold is an application freshness policy, not an exchange SLA.

## Declarations and restrictions

The first declaration covers the preceding 30 calendar days and current holdings. Subsequent declarations cover the period since the previous declaration, including missed days. Dates and day boundaries use IST. Owners enter covered person/account labels, buy/sell dates and quantities, holdings, and recommendations already shared externally with an audience/channel description. Current holdings are snapshots, not a substitute for transaction history. Adding or correcting transactions/holdings invalidates today's declaration while retaining the prior coverage date. The login/workspace reminder remains until confirmed. Corrections retain the old entry and reason; history is encrypted and versioned.

[SEBI RA Regulation 16](https://www.sebi.gov.in/sebi_data/attachdocs/oct-2026/1792127227860.pdf) supplies the 30-day pre-publication / 5-day post-publication trading restrictions, the separate contrary-to-recommendation restriction, covered-person scope and written-approval exceptions. The UI displays the periods and source. Both purchases and sales count. The application conservatively matches stock contracts by underlying ISIN across exchanges and uses inclusive calendar-day windows: a trade on date D blocks publication through D+30; publication on P flags dealing through P+5. Contrary trading remains flagged until an external recommendation is closed. These conservative underlying/direction checks do not perform derivative payoff analysis.

The restriction preview requires a current declaration, unexpired instruments and fresh reference data. It blocks when a reported trade falls within the lookback window. Recording an actual historical trade remains possible even if it conflicts with a prior recommendation: the app saves and flags the conflict rather than losing evidence. There is no broker verification and no ability to prevent external trading. Phase 1 does not implement an exception-approval workflow, pre-IPO controls or the full set of RA regulatory obligations. Review entity/person applicability and written policies before using the publisher operationally.

## Plan access and future publishing

Owners map each subscription plan to equity, futures, options and/or hedge research. Offering grants are frozen at checkout quote time; later plan edits do not modify purchased grants. Existing orders have no automatic backfill. Initial publication combines authenticated tenant membership and audience authorization with the offering eligibility policy, which requires current KYC and paid/agreement-backed entitlement for the requested offering. Development orders cannot qualify in production.

Phase 1 introduced encrypted revision/delivery foundations. [Phase 2](RECOMMENDATIONS.md) invokes restriction and entitlement guards inside publication transactions, retains immutable published reports and exposes them only to authorized recipients. Previously delivered reports remain readable after subscription expiry while active tenant membership remains required. Personal RA declarations never appear in investor projections.
