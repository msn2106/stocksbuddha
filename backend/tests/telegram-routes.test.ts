import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { AuthRoutesDependencies } from "../src/auth/routes";
import { mountTelegram } from "../src/telegram/routes";
import type { TelegramService } from "../src/telegram/service";
import { OnboardingError } from "../src/onboarding/domain";
/** Drive the actual Express Telegram boundary with controlled authentication and service failures. */
function harness() {
  const state = {
    signedIn: true,
    verified: true,
    workspace: true,
    role: "owner",
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
    find: async () =>
      state.workspace
        ? { tenant: { id: "tenant" }, membership: { role: state.role } }
        : null,
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
  ) as TelegramService;
  const app = express();
  mountTelegram(app, { auth, store, service, origin: "http://localhost:3000" });
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

test("Telegram account routes enforce sessions, roles, origin and sanitized failures", async () => {
  const { state, request } = harness();
  const base = "/api/workspaces/alpha/telegram",
    origin = { origin: "http://localhost:3000" };
  assert.equal((await request(base)).status, 200);
  assert.equal((await request(base)).headers["cache-control"], "no-store");
  for (const action of ["connect", "invite", "unlink"]) {
    assert.equal(
      (await request(`${base}/${action}`, "POST", undefined, origin)).status,
      200,
    );
    assert.equal((await request(`${base}/${action}`, "POST")).status, 403);
  }
  state.signedIn = false;
  assert.equal((await request(base)).status, 401);
  state.signedIn = true;
  state.verified = false;
  assert.equal((await request(base)).status, 401);
  state.verified = true;
  state.workspace = false;
  assert.equal((await request(base)).status, 403);
  state.workspace = true;
  state.role = "analyst";
  assert.equal((await request(base)).status, 403);
  state.role = "subscriber";
  assert.equal((await request(base)).status, 200);
  assert.deepEqual(state.calls.at(-1)?.input, [
    { token: "private-token", tenantId: "tenant" },
    false,
  ]);
  state.failure = new OnboardingError("telegram_not_connected", 409);
  assert.equal((await request(base)).status, 409);
  state.failure = new Error("private token provider details");
  const failure = await request(base);
  assert.equal(failure.status, 503);
  assert.equal(failure.body.includes("private"), false);
});

test("Telegram webhook passes its secret to service authorization without requiring a browser session", async () => {
  const { state, request } = harness();
  state.signedIn = false;
  const url = "/api/telegram/tenant/webhook";
  const response = await request(url, "POST", Buffer.from('{"update_id":1}'), {
    "x-telegram-bot-api-secret-token": "synthetic-secret",
  });
  assert.equal(response.status, 200);
  assert.deepEqual(state.calls.at(-1)?.input, [
    "tenant",
    "synthetic-secret",
    { update_id: 1 },
  ]);
  state.failure = new OnboardingError("forbidden", 403);
  assert.equal((await request(url, "POST", Buffer.from("{}"))).status, 403);
  const tooLarge = await request(
    url,
    "POST",
    Buffer.from(JSON.stringify({ text: "x".repeat(40000) })),
  );
  assert.equal(tooLarge.status, 413);
});
