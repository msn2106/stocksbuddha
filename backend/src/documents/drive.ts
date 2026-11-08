import { randomUUID } from "node:crypto";
import { maxDocumentBytes, uuidPattern } from "./policy";

export type DriveConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  rootId: string;
  mainId: string;
  account: string;
};
type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  trashed?: boolean;
  appProperties?: Record<string, string>;
  permissions?: { type: string; role: string; emailAddress?: string }[];
};
const folderMime = "application/vnd.google-apps.folder";
/** Read optional server-only credentials; partial configuration fails instead of silently disabling storage. */
export function driveConfig(env: NodeJS.ProcessEnv): DriveConfig | null {
  const keys = [
    "GOOGLE_DRIVE_CLIENT_ID",
    "GOOGLE_DRIVE_CLIENT_SECRET",
    "GOOGLE_DRIVE_REFRESH_TOKEN",
  ];
  if (!keys.some((key) => env[key])) return null;
  if (
    keys.some((key) => !env[key]) ||
    !env.GOOGLE_DRIVE_ROOT_ID ||
    !env.GOOGLE_DRIVE_MAIN_ID
  )
    throw new Error("Google Drive configuration is incomplete");
  for (const id of [env.GOOGLE_DRIVE_ROOT_ID, env.GOOGLE_DRIVE_MAIN_ID])
    if (!/^[\w-]+$/.test(id!))
      throw new Error("Invalid Google Drive folder ID");
  return {
    clientId: env.GOOGLE_DRIVE_CLIENT_ID!,
    clientSecret: env.GOOGLE_DRIVE_CLIENT_SECRET!,
    refreshToken: env.GOOGLE_DRIVE_REFRESH_TOKEN!,
    rootId: env.GOOGLE_DRIVE_ROOT_ID,
    mainId: env.GOOGLE_DRIVE_MAIN_ID,
    account: env.GOOGLE_DRIVE_ACCOUNT ?? "stocksbuddha@gmail.com",
  };
}
/** Access private Drive files with server-held OAuth credentials; never return provider credentials or URLs. */
export class GoogleDriveStorage {
  private token = "";
  private expires = 0;
  private refresh?: Promise<void>;
  /** Inject fetch for provider-contract tests without transmitting customer documents. */
  constructor(
    readonly config: DriveConfig,
    private readonly request: typeof fetch = fetch,
  ) {}
  /** Refresh short-lived access tokens with one in-flight request per process. */
  private async accessToken() {
    if (this.expires > Date.now()) return this.token;
    this.refresh ??= (async () => {
      const response = await this.request(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          body: new URLSearchParams({
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
            refresh_token: this.config.refreshToken,
            grant_type: "refresh_token",
          }),
          signal: AbortSignal.timeout(15000),
          redirect: "error",
        },
      );
      if (!response.ok) throw new Error("drive_authorization_failed");
      const data = (await response.json()) as {
        access_token?: string;
        expires_in?: number;
      };
      if (!data.access_token || !data.expires_in)
        throw new Error("drive_authorization_failed");
      this.token = data.access_token;
      this.expires = Date.now() + Math.max(0, data.expires_in - 60) * 1000;
    })();
    try {
      await this.refresh;
    } finally {
      this.refresh = undefined;
    }
    return this.token;
  }
  /** Issue bounded HTTPS API requests without forwarding redirects or exposing provider error bodies. */
  private async api(path: string, init: RequestInit = {}) {
    const response = await this.request(`https://www.googleapis.com/${path}`, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${await this.accessToken()}`,
      },
      signal: AbortSignal.timeout(30000),
      redirect: "error",
    });
    if (!response.ok) throw new Error("drive_request_failed");
    return response;
  }
  /** Reject folders shared beyond the storage account, including permissions inherited from a parent. */
  async privateFolder(id: string, parent?: string) {
    const response = await this.api(
      `drive/v3/files/${encodeURIComponent(id)}?fields=id,mimeType,parents,trashed,permissions(type,role,emailAddress)`,
    );
    const file = (await response.json()) as DriveFile;
    if (
      file.mimeType !== folderMime ||
      file.trashed ||
      (parent && !file.parents?.includes(parent)) ||
      !file.permissions?.length ||
      file.permissions.some(
        (p) =>
          p.type !== "user" ||
          p.role !== "owner" ||
          p.emailAddress?.toLowerCase() !== this.config.account.toLowerCase(),
      )
    )
      throw new Error("drive_folder_not_private");
  }
  /** Verify the runtime identity and both configured roots before handling sensitive documents. */
  async verify() {
    const response = await this.api(
      "drive/v3/about?fields=user(emailAddress),storageQuota(limit,usage)",
    );
    const data = (await response.json()) as {
      user?: { emailAddress?: string };
    };
    if (
      data.user?.emailAddress?.toLowerCase() !==
      this.config.account.toLowerCase()
    )
      throw new Error("drive_account_mismatch");
    await this.privateFolder(this.config.rootId);
    await this.privateFolder(this.config.mainId, this.config.rootId);
  }
  /** Reuse exactly one named child; callers serialize creation with a database lock. */
  async folder(parent: string, name: string) {
    if (!/^[\w-]+$/.test(parent) || !/^[\w-]+$/.test(name))
      throw new Error("invalid_folder");
    const query = new URLSearchParams({
      q: `'${parent}' in parents and name='${name}' and mimeType='${folderMime}' and trashed=false`,
      fields: "files(id),nextPageToken",
      pageSize: "2",
    });
    const response = await this.api(`drive/v3/files?${query}`);
    const data = (await response.json()) as {
      files: { id: string }[];
      nextPageToken?: string;
    };
    if (data.files.length > 1 || data.nextPageToken)
      throw new Error("drive_duplicate_folder");
    let id = data.files[0]?.id;
    if (!id) {
      const created = await this.api("drive/v3/files?fields=id", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, mimeType: folderMime, parents: [parent] }),
      });
      id = ((await created.json()) as { id: string }).id;
    }
    await this.privateFolder(id, parent);
    return id;
  }
  /** Resolve RA ownership by immutable metadata, adopting UUID folders without merging matching display names. */
  async tenantFolder(tenantId: string, displayName: string) {
    const name = displayName.trim();
    if (
      !uuidPattern.test(tenantId) ||
      !name ||
      name.length > 160 ||
      Array.from(name).some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      )
    )
      throw new Error("invalid_tenant_folder");
    const parent = this.config.rootId;
    const owned = await this.findTenantFolder(
      parent,
      `appProperties has { key='stocksbuddhaTenantId' and value='${tenantId}' }`,
    );
    const folder =
      owned ?? (await this.findTenantFolder(parent, `name='${tenantId}'`));
    if (folder) {
      if (
        folder.appProperties?.stocksbuddhaTenantId &&
        folder.appProperties.stocksbuddhaTenantId !== tenantId
      )
        throw new Error("drive_tenant_folder_conflict");
      await this.privateFolder(folder.id, parent);
      if (
        folder.name !== name ||
        folder.appProperties?.stocksbuddhaTenantId !== tenantId
      ) {
        await this.api(
          `drive/v3/files/${encodeURIComponent(folder.id)}?fields=id`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name,
              appProperties: {
                ...folder.appProperties,
                stocksbuddhaTenantId: tenantId,
              },
            }),
          },
        );
      }
      return folder.id;
    }
    // Drive allows identical names. Ownership metadata, not a name match, identifies each RA.
    const response = await this.api("drive/v3/files?fields=id", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        mimeType: folderMime,
        parents: [parent],
        appProperties: { stocksbuddhaTenantId: tenantId },
      }),
    });
    const created = (await response.json()) as { id: string };
    await this.privateFolder(created.id, parent);
    return created.id;
  }
  /** Reject ambiguous tenant matches instead of selecting an arbitrary Drive folder. */
  private async findTenantFolder(parent: string, predicate: string) {
    const query = new URLSearchParams({
      q: `'${parent}' in parents and (${predicate}) and mimeType='${folderMime}' and trashed=false`,
      fields: "files(id,name,appProperties),nextPageToken",
      pageSize: "2",
    });
    const response = await this.api(`drive/v3/files?${query}`);
    const data = (await response.json()) as {
      files: DriveFile[];
      nextPageToken?: string;
    };
    if (data.files.length > 1 || data.nextPageToken)
      throw new Error("drive_duplicate_tenant_folder");
    return data.files[0];
  }
  /** Upload a new object; a generated application UUID prevents overwriting retained evidence. */
  async upload(
    parent: string,
    name: string,
    mime: string,
    bytes: Buffer,
    documentId: string,
  ) {
    const boundary = `sb_${randomUUID()}`;
    const metadata = {
      name: `${documentId}-${name}`,
      parents: [parent],
      appProperties: { stocksbuddhaDocumentId: documentId },
    };
    const body = Buffer.concat([
      Buffer.from(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`,
      ),
      bytes,
      Buffer.from(`\r\n--${boundary}--\r\n`),
    ]);
    const response = await this.api(
      "upload/drive/v3/files?uploadType=multipart&fields=id",
      {
        method: "POST",
        headers: { "Content-Type": `multipart/related; boundary=${boundary}` },
        body,
      },
    );
    return ((await response.json()) as { id: string }).id;
  }
  /** Verify the recorded parent before downloading bounded bytes through the authenticated backend. */
  async download(id: string, parent: string) {
    await this.privateFolder(parent);
    const response = await this.api(
      `drive/v3/files/${encodeURIComponent(id)}?fields=parents,trashed,permissions(type,role,emailAddress)`,
    );
    const file = (await response.json()) as DriveFile;
    if (
      file.trashed ||
      !file.parents?.includes(parent) ||
      !file.permissions?.length ||
      file.permissions.some(
        (p) =>
          p.type !== "user" ||
          p.role !== "owner" ||
          p.emailAddress?.toLowerCase() !== this.config.account.toLowerCase(),
      )
    )
      throw new Error("drive_file_not_private");
    const content = await this.api(
      `drive/v3/files/${encodeURIComponent(id)}?alt=media`,
    );
    const reader = content.body?.getReader();
    if (!reader) throw new Error("drive_empty_download");
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        length += chunk.value.length;
        if (length > maxDocumentBytes)
          throw new Error("drive_oversized_download");
        chunks.push(Buffer.from(chunk.value));
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  }
}
