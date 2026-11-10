# QR payments and Cashfree

Implemented for local review on 10 November 2026. This release adds an RA-owned static QR option alongside the existing Cashfree hosted checkout. QR confirmation is manual. Production activation and the unresolved requirements in [SEBI_RA_REVIEW.md](SEBI_RA_REVIEW.md) still apply.

## RA setup

Open **Website configuration → Payment Settings**. The QR and Cashfree sections save independently of each other and of website publication.

1. Enter the payee name, UPI ID and optional instructions.
2. Upload a PNG or JPEG of the RA's receiving QR, up to 1 MiB. The application checks the file type, signature and size; it does not decode the QR or verify that the image encodes the entered UPI ID. The RA must check both, and the investor must check the payee displayed by the UPI app.
3. Enable QR payments and choose **Save QR settings**. Upload, replacement and removal have a preview and participate in the editor's unsaved-change guard. Removal also disables QR.
4. Configure the RA's own Cashfree merchant credentials separately if online checkout is offered. Cashfree merchant settings lock once a Cashfree session/method or legacy payment reference binds the account, including retained cancelled sessions. Quoted/signed orders without Cashfree evidence, QR payments and no-charge orders do not block Cashfree setup. Production gates remain unchanged, and the Cashfree lock does not lock QR settings.

Only an active verified RA owner with supported capability settings can manage QR settings. Platform ownership alone, Analyst, Support and investors cannot manage them. No image or payment configuration is added to public website snapshots.

## Investor flow

KYC → plan/discount quote → agreement/MITC consent → archived agreement → payment.

After signing, QR is selected by default when enabled and permitted by the deployment gate; Cashfree appears second. Unavailable methods have an explanation. When QR is unavailable, Cashfree is selected. A zero-total order keeps the existing no-charge confirmation and does not create a payment attempt.

Selecting the QR radio does not start a payment. **Show QR and pay** reserves the exact signed amount and freezes a copy of the QR, payee, UPI ID and instructions for that order, then reveals the QR and download link. Existing attempts remain readable if the RA later replaces, removes or disables its current QR. Cashfree cannot be started for that order once a QR attempt exists, and a Cashfree-pending order cannot switch to QR. The UI explains this before starting.

The investor submits a 6–40 character alphanumeric UTR/transaction reference, local payment date/time and PNG, JPEG or PDF evidence up to 2 MiB. The backend normalizes references to uppercase and rejects a reference already claimed anywhere within that RA, including a rejected historical claim. Evidence and reference cannot be edited after submission; repeating the identical request is harmless. Contact the RA to resolve mistakes. References are claims, not automatic proof of funds received.

Payment time cannot precede attempt creation by more than a minute or exceed server time by more than a minute, allowing minute-resolution date inputs. The claim can be submitted and reviewed after the original thirty-minute checkout expires. The UI tells investors with expired checkouts to submit proof if already paid and otherwise contact the RA before transferring. No new QR attempt can start on an expired quote.

Unstarted quoted/signed checkouts expire after thirty minutes. Expiry is independent of whether QR/Cashfree credentials are saved. The investor sees an explicit expiry notice with **Choose a plan again**, and the plan form is available again. A fresh quote uses current pricing and terms and requires new MITC consent; existing expired agreement/order records remain unchanged. An open page updates at the checkout deadline. An already-pending QR or Cashfree attempt keeps its existing proof/status recovery and cannot be replaced just because the quote deadline passed.

The investor sees **Awaiting payment verification** after submission. Research access remains unavailable until payment approval and all existing eligibility conditions are satisfied.

## RA review and recovery

**Users** and **Plans and discounts** show **QR payment reviews**, separately from Cashfree reconciliation/delivery jobs. The queue returns up to 100 unresolved attempts, with submitted proofs first and older attempts first within each group. Refresh to see decisions made in another window.

- Open **Review payment**, inspect the frozen payee, amount, claimed time and UTR, and download the original proof as an authenticated attachment.
- Check the receiving bank account independently. Enter a review note (visible to the investor) and explicitly confirm the bank/amount check.
- **Approve received payment** requires submitted proof. Approval atomically marks the order paid, records the reviewer/time/note, activates the fixed-duration subscription and queues the existing canonical commercial receipt/email. The service period begins at approval; the claimed transaction time remains separate evidence. The receipt identifies QR and the retained transaction reference.
- **Reject / close claim** can close a submitted claim or an abandoned attempt without proof. This cancels that checkout and releases its reservations. The investor can see the reason and begin a fresh plan/agreement checkout. Do not reject received funds merely to switch methods; resolve the payment/refund with the investor first.
- Reviews require the current version. Repeated or stale approval cannot activate a second subscription or enqueue another receipt. Bank checks and notes are operator assertions, not bank API verification.

Started QR attempts do not auto-expire or auto-cancel: funds may already have arrived. The RA must review abandoned attempts to release reservations and permit a new checkout. Pending QR attempts block KYC edits and other unresolved checkouts just like pending gateway orders. The Cashfree worker excludes QR records; the general job list directs pending QR payments to the review queue. The existing aged-pending-payment monitoring includes QR attempts. Paid QR receipt/email jobs retain normal retry support.

Static QR transfers cannot be prevented after an order is closed or if a person reuses a downloaded QR. Duplicate bank transfers, wrong amounts, wrong payees, disputes, refunds and mistaken rejection of genuine payments require an RA operating process; this release does not automate bank reconciliation or refunds. Retained rejected claims are not erased or reassigned to another order. Resolve them operationally rather than editing the database to bypass deduplication.

## Storage and migration

Apply `1794528000000-QrPayments` explicitly before running this version:

```sh
npm run db:migrate -- --target dev
npm run db:migrate:status -- --target dev
```

This is migration 20. There are 31 tables including migration metadata. The migration adds:

- `subscription_orders.payment_method` (`qr`, `cashfree`, or null for older/no-charge orders), backfilling existing Cashfree sessions.
- `ra_qr_settings`: independently versioned, encrypted current QR configuration.
- `qr_payment_attempts`: order/tenant-bound frozen QR configuration, encrypted claim/proof and review note, tenant-keyed reference hash with a uniqueness constraint, status/version, reviewer and timestamps.

These bounded images and proofs are stored as encrypted base64 JSON in MariaDB `MEDIUMTEXT`, using the retained `ONBOARDING_DATA_KEY`; they are not Google Drive documents. Each attempt retains its own QR snapshot. Include these tables and the retained key in encrypted backups, capacity planning, access/retention policy and restoration tests. A database backup without the key cannot restore readable evidence. No delete endpoint or destructive migration rollback is provided.

Proof downloads authorize the current verified session, active tenant and investor ownership or RA owner role, and return `Cache-Control: no-store`, attachment disposition and `nosniff`. PDFs are never rendered inline. Raster QR previews are authenticated private data. Files are signature/size checked, not malware-scanned. Audit events record IDs and actions, excluding reference, file contents and review notes.

Live QR initiation and approval require the same production signing/payment approval and provenance gates as the existing onboarding flow. Development orders display a synthetic-evidence warning. Use synthetic images and evidence in development; never transfer money to test these screens. Saving configuration does not activate live payments.

## API and verification

All routes are under `/api/workspaces/:slug/onboarding`. Mutations require the current session and matching Origin; business methods recheck active roles under tenant locks.

| Method     | Route                   | Purpose                                                      |
| ---------- | ----------------------- | ------------------------------------------------------------ |
| GET / POST | `/qr-settings`          | RA owner reads/saves versioned configuration                 |
| POST       | `/qr-start`             | Investor starts/resumes an agreement-bound attempt           |
| POST       | `/qr-submit`            | Investor submits immutable claim and evidence                |
| GET        | `/qr-payment/:id`       | Authorized investor/RA reads frozen details and review facts |
| GET        | `/qr-payment/:id/proof` | Authorized attachment download                               |
| GET        | `/qr-payments`          | RA unresolved review queue                                   |
| POST       | `/qr-review`            | Versioned, bank-checked owner approval/rejection             |

Only QR settings/submission accept JSON up to 3 MiB; the other onboarding actions retain their 64 KiB limit. Image/proof-specific limits are also enforced after decoding.

Onboarding, SMS and private integration authorization acquire user/session/tenant/membership locks in a consistent order, avoiding the session/user inversion found during concurrent browser requests. Browser cases also exercise concurrent mobile/onboarding and QR/Cashfree settings reads.

Unit tests cover file validation, encryption, role/tenant/customer boundaries, versions, MITC gating, frozen settings, references, dates, late proof/review, method locking, no-charge checkout, production gates, worker exclusion and exactly-once activation. UI component tests cover selection, uploads, settings changes, failures and manual review. `tests/organisation/qr-payments-flow.ts` exercises real authentication and migrations in disposable MariaDB with browser uploads, rejection/retry/approval, private proof downloads, responsive screenshots and axe scans. Agreement storage, email and Cashfree are controlled test adapters; no live bank confirmation is performed.

### Local verification, 10 November 2026

- 298 unit tests passed; the whole-repository coverage gate passed with strictly greater than 90% for every executable file and metric.
- All 16 organisation/onboarding Playwright cases passed, including the existing Cashfree journey and the new QR settings, rejection, retry, approval, proof privacy and concurrent-read/version-conflict cases.
- Real MariaDB foundation/migration/constraint/auth tests passed (18 tests including the parent suite); the separate SMS concurrency/recovery regression passed too.
- Lint, formatting, TypeScript, changed-runtime JSDoc checks, production builds and migration bundle generation passed. Sentry source-map upload was disabled for the build.
- Desktop (1280 px), tablet (768 px) and mobile (390 px) screenshots were captured and reviewed; the QR flow's axe scans reported no violations and the tested views had no horizontal overflow.

All database integration/browser checks used disposable databases. Storage, payment and email boundaries were simulated, with synthetic raster patterns/proofs; no real payment or external email was sent. Request throttles are covered separately and disabled only in the multi-account browser fixture to avoid sharing one loopback request bucket across cases; production limits are unchanged. The initial implementation run left the development database unchanged; the subsequent authorized migration is recorded below.

### Development migration verification, 10 November 2026

At the user's request, a private owner-readable backup was created and `1794528000000-QrPayments` was applied to `stocksbuddha_dev`. Post-migration checks confirmed all 20 migrations applied, 31 tables, no unfinished migration attempts and no Cashfree session missing its backfilled payment method. Both new QR tables were empty; test fixtures were not inserted into the development database.

The application persistence runtime, Better Auth schema validation and database readiness passed against the migrated development database. Fresh regression runs passed all 298 unit tests and the per-file coverage gate, 19 disposable MariaDB tests (foundation and SMS), and all 16 organisation/onboarding Playwright cases. The runtime smoke check was closed after validation; it did not leave a development server running. No production database or live payment integration was activated.
