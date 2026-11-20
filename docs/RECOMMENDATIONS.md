# Research Phase 2: recommendation publishing

RA owners open **Workspace → Recommendations** (`/ra/:slug/workspace/recommendations`). Subscribers see delivered reports on their dashboard and at `/ra/:slug/account/recommendations`. Telegram delivery and broker order placement remain future work.

## Create and publish

1. Complete today's declaration in [Market Setup](MARKET_SETUP.md), using a fresh instrument catalogue.
2. Create a normal recommendation (one leg) or hedge (two to ten legs). Choose equity, futures, options or hedge research; select instruments from the public reference catalogue. Enter direction, horizon, quantity in units, entry range, stop-loss, one to five targets and each leg's rationale. F&O quantities must be multiples of the contract lot size. Option prices represent premiums.
3. Supply a title, overall rationale, material-interest/conflict disclosures, extent of AI use and validity. Optionally attach up to ten existing RA general documents or upload supporting PDF/PNG/JPEG files (10 MB each). Customer-private documents cannot be selected as shared attachments.
4. Select all eligible subscribers, specific plans or saved client groups. Group membership never grants paid access by itself. Delivery currently means the investor dashboard and Recommendations section.
5. Save a complete draft or request a publication preview. The preview shows the exact report, eligible recipient count and declaration/conflict blockers. Confirm publication after reviewing it.

The instrument picker limits normal recommendations to their category (Equity, Futures or Options); hedge legs can search each type independently. Contract expiry is a search filter for Futures/Options only, separate from the recommendation validity deadline. Search and expiry-filter edits preserve the selected instrument until a replacement is chosen. Changing category preserves compatible selections and clears incompatible instruments for replacement. Both hedge entry points create at least two legs. Reopened drafts resolve saved keys to readable instrument details without changing quantities. Search results explain when the preserved selection falls outside the filters. Invalid saves show friendly field and leg labels near the actions and focus the error summary.

Existing drafts open as “Edit draft.” Close, Cancel and Escape offer Keep editing, Save and close, or Discard changes when edits are unsaved. Save and close requires a valid complete form. Browser unload protection is registered while edits are unsaved. Save status appears beside the actions. Empty group audiences are disabled with instructions to create a group.

Previews say “Unpublished preview,” with a proposed version and preview-generation time. Expand the recipient summary to see active candidates and exclusions for group membership, KYC, subscription/offering eligibility and plan targeting. Each candidate is counted under the first applicable exclusion; these are aggregate diagnostics, not every failed check. Historical updates retain the original audience. Report and group panels scroll into view when opened.

Draft saves validate the complete form; incomplete forms are retained in the open editor but are not autosaved. Publication recomputes eligibility and restriction checks within the transaction. Changes to the draft, recipient set, declarations or instrument reference invalidate the preview and require another review. Published reports include a frozen issuer identity, author, instrument details, disclosures, attachments and publication timestamp. No live quotes, target generation, automated outcomes or trading execution are supplied by the instrument master.

## Access and lifecycle

Initial publication requires an active tenant membership, current approved KYC and a current paid, agreement-backed order with the requested frozen research offering. Plan targeting matches that same eligible order; group targeting intersects the same eligible members. Development entitlements do not qualify in production. Legacy orders without frozen offering grants do not gain access automatically.

Publication atomically stores an encrypted immutable revision, the frozen recipient grants, dashboard delivery records and the RA's recommendation register. Investors never receive private drafts, audience lists or personal trading declarations. Reports are tenant scoped and require an active authenticated membership on every read. Opening a report marks its current version read.

The original audience retains the report and subsequent updates/closure notices even after its subscription expires. It receives no new recommendations without current eligibility. Revoked memberships cannot read retained reports. New subscribers are not automatically added to older recommendations.

An owner may edit an active report's prices, rationale, disclosures, files and validity, then preview and publish with a reason. Offering, audience, instruments and trade directions are locked after first publication; a different trade requires a new recommendation. Each publication is an immutable version. Owners may close or withdraw an active report with a reason; finalized reports cannot be reopened. All recipients can inspect publication history. Closing does not erase the five-day post-publication restriction. Register entries originating here must be closed through Recommendations, not the manual Market Setup register.

Attachments are delivered through an authenticated recommendation route, checked against frozen attachment metadata and content hash, and authorized again after private Drive I/O. These report grants are separate from the older per-customer Documents eligibility checks. Private provider IDs and credentials are never exposed.

## Operations and limits

Apply migration 23 (`1794700800000-ResearchPublishing`) before application startup. It adds `research_items`, `research_recipients`, `research_groups` and delivery `read_at`; totals are 41 tables including metadata and 23 application migrations. Preserve `ONBOARDING_DATA_KEY` with backups. Startup does not migrate automatically.

The production publisher respects the existing `ONBOARDING_PRODUCTION_APPROVED=true` review gate. This feature is not a compliance certification and does not replace the existing [production review](SEBI_RA_REVIEW.md). It relies on self-declared personal trading records; there is no broker verification or external-trade blocking. Existing Market Setup policies and their stated limits remain applicable.

Lists are paginated in batches of 20; dashboard cards show the latest three. Recipient previews are bounded to 2,000 candidates; plan/client pickers to 1,000, groups to 100 and available general files to 100. Larger deployments need expanded paging before using those limits operationally. Dashboard delivery is recorded synchronously; no email, Telegram or push notification is sent by this publisher.

The tenant-specific Silver/Gold/Platinum mapping correction is tracked in [the plan access handoff](PLAN_RESEARCH_ACCESS_HANDOFF.md). The local development correction was applied on 19 November 2026: Silver has Equity, Gold has Futures/Options, and Platinum has all four current offerings. The two identified Gold development subscriptions were corrected; previously published recipient grants remain intact.
