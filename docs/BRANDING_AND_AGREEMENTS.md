# Branding and agreement stationery

Implemented locally on 10 November 2026. Logo publication and PDF rendering do not certify an RA's identity, legal terms or signing method. Production activation still follows [the SEBI review](SEBI_RA_REVIEW.md).

## RA logo management

RA Admins open **Edit website → Branding → Organisation logo**. Upload artwork for light backgrounds and, optionally, dark backgrounds. Preview both surfaces, save the draft, preview the saved website and publish. Uploading or saving alone does not update the live site. Removing logos uses the RA's initials; Stocks Buddha can restore its bundled originals. With only one uploaded variant, both surfaces use it.

The browser accepts PNG, JPEG and WebP up to 2 MiB, rejects dimensions above 4096 × 4096, and re-encodes pixels as PNG with a maximum dimension of 512 pixels. The normalized PNG must be at most 96 KiB. Transparency is retained. SVG, GIF, PDF and remote logo URLs are unsupported. Processing failures preserve existing artwork.

The server verifies canonical base64, signature, chunk boundaries/checksums, 8-bit RGB/RGBA dimensions, non-interlaced scanlines and bounded decompression. Normalized uploads contain IHDR/IDAT/IEND only. Unsupported images fail with `invalid_content` on save. Logos live inline as optional `branding.logoLight` / `branding.logoDark` in the tenant's existing website snapshot, under its 512 KiB total limit. Logo uploads need no Drive permissions or database migration. Letterhead uploads use the separate migration described below. Published logos are public; never upload confidential documents here.

An omitted field selects the application default; explicit `null` removes artwork. Stocks Buddha defaults to the supplied originals; other RAs default to initials. Published logos appear on RA websites, account forms and workspaces. Platform branding stays independent. Dark footers and the existing high-contrast preference select the inverse variant. This does not introduce a general dark-mode toggle. Historical publications retain their artwork.

## Letterhead and samples

The original PDF is preserved at `backend/assets/stocksbuddha-letterhead-v1.pdf`, with a public reference at `/assets/brand/stocksbuddha-letterhead-v1.pdf`. The RA footer links `/ra/stocksbuddha/sample-agreement.pdf`: a synthetic, unsigned starter marked **SAMPLE - NOT FOR SIGNING**. It never reads client records or private approved terms.

**Plans → Agreement and billing details → Preview saved agreement sample** opens `/api/workspaces/<slug>/onboarding/sample-agreement` for a current verified RA Admin. It uses saved terms, canonical RA identity, saved contact/address, published artwork and synthetic client/plan/fee values. Save changes first: unsaved edits are excluded. Missing settings produce an unapproved starter. Samples never save, approve or sign terms.

RA Admins upload their own one-page portrait A4 PDF (up to 2 MiB) in **Plans → Agreement and billing details → Letterhead**. Adjust top/bottom/left/right margins in millimetres, preview a sample using unsaved artwork, then explicitly save. Uploads are parsed and normalized to printable page content, stripping document-level scripts, form annotations and attachments. Encrypted, rotated, multi-page, malformed and non-A4 PDFs are rejected. Your uploaded header is retained; generated RA identity/page numbering/disclosures use reserved space inside the printable area above your footer. Restore default removes the uploaded PDF for future agreements only.

Stocks Buddha defaults to the supplied vector PDF stationery, covering its platform header and replacing it with frozen RA identity. Other RAs default to standard A4 stationery. Uploaded letterheads override either default. Both retain full canonical RA identity/contact in the body and repeat identity, page numbering and the registration/performance disclaimer. Built-in stationery also repeats contact/address in its header. Complete identity values also remain in the body. The original reference PDF is unchanged.

Deploy `backend/assets/` with the backend: original PDF, default light logo, combined Latin/Devanagari Noto font and OFL license. Vite copies `frontend/public/assets/brand/` to `frontend/dist/client/assets/brand/`, served by the existing `/assets` middleware. Backend asset paths work in source and bundled entrypoints, independently of the working directory.

## Frozen agreements and consent

Restricted Handlebars placeholders remain plain text. Each new checkout renders onto stationery with an embedded Noto Sans Devanagari font, selectable text, aligned fee rows, section headings and reserved headers/footers. Its encrypted snapshot retains the exact unsigned PDF, PDF SHA-256, text SHA-256, layout version and letterhead identity/artwork. The consent digest binds those two hashes and the layout version; email codes remain order/digest-bound.

The investor’s **Read agreement and MITC** section displays the frozen letterhead PDF inline before consent. It uses the authenticated `/api/workspaces/<slug>/onboarding/agreement/<orderId>` endpoint, which permits framing only from the same origin and retains subscriber/order ownership checks and no-store caching. A lazily loaded PDF.js renderer and bundled same-origin worker paint the pages directly, with previous/next page buttons and 50–200% zoom; no browser PDF plugin is required. A new-tab PDF link and **Read text version** remain available if rendering fails. Only the current page is rendered, and obsolete render tasks and documents are released when the reader changes or closes. Damaged text/PDFs fail integrity checks. Subsequent branding, identity or terms changes do not rewrite an existing checkout.

Archival preserves the original agreement content streams, adds the confirmed signature to reserved areas on new layouts, and appends consent evidence with name, method, timestamp and hashes. Original pages are not re-rendered. Existing Drive leases, idempotency, archival-before-payment and canonical download/email behavior apply to Cashfree, QR and zero-total orders. Legacy snapshots without frozen PDFs retain their original text digest/rendering path. Existing archived evidence is never regenerated.

Signing remains **typed name plus email OTP**, not a certificate-based digital signature. No provider or live credentials are provisioned. Approved RA-specific terms/MITC and a legally accepted signing method remain production requirements. A future certificate integration must retain provider-returned signed bytes unchanged.

## Verification

Branding unit tests cover image validation, multipage/Unicode PDFs, preservation of frozen page streams, tampering, published artwork, access boundaries, samples and legacy previews. Component tests cover normalization limits, cleanup, upload errors/pending states, removal/restoration, variant fallbacks and localized sample links. The organisation browser flow uploads both originals using browser decoding and saves/publishes through MariaDB, alongside its accessibility and responsive checks.

## Per-RA stationery storage and APIs

Apply migration **21**, `1794614400000-LetterheadSettings`, before startup. It adds `ra_letterhead_settings` (`tenant_id` primary/foreign key, encrypted `config_cipher` LONGTEXT, positive optimistic `version`), bringing current totals to 21 migrations and 32 tables including metadata. Preserve `ONBOARDING_DATA_KEY` and back up these records. Current configuration is private to verified RA Admins; frozen order snapshots retain prior PDF/margin versions. No uploaded letterhead is published as a public URL.

`GET` / `POST /api/workspaces/<slug>/onboarding/letterhead` read/save a configuration. POST accepts `{version, name, pdf, margins}` with canonical `data:application/pdf;base64,...` or `pdf: null` to restore defaults. Margins are integer millimetres: top 15–100, bottom 15–75, left/right 10–40. Generated identity/disclosures and signatures reserve an additional 160 points inside the printable region. `POST /api/workspaces/<slug>/onboarding/letterhead-preview` accepts the same fields, renders an unsigned synthetic sample and changes no settings. Requests are bounded to 3 MiB including base64 overhead and require the configured Origin for writes/previews; subscriber/staff/foreign-tenant access is rejected.

## Investor signatures and footer separation

New quotes use the `:signature-v2` layout, reserving a bottom-right 180 × 54 point signature area above a horizontal footer divider. Agreement and appended consent pages retain the RA footer and disclaimer. Signature placement follows the frozen RA margins; later stationery edits cannot move an existing checkout's signature.

Investors enter their verified full name and choose **Type name and choose font**, **Draw signature** (mouse/touch, with Clear) or **Upload signature**. Allura, Caveat and Noto Sans are bundled locally with their OFL licenses; Noto supplies Devanagari glyphs. Image uploads accept PNG/JPEG/WebP up to 2 MiB and 4096 × 4096 pixels, normalized in-browser to a PNG at most 512 pixels per side and 96 KiB. The server validates PNG structure, checksums, decoded bounds and visible ink; blank/transparent, corrupt, remote and unsupported images fail with `invalid_signature`. The signature POST is bounded to 192 KiB.

The selected mark appears in each unsigned preview page's reserved area. Every option still requires explicit consent, a matching verified name and the existing order/agreement-bound email OTP. The encrypted consent record retains the signature selection and SHA-256 plus the exact rendered stamp PDF and its SHA-256 alongside the agreement hash and verified actor/time. Archive retries reuse that frozen stamp rather than regenerating font artwork. The archived PDF adds that mark to every agreement and consent page while preserving original agreement content streams. After signing, the inline reader opens the archived signed PDF. Signing retries return the existing archive, preserving its bytes.

Already archived agreements remain unchanged. Older unsigned layouts have no reserved signature area: their existing typed-name/email-code flow remains available, and the UI explains that a fresh checkout is required for visual signatures. Older clients that omit a mark use the formal typed style on new layouts. Development skips do not receive investor signature artwork. These visible marks do not introduce certificate-based signing or remove the existing production compliance activation gate.
