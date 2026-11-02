# Website accessibility and language support

Implemented 31 October 2026. This is an engineering implementation and test record, not a declaration of regulatory compliance or an independent accessibility audit.

## Reading and display

- Main reading text is 18 CSS pixels at default browser settings. Controls and important disclosures are at least 16px. The brand subtitle and compass supporting labels use 14px secondary text. Typography uses relative `rem` units so browser font defaults and text-only enlargement can work.
- English uses DM Sans for reading and controls, with Libre Caslon Display for large headings. Hindi uses Noto Sans Devanagari, with Nirmala UI/Mangal/system fallbacks. Optional Google Fonts requests are enhancements; the interface remains usable with fallback fonts.
- The always-available Display preferences dialog supports 100%, 125%, 150% and 200% text size, high contrast, reduced motion and reset. Settings apply to the entire document, including portalled dialogs. Storage failures are handled without blocking the controls. Device reduced-motion preferences remain effective regardless of the toggle.
- Interactive compass labels are ordinary keyboard-operable buttons outside the decorative dial, so text enlargement does not cause overlapping controls. Selection is indicated by underline, weight, border and `aria-pressed`, rather than color alone.

## English and Hindi

`?lang=en` and `?lang=hi` select the same tenant page in either language, including server-rendered content, HTML language, title and description. The language switch uses native links and is available without JavaScript. A preference cookie remembers language after hydration; an explicit URL parameter takes precedence. Unknown or disabled values fall back to the resolved tenant’s default language. Navigation preserves both tenant and language.

`frontend/src/locales/en.json` and `hi.json` contain shared UI messages, pending states, disclosures, display controls and help. Tenant website revisions own their separate English/Hindi marketing and FAQ content under `backend/src/websites/seeds/`. Proper legal/brand names and registration identifiers remain unchanged. The interpolated analyst/organization copy supports either language’s word order. New tenant-authored text must have its own approved translations before claiming bilingual coverage. Unknown UI keys fail explicitly; there is no English-sentence lookup. See [i18n architecture and extension](I18N.md).

**The RA must review and approve the Hindi financial/legal wording before publication.** No translation service receives visitor content. Approved legal documents, accessible PDF reports and media are not yet available and are not fabricated by this slice.

## Keyboard and assistive technology

The skip link focuses the main landmark. Native links/buttons, headings, labelled radio groups/checkboxes, meaningful control names and live compass updates support assistive technology. Radix manages modal focus containment and Escape; closing restores focus to the trigger. Escape also closes mobile navigation and returns focus to its toggle. Focus outlines, browser zoom, forced-color adaptation and reduced motion are supported.

The display dialog includes keyboard help and an honest accessibility-feedback state. The RA's contact and accessibility grievance channel are still required before launch. An external SCORES link is present under Investor information. This preview does not invent an operational contact address or a published accessibility certification.

## Playwright acceptance

Run `npm run build` followed by `npm run test:e2e`, or use `npm run verify` for the complete security/build/test pipeline. The production test server starts independently on port 3100.

`tests/e2e/accessibility.spec.ts` covers:

- Hindi server-rendered HTML/metadata; translated sections, FAQ, disclosures and subscription dialogs; language switching and independent cookie persistence for each tenant.
- Keyboard-only skip link and dialog entry, visible focus, forward/reverse focus containment, Escape restoration and mobile-menu Escape.
- Measured 18px body/16px disclosure defaults and true 200% text enlargement to 36px body copy; preference persistence/reset; high-contrast colors; user and OS reduced motion; help text; unavailable browser storage.
- Axe scans of both languages, preference dialogs, and enlarged high-contrast pages.
- Horizontal reflow at 1440/768/390/320px, clipping checks at 200% text, and user-overridden line/letter/word/paragraph spacing.
- Desktop/mobile and enlarged-state screenshots in the ignored `test-results/` directory.

Automated tests do not exercise an actual screen reader, certify every WCAG criterion, or replace usability testing with people with disabilities and a professional accessibility audit. Future login, KYC, payments, research documents, media, editors and tenant themes need the same review as they are introduced.

Historical S0.1 results, before the tenant-owned architecture and pre-commit tooling changes: **10/10 Playwright scenarios, 4/4 backend tests and 2/2 dependency-policy tests passed**. Production build, workspace type checks, formatting and dependency-policy checks passed. That earlier lockfile audit reported **zero known vulnerabilities**; this is not an audit result for the current lockfile. English desktop and Hindi mobile screenshots were visually reviewed. The tests found and drove fixes for intermediate contrast colors, enlarged serif line heights and subscription-list wrapping under combined text/spacing enlargement. No new npm dependencies were added in that accessibility implementation.

## Regulatory and design references

- [SEBI digital accessibility directions, July 2025](https://www.sebi.gov.in/sebi_data/attachdocs/aug-2025/1754651443956.pdf): WCAG/latest, GIGW, IS 17802, documents/media, governance, support and audit requirements.
- [SEBI December 2025 clarification](https://www.sebi.gov.in/sebi_data/attachdocs/dec-2025/1765194149704.pdf): latest-WCAG AA reporting, RA reporting authority, certified audits and accessibility complaints.
- [RA Master Circular, February 2026](https://www.sebi.gov.in/sebi_data/attachdocs/feb-2026/1770375507051.pdf): advertisement warning and translation requirements. Its minimum font-size wording is not treated as a 10px website design target.
- [GIGW guidelines](https://guidelines.india.gov.in/guidelines/): bilingual selection, Unicode and accessibility guidance.
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/) and [GOV.UK typography](https://design-system.service.gov.uk/styles/paragraphs/): technical criteria and an external readability reference respectively.

Compliance schedules must use current SEBI/BSE RAASB instructions, including subsequent extensions; no regulatory submission is performed by this change.

## Tenant-owned websites (S0.2)

Website copy now belongs to independently localized tenant revisions; shared UI/disclosure translations remain in frontend catalogues. Language selection and cookies are tenant-scoped, so another tenant keeps its own language/default. Templates render their configured section order in DOM order. Beta demonstrates the editorial template and is covered by English/Hindi axe and responsive tests. See [architecture](ARCHITECTURE.md) and [language maintenance](I18N.md).

Workspace tables are named, keyboard-focusable regions with a visible focus indicator. Horizontal overflow remains keyboard accessible on narrow screens even when accepted/revoked invitation rows have no focusable action buttons. Role-conflict feedback uses the existing alert styling and provides links to the correct sign-in capsule; messages do not rely on colour alone. The organisation Playwright suite scans desktop/mobile conflict screens with axe.
