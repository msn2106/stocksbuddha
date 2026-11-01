-- Run only after AddAuthTenantContext1793491200009 is applied.
-- Replace the placeholders using known historical facts. Run against the intended DB.
-- These queries record provenance only: no membership, role or email verification changes.
-- Existing NULL means unknown/platform context, not a missing authorization grant.

-- 1. Inspect users and known signup origins. No passwords or session tokens are selected.
SELECT u.id, u.email, u.created_at, t.slug AS signup_ra
FROM auth_users u
LEFT JOIN tenants t ON t.id = u.signup_tenant_id
ORDER BY u.created_at, u.id;

-- 2. Backfill each known user's signup RA. Change BOTH values and run this block
-- once for Stocks Buddha, then again for Beta with tenant_slug = 'beta'.
-- A second run leaves the existing origin intact and creates no duplicate audit row.
SET @user_email = 'replace-with-stocksbuddha-user-email';
SET @tenant_slug = 'stocksbuddha';
START TRANSACTION;
SELECT id FROM auth_users WHERE email = LOWER(TRIM(@user_email)) FOR UPDATE;
UPDATE auth_users u
JOIN tenants t ON t.slug = @tenant_slug
SET u.signup_tenant_id = t.id
WHERE u.email = LOWER(TRIM(@user_email)) AND u.signup_tenant_id IS NULL;
SET @updated = ROW_COUNT();
INSERT INTO audit_events
(id, scope, tenant_id, actor_type, action, entity_type, entity_id, reason, metadata_json)
SELECT UUID(), 'tenant', u.signup_tenant_id, 'system', 'auth.signup_context.backfilled',
       'auth_user', u.id, 'Operator supplied historical signup origin; event time is the backfill time',
       JSON_OBJECT('schemaVersion', 1, 'source', 'manual_backfill')
FROM auth_users u
JOIN tenants t ON t.id = u.signup_tenant_id AND t.slug = @tenant_slug
WHERE u.email = LOWER(TRIM(@user_email)) AND @updated = 1;
SELECT u.id, u.email, t.slug AS signup_ra, @updated AS updated_rows
FROM auth_users u LEFT JOIN tenants t ON t.id = u.signup_tenant_id
WHERE u.email = LOWER(TRIM(@user_email));
COMMIT;

-- 3. Optional: inspect existing sessions. Do not infer a session's RA from the
-- signup origin: the same user can log into different RAs. Leave unknowns NULL.
SELECT s.id AS session_id, u.email, s.created_at, s.expires_at, t.slug AS login_ra
FROM auth_sessions s
JOIN auth_users u ON u.id = s.user_id
LEFT JOIN tenants t ON t.id = s.login_tenant_id
ORDER BY s.created_at, s.id;

-- 4. Optional: backfill ONE specific session only when its original login RA is known.
SET @session_id = 'replace-with-a-session-id-from-the-query-above';
SET @user_email = 'replace-with-the-session-owner-email';
SET @tenant_slug = 'stocksbuddha';
START TRANSACTION;
SELECT s.id FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
WHERE s.id = @session_id AND u.email = LOWER(TRIM(@user_email)) FOR UPDATE;
UPDATE auth_sessions s
JOIN auth_users u ON u.id = s.user_id
JOIN tenants t ON t.slug = @tenant_slug
SET s.login_tenant_id = t.id
WHERE s.id = @session_id AND u.email = LOWER(TRIM(@user_email)) AND s.login_tenant_id IS NULL;
SET @updated = ROW_COUNT();
INSERT INTO audit_events
(id, scope, tenant_id, actor_type, action, entity_type, entity_id, reason, metadata_json)
SELECT UUID(), 'tenant', s.login_tenant_id, 'system', 'auth.login_context.backfilled',
       'auth_session', s.id, 'Operator supplied historical login origin; event time is the backfill time',
       JSON_OBJECT('schemaVersion', 1, 'source', 'manual_backfill')
FROM auth_sessions s
JOIN auth_users u ON u.id = s.user_id
JOIN tenants t ON t.id = s.login_tenant_id AND t.slug = @tenant_slug
WHERE s.id = @session_id AND u.email = LOWER(TRIM(@user_email)) AND @updated = 1;
SELECT s.id, u.email, t.slug AS login_ra, @updated AS updated_rows
FROM auth_sessions s JOIN auth_users u ON u.id = s.user_id
LEFT JOIN tenants t ON t.id = s.login_tenant_id
WHERE s.id = @session_id AND u.email = LOWER(TRIM(@user_email));
COMMIT;

-- 5. Query signup/login history, including contexts imported by the operator.
SELECT e.occurred_at, e.action, e.scope, t.slug AS ra, e.entity_type, e.entity_id, e.reason
FROM audit_events e
LEFT JOIN tenants t ON t.id = e.tenant_id
WHERE e.action IN ('auth.signup', 'auth.login', 'auth.signup_context.backfilled', 'auth.login_context.backfilled')
ORDER BY e.occurred_at, e.id;
