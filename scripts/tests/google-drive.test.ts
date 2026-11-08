import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, mkdir, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type {
  createServer,
  RequestListener,
  IncomingMessage,
  ServerResponse,
} from "node:http";
import {
  saveToken,
  authorize,
  check,
  main,
  type SetupDependencies,
} from "../google-drive";
const env = {
  GOOGLE_DRIVE_CLIENT_ID: "test-client",
  GOOGLE_DRIVE_CLIENT_SECRET: "test-secret",
  GOOGLE_DRIVE_ROOT_ID: "root",
  GOOGLE_DRIVE_MAIN_ID: "main",
};

/** Capture a local callback listener and simulate Google without network sockets or real credentials. */
function setupHarness() {
  let handler: RequestListener;
  let onError: (error: Error) => void;
  const state = {
    url: "",
    saved: "",
    closed: 0,
    logs: [] as string[],
    status: 200,
    token: "test-refresh",
    exchangeError: false,
    refreshError: false,
    savedError: false,
    emails: "stocksbuddha@gmail.com",
    signalError: false,
  };
  const server = {
    on(_event: string, listener: (error: Error) => void) {
      onError = listener;
    },
    listen(port: number, host: string, ready: () => void) {
      assert.equal(port, 53682);
      assert.equal(host, "127.0.0.1");
      ready();
      if (state.signalError) onError(new Error("port busy"));
    },
    close() {
      state.closed++;
    },
  };
  const dependencies: SetupDependencies = {
    serverFactory: ((listener: RequestListener) => {
      handler = listener;
      return server;
    }) as unknown as typeof createServer,
    save: async (token) => {
      if (state.savedError) throw new Error("token storage failed");
      state.saved = token;
    },
    log: (message) => {
      state.logs.push(message);
      if (message.includes("https://accounts.google.com"))
        state.url = message.split("\n")[1];
    },
    request: async (input, init) => {
      const url = new URL(String(input));
      if (url.hostname === "oauth2.googleapis.com") {
        if (String(init?.body).includes("authorization_code")) {
          if (state.exchangeError)
            return new Response("private provider details", { status: 400 });
          assert.match(String(init?.body), /client_id=test-client/);
          return Response.json({ refresh_token: state.token || undefined });
        }
        if (state.refreshError) throw "private thrown value";
        return Response.json({ access_token: "test-access", expires_in: 3600 });
      }
      if (url.pathname.endsWith("/about"))
        return Response.json({ user: { emailAddress: state.emails } });
      return Response.json({
        mimeType: "application/vnd.google-apps.folder",
        parents: ["root"],
        permissions: [
          {
            type: "user",
            role: "owner",
            emailAddress: "stocksbuddha@gmail.com",
          },
        ],
      });
    },
  };
  /** Deliver a browser callback and capture its safe response text and status. */
  async function callback(query: string, pathname = "/oauth/google-drive") {
    const response = {
      status: 200,
      text: "",
      setHeader() {},
      writeHead(status: number) {
        this.status = status;
        return this;
      },
      end(text: string) {
        this.text = text;
      },
    };
    await handler!(
      { url: `${pathname}?${query}` } as IncomingMessage,
      response as unknown as ServerResponse,
    );
    return response;
  }
  /** Use the current one-time state in a simulated successful Google redirect. */
  function query(extra = "code=authorization-code") {
    return `state=${new URL(state.url).searchParams.get("state")}&${extra}`;
  }
  return { state, dependencies, callback, query };
}

test("Drive token persistence creates, replaces and protects only the chosen environment file", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "sb-drive-token-"));
  const file = pathToFileURL(path.join(directory, ".env"));
  try {
    await saveToken("first-token", file);
    assert.match(
      await readFile(file, "utf8"),
      /GOOGLE_DRIVE_REFRESH_TOKEN="first-token"/,
    );
    await saveToken("replacement-token", file);
    const text = await readFile(file, "utf8");
    assert.equal(text.split("GOOGLE_DRIVE_REFRESH_TOKEN=").length, 2);
    assert.equal(text.includes("first-token"), false);
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(directory), [".env"]);
    const bad = pathToFileURL(path.join(directory, "directory"));
    await mkdir(bad);
    await assert.rejects(saveToken("token", bad), /EISDIR/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Drive authorization verifies the storage identity before saving and rejects unrelated browser callbacks", async () => {
  const { state, dependencies, callback, query } = setupHarness();
  const operation = authorize(env, dependencies);
  const url = new URL(state.url);
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(
    url.searchParams.get("scope"),
    "https://www.googleapis.com/auth/drive",
  );
  assert.equal((await callback("", "/favicon.ico")).status, 404);
  assert.equal((await callback("")).status, 400);
  assert.equal((await callback(`state=${"a".repeat(64)}`)).status, 400);
  const response = await callback(query());
  await operation;
  assert.equal(response.status, 200);
  assert.equal(state.saved, "test-refresh");
  assert.equal(state.closed, 1);
  assert.equal(
    state.logs.some((message) => message.includes("test-refresh")),
    false,
  );
});

test("Drive authorization rejects missing credentials, declined consent, missing tokens and failed exchanges without saving", async () => {
  await assert.rejects(authorize({}), /Set GOOGLE_DRIVE_CLIENT_ID/);
  for (const reason of [
    "denied",
    "code",
    "token",
    "exchange",
    "config",
    "identity",
    "save",
  ]) {
    const { state, dependencies, callback, query } = setupHarness();
    if (reason === "token") state.token = "";
    if (reason === "exchange") state.exchangeError = true;
    if (reason === "identity") state.emails = "other@example.test";
    if (reason === "save") state.savedError = true;
    const operation = authorize(
      reason === "config" ? { ...env, GOOGLE_DRIVE_ROOT_ID: "" } : env,
      dependencies,
    );
    const failure = assert.rejects(operation);
    const response = await callback(
      query(
        reason === "denied"
          ? "error=access_denied&code=present"
          : reason === "code"
            ? ""
            : "code=authorization-code",
      ),
    );
    await failure;
    assert.equal(response.status, 400);
    assert.equal(state.saved, "");
    assert.equal(state.closed, 1);
    assert.equal(
      (await callback(query())).status,
      400,
      "one-use handler rejects replay",
    );
  }
});

test("Drive authorization expires abandoned flows and reports loopback listener failures", async () => {
  const timeout = setupHarness();
  await assert.rejects(
    authorize(env, { ...timeout.dependencies, timeoutMs: 1 }),
    /timed out/,
  );
  assert.equal(timeout.state.closed, 1);
  const busy = setupHarness();
  busy.state.signalError = true;
  await assert.rejects(authorize(env, busy.dependencies), /port busy/);
});

test("Drive setup command dispatch verifies configuration and sanitizes command failures", async () => {
  const { state, dependencies, callback, query } = setupHarness();
  await assert.rejects(check({}, dependencies), /not configured/);
  await check({ ...env, GOOGLE_DRIVE_REFRESH_TOKEN: "refresh" }, dependencies);
  assert.ok(
    state.logs.some((message) => message.includes("Root and Main are private")),
  );
  const errors: string[] = [];
  assert.equal(
    await main(
      "check",
      { ...env, GOOGLE_DRIVE_REFRESH_TOKEN: "refresh" },
      dependencies,
      (error) => errors.push(error),
    ),
    0,
  );
  const operation = main(
    "authorize",
    { ...env, GOOGLE_DRIVE_ACCOUNT: "stocksbuddha@gmail.com" },
    dependencies,
  );
  await callback(query());
  assert.equal(await operation, 0);
  assert.equal(
    await main("unknown", {}, dependencies, (error) => errors.push(error)),
    1,
  );
  state.refreshError = true;
  assert.equal(
    await main(
      "check",
      { ...env, GOOGLE_DRIVE_REFRESH_TOKEN: "refresh" },
      dependencies,
      (error) => errors.push(error),
    ),
    1,
  );
  assert.equal(errors.at(-1), "Drive setup failed");
  const script = fileURLToPath(new URL("../google-drive.ts", import.meta.url));
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", script, "unknown"],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage:/);
});
