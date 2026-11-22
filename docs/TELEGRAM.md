# Telegram recommendations

Each RA connects a dedicated BotFather bot. Investors receive private bot messages, using the same frozen eligible audience as dashboard recommendations. Client groups are site audience lists, not Telegram channels. Joining the bot does not grant research access.

## RA setup

1. Apply migration 24, `1794787200000-TelegramDelivery`, before restarting the app. There are now 46 tables including migration metadata. Startup checks migration history and never applies migrations automatically.
2. Keep the existing `ONBOARDING_DATA_KEY`. Set `AUTH_BASE_URL` to the public site origin. Telegram requires an internet-reachable HTTPS webhook; optionally set `TELEGRAM_WEBHOOK_ORIGIN` to a separate public HTTPS origin serving the same backend. Localhost alone cannot receive callbacks.
3. Open **Website configuration > Telegram Settings**, paste the BotFather token, and save. The encrypted token is never returned to the browser. Existing channel/chat IDs and manually entered invite links are no longer needed for delivery.
4. Click **Connect bot to site**. The backend checks `getMe`, reserves a unique bot identity per RA, and calls `setWebhook` with a private secret header. One bot cannot serve two RAs. This replaces any webhook previously configured for that bot, so use a dedicated bot.

Saving a replacement token disables the connection until it is reconnected. Rotating a token for the same bot preserves investor links. Connecting a different bot clears old links/invites and skips pending messages for the old bot; investors must reconnect. External webhook configuration cannot be atomically committed with SQL: if setup reports a failure after a provider request, retry Connect and verify the status. Never paste tokens into public documents, logs or source control.

## Investor connection

The account dashboard and Recommendations page show **Connect Telegram**. The investor must have an active subscriber membership and a verified site mobile. The button creates a random, single-use, ten-minute personal link, stored only as a keyed digest. A new invite invalidates the previous pending invite. Do not share personal invites.

Open the link, press Start in Telegram and use **Share my phone number**. The callback must come from a private chat, and the contact's Telegram user ID must equal the sender's ID. Its normalized Indian mobile must match the verified site mobile. Forwarded contacts, mismatched numbers, expired invites and unauthenticated callbacks cannot link an account.

There is one link per investor membership per RA and one investor per Telegram identity within an RA. **Replace Telegram account** repeats verification and atomically replaces the prior destination. **Disconnect Telegram** or `/stop` removes the link and pending invite. A Telegram block detected during delivery also disconnects the link. Refresh the website status after sharing your contact.

Telegram does not silently disclose phone-number changes, so the saved mobile is the latest number explicitly shared and verified, not a live phone-number feed. Every send checks that it still matches the current verified site mobile. Investors must relink after changing accounts/numbers. This prevents multiple active destinations for one membership; it cannot prevent screenshots, copied messages, credential sharing or several devices logged into the same Telegram account.

## Publishing and delivery

Choose plans or client groups in the existing recommendation editor. Publication still requires current KYC, paid agreement-backed research entitlement, applicable offering access and the existing production/declaration checks. Selecting a group alone never grants paid access.

In the publication preview, check **Also send to investors on Telegram**. The immutable revision, dashboard deliveries and Telegram queue entries commit together. If the bot is not connected, publication with Telegram selected fails without publishing a partial result. Owners can also use **Send latest version to Telegram** in a published report, or opt into Telegram when closing/withdrawing a recommendation. These actions send the published snapshot, never unpublished edits. Each revision/recipient pair is queued only once, including repeated clicks.

Messages contain the issuer/registration, title, status/version and a bounded trade summary (instruments, direction, quantity, entry, stop and targets), plus a link to authenticated research history for the complete rationale, disclosures and attachments. Long summaries are truncated; the website remains authoritative. Telegram content protection is requested. Attachments and private Drive URLs are not copied to Telegram.

The audience is identical to the frozen dashboard audience. Original recipients retain updates and closure notices after subscription expiry, matching dashboard history policy; new recommendations require current entitlement. Before dispatch the worker rechecks the active RA/membership, supported capability settings, verified mobile, bot identity, current Telegram link and frozen research grant. Unlinked/revoked recipients and queued versions superseded by a newer publication are skipped, so delayed retries cannot send an old active trade after its closure. New subscribers do not receive old research automatically.

The existing ten-second runtime worker processes up to five Telegram deliveries per pass. Rows persist across restarts and concurrent workers claim distinct jobs. Tenant/member/link locks span each bounded eight-second provider request so a completed account replacement cannot race a send to its old destination. This can briefly delay other changes for the same RA. Shutdown drains in-flight work.

Report delivery counts distinguish `pending`, `sending`, `delivered`, `skipped`, `failed` and `unknown`. Delivered means Telegram accepted the message, not that the investor read it. Rate-limit rejections retry after Telegram's delay, up to five attempts. Definitive provider rejections fail; network/timeouts/server errors and abandoned in-flight sends become unknown and are not automatically replayed, because Telegram provides no send-message idempotency key. Refresh delivery status to see results. Skipped/failed/unknown rows are retained and the same revision is not requeued; investors can still use dashboard history.

## Storage and verification

`telegram_bots` stores verified identities and encrypted webhook secrets; tokens remain in `tenant_integrations`. `telegram_links` stores the current unique account binding, encrypted contact evidence and a keyed mobile digest. `telegram_invites` holds at most one pending invite per membership. `telegram_updates` deduplicates authenticated callbacks; `telegram_deliveries` stores per-revision outcomes and retry/claim state. Callback bodies, contacts, bot tokens and provider error payloads are not logged. Monitoring redacts token-bearing Telegram API paths. Preserve these tables and the encryption key in backups; review retention of callback IDs and delivery evidence with the platform's data-retention policy.

Tests use synthetic identities and a fake Telegram API: `backend/tests/telegram.test.ts`, the opt-in disposable MariaDB `backend/tests/integration/telegram.test.ts`, React connection/settings tests, and `tests/organisation/telegram-flow.ts`. They cover phone proof, replay rejection, account replacement, tenant boundaries, queue atomicity, concurrent consumption/worker claims, delivery errors and responsive UI. A live activation check still requires a real RA bot, reachable HTTPS webhook and an investor sharing their own contact. Automated tests do not send live Telegram messages.
