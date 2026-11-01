# RA website editor

RA Admins enter through **Edit website** in the organisation workspace. The page, private API and saved preview require a fresh active tenant-owner membership with `website:edit`; platform owners have no implicit tenant authority. Investors and other staff do not see the link and cannot access its routes. MariaDB mode is required.

## Editing and publication

- **Branding:** website name, legal name, registration number, initials, public email/phone, theme/background colour, approved font, page template and default/enabled language. These values live in website snapshots and do not update organisation account identity.
- **Navigation:** select enabled landing sections, edit English/Hindi labels, reorder or remove links. Public login and subscription actions keep their destinations; their copy can be edited.
- **Sections:** reorder with keyboard-accessible buttons, add/remove Principles and FAQ, select original/stacked/reversed layouts, attach hosted HTTPS image URLs and English/Hindi descriptions, and edit section copy. Hero stays first. Research, Approach, About, Expectations, Plans and Investor information remain required.
- **Content:** all approved website content and optional public text overrides, separately for English and Hindi. A new organisation starts with blank content, not another organisation's copy. Hindi must be complete when enabled. Named placeholders are restricted to `{name}` in the two analyst introductions.
- **Footer:** column/compact presentation and approved footer, contact, policy and disclosure wording. Policy links retain their existing application behavior; editing wording does not implement new legal-document or subscription features.

Save partial drafts as often as needed. The live revision remains unchanged. After required content is complete, save and preview the saved revision in a private frame or a new tab. The preview validates the full publication schema; remaining invalid branding, links or media prevent rendering with a completion message. Publish confirms the saved draft and atomically changes the public pointer through the existing transactional operation. Subsequent edits create a new draft and preserve historical publications.

Unsaved changes disable preview/publish and prompt when leaving the page. Version conflicts preserve local input and show recovery instructions; copy needed changes before reloading. The editor offers an explicit **Update publishing base** action for a stale publication after confirmation. Review the live site first: this preserves the current draft and captures the latest publication generation, without merging content. **Reload saved draft** discards local unsaved changes after confirmation. Network retries reuse the same operation key for unchanged requests. Disabling Hindi removes its draft content; switching the default back to English is required before disabling it.

## Boundaries

No arbitrary HTML, JavaScript, new component types, file uploads, or asset hosting are introduced. Images must use hosted HTTPS URLs and public alternatives in both languages. The browser loads images directly with no-referrer policy. Sections keep the approved component structure; layout options affect applicable column/list compositions. Colours accept six-digit hex values. Owners should review the actual preview for readability after changing their theme.

`GET /api/workspaces/:slug/website` returns the newest draft, otherwise the current publication as an unsaved draft source, otherwise an empty organisation-specific starting snapshot. Stored checksums are verified. `POST` accepts save/publish/rebase, draft ID/version and an `Idempotency-Key` UUID; save includes the snapshot. Origin checks, request-size limits, schema validation, database session/capability checks, optimistic locking and transaction receipts apply. The API never trusts client-supplied tenant or actor identities.

The preview route `/ra/:slug/workspace/website/preview` uses the public React renderer and the authorized saved snapshot. Responses are `no-store`, `noindex`, and can be framed only by the same origin. Public reads continue to follow only the published tenant pointer.

## Verification

`npm run test:unit` covers configuration validation, public rendering, localization and owner route boundaries. `npm run test:e2e:organisations` exercises real authentication/MariaDB draft persistence, private preview, publication, Hindi rendering and desktop/tablet/mobile accessibility. That suite creates and removes a disposable local database using the existing development test credentials. Build the frontend before running it.
