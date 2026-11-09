/** Stable application statuses independent of a vendor's status vocabulary. */
export type KycVerificationStatus =
  "validated" | "registered" | "on_hold" | "rejected" | "not_found" | "pending";
/** Provider evidence is bound to a specific tenant membership and submitted identity revision. */
export type KycVerificationRequest = {
  tenantId: string;
  membershipId: string;
  submissionVersion: number;
  pan: string;
  dob: string;
  evidence: { type: "pan" | "aadhaar"; documentId: string }[];
};
/** Preserve both normalized and original provider results for later compliance review. */
export type KycVerificationResult = {
  provider: string;
  reference: string;
  status: KycVerificationStatus;
  originalStatus: string;
  checkedAt: string;
  evidenceDocumentId: string;
};
/** Future vendor integrations implement this boundary on the backend; callbacks must additionally authenticate the vendor and match the submission revision. */
export interface KycVerificationProvider {
  readonly id: string;
  readonly mode: "manual" | "automatic";
  verify(request: KycVerificationRequest): Promise<KycVerificationResult>;
}
