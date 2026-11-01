import { test } from "node:test";
import assert from "node:assert/strict";
import type { Response } from "express";
import { makePage } from "../../packages/contracts/tests/fixtures";
import { accountTenant } from "../src/auth/account-tenant";
import { authFailure } from "../src/auth/response-error";

test("anonymous account branding uses only the matching publication and safe fallback before first publication", () => {
  const page = makePage();
  const account = structuredClone(page);
  account.account = { mode: "login" };
  account.tenant!.profile.name = "Unpublished secret";
  assert.deepEqual(accountTenant(account, page), page.tenant);
  const absent = { ...page, tenant: null, website: null };
  for (const mode of [
    "login",
    "signup",
    "verify-email",
    "forgot-password",
    "reset-password",
    "unavailable",
  ] as const) {
    account.account.mode = mode;
    const projection = accountTenant(account, absent)!;
    assert.equal(projection.profile.name, account.tenant!.slug);
    assert.equal(projection.profile.registration, null);
    assert.ok(!JSON.stringify(projection).includes("Unpublished secret"));
  }
  for (const mismatch of [
    { ...page.tenant!, id: "foreign-id" },
    { ...page.tenant!, slug: "foreign-slug" },
  ])
    assert.equal(
      accountTenant(account, { ...page, tenant: mismatch })!.profile.name,
      account.tenant!.slug,
    );
  for (const mode of ["workspace", "join", "invitation"] as const) {
    account.account.mode = mode;
    assert.equal(accountTenant(account, absent), account.tenant);
  }
  delete account.account;
  assert.equal(
    accountTenant(account, absent)!.profile.name,
    account.tenant!.slug,
  );
  assert.equal(accountTenant(absent, page), null);
});

test("authentication throttles retain safe retry seconds and distinguish credential failures", () => {
  const headers: Record<string, unknown> = {};
  const res = {
    setHeader: (key: string, value: unknown) => {
      headers[key] = value;
    },
  } as Response;
  assert.equal(
    authFailure(new Response(null, { status: 401 }), res),
    "credentials",
  );
  for (const delay of [undefined, "", "invalid", "12"]) {
    assert.equal(
      authFailure(
        new Response(null, {
          status: 429,
          ...(delay === undefined ? {} : { headers: { "retry-after": delay } }),
        }),
        res,
      ),
      "throttled",
    );
  }
  assert.equal(headers["Retry-After"], "12");
});
