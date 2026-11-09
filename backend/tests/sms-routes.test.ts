import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { AuthRoutesDependencies } from "../src/auth/routes";
import { mountSms } from "../src/sms/routes";
import type { SmsService } from "../src/sms/service";
import { SmsError } from "../src/sms/policy";
/** Drive the actual Express SMS boundary with controlled authentication and service failures. */
function harness() {
  const state = {
    signedIn: true,
    verified: true,
    workspace: true,
    failure: null as unknown,
    calls: [] as { operation: string; input: unknown[] }[],
  };
  const auth = {
    api: {
      getSession: async () =>
        state.signedIn
          ? {
              user: { id: "user", emailVerified: state.verified },
              session: { token: "private-token" },
            }
          : null,
    },
  } as unknown as AuthRoutesDependencies["auth"];
  const store = {
    find: async () => (state.workspace ? { tenant: { id: "tenant" } } : null),
  } as unknown as AuthRoutesDependencies["store"];
  const service = new Proxy(
    {},
    {
      get:
        (_target, operation) =>
        async (...input: unknown[]) => {
          state.calls.push({ operation: String(operation), input });
          if (state.failure) throw state.failure;
          return { ok: true, challengeId: "id" };
        },
    },
  ) as SmsService;
  const app = express();
  mountSms(app, { auth, store, service, origin: "http://localhost:3000" });
  /** Stream a literal request through Express and collect the HTTP response as the browser would. */
  async function request(
    url: string,
    method = "GET",
    body?: Buffer,
    headers: Record<string, string> = {},
  ) {
    const chunks: Buffer[] = [];
    const socket = new Duplex({
      read() {},
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        done();
      },
    });
    const req = new IncomingMessage(socket as Socket);
    req.url = url;
    req.method = method;
    req.httpVersion = "1.0";
    req.httpVersionMajor = 1;
    req.httpVersionMinor = 0;
    req.complete = true;
    req.headers = {
      host: "localhost:3000",
      ...(body
        ? {
            "content-length": String(body.length),
            "content-type": "application/json",
          }
        : {}),
      ...headers,
    };
    const res = new ServerResponse(req);
    res.assignSocket(socket as Socket);
    try {
      await new Promise<void>((resolve, reject) => {
        res.on("finish", resolve);
        res.on("error", reject);
        app(req, res);
        if (body) req.push(body);
        req.push(null);
      });
      return {
        status: res.statusCode,
        headers: res.getHeaders(),
        body: Buffer.concat(chunks)
          .toString()
          .split("\r\n\r\n")
          .slice(1)
          .join("\r\n\r\n"),
      };
    } finally {
      socket.destroy();
    }
  }
  return { state, request };
}

const path = "/api/sms/alpha";
const origin = { origin: "http://localhost:3000" };
test("private SMS routes require current verified sessions, enforce origins, bound JSON and sanitize errors", async () => {
  const { state, request } = harness();
  for (const route of [
    "settings",
    "mobile",
    "records",
    "records?before=cursor",
  ])
    assert.equal((await request(`${path}/${route}`)).status, 200);
  for (const route of ["settings", "send", "verify", "recovery-contact"])
    assert.equal(
      (await request(`${path}/${route}`, "POST", Buffer.from("{}"), origin))
        .status,
      200,
    );
  assert.equal(
    (await request(`${path}/send`, "POST", Buffer.from("{}"))).status,
    403,
  );
  assert.equal(
    (await request(`${path}/send`, "POST", Buffer.from("{"), origin)).status,
    400,
  );
  assert.equal(
    (
      await request(
        `${path}/send`,
        "POST",
        Buffer.from(JSON.stringify({ text: "x".repeat(9000) })),
        origin,
      )
    ).status,
    413,
  );
  state.signedIn = false;
  assert.equal((await request(`${path}/mobile`)).status, 401);
  state.signedIn = true;
  state.verified = false;
  assert.equal((await request(`${path}/mobile`)).status, 401);
  state.verified = true;
  state.workspace = false;
  assert.equal((await request(`${path}/mobile`)).status, 403);
  state.workspace = true;
  state.failure = new SmsError("sms_rate_limited", 429, 60);
  const limited = await request(`${path}/mobile`);
  assert.equal(limited.status, 429);
  assert.equal(limited.headers["retry-after"], 60);
  state.failure = new Error("private provider credentials");
  const failed = await request(`${path}/mobile`);
  assert.equal(failed.status, 503);
  assert.ok(!failed.body.includes("credentials"));
  assert.ok(state.calls.some((call) => call.operation === "send"));
});
test("public recovery checks confirmation and password bounds without requiring an authenticated session", async () => {
  const { state, request } = harness();
  state.signedIn = false;
  for (const body of [
    {},
    { password: "short", confirmPassword: "short" },
    { password: "x".repeat(129), confirmPassword: "x".repeat(129) },
    { password: "long-password", confirmPassword: "wrong" },
  ]) {
    assert.equal(
      (
        await request(
          `${path}/public/reset`,
          "POST",
          Buffer.from(JSON.stringify(body)),
          origin,
        )
      ).status,
      400,
    );
  }
  assert.equal(
    (
      await request(
        `${path}/public/reset`,
        "POST",
        Buffer.from(
          JSON.stringify({
            challengeId: "id",
            code: "123456",
            password: "new-password",
            confirmPassword: "new-password",
          }),
        ),
        origin,
      )
    ).status,
    200,
  );
  const call = state.calls.find((call) => call.operation === "verify")!;
  assert.equal((call.input[0] as Record<string, unknown>).slug, "alpha");
  assert.equal(
    (call.input[0] as Record<string, unknown>).newPassword,
    "new-password",
  );
});
test("public SMS requests retain uniform generic responses and omit per-account quota details", async () => {
  const { state, request } = harness();
  state.signedIn = false;
  const result = await request(
    `${path}/public/send`,
    "POST",
    Buffer.from(JSON.stringify({ email: "unknown@test.local", key: "key" })),
    origin,
  );
  assert.equal(result.status, 200);
  assert.ok(result.body.includes("If SMS recovery is enabled"));
  assert.equal(JSON.parse(result.body).sendsRemaining, 0);
});
