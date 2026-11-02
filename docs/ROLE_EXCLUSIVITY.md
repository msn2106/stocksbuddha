# One role per email per RA

## Product rule

A global login identity has one email and one password. Within one RA, that identity has at most one membership and one current role: RA Admin (`owner`), Analyst (`analyst`), Support (`support`) or Subscriber (`subscriber`). Staff and subscriber access are mutually exclusive. The rule applies to every staff role, including roles added in future; invitation guards must remain shared rather than special-cased to Analyst or Support.

The same identity may have a different role in another RA. A subscriber at RA A may be staff at RA B. There is no second user, parallel subscriber enrolment record or automatic staff entitlement to the subscriber dashboard.

## Allowed destinations and actions

| Existing role in this RA     | Investor capsule / subscriber dashboard | Organisation capsule / staff workspace              | Subscriber signup or enrolment                          | Staff invitation                                                   |
| ---------------------------- | --------------------------------------- | --------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| None                         | Verified subscriber enrolment           | Denied unless a valid staff invitation is completed | May create the subscriber membership                    | May establish its stored staff role                                |
| Subscriber                   | Allowed                                 | Denied                                              | Existing account sign-in; never create another identity | Rejected for every staff role; use a different email               |
| RA Admin / Analyst / Support | Denied                                  | Allowed for the stored staff role                   | Rejected; use a different email                         | Only an identical role is compatible; a different role is rejected |
| Revoked membership           | Denied                                  | Denied                                              | Cannot reactivate                                       | Issuance, resend and acceptance cannot restore access              |

Recipient compatibility never overrides issuer authorization: RA Admin appointment remains platform-owner-only.

The capsule selects a destination, never a permission. Staff cannot bypass the boundary by entering `/ra/:slug/account`, `/ra/:slug/join`, posting to enrolment APIs or submitting another role in a body. Subscribers cannot obtain staff access through an old invitation or an Organisation login. Public signup, joining and invitations never convert a stored role.

The reviewed membership-management API may explicitly change one staff role to another under its existing authorization, version and last-owner checks. It cannot convert Subscriber to any staff role or staff to Subscriber, even for a platform owner. Invitations are not a role-change mechanism. Revocation/reactivation review remains separate and does not create a second role.

## User-facing messages

An authenticated account holder attempting staff-to-subscriber signup/login sees:

> This email already belongs to an organisation team account. Please sign in under Organisation. Use a different email to become a subscriber in this organisation.

An authorized RA Admin attempting to invite a subscriber sees:

> This person is already listed as a subscriber in this organisation. Use a different email to add them to the organisation team.

A conflicting existing staff role receives a corresponding different-email message. Wrong-capsule login screens link directly to the correct capsule. English/Hindi messages are shared across account, invitation and administration screens.

Public anonymous signup must not reveal whether an arbitrary email is staff or a subscriber. Role-specific signup guidance requires an authenticated session for the exact submitted email; authenticated password sign-in can also return its own role mismatch. Another signed-in identity cannot probe a different email's role. Anonymous duplicate signup keeps the authentication provider's generic response and cannot overwrite the account or membership. Authorized RA administrators can inspect conflicts only in the RA they manage.

## Persistence and concurrency

`auth_users.email` is globally unique and normalized. `tenant_memberships` retains the unique `(tenant_id, user_id)` constraint and a single role column. No schema migration or automatic data conversion is required for this policy. Existing records retain their current role; historical intent is not inferred from earlier invitations or audits.

Invitation issuance and resend check the recipient after authorization and after locking the target tenant. Their transactions use READ COMMITTED so recipient lookups see memberships committed while waiting for that lock. Conflicts are checked before replacing old links, inserting invitations, auditing issuance or sending email.

Acceptance rechecks the recipient's current membership under locks, even for invitations issued before this policy or before subscriber enrolment. A conflict does not consume the invitation or mutate the membership. A pending invitation is not a reserved staff membership: if subscriber enrolment wins a concurrent race, acceptance fails; if staff acceptance wins, subscriber enrolment fails. The tenant lock and unique membership key prevent a dual role.

New invitees can still create a verified account with their locked invited email and chosen password without another verification email. Existing identities/passwords are never overwritten. Matching existing users with no membership in this RA can join through their invitation; an identical existing staff role can complete a same-role invitation. Different-account recovery and Back to my workspaces remain available.

## Regression coverage

Unit tests cover the complete role matrix, signup ownership/privacy, capsule routing, direct account/join requests, enrolment denial, invitation issuance/resend/acceptance, API category conversion and safe messages. MariaDB tests verify current-row enforcement, cross-RA independence, no mutation on rejection and the subscriber-enrolment versus staff-acceptance race. Playwright verifies the displayed messages, zero outgoing invitations for rejected recipients, every current staff role, forged requests, legacy pending links and cross-RA navigation. These tests use disposable databases and captured email; they do not alter application users or send real messages.
