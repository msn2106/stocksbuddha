import { AsyncLocalStorage } from "node:async_hooks";

const context = new AsyncLocalStorage<{ tenantId: string | null }>();

/** Scope authentication provenance to the server-resolved tenant for this asynchronous request. */
export function withAuthTenant<T>(tenantId: string | null, action: () => T): T {
  return context.run({ tenantId }, action);
}

/** Read provenance only from the trusted server scope; unscoped/core API calls remain global. */
export function currentAuthTenant(): string | null {
  return context.getStore()?.tenantId ?? null;
}
