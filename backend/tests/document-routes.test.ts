import { test } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import { IncomingMessage, ServerResponse } from "node:http";
import { Duplex } from "node:stream";
import type { Socket } from "node:net";
import type { AuthRoutesDependencies } from "../src/auth/routes";
import type { Workspace } from "../src/auth/workspaces";
import { mountDocuments } from "../src/documents/routes";
import { DocumentError, type DocumentService } from "../src/documents/service";
import { tenants } from "../src/tenants/tenants";

/** Exercise actual document middleware/parsers without opening ports or trusting browser identities. */
function harness() {
  const state = {
    signedIn: true,
    verified: true,
    role: "owner",
    failure: null as unknown,
    calls: [] as { operation: string; context: unknown; input?: unknown }[],
  };
  const auth = {
    api: {
      getSession: async () =>
        state.signedIn
          ? {
              user: {
                id: "authenticated-user",
                name: "User",
                email: "user@test.local",
                emailVerified: state.verified,
              },
              session: { token: "server-only-token" },
            }
          : null,
    },
  } as unknown as AuthRoutesDependencies["auth"];
  const store = {
    find: async (user: string, slug: string) =>
      slug === tenants[0].slug
        ? ({
            tenant: tenants[0],
            membership: { role: state.role },
            capabilities: [],
            user,
          } as unknown as Workspace)
        : null,
  } as unknown as AuthRoutesDependencies["store"];
  const service = {
    list: async (context: unknown, cursor?: string) => {
      state.calls.push({ operation: "list", context, input: cursor });
      if (state.failure) throw state.failure;
      return { configured: true, documents: [] };
    },
    customers: async (context: unknown) => {
      state.calls.push({ operation: "customers", context });
      return [{ id: "subscriber-id", name: "Client" }];
    },
    upload: async (context: unknown, input: unknown) => {
      state.calls.push({ operation: "upload", context, input });
      if (state.failure) throw state.failure;
      return { id: "document-id" };
    },
    download: async (context: unknown, id: string) => {
      state.calls.push({ operation: "download", context, input: id });
      if (state.failure) throw state.failure;
      return {
        name: "proof'().pdf",
        mime: "application/pdf",
        bytes: Buffer.from("%PDF-1.4"),
      };
    },
  } as unknown as DocumentService;
  const app = express();
  mountDocuments(app, {
    auth,
    store,
    service,
    origin: "http://localhost:3000",
    page: (res, _next, tenant, view) => {
      res.json({ tenant, view });
    },
  });
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
            "content-type": "application/pdf",
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
const path = `/api/workspaces/${tenants[0].slug}/documents`;

test("document API uses only authenticated session and server-resolved tenant for lists, customers, raw uploads and attachments", async () => {
  const { state, request } = harness();
  assert.equal((await request(`${path}?before=cursor`)).status, 200);
  assert.equal(state.calls[0].input, "cursor");
  assert.deepEqual(state.calls[0].context, {
    token: "server-only-token",
    tenantId: tenants[0].id,
  });
  assert.equal((await request(`${path}/customers`)).status, 200);
  assert.equal((await request(`${path}?before[bad]=array`)).status, 200);
  const response = await request(path, "POST", Buffer.from("%PDF-1.4"), {
    origin: "http://localhost:3000",
    "x-document-name": "proof%20one.pdf",
    "x-document-kind": "mitc",
    "x-customer-id": "client",
  });
  assert.equal(response.status, 201);
  const input = state.calls.find((call) => call.operation === "upload")!
    .input as { name: string; bytes: Buffer };
  assert.equal(input.name, "proof one.pdf");
  assert.deepEqual(input.bytes, Buffer.from("%PDF-1.4"));
  const file = await request(`${path}/id/download`);
  assert.equal(file.status, 200);
  assert.match(
    String(file.headers["content-disposition"]),
    /attachment;.*%27%28%29/,
  );
  assert.match(file.body, /%PDF/);
  assert.equal((await request("/api/documents")).status, 200);
  assert.deepEqual(state.calls.at(-1)?.context, {
    token: "server-only-token",
    tenantId: null,
  });
});

test("document API denies guests, unverified sessions, wrong workspaces, foreign origins and malformed bodies before upload", async () => {
  const { state, request } = harness();
  state.signedIn = false;
  assert.equal((await request(path)).status, 401);
  state.signedIn = true;
  state.verified = false;
  assert.equal((await request(path)).status, 401);
  state.verified = true;
  assert.equal(
    (await request("/api/workspaces/unknown/documents")).status,
    404,
  );
  assert.equal(
    (
      await request(path, "POST", Buffer.from("pdf"), {
        origin: "https://attacker.test",
      })
    ).status,
    403,
  );
  const headers = {
    origin: "http://localhost:3000",
    "x-document-name": "%bad",
  };
  assert.equal(
    (await request(path, "POST", Buffer.from("pdf"), headers)).status,
    400,
  );
  assert.equal(
    (
      await request(path, "POST", Buffer.from("pdf"), {
        ...headers,
        "content-type": "text/plain",
      })
    ).status,
    400,
  );
  assert.equal(
    (await request(path, "POST", Buffer.alloc(10 * 1024 * 1024 + 1), headers))
      .status,
    413,
  );
  assert.equal(
    state.calls.some((call) => call.operation === "upload"),
    false,
  );
});

test("document API sanitizes provider errors and preserves safe application errors", async () => {
  const { state, request } = harness();
  state.failure = new Error("secret provider details");
  const error = await request(path);
  assert.equal(error.status, 502);
  assert.equal(error.body.includes("secret"), false);
  state.failure = new DocumentError("forbidden", 403);
  assert.equal((await request("/api/documents")).status, 403);
  state.failure = null;
  assert.equal(
    (
      await request(path, "POST", Buffer.from("pdf"), {
        origin: "http://localhost:3000",
      })
    ).status,
    201,
  );
});

test("document pages distinguish platform, staff and investor identity and enforce both workspace audiences", async () => {
  const { state, request } = harness();
  const staff = `/ra/${tenants[0].slug}/workspace/documents`,
    customer = `/ra/${tenants[0].slug}/account/documents`;
  state.signedIn = false;
  assert.equal(
    (await request(staff)).headers.location,
    `/ra/${tenants[0].slug}/login`,
  );
  assert.equal(
    (await request("/workspace/documents")).headers.location,
    "/workspace/login",
  );
  state.signedIn = true;
  assert.equal((await request("/ra/unknown/workspace/documents")).status, 404);
  assert.equal((await request(customer)).status, 403);
  const page = await request(staff);
  assert.equal(JSON.parse(page.body).view.area, "organisation");
  state.role = "subscriber";
  assert.equal((await request(staff)).status, 403);
  assert.equal(
    JSON.parse((await request(customer)).body).view.area,
    "investor",
  );
  assert.equal(
    JSON.parse((await request("/workspace/documents")).body).view.role,
    "platform_owner",
  );
  state.failure = new Error("database error");
  assert.equal((await request(customer)).status, 403);
});
