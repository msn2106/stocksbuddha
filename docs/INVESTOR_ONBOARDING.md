# Investor onboarding, plans and payments

Implemented locally on 8 November 2026. The complete development journey is available; this is not a certification of regulatory compliance or authorization to collect live money. Read [the SEBI RA review](SEBI_RA_REVIEW.md) before production activation.

## Journey

Public investor signup collects full name, phone, email, password and password confirmation. Phone collection does not verify the phone. Email verification and explicit subscriber enrollment remain required; account creation never grants staff access. Invitation-based staff setup retains its existing fields.

The investor dashboard shows KYC → plan/MITC → payment. Open `/ra/<slug>/account/onboarding` to continue. The initial scope is individual investors aged 18 or older, with individual PANs. HUFs, companies, minors, institutional and other special cases need separate workflows; do not route them through this individual form.

1. Verify the mobile by OTP, then enter legal name, the verified phone, PAN and DOB; upload PAN evidence; declare the accuracy of identity/family details and consent to KYC processing.
2. Submit to the RA. The investor sees `pending`, `changes`, `rejected`, `verified` or distinctly labelled `skipped_dev`.
3. The RA Admin opens **Users** → **Edit user**, requests corrections or performs a manual KFIN check. Approval requires the current submission version, `KYC VALIDATED`, a reference and a separate retained KFIN evidence document. The original PAN upload cannot serve as verification evidence. The review form explains that a separate screenshot or PDF of the KFIN result is required for approval; missing or malformed evidence IDs return `verification_evidence_required` rather than the generic `invalid_id`. Requesting changes or rejecting does not require this upload. A reason is optional for approval and requires at least five characters for changes/rejection. Other KRA statuses currently require remediation; the status acceptance policy needs compliance approval.
4. Choose a plan and optionally apply a coupon. The server freezes the price, discount, tax, duration, offering and approved terms into a thirty-minute checkout. Only one active subscription or unresolved checkout is allowed per investor/RA.
5. Review terms including MITC, explicitly consent, type the verified full name and confirm the code sent to the verified mailbox. Ten-minute codes are bound to the order and agreement hash, limited to ten failed attempts per checkout, with at least one minute between sends and ten code requests per identity per hour across checkouts. Resending does not reset the attempt counter.
6. The exact agreement and consent record are rendered to PDF and privately archived before payment can begin. A Drive failure is resumable by retrying **Pay with Cashfree**, without consuming another code or changing the signature.
7. Pay through Cashfree hosted checkout. A verified zero-total checkout follows the same signing/evidence requirements but does not contact Cashfree.
8. The server confirms payment independently, activates the fixed-duration subscription and queues the commercial invoice/receipt and email. Downloads and email use canonical archived PDF bytes. The UI shows document preparation until the invoice is available.

Payment is deliberately after consent. Existing subscriber membership permits the dashboard and owned document access; it is not proof of paid research entitlement. Future research-delivery endpoints must invoke `OnboardingService.canUseResearch` and enforce their own resource authorization. No research-delivery endpoint is introduced by this change.

## RA administration

An active tenant `owner` (RA Admin) sees **Users** and **Plans and discounts**. Platform ownership alone, Analyst and Support do not grant these APIs. Existing Support upload/read permissions on customer KYC/MITC documents remain unchanged; Support cannot approve KYC or manage offers.

- `/ra/<slug>/workspace/plans`: up to 100 plans and 500 coupon records per RA, plus reviewed agreement/billing settings.
- `/ra/<slug>/workspace/users`: active subscriber roster, fifty records per page, with masked PAN; use **Load more users** for subsequent pages.
- `/ra/<slug>/workspace/users/<membership UUID>`: full authorized detail, admin-assisted editing and KFIN decisions. IDs from other RAs cannot be used.

Plans have name, offering, 1–365 days, integer-paise fee, tax basis points and active status. Coupon codes contain 3–32 letters, numbers, hyphens or underscores, without spaces (for example `DIWALI10` or `DIWALI-OFFER`); they are saved in uppercase. Invalid codes receive a specific format message. Coupons have fixed-paise or whole-percentage discounts, optional eligible plan, UTC validity dates, total limit, per-investor limit and active status. Tax is rounded once on discounted fees. Total cannot be negative. Active checkout reservations count toward coupon/family limits; cancelling an unpaid checkout releases its reservation. Gateway-pending reservations remain until the provider confirms payment or terminal unpaid expiry/termination.

Optimistic versions reject stale plan/coupon/terms/KYC changes. Edits affect future quotes; a checkout already signed retains its original terms until expiry. Deactivation stops new quotes and does not change existing subscriptions. Admin edits to pre-payment KYC invalidate unfinished agreements. A gateway-pending payment blocks KYC edits to avoid losing a genuine payment. After any paid order, PAN, DOB, legal-name, KYC-mobile or family-identity changes require a separate compliance-controlled process and are blocked by this UI. Historical evidence is never overwritten. Administrators cannot consent or enter a signing code on behalf of the investor.

The advanced family declaration groups dependent investors by the earning family member's PAN. The server counts paid research fees (excluding configured tax) over a conservative rolling 366-day window plus unresolved reservations. Default maximum configurable allowance is INR 151,000. This only covers records in this system and depends on truthful declarations; externally collected fees and historical imports must be reconciled before production. There is no automated verification of family relationships.

## Agreement templates

New RA agreement editors start with an editable, unreviewed sample and placeholders. **Load sample agreement** replaces the editor wording and clears its review checkbox while preserving contact/billing fields. Saved custom wording is preserved on load. Editing wording also clears the review checkbox; the RA can replace the entire text with its own agreement. The sample is a starter draft, not certified standardized MITC: complete RA-specific disclosures, incorporate the current approved MITC and remove the drafting note before live use. Nothing is saved or approved automatically.

Each RA saves its approved plain-text research-service terms including MITC (500–30,000 characters), contact, address, applicable GSTIN and family fee allowance. Checkout is unavailable until the RA marks the terms reviewed and a registration number exists in the tenant profile. This checkbox records an operator assertion; it does not independently validate SEBI registration or certify the wording.

Handlebars compiles a server-owned envelope plus the RA's terms. The envelope includes investor identity, RA identity/contact, plan offering, duration, all price components and checkout ID. Supported optional data fields are:

```text
{{clientName}} {{clientEmail}} {{clientPan}} {{clientDob}} {{clientPhone}}
{{raName}} {{registration}} {{contact}} {{address}}
{{planName}} {{offering}} {{days}} {{subtotal}} {{discount}} {{tax}} {{total}}
{{date}} {{orderId}}
```

Helpers, arbitrary HTML and unknown placeholders are rejected. Rendered text is displayed as React text and passed to PDFKit; it is never executed as HTML. PDFKit's default font is currently used: production templates require English/Latin text until an approved embedded Unicode font and multilingual PDF visual QA are added. Hindi interface labels are supported, but that does not mean Hindi legal PDFs are supported.

The signature mechanism records typed name, explicit consent, email-code proof, authenticated identity/membership, time and agreement hash. It does not produce a CCA certificate or cryptographically signed PDF. It must not be advertised as Aadhaar/CCA eSign. Production signing is disabled without explicit deployment approval; see the compliance review.

## Storage and data protection

Migration `1794096000000-InvestorOnboarding` adds seven business tables and `auth_users.signup_phone`. Migration `1794182400000-DocumentStorageLeases` adds `document_storage_leases` for external transfer coordination. Migration `1794268800000-MobileVerification` adds six private SMS/recovery tables; `1794355200000-RecoveryEmailLimits` adds the email reset-send ledger; `1794441600000-TenantIntegrations` adds private Telegram/payment settings and expands SMS template storage. There are now nineteen application migrations and twenty-nine total tables including migration metadata:

| Table                   | Responsibility                                                                           |
| ----------------------- | ---------------------------------------------------------------------------------------- |
| `ra_agreement_settings` | Versioned RA-approved terms/billing identity                                             |
| `subscription_plans`    | Tenant-owned plan revisions                                                              |
| `discount_codes`        | Tenant-owned coupon definitions                                                          |
| `investor_kyc`          | Encrypted current identity, provider result and review state                             |
| `kyc_history`           | Encrypted history of every save/submission/decision                                      |
| `subscription_orders`   | Frozen encrypted agreement/identity, prices, signatures, payment and evidence references |
| `onboarding_deliveries` | Durable invoice/email queue with leases/retries                                          |

PAN/DOB and agreement/signature snapshots use AES-256-GCM with random nonces. PAN/family lookups use tenant-bound keyed hashes. Configure a stable `ONBOARDING_DATA_KEY` with 64 lowercase hexadecimal characters. MariaDB SMS startup now requires that retained key in development too. The standalone onboarding service retains its old development fallback only for isolated callers; it does not remove the runtime requirement. Back up the selected key privately with the database and Drive objects. Changing or losing it makes stored evidence unreadable and breaks keyed lookup continuity; key rotation needs a migration, not an environment-only edit. Never copy development data/skips to production.

PAN and KFIN uploads remain document kind `kyc`. Generated agreement and invoice/receipt files belong to the `mitc` agreement-paperwork category under `Customer/<membership UUID>/`; each has its own file ID and descriptive filename. No public Drive links are returned. Generated-document methods are backend-only, derive targets from the signed/paid order and cannot be invoked through arbitrary customer upload inputs. Original PDF bytes are retained and hash-verified on reads. Inaccessible customer documents remain inaccessible after payment.

Application audit events contain identifiers and action names, not PAN, DOB, code or full agreement text. Encrypted KYC history retains the full review facts. Drive is not WORM storage; external sharing/deletion, backups and regulatory holds need operational controls.

## Environment and activation

The backend `.env.example` documents the settings. Apply migrations explicitly; no migration runs during startup:

```sh
npm run db:migrate -- --target dev
npm run db:migrate:status -- --target dev
npm run dev
```

```dotenv
# Generate once and retain privately. Never use this placeholder as a key.
ONBOARDING_DATA_KEY=replace-with-64-lowercase-hex-characters
ONBOARDING_DEV_SKIP=true
ONBOARDING_PRODUCTION_APPROVED=false
# Server-only JSON: use separate credentials for each RA's merchant account.
# CASHFREE_MERCHANTS_JSON={"stocksbuddha":{"clientId":"...","clientSecret":"...","mode":"sandbox"}}
```

`ONBOARDING_DEV_SKIP=true` is honored only with `DB_ENV=dev` and a non-production `NODE_ENV`. Both KYC and MITC UI skips record development provenance; direct skip requests are forbidden in production. Development orders are watermarked and cannot be charged through a live Cashfree merchant. Sandbox gateways are forbidden by the production runtime. Live gateway configuration requires `NODE_ENV=production`, `DB_ENV=prod` and `ONBOARDING_PRODUCTION_APPROVED=true`. That flag must stay false until the review findings are resolved; it is not compliance certification.

Use a different Cashfree merchant account/credential configuration for each RA unless a separately approved marketplace/split-settlement model is introduced. Credentials are never stored in public tenant configuration, returned to browsers or supplied through the RA UI. The checkout SDK loads only from `https://sdk.cashfree.com/js/v3/cashfree.js` when the investor starts payment; deploy CSP and gateway domain/return URL settings accordingly.

Configure the webhook URL in the relevant Cashfree merchant dashboard as `https://<app-origin>/api/onboarding/webhooks/<ra-slug>`. The endpoint verifies HMAC over raw bytes with that RA's secret, then re-fetches provider order/payment state and checks INR, exact amount and success before activation. Do not treat the browser return URL as proof. Configure Hostinger SMTP and private Google Drive credentials separately; absent integrations fail closed. No real gateway credentials, merchant provisioning, deployment or live customer email/payment is created by automated tests.

## Operations and recovery

Every ten seconds the runtime leases up to five delivery jobs; every sixth tick it reconciles up to twenty pending payments, rotating by last reconciliation attempt to avoid starving newer orders. Multiple runtimes serialize mutations on the tenant row and coordinate delivery with database leases. Shutdown stops the worker before closing its pools.

- An authenticated investor can use **Check payment status** after returning from Cashfree, including for a late genuine payment.
- Repeated signed/paid callbacks do not create another subscription or delivery job.
- An expired quote cannot initiate payment. A gateway-pending order is cancelled locally only after the gateway confirms terminal unpaid state. Provider failures retain the reservation for reconciliation.
- Payment success and the delivery queue commit together. Invoice/SMTP failure leaves payment successful and retries delivery after fifteen minutes, with a five-minute worker lease for crash recovery.
- Email is at-least-once: SMTP acceptance followed by a lost DB acknowledgment can produce a repeated email. Attachments remain identical. Monitor retrying deliveries and unresolved payment records before launch.
- Drive upload and MariaDB commit are not atomic; existing orphan-object reconciliation rules still apply. Evidence writes serialize with the tenant storage lease, recheck the tenant/order before committing, and reuse an existing order evidence reference on retries.
- Refund/cancellation requests after payment require an operational RA process. This slice has no Cashfree refund API, credit-note ledger or self-service paid cancellation; do not launch without completing that workflow.

The generated invoice is a commercial invoice/payment receipt, not a verified GST tax-invoice implementation. Tax registration, place of supply, tax component split, legally required numbering/fields and credit notes need review and implementation before taxable production billing. Do not relabel the receipt as a compliant tax invoice.

## Future verification providers and Aadhaar

`backend/src/onboarding/verification.ts` defines a backend provider contract with normalized status, original status, provider reference, evidence, tenant/member and submission version. No CVL/API integration is active. Current decisions are explicitly manual KFIN decisions. A future adapter must authenticate callbacks, bind results to the current submission, reconcile retries and preserve provider evidence; a vendor string supplied by the browser must never grant approval.

The encrypted profile and evidence references can be extended for separate PAN/Aadhaar document types without making vendor IDs part of UI state. Aadhaar is not collected or implied to be mandatory today. Add the applicable UIDAI consent, masking, access/retention and permitted verification mode before enabling collection.

## Verification

```sh
npm run test:unit
npm run test:coverage
npm run typecheck
SENTRY_AUTH_TOKEN='' npm run build # local validation without source-map upload
npm run test:e2e
npm run test:e2e:organisations
```

`onboarding-domain`, `onboarding-service` and `onboarding-routes` tests cover validation, encrypted evidence, controlled in-memory workflow adapters, authoritative roles, HTTP bodies/origins, pricing, consent, signing-code limits, canonical PDFs, payment replay, late callbacks, terminal-state recovery and mail retries. The in-memory SQL test adapter is not MariaDB proof. `tests/organisation/onboarding-flow.ts` runs real migrations, MariaDB, real authentication, browser forms and an in-memory Drive/payment/mail boundary, including corrections, KFIN approval, discount-before-signature, payment-before-consent denial, invoice delivery, tenant/customer isolation, mobile screenshots and axe. The separate disposable MariaDB suites retain constraint and authentication regression coverage. No live money, external email, KFIN request or Drive customer upload is used in automated tests.

## Recommendation eligibility and administrator recovery

Subscriber recommendation metadata and downloads share the same eligibility query as `canUseResearch`: current verified KYC (or explicitly permitted development KYC), an active paid date range, an archived agreement reference and no development order in production. Staff document permissions remain role-scoped. Historical KYC and `mitc` agreements/receipts remain accessible to the owning active member after subscription expiry. Downloads reauthorize after external I/O; expired eligibility or revoked authorization prevents releasing bytes.

RA Admin onboarding pages show up to 100 payment/delivery jobs, with payment status, delivery status, attempts, queue date and next attempt. `GET /api/workspaces/:slug/onboarding/jobs` returns status only after fresh tenant-admin authorization. `POST /api/workspaces/:slug/onboarding/retry-job` takes `{"orderId":"<uuid>"}` and the same Origin/session protection as other writes. A paid, unsent delivery without a live lease is requeued for the worker; a pending payment is reconciled with the provider. Sent jobs cannot be resent through this action. Retry requests are audited. A retry does not mean the provider recovered or that email reached an inbox.

Background delivery, reconciliation, worker and post-upload metadata failures emit sanitized fixed Sentry classifications. Queue-age warnings begin after one hour (delivery age from payment, pending payment age from order creation), checked every sixth worker tick and throttled to once per fifteen minutes per process. Configure Sentry routing and an independent process/worker monitor before deployment; an offline worker cannot report its own queue. See [Sentry operations](SENTRY.md) and the [ordered rollout plan](ROLLOUT_PLAN.md).

## Mobile OTP

New KYC submissions, manual approval, quotes and signing/payment transitions require verification of the exact phone. Legacy paid services remain available while subscribers are prompted to verify. Phone verification is separate from KRA status and agreement consent. See [the complete SMS flow, private RA configuration, global recovery boundary and limits](MOBILE_VERIFICATION.md).

Cashfree can also be configured through the private **Payment Gateway Settings** tab. A saved record overrides environment fallback (including an explicit disable). Merchant settings lock after any non-cancelled checkout order to preserve payment-account continuity. The production activation gate remains unchanged. See [private integration settings](WEBSITE_EDITOR.md#private-service-settings).
