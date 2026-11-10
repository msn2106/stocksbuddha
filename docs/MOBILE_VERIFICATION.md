# Mobile verification and SMS recovery

SMS Horizon is a transport, not an identity or KRA provider. Mobile OTP proves possession of a number at a point in time. It does not establish PAN ownership, KRA validation, suitability, client consent to research terms, or agreement signing. Existing manual KFIN review and production signing gates remain in place.

## Investor and RA behavior

After verified-email login and subscriber enrollment, **Continue onboarding** opens mobile verification before the KYC form. The signup number is a suggestion, not proof. The server accepts Indian mobile numbers only, canonicalizes them to `+91` format, and rejects foreign numbers rather than relying on the vendor's last-ten-digit behavior. A subscriber sends and verifies their own code; owners cannot send or confirm OTPs on an investor's behalf through these APIs.

KYC submission, RA approval, new quotes and subsequent signing/payment transitions require verification of the exact phone in the relevant KYC/agreement snapshot. Saving a draft with a different phone clears the old membership verification timestamp. Verifying a replacement number cancels unfinished quoted/signed orders and is blocked during gateway-pending payment. If the submitted KYC phone changes before payment, KYC moves to changes with a new encrypted history revision so the investor can resubmit for review. Changing the KYC phone after any paid order is blocked pending a separately controlled compliance procedure; the same existing KYC number can still be verified. Existing paid orders, agreements and invoices are retained. Paid research access continues under the existing eligibility rule: legacy subscribers are prompted to verify but are not automatically cut off from paid services. New checkout requires verification. Development-only simulated KYC retains its explicit provenance and cannot enter production.

The RA Admin opens **Website → SMS settings**. Configuration is private, encrypted and versioned; saving takes effect immediately and does not require website publication. Public snapshots, previews and hydration never contain these settings. Enter the RA's vendor username/API key, approved sender, DLT entity ID, encoding and approved mobile-verification template ID/text. Blank API key on edit retains the stored secret; the API never returns it. The sample preview substitutes `123456` and `5`. Only `{{otp}}` and `{{expiryMinutes}}` are allowed. Replace the DLT OTP-variable marker (for example `{#var#}`) with `{{otp}}`; use `{{expiryMinutes}}` only where expiry is also a registered variable. Keep all approved static wording and punctuation unchanged. English text rejects non-ASCII content; select Unicode and an approved matching template for Hindi messages. The maximum configured template is 441 characters; multipart SMS can consume several vendor credits per send.

RA settings show the latest 20 **KYC verification** send attempts, provider acceptance/uncertainty and the reported remaining credits. Acceptance does not mean delivery or phone verification. The owner-only records API exports up to 50 verification records and a `nextCursor`; follow it as `?before=<nextCursor>` for further pages. Messages are redacted before returning them to an RA. Export reads are audited. Platform password-recovery records and credentials are excluded from RA views.

## Shared account recovery boundary

One identity/password can access several RAs. A tenant-owned vendor account may expose SMS content in its provider console. Therefore **tenant credentials, templates and logs must never control global password recovery**. This deliberately replaces the initial idea of an RA-editable password-reset template. The RA controls its KYC template; the platform controls the global recovery sender/template.

Set `SMS_RECOVERY_SETTINGS_JSON` privately on the server using a dedicated platform-owned SMS Horizon account. Its strict object contains `username`, `apiKey`, `senderId`, `entityId`, `encoding` (`txt` or `uni`) and `template: { id, text }`. The template has the same approved placeholders. Do not share this account or its provider console with any RA. The server rejects RA configurations that use the platform username, and refuses recovery sends while any saved RA configuration references it. Distinct usernames are a software check, not proof of provider-console access isolation; provision and review that access operationally. Configured SMTP is required when platform SMS recovery is enabled.

SMS recovery is optional. A subscriber first verifies their mobile, then enters their current account password to enable it. The recovery number is stored separately from every RA's KYC phone. Changing KYC does not change global recovery. The UI displays the masked recovery number; disable and re-enable after verification to replace it. Disabling also requires the current password. A recovery number can belong to only one global recovery identity; KYC numbers are not globally unique, allowing legitimate family contact sharing without conflating identities.

An account with any active staff membership or platform role cannot enable or use SMS password recovery. It retains the existing email recovery channel. This is checked both at enrollment and at reset, including a role granted after code issuance. RA administrators cannot enable recovery for an investor.

**Forgot password → Reset password by SMS** takes the email identifier, then the code and new password/confirmation. It never asks for a destination number. Responses to send requests are generic and have an 8.5-second minimum duration, beyond the adapter's eight-second deadline. Unknown accounts, unconfigured recovery, unsupported trial destinations and exhausted send quotas produce the same response shape. OTP verification and password replacement occur in one atomic transaction using the pinned Better Auth password hasher; all account sessions, remaining recovery challenges and existing email reset tokens are invalidated. No automatic login follows. This combined form needs no reset credential exposed to the browser. Email recovery remains available, including for investors who have never verified a mobile.

## Limits and failure handling

All limits are enforced in shared MariaDB transactions, not browser timers or process memory:

| Control       | Value                                                                                        |
| ------------- | -------------------------------------------------------------------------------------------- |
| OTP           | Six random digits; five-minute lifetime                                                      |
| Resend        | At least 60 seconds                                                                          |
| Flow          | At most three sends and five wrong guesses within a 30-minute flow                           |
| Resend proof  | Only the newest code is valid; attempts do not reset                                         |
| Per mobile    | Five sends/hour and ten/rolling 24 hours, across RAs and purposes                            |
| Per account   | Ten sends/rolling 24 hours across numbers and RAs                                            |
| Wrong guesses | Ten per account or mobile/30 minutes across flows                                            |
| Per IP        | Twenty sends/hour, plus 30 SMS API requests/ten minutes, including unknown recovery accounts |
| Tenant/global | Configurable rolling 24-hour send caps; trial defaults 10/20, live defaults 200/1000         |

`SMS_TENANT_DAILY_CAP` and `SMS_GLOBAL_DAILY_CAP` must be positive integers no greater than 10,000. The caps count attempts, including ambiguous outcomes, not SMS segments or rupee spend. Keep multipart templates and credit balances in mind when budgeting. Quotas do not permanently lock login or email recovery.

A shared mutex serializes SMS quota/state decisions. Reservation and encrypted evidence commit before provider I/O; no database transaction is held during SMS or SMTP network calls. A fresh request key is required for each intended send. Repeating a key does not send again. Switching to a different pending mobile invalidates earlier verification challenges. Failed/unknown vendor outcomes remain charged against local caps. There is no automatic SMS resend: an acknowledgment may have been lost after vendor acceptance. The investor can still enter the reserved code after an uncertain outcome. The vendor's API is fixed to HTTPS POST, uses bearer authentication and has an eight-second timeout; redirects are rejected.

OTP lookup values are HMACs under the retained key. Full message/destination/template/sender/configuration evidence is encrypted; ordinary logs, errors and audit metadata contain no OTPs, phone numbers or vendor credentials. Only the subscriber's verified session can consume a KYC proof. Evidence is retained after code expiry; possession of the retained ciphertext is not an active OTP proof. RA exports redact OTPs. Raw encrypted SMS evidence is available only to controlled database/key operators, whose access must be covered by the retention and audit procedure.

Security changes queue email notifications transactionally in `sms_security_notices`. The worker leases notices, sends outside transactions and retries after five minutes, up to ten attempts. Delivery is at least once; a lost acknowledgment can duplicate email. Exhausted jobs emit a sanitized `sms_security_notice_failed` Sentry event and require operator review/requeue. A reported SMS balance at or below ten credits emits `sms_low_balance`. Deployment must configure alert routing and verify ingestion. Vendor acceptance and SMTP acceptance do not guarantee delivery.

## Deployment and trial

1. Back up the database and retained `ONBOARDING_DATA_KEY`. MariaDB mode now requires a 64-character lowercase hexadecimal key even in development. Do not replace an existing key: onboarding and SMS evidence use it. For a fresh installation only, generate it with `openssl rand -hex 32` and store it privately.
2. Stop old application writers. Apply migration `1794268800000-MobileVerification` explicitly with `npm run db:migrate -- --target dev` (or the reviewed production target), then check `npm run db:migrate:status -- --target dev`. Startup never migrates. This is migration 17 and adds six tables. Also apply `1794355200000-RecoveryEmailLimits` (migration 18), which adds the email-send ledger. Also apply migration 19, `1794441600000-TenantIntegrations`, for private integration settings and expanded SMS library storage. Current totals are 29 tables including metadata. No existing mobile is automatically marked verified.
3. Start with `SMS_MODE=trial`. Both the service and real adapter reject every SMS destination except `+919599400141`; they never redirect someone else's OTP to this phone. Leave platform recovery unconfigured until its separate account and SMTP are ready. Keep production signing approval disabled while existing blockers remain.
4. Configure the test RA's real approved credentials/header/DLT template through the private UI. Enable platform recovery only after its independent account and platform DLT template are provisioned. Confirm entity/header/template mapping, balance, provider-console permissions and any IP allowlist with SMS Horizon. No API key or live template IDs are bundled.
5. Exercise one controlled end-to-end send/verify, resend/expiry and optional recovery. Confirm generic responses, new-password login, session revocation, security email, provider acceptance/delivery and correct credit debit. The automated suite uses a fake transport and never spends trial credits.
6. Before `SMS_MODE=live`, review caps, production credentials, TLS, SMTP, Sentry routing, backup/restore, retention/holds and the RA compliance audit. There is no unsigned delivery webhook that can grant verification. The current application does not poll vendor delivery receipts; acceptance/uncertainty is the recorded transport status.

Trial mode is not a way to onboard real investors whose number differs from the approved phone. They must wait for live account activation or use other existing account features. Do not enter the test phone as another investor's identity.

## Evidence and retention

Keep client SMS communication records for at least five years, and longer for disputes or SEBI-directed preservation. This follows the [23 October 2026 SEBI circular, effective 8 November 2026](https://www.sebi.gov.in/sebi_data/attachdocs/oct-2026/1792753022042.pdf). The application has no automatic deletion of these records, but database administrators can still modify/delete data. Operator-controlled archival, legal holds, encryption-key custody, access logs and tested restoration remain deployment obligations. See [the mobile-specific RA audit](MOBILE_VERIFICATION_AUDIT.md).

Provider reference: [SMS Horizon v2 documentation](https://smshorizon.com/api-docs/sms-api.php). Security reference: [OWASP password recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## API reference

All routes are under `/api/sms/:slug`. POST requires the configured same origin and bounded JSON. Responses are `no-store`; all requests use trusted socket/proxy-derived IP limits.

| Route                          | Authorization and purpose                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `GET/POST /settings`           | Current owner; read sanitized settings or save complete versioned configuration                             |
| `GET /records?before=<cursor>` | Current owner; paginated redacted KYC SMS evidence; read audited                                            |
| `GET /mobile`                  | Current subscriber; own membership phone/proof and masked global recovery status                            |
| `POST /send`                   | Current subscriber; `{ mobile, key }` requests own verification OTP                                         |
| `POST /verify`                 | Current subscriber; `{ challengeId, code }` consumes own verification proof                                 |
| `POST /recovery-contact`       | Current subscriber; `{ password, enabled }` changes optional global recovery enrollment                     |
| `POST /public/send`            | Anonymous; `{ email, key }` uses only stored global recovery contact and returns a generic response         |
| `POST /public/reset`           | Anonymous; `{ challengeId, code, password, confirmPassword }` consumes recovery proof and resets atomically |

## Password-recovery budgets

Password recovery has independent channel budgets, shared across RAs, devices and application replicas:

| Channel        | Rolling 24-hour cap per global identity             | Cooldown                                 |
| -------------- | --------------------------------------------------- | ---------------------------------------- |
| SMS recovery   | 3 send attempts, including initial send and resends | 60 seconds across all RAs                |
| Email recovery | 5 reset-link send attempts                          | 60 seconds across all reset entry points |

The three-SMS recovery cap is additional to the broader combined mobile/account/IP/tenant SMS safety limits above. It does not consume or replace the separate KYC flow's three-send/five-wrong-guess allowance. Successful reset, a new flow, a new device, another RA, or replacement of a recovery contact does not replenish the rolling daily recovery budget. Wrong SMS guesses remain capped at five per flow; resend never resets that counter. Email keeps its existing high-entropy reset links rather than introducing a numeric email OTP.

Email recovery is available immediately, without first consuming SMS credits. The recovery page explains both limits, provides a link to the email form, counts local SMS requests, shows a resend cooldown, and recommends email after three requests. Browser counters are only a convenience: the database enforces the real identity-wide caps even after reload, switching RAs or changing IPs. An investor can still enter the third requested code; exhausting sends does not discard a valid proof.

Email sends are reserved inside Better Auth's `sendResetPassword` callback, covering `/ra/:slug/forgot-password`, `/workspace/forgot-password`, and direct `/api/auth/request-password-reset` calls. This applies to all account roles, preserving the same security boundary on every entry point. Other email kinds (verification, invitations, security notices and receipts) do not consume this recovery allowance. Reservations commit before SMTP and count attempted delivery, including failures; an SMTP error cannot reset the budget.

For anonymous callers, quota/cooldown suppression returns the same generic result as an unknown account. SMS suppression does not automatically send email: the investor explicitly requests an email link. Responses and the UI do not reveal whether an account exists, has recovery enabled or has exhausted a server-side quota. Reaching either channel limit does not lock password login, revoke sessions or change credentials. Existing unexpired reset links/codes can still be used. Each rolling slot becomes available when that attempt ages past 24 hours; this is not a lifetime cap or a midnight reset.

## SMS template library

The dedicated **SMS Settings** tab replaces the former Branding section. It starts with Login (existing post-password-login mobile/KYC verification) and Reset/Forgot Password (a reference copy; global resets remain platform-owned). Owners can add custom templates, up to 100 total; only Login is dispatched by this release. Approved template IDs/text must match DLT registration. Additional templates are stored without triggering sends. Legacy configuration is normalized without losing its active verification template. See [private settings, placeholders and restrictions](WEBSITE_EDITOR.md#private-service-settings).

Verified investors see their verified mobile and an explicit **Change mobile number** action. The send/OTP forms are hidden after proof succeeds and on subsequent page loads; opening and cancelling a number change does not send SMS. The optional password-reset section explains that SMS recovery is separate from KYC and email recovery remains available. Existing server-side number-change and paid-client protections still apply.
