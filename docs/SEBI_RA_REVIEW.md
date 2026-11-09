# SEBI Research Analyst implementation review

Review date: **9 November 2026**. Scope: the local investor KYC → plan/discount → terms/MITC consent → Cashfree → documents implementation. This is an engineering review against cited requirements, not legal certification. Production activation remains disabled by default.

## Sources and timing

- [SEBI Research Analyst Master Circular, 6 February 2026](https://www.sebi.gov.in/sebi_data/attachdocs/feb-2026/1770375507051.pdf): fee provisions in 1.9; client terms/consent in 1.12; KYC references in section 19 and Annexure B.
- [SEBI circular, 23 October 2026, effective 8 November 2026](https://www.sebi.gov.in/sebi_data/attachdocs/oct-2026/1792753022042.pdf): replaces interaction-record requirements, retains KYC obligations, and specifies five-year retention with dispute/SEBI preservation extensions. Institutional call-recording relief does not generally exempt retail onboarding records.
- [CCA eSign description](https://cca.gov.in/eSign.html): certificate/provider-based eSign differs from an application's email-code consent record.
- [Cashfree raw webhook verification](https://www.cashfree.com/docs/payments/online/webhooks/signature-verification) and [idempotency guidance](https://www.cashfree.com/docs/payments/online/webhooks/webhook-indempotency): payment integration/security references, not SEBI compliance certification.

## Controls implemented

| Requirement / risk                              | Implementation evidence                                                                                                                                     |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Consent before research fees                    | Payment endpoint requires signed consent and archived agreement; browser/direct-request regression tests reject pre-signature payment                       |
| Accurate discounted price                       | Integer-paise quote freezes offering, base fee, discount, tax, total and duration before consent; gateway amount/currency must match                        |
| Manual KYC has an attributable decision         | RA Admin-only current-version review; separate KFIN evidence, provider result/reference, time and encrypted review history                                  |
| Tenant/client confidentiality                   | Current verified sessions and memberships, role checks, tenant-scoped queries, encrypted identity snapshots, masked roster PAN and download denial tests    |
| Consent evidence survives later edits           | Exact rendered text/hash, typed name, email-code proof, identity, timestamp and immutable private PDF; emailed attachment equals archived bytes             |
| Development shortcuts cannot collect live funds | Explicit dev-only configuration, server rejection in production, development provenance/watermarks and live-gateway rejection                               |
| Fee/advance controls                            | 1–365-day plans, configurable conservative family fee ceiling, family declaration and serialized reservation checks                                         |
| Payment evidence and recovery                   | Merchant-specific HMAC, authenticated reconciliation, amount checks, idempotent activation, durable document/email queue                                    |
| Active research eligibility                     | Shared eligibility query enforces current KYC, active paid period, archived agreement and provenance on recommendation lists/downloads and `canUseResearch` |

## Findings that block production activation

1. **Signing method needs legal acceptance.** Typed name plus email OTP creates an attributable consent record but not a CCA digital certificate or digitally signed PDF. Validate the mode under the applicable RA/IT Act rules or integrate a suitable signing provider while retaining this website experience. A configuration flag cannot make an unsuitable method legally acceptable.
2. **The complete KYC procedure is not certified.** PAN/DOB/upload and a KFIN status screenshot are the current collection/review mechanism, not proof that every KYC/AML/KRA requirement has been satisfied. Confirm intermediary access, retrieval/registration/update duties, required additional information, identity/address checks, applicable declarations and treatment of non-validated statuses. Current `KYC VALIDATED`-only approval is conservative and may over-restrict otherwise acceptable clients. No automatic KFIN/CVL submission or KRA record upload is implemented.
3. **Each RA must supply approved complete terms, including MITC.** The system validates structure and records the RA's review assertion; it cannot substantively certify the wording, disclosures, fee provisions, grievance contacts or registration. The editable starter draft is not a certified standardized MITC; new settings start unreviewed, and modifying or reloading the sample clears the review checkbox. Saved custom terms are preserved. No legacy single-RA template is silently copied. Review actual values and the configured signing method before enabling live checkout.
4. **Paid cancellation/refunds are not automated.** The current UI can cancel only pre-gateway checkouts. Complete proportionate refund handling, gateway refunds, failed-refund recovery, records and credit notes; publish the policy. An operator process must be in place until software handles it.
5. **The generated commercial invoice/receipt is not a certified GST invoice.** It lacks a complete reviewed place-of-supply/component-split/tax-numbering/credit-note implementation. Confirm each RA's registration and billing obligations and implement the required tax invoice. Cashfree's merchant-fee invoice does not replace the RA's invoice to an investor.
6. **Regulated retention and restoration remain operational gaps.** Private Drive files, hashes and application no-delete behavior do not prevent storage administrators from modifying/deleting records. Establish five-year retention and holds, backups of both DB and objects, recovery of encryption keys, tested restoration and access controls. Retain required customer communications outside this application too.
7. **Family fee aggregation has external dependencies.** The app uses declared earning-member PAN and only its own orders. Verify family grouping, previous collections, parallel/offline sales, imports, current applicable ceilings and any client-category exceptions. The configured allowance does not certify completeness of those inputs.
8. **Live integrations and deployment have not been proven.** Provision each RA's merchant setup, secrets, return/webhook URLs, production Drive OAuth, mailbox delivery and queue monitoring; test controlled real-provider settlement/reconciliation before release. Automated tests use fake payment/Drive/mail boundaries. No real money was taken.

## Additional limitations and follow-up controls

- The initial client model supports adults with individual PANs; minors, HUFs, companies, NRIs requiring distinct checks and institutional categories are not fully modeled. Do not assume a valid individual PAN alone establishes eligibility for all these cases.
- Mobile OTP is now required for new KYC submissions and checkout, independently of KRA/consent. Existing clients are prompted without cancelling paid services. See [the mobile-specific RA audit](MOBILE_VERIFICATION_AUDIT.md) for transport isolation, evidence and activation conditions.
- PAN/DOB/name/mobile/family corrections after a paid record require a separate controlled process. The current API blocks these material changes rather than rewriting signed history or bypassing fee aggregation.
- Default PDF fonts are not suitable for arbitrary multilingual legal text. English/Latin template review and PDF visual QA are required; add embedded fonts before Hindi legal PDFs.
- Financial and KYC server endpoints enforce their own state transitions. Recommendation lists/downloads now enforce the shared eligibility guard. Apply the same guard to any additional research-delivery endpoint. Historical agreements/receipts remain available to active members without an active subscription.
- Existing Support document access is unchanged and distinct from RA Admin approval. Review least-privilege role policy, administrator MFA and operational account access before launch.
- Email delivery is at-least-once and should be monitored; do not equate an SMTP request with guaranteed inbox receipt. Repeated emails can occur after a lost acknowledgment.
- Uploads are not malware-scanned. Files download as attachments. Add quarantine/scanning before introducing document parsing or inline previews.
- Dependency audit results and exact test evidence belong to the current verification run; historical README audit notes must not be treated as today's result.

## Activation decision

Keep `ONBOARDING_PRODUCTION_APPROVED=false` while the blocking findings remain unresolved. Development/sandbox use can proceed with synthetic evidence. Resolving these findings is a prerequisite to a live RA rollout; passing software tests alone is insufficient.

## Four-finding remediation, 9 November 2026

1. Recommendation delivery now enforces eligibility, including a second check after Drive I/O before returning bytes. Staff access and historical agreement/receipt access retain their existing role and tenant boundaries.
2. Background failures now emit fixed sanitized Sentry events; one-hour queue-age warnings and tenant-admin status/retry APIs/UI provide recovery evidence. Production alert routing, worker liveness and provider ingestion still require deployment verification.
3. Uploads and generated evidence now use durable fifteen-minute storage leases and short prepare/publish transactions; Drive requests hold no database locks/connections. Metadata publication rechecks authorization and the lease token. Crashes, expired leases and provider/DB partial success still require the documented orphan-reconciliation procedure; this is not an atomic Drive/database transaction.
4. Exact `glob@14.0.3` and `minimatch@11.0.3` overrides clear the 16 moderate findings without changing the seven-day policy. Audit results are time-specific and must be rerun before release.

These fixes do not resolve the production blockers above. Follow [the ordered rollout plan](ROLLOUT_PLAN.md) for the wider work.

## Verification evidence for this remediation

On 9 November 2026: 242 unit tests passed; the precommit gate passed lint, formatting, types, JSDoc and strictly greater than 90% coverage in every changed executable file. `npm run verify` passed the full security/format/lint/whole-repository coverage/integration/build/public-browser pipeline. The full audit reported zero vulnerabilities with the release-age policy unchanged. Separately, all 19 disposable MariaDB assertions/subtests and all 13 organisation/onboarding Playwright tests passed, including admin queue visibility, subscriber queue denial, mobile reflow and accessibility. The public browser suite passed 19 tests. MariaDB tests use in-memory Drive bytes; onboarding browser tests simulate payment, Drive and mail providers.

A synthetic failed-delivery event was confirmed in the real development Sentry project: [verification issue](https://stocks-buddha.sentry.io/issues/STOCKSBUDDHA-BACKEND-7). This proves that sanitized background reporting reaches that project; it does not prove notification routing, real Drive round trips, email delivery or payment settlement. Production activation remains disabled.
