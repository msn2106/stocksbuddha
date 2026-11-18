import { z } from "zod";
import {
  researchOfferings,
  type MarketInstrument,
  type ResearchCheck,
} from "./market";
const id = z.string().uuid();
const price = z.number().finite().positive().max(1e10);
export const researchLegSchema = z
  .object({
    instrumentKey: z.string().min(1).max(160),
    side: z.enum(["buy", "sell", "hold"]),
    quantity: z.number().int().positive().max(10000000),
    horizon: z.enum(["intraday", "swing", "longterm"]),
    entryMin: price,
    entryMax: price,
    stopLoss: price,
    targets: z.array(price).min(1).max(5),
    note: z.string().trim().max(2000),
    rationale: z.string().trim().min(10).max(4000),
  })
  .strict()
  .superRefine((v, c) => {
    if (v.entryMax < v.entryMin)
      c.addIssue({
        code: "custom",
        message: "Entry maximum must be at least the minimum",
        path: ["entryMax"],
      });
    if (
      v.side === "buy" &&
      (v.stopLoss >= v.entryMin || v.targets.some((t) => t <= v.entryMax))
    )
      c.addIssue({
        code: "custom",
        message: "Buy stops must be below entry; targets must be above entry",
        path: ["targets"],
      });
    if (
      v.side === "sell" &&
      (v.stopLoss <= v.entryMax || v.targets.some((t) => t >= v.entryMin))
    )
      c.addIssue({
        code: "custom",
        message: "Sell stops must be above entry; targets must be below entry",
        path: ["targets"],
      });
    if (new Set(v.targets).size !== v.targets.length)
      c.addIssue({
        code: "custom",
        message: "Targets must be distinct",
        path: ["targets"],
      });
  });
export const researchDraftSchema = z
  .object({
    title: z.string().trim().min(3).max(160),
    offering: z.enum(researchOfferings),
    validUntil: z.string().datetime(),
    rationale: z.string().trim().min(20).max(12000),
    disclosures: z.string().trim().min(20).max(6000),
    aiDisclosure: z.string().trim().min(2).max(2000),
    attachmentIds: z.array(id).max(10),
    legs: z.array(researchLegSchema).min(1).max(10),
    audience: z
      .object({
        mode: z.enum(["all", "plans", "groups"]),
        ids: z.array(id).max(100),
      })
      .strict(),
  })
  .strict()
  .superRefine((v, c) => {
    if ((v.offering === "hedges") !== v.legs.length > 1)
      c.addIssue({
        code: "custom",
        message: "Hedges need at least two legs; other offerings use one leg",
        path: ["legs"],
      });
    if (
      v.audience.mode === "all"
        ? v.audience.ids.length > 0
        : v.audience.ids.length === 0
    )
      c.addIssue({
        code: "custom",
        message: "Choose at least one plan or group",
        path: ["audience"],
      });
    if (new Set(v.legs.map((l) => l.instrumentKey)).size !== v.legs.length)
      c.addIssue({
        code: "custom",
        message: "Use each contract only once",
        path: ["legs"],
      });
  });
export const researchSaveSchema = z
  .object({
    id,
    version: z.number().int().nonnegative(),
    draft: researchDraftSchema,
  })
  .strict();
export const researchPublishSchema = z
  .object({
    version: z.number().int().positive(),
    token: z.string().length(64),
    confirmed: z.literal(true),
    reason: z.string().trim().max(2000),
  })
  .strict();
export const researchCloseSchema = z
  .object({
    version: z.number().int().positive(),
    status: z.enum(["closed", "withdrawn"]),
    reason: z.string().trim().min(10).max(2000),
  })
  .strict();
export const researchGroupSchema = z
  .object({
    id,
    version: z.number().int().nonnegative(),
    name: z.string().trim().min(2).max(160),
    membershipIds: z.array(id).max(1000),
  })
  .strict();
export type ResearchDraft = z.infer<typeof researchDraftSchema>;
export type ResearchStatus = "draft" | "active" | "closed" | "withdrawn";
export type ResearchAttachment = {
  id: string;
  name: string;
  mime: string;
  bytes: number;
  sha256: string;
};
export type ResearchSnapshot = Omit<
  ResearchDraft,
  "audience" | "attachmentIds"
> & {
  instruments: MarketInstrument[];
  attachments: ResearchAttachment[];
  issuer: { name: string; registration: string; author: string };
  status: Exclude<ResearchStatus, "draft">;
  reason: string;
  publishedAt: string;
  version: number;
};
export type ResearchItem = {
  id: string;
  version: number;
  status: ResearchStatus;
  draft?: ResearchDraft;
  latest: ResearchSnapshot | null;
  unread: boolean;
  recipientCount?: number;
};
export type ResearchDetail = ResearchItem & { history: ResearchSnapshot[] };
export type ResearchPreview = {
  snapshot: ResearchSnapshot;
  check: ResearchCheck;
  recipientCount: number;
  reasons: string[];
  token: string | null;
};
export type ResearchOptions = {
  plans: { id: string; name: string }[];
  groups: {
    id: string;
    name: string;
    version: number;
    membershipIds: string[];
  }[];
  clients: { id: string; name: string }[];
  attachments: ResearchAttachment[];
};
