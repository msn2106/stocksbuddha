export const documentKinds = [
  "kyc",
  "mitc",
  "recommendation",
  "general",
  "contract",
  "owner",
] as const;
export type DocumentKind = (typeof documentKinds)[number];
export type DocumentActor = {
  id: string;
  tenantId: string | null;
  platformOwner: boolean;
  role: string | null;
  membershipId: string | null;
};
export type DocumentTarget = {
  tenantId: string | null;
  kind: DocumentKind;
  customerId: string | null;
};
export const maxDocumentBytes = 10 * 1024 * 1024;
export const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Enforce document-specific roles; research staff cannot read customer identity documents. */
export function documentAllowed(
  actor: DocumentActor,
  target: DocumentTarget,
  write: boolean,
): boolean {
  if (
    !documentKinds.includes(target.kind) ||
    actor.tenantId !== target.tenantId
  )
    return false;
  if (target.kind === "contract" || target.kind === "owner")
    return (
      actor.platformOwner &&
      actor.tenantId === null &&
      target.customerId === null
    );
  if (!actor.tenantId) return false;
  if (
    target.kind === "general" ? target.customerId !== null : !target.customerId
  )
    return false;
  if (actor.role === "owner") return true;
  if (target.kind === "general")
    return actor.role === "analyst" || (!write && actor.role === "support");
  if (target.kind === "recommendation")
    return (
      actor.role === "analyst" ||
      (!write &&
        actor.role === "subscriber" &&
        actor.membershipId === target.customerId)
    );
  return (
    actor.role === "support" ||
    (actor.role === "subscriber" && actor.membershipId === target.customerId)
  );
}
/** Validate actual file signatures, bounded filenames and sizes before storing PDF/JPEG/PNG bytes. */
export function validateDocument(name: string, mime: string, bytes: Buffer) {
  const signatures: Record<string, boolean> = {
    "application/pdf": bytes.subarray(0, 5).toString() === "%PDF-",
    "image/jpeg": bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff,
    "image/png": bytes
      .subarray(0, 8)
      .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
  };
  const extensions: Record<string, RegExp> = {
    "application/pdf": /\.pdf$/i,
    "image/jpeg": /\.jpe?g$/i,
    "image/png": /\.png$/i,
  };
  if (
    !name ||
    name.length > 160 ||
    Array.from(name).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    /[/\\]/.test(name) ||
    !extensions[mime]?.test(name) ||
    !signatures[mime] ||
    !bytes.length ||
    bytes.length > maxDocumentBytes
  )
    throw new Error("invalid_document");
}
