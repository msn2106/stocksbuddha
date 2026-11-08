# Private Google Drive document storage

## Start here: your current progress

On **8 November 2026**, you confirmed that the Drive integration is working in project **`valid-tower-514017-i5`**. Your existing OAuth setup can be kept. Steps 1–9 below remain as the repeatable setup runbook; you do not need to repeat them for the folder-layout update.

The private Drive folders and local database migration are prepared, and you have tested the app functionality. Restart the backend after the folder-layout code update; new uploads then use the [structure and naming pattern below](#folder-structure-and-naming-pattern). This layout change needs no new database migration or OAuth authorization. The Google Drive connection in this chat remains independent of backend OAuth credentials.

| Item                                         | Status                                                                                                  |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Cloud project                                | `valid-tower-514017-i5` — use this project throughout                                                   |
| Google Drive API                             | Enabled, as confirmed by you                                                                            |
| Storage account                              | `stocksbuddha@gmail.com` — verified through the Drive connector on 7 November 2026                      |
| Private folders for three RAs                | Created — [open Stocksbuddha](https://drive.google.com/drive/folders/19ZQV2tselQzTwzCM6UHSV4xYEwJBTqW1) |
| Local document database migration            | Applied                                                                                                 |
| OAuth consent settings and Desktop client    | Configured — working setup reported by you                                                              |
| Backend credentials and Google authorization | Configured — working setup reported by you                                                              |
| Connection and app upload/download check     | Working — tested by you; repeat Step 9 after the layout update                                          |

## Step 1 — Open Google Auth Platform in your existing project

1. Open [Google Auth Platform → Branding](https://console.cloud.google.com/auth/branding?authuser=4&project=valid-tower-514017-i5).
2. Check that the project selector shows **`valid-tower-514017-i5`**. Every Cloud link in this guide targets that project. If Google selects a different signed-in account, choose an account that can manage this project.
3. If you see **Google Auth platform not configured yet**, click **Get started** and continue to Step 2.
4. If Branding is already configured, review the app name and support email in Step 2, then continue with Audience in Step 3.

**Expected result:** you are configuring Google Auth Platform for the existing Stocksbuddha project.

## Step 2 — Enter the app information

In the initial **Get started** wizard, enter:

| Screen / field                      | Value / action                                                                                                       |
| ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| App Information → App name          | `Stocksbuddha Document Storage`                                                                                      |
| User support email                  | Select `stocksbuddha@gmail.com` if available; otherwise use a monitored email available to the project administrator |
| Audience                            | **External** — the storage account is a Gmail account                                                                |
| Contact Information → Email address | A monitored administrator email, such as `stocksbuddha@gmail.com`                                                    |
| Finish                              | Review the Google API Services User Data Policy; accept it if you agree, then click **Continue → Create**            |

Click **Next** between screens. If the app was already configured, use **Branding** to check its app name/support email instead of starting a second app.

**Expected result:** the Google Auth Platform navigation includes **Branding**, **Audience**, **Clients** and **Data Access**.

## Step 3 — Add the storage account as a test user

1. Open [Google Auth Platform → Audience](https://console.cloud.google.com/auth/audience?authuser=4&project=valid-tower-514017-i5).
2. Confirm the audience is **External** and leave the app in **Testing** for this initial local setup.
3. Under **Test users**, click **Add users**.
4. Enter `stocksbuddha@gmail.com` and click **Save**.

Only this storage account needs to authorize Google Drive. RAs and customers will continue using their existing Stocksbuddha logins; do not add all customers as Google test users.

**Expected result:** `stocksbuddha@gmail.com` appears in the Test users list.

## Step 4 — Add the Drive scope and create the Desktop OAuth client

First add the scope:

1. Open [Google Auth Platform → Data Access](https://console.cloud.google.com/auth/scopes?authuser=4&project=valid-tower-514017-i5).
2. Click **Add or remove scopes**.
3. Find and select this exact scope. If the screen offers a manual scope entry field, paste it there:

   ```text
   https://www.googleapis.com/auth/drive
   ```

4. Click **Update**, then **Save** if shown.

This is broad Drive access and appears as a restricted scope. The current implementation needs it to discover the private folders created before this OAuth client existed. Keep the exact scope above for this setup; `drive.file` would require a different folder-grant workflow.

### Why Desktop app when Stocksbuddha is a website/PWA?

**Keep Desktop app for the setup described here.** This OAuth client identifies the administrator's local `npm run drive:authorize` helper. Google classifies local command-line authorization tools under Desktop apps. It does not determine what kind of product Stocksbuddha is.

The flow is:

```text
Administrator runs local helper → authorizes stocksbuddha@gmail.com once
                               → helper saves a refresh token privately
Stocksbuddha backend           → uses that token to access Drive
Website / future PWA          → uploads and downloads through the backend
```

No desktop or Android product needs to be built or installed. Adding a PWA does not change this storage flow: Google credentials stay on the backend, and customers continue signing into Stocksbuddha normally.

A **Web application** OAuth client would be appropriate if we implement a hosted administrator “Connect Google Drive” flow with a registered backend callback URL. That is a separate authorization flow; it is not required merely because customers access the product through a website or PWA. This guide and the current helper use the local CLI flow instead.

References: [Google's Desktop OAuth guide, including CLI tools](https://developers.google.com/identity/protocols/oauth2/native-app), [Google's hosted web-server OAuth flow](https://developers.google.com/identity/protocols/oauth2/web-server).

### Create the client for the local helper

1. Open [Google Auth Platform → Clients](https://console.cloud.google.com/auth/clients?authuser=4&project=valid-tower-514017-i5).
2. Click **Create client**.
3. For **Application type**, select **Desktop app**.
4. For **Name**, enter `Stocksbuddha Drive bootstrap`.
5. Click **Create**.
6. Save the displayed **Client ID** and **Client secret** privately. If Google offers a JSON download, save it outside the repository. In a Desktop client JSON file, the values are `installed.client_id` and `installed.client_secret`.

The Desktop client matches the local authorization helper already implemented. Its browser callback uses `http://127.0.0.1:53682/oauth/google-drive`. You do not enter a hosted redirect URL or JavaScript origin for this Desktop client. Do not choose Web application, API key or service account for this workflow.

**Expected result:** a Desktop app client named `Stocksbuddha Drive bootstrap` exists, and you have its client ID and secret.

## Step 5 — Put the client credentials in the backend environment file

On your Mac, open this existing file in your editor:

```text
/Users/mayank/Development/work/stocksbuddha/backend/.env
```

Keep the existing database, authentication and mail settings. Add or update these entries **once each**, replacing only the two `PASTE_...` values with the credentials from Step 4:

```dotenv
GOOGLE_DRIVE_ACCOUNT=stocksbuddha@gmail.com
GOOGLE_DRIVE_ROOT_ID=19ZQV2tselQzTwzCM6UHSV4xYEwJBTqW1
GOOGLE_DRIVE_MAIN_ID=1_wA_2T3ieQkmm-kbtbmKqpoGPDjYoXTo
GOOGLE_DRIVE_CLIENT_ID=PASTE_YOUR_CLIENT_ID_HERE
GOOGLE_DRIVE_CLIENT_SECRET=PASTE_YOUR_CLIENT_SECRET_HERE
```

The first three values were already added during local setup; check them rather than adding duplicates. Existing lines starting with `# GOOGLE_DRIVE_CLIENT_ID` or `# GOOGLE_DRIVE_CLIENT_SECRET` are comments: remove the `#` when entering the real values. Save the file.

Leave `GOOGLE_DRIVE_REFRESH_TOKEN` absent for now. The next step creates it automatically. Keep credentials in `backend/.env`, which Git ignores; do not put them in `backend/.env.example`, frontend variables, a committed JSON file or chat. The client secret is the OAuth credential, not your Gmail password.

**Expected result:** `backend/.env` contains the two real client credentials and the correct account/folder IDs. Uploads are not ready yet. If the app is running, stop it until Step 8 because this intermediate credential configuration is incomplete.

## Step 6 — Authorize the storage account once

Open Terminal on the same Mac where you will use the browser. Run:

```sh
cd /Users/mayank/Development/work/stocksbuddha
npm run drive:authorize
```

1. The terminal prints a Google authorization URL. Open that URL in your browser.
2. Keep the terminal running; the authorization window lasts ten minutes.
3. Select **`stocksbuddha@gmail.com`**, even if your browser has several Google accounts signed in.
4. Check that the consent screen identifies your Stocksbuddha app and requests the Drive access configured in Step 4. Grant that access to complete this setup.
5. The browser redirects to the local callback and displays:

   ```text
   Stocksbuddha Drive authorization saved. You can close this tab.
   ```

6. The terminal should display:

   ```text
   Verified storage account and private folders. Refresh token saved to backend/.env. Restart the app.
   ```

The helper checks the exact account and private root/Main permissions before saving `GOOGLE_DRIVE_REFRESH_TOKEN` to `backend/.env`. You do not need to copy a token, paste a browser authorization code or edit the callback URL manually.

**Expected result:** the command finishes successfully and the refresh-token entry has been saved locally. Do not share its value.

## Step 7 — Verify the backend connection

In the repository terminal, run:

```sh
npm run drive:check
```

Expected output:

```text
Google Drive verified for stocksbuddha@gmail.com. Root and Main are private.
```

This checks the stored credentials, storage account and root folder permissions without uploading a document. If it fails, use the troubleshooting table below before continuing.

**Expected result:** the exact verification message above.

## Step 8 — Start or restart the local app

The local document migration was applied during the initial integration. You can safely confirm/apply any pending local migrations with:

```sh
npm run db:migrate -- --target dev
```

Stop any existing development server with **Ctrl+C** in its terminal, then start it again:

```sh
npm run dev
```

Keep this terminal running. Open the app using the origin configured by `AUTH_BASE_URL` in `backend/.env`, normally [http://localhost:3000](http://localhost:3000). Use that same hostname for login and uploads.

**Expected result:** the app starts without a Drive configuration error. In Documents, the message **Document storage is awaiting activation** is gone.

## Step 9 — Confirm one real upload and download

Use a small test PDF with no customer personal information. The app retains uploaded evidence and has no delete button.

1. Sign in with the existing **platform owner** account at `/workspace/login`.
2. Open **Documents**, or visit `/workspace/documents` on the same app origin.
3. Select **Owner document**, choose the test PDF and click **Upload document**.
4. Confirm **Document uploaded** appears and the file is listed.
5. Click **Download** for that row and confirm the downloaded file opens correctly.
6. Open [Stocksbuddha → Main in Drive](https://drive.google.com/drive/folders/1_wA_2T3ieQkmm-kbtbmKqpoGPDjYoXTo). The stored filename has a generated UUID prefix followed by the original filename.

For an RA check, use an existing RA Admin login at `/ra/stocksbuddha/login?audience=organisation`, then open `/ra/stocksbuddha/workspace/documents` and upload a **General document**. Its destination is `Stocksbuddha/Stocks Buddha/General/`. Platform ownership alone does not grant RA membership. Customer KYC/MITC and recommendation checks need an active subscriber in that RA; select that customer from the form. The app resolves `Customer/<membership UUID>/` automatically; recommendation evidence goes into its `ForYouByRA/` child.

**Expected result:** the upload is visible in the app and correct Drive folder, and downloading through the app succeeds. This completes local activation.

## If a step fails

| Message / symptom                                                   | What to check next                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google says access is blocked or the user is not a test user        | Repeat Step 3 in `valid-tower-514017-i5`; authorize using exactly `stocksbuddha@gmail.com`. If still blocked, record the error text without tokens or secrets before changing anything.                                                                                     |
| Google shows an unverified-app notice                               | Testing apps using this restricted scope may show a warning. Confirm the displayed app is your own Stocksbuddha app. If Google blocks access entirely, resolve the displayed consent/test-user issue; this guide does not require publishing the app to finish local setup. |
| `Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET...`      | Complete Step 5; check that the entries are not commented out and that you edited `backend/.env`.                                                                                                                                                                           |
| `invalid_client`, `redirect_uri_mismatch` or token exchange failure | Check that Step 4 created a **Desktop app** client and Step 5 uses both values from that same client. Rerun `npm run drive:authorize`.                                                                                                                                      |
| Port 53682 is already in use / `EADDRINUSE`                         | Stop an earlier `drive:authorize` command with Ctrl+C, then retry.                                                                                                                                                                                                          |
| Authorization timed out or localhost callback will not open         | Rerun Step 6 and open its new URL on the same Mac while the terminal remains running.                                                                                                                                                                                       |
| `drive_account_mismatch`                                            | Rerun Step 6 and explicitly select `stocksbuddha@gmail.com`.                                                                                                                                                                                                                |
| `drive_folder_not_private`                                          | Check the configured root/Main IDs and their Drive sharing permissions. They must remain private to the storage account.                                                                                                                                                    |
| `drive_request_failed` or `drive_authorization_failed`              | Confirm Drive API is enabled in the same project that issued the client; verify credentials and rerun authorization if consent was revoked or expired.                                                                                                                      |
| The app still says storage awaits activation                        | Confirm Step 7 succeeds, then restart the backend using the same `backend/.env` in Step 8.                                                                                                                                                                                  |
| Customer selector is empty                                          | That RA needs an active subscriber membership; creating a Drive folder alone does not create a Stocksbuddha customer.                                                                                                                                                       |

## Before unattended production use

The initial setup above uses **External / Testing**. Google normally expires refresh tokens after seven days in this mode when Drive scopes are requested. Complete local activation first; then review the separate publishing/verification requirements for the restricted Drive scope before relying on unattended production access. Moving to Production is not the same as completing Google verification, and tokens can still be revoked for other reasons.

For a future hosted deployment, configure these server-only environment values in the host's secret settings, apply the reviewed migration to the explicit production target, and restart the hosted backend. Do not copy the entire local `.env` over production database settings.

The runtime rejects partial OAuth configuration. With all three OAuth credentials absent, metadata pages can load but uploads remain disabled. Fixture preview mode has no authenticated document service.

Setup references: [Google consent configuration](https://developers.google.com/workspace/guides/configure-oauth-consent), [Desktop OAuth client creation](https://developers.google.com/workspace/guides/create-credentials#desktop), [desktop loopback authorization](https://developers.google.com/identity/protocols/oauth2/native-app), [refresh-token expiry](https://developers.google.com/identity/protocols/oauth2#expiration).

## Folder structure and naming pattern

New uploads use this layout:

```text
Stocksbuddha/
├── Main/                                  # Platform owner contracts and documents
├── Stocks Buddha/                         # RA display name from tenants.display_name
│   ├── General/                           # RA's general documents
│   └── Customer/                          # Literal container name, singular
│       └── <customer-membership-UUID>/     # tenant_memberships.id, not a person's name
│           ├── <document-UUID>-PANCard.jpg
│           ├── <document-UUID>-MITC-Signed.pdf
│           └── ForYouByRA/                 # Recommendation evidence provided by the RA
│               └── <document-UUID>-RecommendationEvidence.pdf
├── Alpha Research/
│   └── …same structure…
└── Beta Research/
    └── …same structure…
```

| Document kind       | Destination relative to Stocksbuddha                       |
| ------------------- | ---------------------------------------------------------- |
| `contract`, `owner` | `Main/`                                                    |
| `general`           | `<RA display name>/General/`                               |
| `kyc`, `mitc`       | `<RA display name>/Customer/<membership UUID>/` directly   |
| `recommendation`    | `<RA display name>/Customer/<membership UUID>/ForYouByRA/` |

`Customer` and `ForYouByRA` are literal folder names. There is no extra `Customers` folder around a customer's KYC/MITC files, and the code never creates a literal `CustomerUniqueID` placeholder. Each upload has a new document UUID prefixed to the original filename; repeated uploads retain separate files.

### Readable RA names with stable ownership

The RA folder label comes from the freshly authorized database row's `tenants.display_name`. Spaces, Unicode, apostrophes and punctuation are supported; surrounding whitespace is trimmed. The name is written as Drive metadata and is never interpolated into a Drive search expression. Names are not filesystem paths and do not determine access rights.

The folder also carries the app-private Drive property `stocksbuddhaTenantId=<tenants.id>`. The backend finds the folder using that immutable tenant ID under the configured storage root, rather than trusting its readable name. On the next upload after an RA name change, the backend updates the same folder's label without changing its Drive ID or existing contents.

Two RAs with identical display names receive distinct Drive folders tagged with their different tenant IDs. Drive allows duplicate visible names; the metadata and database tenant scope keep them separate. An unrelated folder with the same visible name is not adopted. Even an RA named `Main` cannot take over the platform Main folder. Keep the same OAuth client when relying on these app-private properties: they are visible only to that app.

Customer folders use immutable **membership IDs**, not global user IDs, names, email addresses, PAN numbers or Aadhaar numbers. The same person belonging to different RAs has a separate membership/folder in each RA. Only active subscriber memberships can be new upload targets. The server derives a customer's own membership ID or verifies staff-selected IDs within that RA before resolving any folder.

Folders are created on demand by successful authorized upload attempts. Per-tenant database locking serializes lookup/creation across app instances. Duplicate matches for a tenant tag, legacy UUID folder or a structural child folder cause an error instead of an arbitrary selection. The upload operation verifies private permissions before using or renaming an existing RA folder.

### Existing folders and uploads

The initial setup used RA UUID labels. When the app first needs an RA folder after this update, it first searches for the tenant property. If none exists, it can adopt the unambiguous private folder whose name is that exact tenant UUID, attach the tenant property and rename it to the current display name. Its Drive ID and contents are preserved. Conflicting ownership metadata blocks adoption.

On **8 November 2026**, the live test Drive layout was reconciled: all three existing RA folders were renamed to **Stocks Buddha**, **Alpha Research** and **Beta Research**, tagged with their stable tenant IDs, and given `General/` and `Customer/` containers. The old empty `CustomerUniqueID` example folders and their children were removed. Existing root/RA/General folder IDs and the two test-document records/files were retained; both documents were downloaded successfully after the change. There were no subscriber memberships at that time, so the three `Customer/` containers were empty. Real membership-ID folders are created on demand rather than by inventing example customers.

For later RA display-name changes, automatic folder-label synchronization still occurs on that RA's next authorized upload. The folder name does not update immediately when only the database profile changes.

The normal upload code does **not** bulk relocate historical customer files. On another environment using the older layout, uploads may still exist under `<RA>/<membership UUID>/Customers/` or `ByRAForThisCustomer/`. Downloads use each document's recorded `drive_file_id` and `drive_folder_id`, so these uploads remain accessible after an RA rename. New uploads use the current structure. Do not manually move old files between parent folders without reconciling their recorded parent IDs; download validation checks that parent.

| Folder / RA                     | Stable tenant ID                       | Existing Drive folder ID            |
| ------------------------------- | -------------------------------------- | ----------------------------------- |
| Stocksbuddha root               | —                                      | `19ZQV2tselQzTwzCM6UHSV4xYEwJBTqW1` |
| Main                            | —                                      | `1_wA_2T3ieQkmm-kbtbmKqpoGPDjYoXTo` |
| Alpha Research (synthetic/demo) | `aba574d1-3eea-4547-8295-3bf8d22c6281` | `1Wn87dC-65IOgKbGSqUivj8UGSVnjNR0P` |
| Beta Research (synthetic/demo)  | `dab574d1-3eea-4547-8295-3bf8d22c6282` | `1wXqzjJ1BqJWXuEqrPdfdjkxEIXfcEhXe` |
| Stocks Buddha                   | `a1b87125-42b7-4d6d-8715-78721c436a82` | `1j2KBkCM5HHQ9TM8exNOWK_6UziXkUnSg` |

## App workflow and authorization

Use **Documents** in the platform workspace (`/workspace/documents`), an RA workspace (`/ra/<slug>/workspace/documents`) or a customer account (`/ra/<slug>/account/documents`). Uploads accept PDF, JPEG and PNG, require matching extensions/signatures, and are capped at 10 MiB. Signed MITC files are retained as uploaded; this feature does not generate signatures, verify signatures, certify KYC or submit documents to a regulator. Downloads are attachments served by the authenticated backend; direct Drive URLs are never returned.

| Document                                | Platform owner | RA admin    | Analyst     | Support     | Customer        |
| --------------------------------------- | -------------- | ----------- | ----------- | ----------- | --------------- |
| Owner contract / owner document in Main | Upload/read    | —           | —           | —           | —               |
| RA General                              | —              | Upload/read | Upload/read | Read        | —               |
| Customer KYC / MITC                     | —              | Upload/read | —           | Upload/read | Upload/read own |
| Recommendation evidence                 | —              | Upload/read | Upload/read | —           | Read own        |

Platform ownership does not grant implicit access to RA/customer documents. An active tenant membership is required for those paths. Session validity, email verification, tenant activity, membership revocation and unsupported capability overrides are checked against MariaDB for every service operation. Customer IDs are resolved server-side for customers and validated within the same tenant for staff. Uploaded content remains untrusted; there is no malware-scanning service in this implementation. Documents always download as attachments with `nosniff`; add a reviewed quarantine/scanning workflow before any future inline preview or automated content processing.

## Document access guarantees and lifecycle

In this guide, **RA Admin** means an active `owner` membership inside one RA. **Platform owner** is the separate global platform role; it is not a tenant permission.

1. An RA Admin can list/download documents for every client of that RA, including retained historical documents for a former client. The document's tenant must match the authorized RA. The same user may have different roles in two RAs; permissions are evaluated separately for the requested RA.
2. A customer can list/download only KYC, MITC and recommendation records assigned to that exact tenant membership ID. Knowing another customer's document UUID, changing the route RA, adding customer-ID query/header values or supplying another document's pagination cursor does not grant access. Missing and inaccessible cursors both return `invalid_cursor`; inaccessible/missing download records return `document_not_found` after tenant authorization.
3. A customer can repeatedly download documents supplied by their RA in `ForYouByRA/`. There is no expiring public link or document-age gate. Access requires a valid verified session, an active RA and an active membership; revocation or suspension stops subsequent requests. Provider availability and integrity checks still apply. Retention of a document does not itself grant a revoked customer continued login access.
4. The app never returns Drive object IDs, provider URLs or raw file bytes for an unauthorized request. Database queries constrain tenant/customer scope, and the document policy independently verifies the returned record's tenant, kind and customer before projecting metadata or contacting Drive for a download. Pagination cursors are authorized against the same rules as documents.
5. Platform ownership alone allows only the platform's Main documents. It does not grant access to tenant General files, KYC/MITC or recommendation evidence. If a platform owner has an explicitly granted membership in an RA, only that membership's role applies there; the global role adds no tenant permissions.

Successful uploads/downloads are audited. Current controls do not implement a separate support-access grant or an exception for debugging. Customer self-upload targets are derived from the authenticated membership rather than browser-supplied customer IDs. RA staff-selected customer targets are verified within that RA before creating/uploading a Drive object.

### Recommended platform-owner support policy (proposal, not implemented)

Keep **no standing platform-owner access to RA/client document contents**. Investigate routine failures using request IDs, error codes, authorization outcomes, byte counts, integrity-check results and synthetic test documents. Avoid putting client identity details or document contents into debugging logs.

If support needs a real document, build a separate **RA-approved support-access grant** with these properties:

- Identify the named support operator, requesting RA, ticket/reason, exact customer/document scope and permitted actions. Default to read-only and the smallest useful scope; document downloads require explicit permission because read access can disclose sensitive contents.
- Have an authorized RA Admin approve the request, with any client authorization required by the applicable consent/outsourcing arrangements. Platform ownership alone must not approve its own access.
- Require recent MFA/reauthentication for the support operator, a short expiry (for example 30 minutes), and immediate RA revocation. Check the live grant on every list/read/download request; expiration/revocation must block subsequent requests.
- Record request, approval, use, expiry and revocation in audit records visible to the RA. Record the real operator rather than impersonating the RA/customer. Keep the audit trail separate from document contents and protect it from the support operator.
- Maintain any emergency-access mechanism as a separately approved, strongly authenticated and audited process; do not add a hidden global bypass. Development/testing should use synthetic tenants/documents.

This is a proposed security policy, not an implemented feature or a conclusion that all operator access is legally prohibited. Before enabling content access for support, review the data-processing/outsourcing terms and required client authorizations with the responsible compliance adviser. SEBI's February 2026 RA Master Circular discusses client privacy/confidentiality (Annexure A, printed page 69) and segregation when an outsourcing provider handles multiple intermediaries (printed page 85). [Official circular](https://www.sebi.gov.in/sebi_data/attachdocs/feb-2026/1770375507051.pdf). Least privilege and auditing privileged actions also follow [NIST access-control guidance](https://nvlpubs.nist.gov/nistpubs/SpecialPublications/800-171r3/NIST.SP.800-171r3.html).

### Application authorization versus storage administrator access

The current storage account `stocksbuddha@gmail.com` owns every folder, and the backend holds a token with broad Drive access. A person who can sign into that Gmail account can read its Drive contents outside the app. A server/database administrator with sufficient privileges can also access credentials or alter roles. Application tests do not eliminate those administrative capabilities.

Keep the storage-account credentials and backend secrets restricted, protect administrator sign-ins, and do not distribute the Drive account or root-folder access to RAs/customers. A requirement that even the storage/server operator cannot read client documents needs a separate encryption/key-custody design with keys outside that operator's control; it is not provided by the current shared-account Drive setup.

## HTTP interface

The same-origin browser session cookie is required. Writes additionally require the exact configured `Origin`.

| Method | Path                                           | Result                                                      |
| ------ | ---------------------------------------------- | ----------------------------------------------------------- |
| GET    | `/api/documents`                               | Platform metadata page                                      |
| POST   | `/api/documents`                               | Platform upload                                             |
| GET    | `/api/documents/:id/download`                  | Owner attachment                                            |
| GET    | `/api/workspaces/:slug/documents`              | Tenant-authorized metadata page                             |
| GET    | `/api/workspaces/:slug/documents/customers`    | Up to 1,000 active subscriber IDs/names for staff selection |
| POST   | `/api/workspaces/:slug/documents`              | Tenant upload                                               |
| GET    | `/api/workspaces/:slug/documents/:id/download` | Authorized attachment                                       |

POST sends raw file bytes, `Content-Type`, URI-encoded `X-Document-Name`, `X-Document-Kind` (`kyc`, `mitc`, `recommendation`, `general`, `contract`, `owner`) and, for staff customer uploads, `X-Customer-Id`. Do not use multipart or base64 JSON. List pages return `configured`, `documents` and `nextCursor`; pass that cursor unchanged as `?before=...`. Metadata never includes Drive object IDs, bearer tokens or public sharing links.

## Evidence, operations and recovery

`documents` records tenant/customer scope, kind, original name, MIME type, byte count, SHA-256, private Drive file/folder IDs, uploader and timestamp. Audit events record successful uploads/downloads without filenames or document content. Downloads verify byte count and SHA-256 before returning data. Provider errors are sanitized at the HTTP boundary. OAuth refresh and API requests have explicit timeouts. Folder lookup/creation is serialized per tenant using the database tenant row lock. RA ownership is resolved by the tenant property; structural children are resolved by exact names within their parent. Ambiguous matches fail instead of selecting arbitrarily.

Do not share these folders directly with RAs/customers: folder inheritance bypasses app authorization. Runtime operations reject shared root/Main and accessed folders/files. This is a permission check at request time; the storage-account owner can still change Drive contents/permissions directly. This setup is **not immutable/WORM storage** or a backup. Agree retention, backup and evidentiary requirements before relying on it for regulated retention. The app deliberately exposes no deletion or replacement endpoint.

Drive and MariaDB cannot participate in one atomic transaction. A successful Drive upload followed by database/audit failure (or an ambiguous network response) may leave an unindexed object. The app retains that object to avoid deleting evidence; reconcile its `stocksbuddhaDocumentId` app property/UUID filename against `documents.id` and audit history before retrying or removing it. Automatic retries/idempotency are not implemented. A failed browser response should be followed by refreshing the list first. Back up both the metadata database and Drive objects; restoring just one is insufficient.

Official references: [Drive scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth), [uploads](https://developers.google.com/workspace/drive/api/guides/manage-uploads), [desktop OAuth](https://developers.google.com/identity/protocols/oauth2/native-app), [token expiry](https://developers.google.com/identity/protocols/oauth2#expiration).
