import * as Sentry from "@sentry/node";

export type BackgroundStage =
  | "sms_low_balance"
  | "sms_security_notice_failed"
  | "delivery"
  | "reconciliation"
  | "worker"
  | "delivery_queue_age"
  | "payment_queue_age"
  | "storage_orphan";
/** Emit only fixed classifications and internal correlation IDs, never caught exceptions or provider payloads. */
export function reportBackground(stage: BackgroundStage, orderId?: string) {
  const scope = new Sentry.Scope();
  scope.setClient(Sentry.getClient());
  scope.setTag("background_stage", stage);
  if (orderId) scope.setTag("order_id", orderId);
  scope.setFingerprint(["background", stage]);
  Sentry.withIsolationScope(new Sentry.Scope(), () =>
    Sentry.withScope(scope, () =>
      Sentry.captureEvent({
        message: `Background operation requires attention: ${stage}`,
        level:
          stage.endsWith("queue_age") || stage === "sms_low_balance"
            ? "warning"
            : "error",
      }),
    ),
  );
}
