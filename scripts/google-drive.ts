import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, rename, chmod } from "node:fs/promises";
import {
  driveConfig,
  GoogleDriveStorage,
} from "../backend/src/documents/drive";

/** Save only the new refresh token to the ignored backend environment file without printing credentials. */
export async function saveToken(
  token: string,
  file = new URL("../backend/.env", import.meta.url),
) {
  const text = await readFile(file, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "";
      throw error;
    },
  );
  const line = `GOOGLE_DRIVE_REFRESH_TOKEN=${JSON.stringify(token)}`;
  const updated = /^GOOGLE_DRIVE_REFRESH_TOKEN=.*$/m.test(text)
    ? text.replace(/^GOOGLE_DRIVE_REFRESH_TOKEN=.*$/m, line)
    : `${text.trimEnd()}\n${line}\n`;
  const temporary = new URL(
    `.env.drive-${randomBytes(8).toString("hex")}`,
    file,
  );
  await writeFile(temporary, updated, { mode: 0o600, flag: "wx" });
  await rename(temporary, file);
  await chmod(file, 0o600);
}
export type SetupDependencies = {
  request?: typeof fetch;
  serverFactory?: typeof createServer;
  save?: typeof saveToken;
  log?: (message: string) => void;
  timeoutMs?: number;
};
/** Run a one-use loopback consent flow and verify the exact storage account before retaining its token. */
export async function authorize(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: SetupDependencies = {},
) {
  const {
    request = fetch,
    serverFactory = createServer,
    save = saveToken,
    log = console.log,
    timeoutMs = 10 * 60 * 1000,
  } = dependencies;
  const clientId = env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret)
    throw new Error(
      "Set GOOGLE_DRIVE_CLIENT_ID and GOOGLE_DRIVE_CLIENT_SECRET in backend/.env first",
    );
  const state = randomBytes(32).toString("hex");
  const redirect = "http://127.0.0.1:53682/oauth/google-drive";
  const account = env.GOOGLE_DRIVE_ACCOUNT ?? "stocksbuddha@gmail.com";
  await new Promise<void>((resolve, reject) => {
    let busy = false;
    const server = serverFactory(async (req, res) => {
      const url = new URL(req.url ?? "/", redirect);
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.setHeader("Referrer-Policy", "no-referrer");
      if (url.pathname !== "/oauth/google-drive") {
        res.writeHead(404).end("Not found");
        return;
      }
      const returned = url.searchParams.get("state") ?? "";
      if (
        !/^[a-f0-9]{64}$/.test(returned) ||
        !timingSafeEqual(Buffer.from(returned), Buffer.from(state)) ||
        busy
      ) {
        res.writeHead(400).end("Invalid authorization state");
        return;
      }
      busy = true;
      try {
        const code = url.searchParams.get("code");
        if (!code || url.searchParams.has("error"))
          throw new Error("Google authorization was not granted");
        const response = await request("https://oauth2.googleapis.com/token", {
          method: "POST",
          body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirect,
            grant_type: "authorization_code",
          }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        });
        if (!response.ok) throw new Error("Google token exchange failed");
        const tokens = (await response.json()) as { refresh_token?: string };
        if (!tokens.refresh_token)
          throw new Error(
            "Google did not issue an offline token; rerun and grant consent",
          );
        const config = driveConfig({
          ...env,
          GOOGLE_DRIVE_REFRESH_TOKEN: tokens.refresh_token,
        });
        // The exchange supplied a refresh token, so configuration must now be complete.
        await new GoogleDriveStorage(config!, request).verify();
        await save(tokens.refresh_token);
        res.end(
          "Stocksbuddha Drive authorization saved. You can close this tab.",
        );
        log(
          "Verified storage account and private folders. Refresh token saved to backend/.env. Restart the app.",
        );
        resolve();
      } catch (error) {
        res
          .writeHead(400)
          .end("Authorization could not complete. See the local terminal.");
        reject(error);
      } finally {
        clearTimeout(timer);
        server.close();
      }
    });
    const timer = setTimeout(() => {
      server.close();
      reject(new Error("Authorization timed out after 10 minutes"));
    }, timeoutMs);
    server.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    server.listen(53682, "127.0.0.1", () => {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirect,
        response_type: "code",
        scope: "https://www.googleapis.com/auth/drive",
        access_type: "offline",
        prompt: "consent",
        state,
        login_hint: account,
      }).toString();
      log(`Open this URL and sign in as ${account}:\n${url}`);
    });
  });
}
/** Validate stored runtime credentials and folder permissions without uploading customer files. */
export async function check(
  env: NodeJS.ProcessEnv = process.env,
  dependencies: SetupDependencies = {},
) {
  const { request = fetch, log = console.log } = dependencies;
  const config = driveConfig(env);
  if (!config)
    throw new Error(
      "Google Drive is not configured; follow docs/GOOGLE_DRIVE.md",
    );
  await new GoogleDriveStorage(config, request).verify();
  log(
    `Google Drive verified for ${config.account}. Root and Main are private.`,
  );
}
/** Dispatch one setup command and report sanitized failures without exposing OAuth responses or token values. */
export async function main(
  command = process.argv[2],
  env: NodeJS.ProcessEnv = process.env,
  dependencies: SetupDependencies = {},
  reportError = console.error,
) {
  try {
    if (command === "authorize") await authorize(env, dependencies);
    else if (command === "check") await check(env, dependencies);
    else
      throw new Error("Usage: npm run drive:authorize | npm run drive:check");
    return 0;
  } catch (error) {
    reportError(error instanceof Error ? error.message : "Drive setup failed");
    return 1;
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = await main();
