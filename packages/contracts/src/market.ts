import { z } from "zod";

export const researchOfferings = [
  "equity",
  "futures",
  "options",
  "hedges",
] as const;
export type ResearchOffering = (typeof researchOfferings)[number];
export type MarketInstrument = {
  key: string;
  name: string;
  symbol: string;
  exchange: string;
  type: "EQ" | "FUT" | "CE" | "PE" | "INDEX";
  underlying: string;
  expiry: string | null;
  strike: number | null;
  lotSize: number;
  tickSize: number;
};
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      Number.isFinite(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
  );
const label = z.string().trim().min(1).max(160);
export const tradeSchema = z
  .object({
    instrumentKey: label,
    person: label,
    account: label,
    date,
    side: z.enum(["buy", "sell"]),
    quantity: z.number().positive().max(1e12),
    note: z.string().trim().max(1000).default(""),
  })
  .strict();
export const holdingSchema = z
  .object({
    instrumentKey: label,
    person: label,
    account: label,
    quantity: z.number().positive().max(1e12),
  })
  .strict();
export const externalSchema = z
  .object({
    instrumentKey: label,
    publishedOn: date,
    direction: z.enum(["buy", "sell", "hold"]),
    audience: z.string().trim().min(1).max(500),
    rationale: z.string().trim().min(10).max(4000),
  })
  .strict();
export const marketMutationSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("trade"),
      version: z.number().int().nonnegative(),
      value: tradeSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("holding"),
      version: z.number().int().nonnegative(),
      value: holdingSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("external"),
      version: z.number().int().nonnegative(),
      value: externalSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("declare"),
      version: z.number().int().nonnegative(),
      coveredFrom: date,
      confirmed: z.literal(true),
    })
    .strict(),
  z
    .object({
      action: z.literal("close"),
      version: z.number().int().nonnegative(),
      id: z.string().uuid(),
      reason: z.string().trim().min(10).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("correct"),
      version: z.number().int().nonnegative(),
      id: z.string().uuid(),
      reason: z.string().trim().min(10).max(1000),
    })
    .strict(),
  z
    .object({
      action: z.literal("plan"),
      version: z.number().int().nonnegative(),
      planId: z.string().uuid(),
      offerings: z
        .array(z.enum(researchOfferings))
        .max(4)
        .refine((v) => new Set(v).size === v.length),
    })
    .strict(),
]);
export type MarketMutation = z.infer<typeof marketMutationSchema>;
export type DeclaredTrade = z.infer<typeof tradeSchema> & {
  id: string;
  instrument: MarketInstrument;
  recordedAt: string;
  voidReason?: string;
};
export type DeclaredHolding = z.infer<typeof holdingSchema> & {
  id: string;
  instrument: MarketInstrument;
  recordedAt: string;
  voidReason?: string;
};
export type ExternalRecommendation = z.infer<typeof externalSchema> & {
  sourceResearchId?: string;
  id: string;
  instrument: MarketInstrument;
  recordedAt: string;
  closedOn?: string;
  closeReason?: string;
};
export type MarketState = {
  version: number;
  trades: DeclaredTrade[];
  holdings: DeclaredHolding[];
  recommendations: ExternalRecommendation[];
  declaration: {
    at: string;
    coveredFrom: string;
    actorId: string;
    invalidated?: boolean;
  } | null;
};
export type MarketView = MarketState & {
  today: string;
  requiredFrom: string;
  declarationCurrent: boolean;
  catalogue: {
    count: number;
    importedAt: string;
    sourceModified: string | null;
    stale: boolean;
  } | null;
  plans: { id: string; name: string; offerings: ResearchOffering[] }[];
};
export type ResearchCheck = {
  allowed: boolean;
  reasons: string[];
  conflicts: { id: string; symbol: string; date: string; until: string }[];
};
/** Shared draft contract; publication is a separate, server-authorized operation. */
export const recommendationSchema = z
  .object({
    title: label,
    offering: z.enum(researchOfferings),
    rationale: z.string().trim().min(20).max(12000),
    disclosures: z.string().trim().min(10).max(6000),
    horizon: z.enum(["intraday", "swing", "longterm"]),
    validUntil: z.string().datetime(),
    attachmentIds: z.array(z.string().uuid()).max(10),
    legs: z
      .array(
        z
          .object({
            instrumentKey: label,
            side: z.enum(["buy", "sell"]),
            lots: z.number().int().positive().max(10000),
            entryMin: z.number().positive(),
            entryMax: z.number().positive(),
            stopLoss: z.number().nonnegative(),
            targets: z.array(z.number().positive()).min(1).max(5),
            priceBasis: z.enum(["instrument", "underlying"]),
          })
          .strict()
          .refine((v) => v.entryMax >= v.entryMin),
      )
      .min(1)
      .max(10),
  })
  .strict();
