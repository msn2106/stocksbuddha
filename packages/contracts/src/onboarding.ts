/** Public onboarding projections contain application IDs only, never provider credentials. */
export type Plan = {
  id: string;
  name: string;
  description: string;
  days: number;
  price: number;
  taxBps: number;
  active: boolean;
  version: number;
};
export type Coupon = {
  id: string;
  code: string;
  type: "percent" | "fixed";
  value: number;
  planId: string | null;
  startsAt: string;
  endsAt: string;
  limit: number;
  perUser: number;
  active: boolean;
  version: number;
};
export type KycProfile = {
  fullName: string;
  phone: string;
  pan: string;
  dob: string;
  documentId: string;
  familyPan: string;
  declaration: boolean;
};
export type KycView = {
  mobileVerified?: boolean;
  verifiedMobile?: string;
  id: string;
  name: string;
  email: string;
  status:
    | "not_started"
    | "draft"
    | "pending"
    | "changes"
    | "rejected"
    | "verified"
    | "skipped_dev";
  version: number;
  profile: KycProfile;
  reason: string;
  provider: string;
  checkedAt: string | null;
};
export type AgreementSettings = {
  terms: string;
  version: number;
  reviewed: boolean;
  contact: string;
  address: string;
  gstin: string;
  annualLimit: number;
};
export type OrderView = {
  id: string;
  status: string;
  paymentMethod?: "qr" | "cashfree" | null;
  planName: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  days: number;
  text: string;
  hash: string;
  expiresAt: string;
  signedAt: string | null;
  startsAt: string | null;
  endsAt: string | null;
  agreementId: string | null;
  invoiceId: string | null;
  dev: boolean;
};
export type OnboardingView = {
  admin: boolean;
  devSkip: boolean;
  signingEnabled: boolean;
  paymentEnabled: boolean;
  qrEnabled?: boolean;
  plans: Plan[];
  coupons: Coupon[];
  settings: AgreementSettings | null;
  users: KycView[];
  customer: KycView | null;
  orders: OrderView[];
  nextCursor: string | null;
};
