# Fix StocksBuddha plan research access

Correction applied and verified against the local development database on 19 November 2026. This document records the original state, targeted correction and remaining UX observations.

## Intended behavior confirmed by the owner

| Plan     | Research access                                                         |
| -------- | ----------------------------------------------------------------------- |
| Silver   | Equity only                                                             |
| Gold     | F&O only: Futures and Options                                           |
| Platinum | Equity, Futures, Options and Hedges (all currently supported offerings) |

The current offering model has only `equity`, `futures`, `options`, and `hedges`. Do not interpret “everything else” as automatic access to future categories. Clarify whether derivative hedge research should also belong to Gold before expanding Gold beyond the explicitly confirmed Futures/Options mapping.

## Original local state (rechecked before correction)

Tenant slug: `stocksbuddha`.

- Silver: no rows in `research_plan_offerings`.
- Gold: `equity` only.
- Platinum: no rows in `research_plan_offerings`.
- Two active, verified investors have paid development Gold subscriptions with agreements, expiring on 10 and 12 December 2026 respectively. Both have only `equity` in `research_order_offerings`.

The Gold equity grants were added during troubleshooting to unblock a dummy equity recommendation, before the owner clarified the intended plan structure. The earlier troubleshooting assumption was incorrect. KYC and payment are not the blockers.

Relevant IDs for targeted local verification:

- Tenant: `a1b87125-42b7-4d6d-8715-78721c436a82`
- Silver: `3302fc23-a7fa-4e7e-b5cb-8e6c21e83344`
- Gold: `91dd7491-a1e4-4e9a-923b-9f901150966a`
- Platinum: `d39001e0-5f8c-4e97-9334-9db41f81d47e`
- Paid development Gold orders: `b37e9bee-1fc8-4651-a8c0-111c963a4a5a`, `41eccef6-265a-4d1f-ad54-1e90a04b691d`.

## Why this happens

Plan offerings and purchased offerings are separate. Checkout freezes the selected plan's offerings into `research_order_offerings`. Later plan changes do not rewrite purchased grants. The publisher requires the requested offering on the same current paid, agreement-backed order that matches the selected plan, together with active subscriber membership and acceptable KYC.

A plan name, verified KYC, or payment alone does not confer an offering. Changing only `research_plan_offerings` will not repair existing subscriptions. Previously created quotes also retain their original offering snapshot.

## Correction procedure (completed 19 November 2026)

1. Recheck the local state; do not assume the observations above remain current.
2. Set the StocksBuddha plan mappings to the intended table above. These are tenant-specific settings, not global rules inferred from names such as Gold.
3. Correct the two identified existing development Gold orders: remove the mistakenly added Equity grant and add Futures/Options, preserving payment, agreement and subscription dates. Use a transaction with explicit local/dev/tenant/order checks and record the before/after changes. Do not apply this as an unreviewed production backfill.
4. Inspect existing quotes and any published recommendations before changing grants. Do not silently rewrite signed agreements or revoke historical publication grants. Explain any legacy inconsistency requiring a separate decision.
5. Check whether the plan management UI makes included research offerings clear and whether recipient preview can explain missing offering access instead of only showing zero recipients.
6. Verify that new checkout freezes the configured offerings and that existing purchase snapshots remain unchanged except for the explicitly targeted correction.

## Applied changes and verification

The correction ran in one transaction restricted to a loopback development database, the exact active StocksBuddha tenant, the three named plan IDs and the two paid development Gold order IDs above.

| Record                      | Before    | After                            |
| --------------------------- | --------- | -------------------------------- |
| Silver plan                 | No grants | Equity                           |
| Gold plan                   | Equity    | Futures, Options                 |
| Platinum plan               | No grants | Equity, Futures, Options, Hedges |
| Both identified Gold orders | Equity    | Futures, Options                 |

The actual checkout snapshot function was exercised for all three plans inside rolled-back savepoints. Each copied exactly the configured offerings. The actual offering eligibility function confirmed both existing Gold members qualify for Futures and Options, and neither qualifies for Equity or Hedges. No current paid Silver or Platinum investors exist locally, so their end-to-end recipient delivery was not exercised.

Full subscription order records were compared before/after and remained identical, including payment, agreement evidence, encrypted snapshots and subscription dates. Unrelated purchased grants and all research items, revisions, recipients and deliveries were also verified unchanged. No recommendation was published for testing.

Two expired Gold quotes retain their original empty grants; future purchases should use fresh quotes. The previously published **Reliance** Equity report (`8d8b04a5-17d2-4f26-9fb3-dee31b0219aa`) already has frozen recipient grants for both Gold investors. Those historical grants remain intact under the published-report retention policy; this correction affects eligibility for new recommendations. Removing or changing that historical delivery would require a separate explicit decision.

The Market Setup UI already exposes the four offering checkboxes per plan and explains that edits apply to future checkouts. No UI changes were needed for the original data correction. The subsequent recommendation repairs added aggregate recipient exclusions for groups, KYC, subscription/offering eligibility and selected plans. These counts do not expose individual investors' missing grants. See [the repair retest](audits/recommendations-2026-11-19/RETEST.md).

## Acceptance criteria

- Eligible Silver investor receives Equity, not Futures/Options/Hedges.
- Eligible Gold investor receives Futures/Options, not Equity.
- Eligible Platinum investor receives every currently supported offering.
- The two existing Gold test investors qualify for F&O after correction without repurchasing.
- An Equity recommendation targeted only at Gold correctly has zero eligible recipients.
- KYC, current paid period, agreement, membership and tenant isolation remain enforced.
- Groups do not override purchased offerings.
- Plan edits do not silently change unrelated existing subscriptions or delivered report history.

## Implementation references

- `backend/src/research/service.ts`: recipient eligibility and publication checks.
- `backend/src/market/service.ts`: plan offering configuration.
- `backend/src/onboarding/service.ts`: checkout and frozen order offerings.
- `packages/contracts/src/market.ts`: supported offering categories.
- `docs/RECOMMENDATIONS.md`: publication and historical access behavior.

The separate SEBI review findings from this chat (complete report disclosures/identity, signing, fair distribution and evidence retention) remain outstanding. Correcting plan mappings does not resolve or certify those broader compliance requirements. No production recommendation should be published merely to test this handoff.
