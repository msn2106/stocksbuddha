import { useEffect, useState, type FormEvent } from "react";
import { QrCode, CreditCard, Clock3 } from "lucide-react";
import type { OnboardingView, OrderView } from "@ra/contracts";
import { privateRequest } from "../websites/settings-ui";

type Result = Record<string, unknown>;
type Action = (action: string, body: Result) => Promise<Result>;
type Run = (
  task: () => Promise<unknown>,
  message?: string,
  refresh?: boolean,
) => Promise<void>;
export type QrConfiguration = {
  version: number;
  enabled: boolean;
  payee: string;
  upiId: string;
  instructions: string;
  image: string;
};
type QrPayment = {
  orderId: string;
  total: number;
  status: string;
  version: number;
  config: QrConfiguration;
  reference: string;
  paidAt: string | null;
  reason: string;
};
/** Format frozen integer-paise totals consistently in payment and review views. */
const money = (paise: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(
    paise / 100,
  );

/** Bound local files before conversion; the server independently verifies type, bytes and size. */
export async function paymentFile(file: File, proof = false): Promise<string> {
  if (
    file.size > (proof ? 2 : 1) * 1024 * 1024 ||
    ![
      "image/png",
      "image/jpeg",
      ...(proof ? ["application/pdf"] : []),
    ].includes(file.type)
  )
    throw new Error("invalid_payment_file");
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("invalid_payment_file"));
    reader.readAsDataURL(file);
  });
}

/** Track the server-issued deadline so an open checkout changes state when its window ends. */
export function useCheckoutExpired(expiresAt?: string): boolean {
  const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
  const [expired, setExpired] = useState(
    () => Number.isFinite(deadline) && deadline <= Date.now(),
  );
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    /** Recheck the absolute deadline and cap long fixture deadlines without overflowing browser timers. */
    function update() {
      const remaining = deadline - Date.now();
      setExpired(Number.isFinite(deadline) && remaining <= 0);
      if (remaining > 0)
        timer = setTimeout(update, Math.min(remaining + 1, 2147483647));
    }
    update();
    return () => clearTimeout(timer);
  }, [deadline]);
  return expired;
}

/** Explain why expired quotes cannot collect fees and point to the fresh plan/agreement flow. */
export function ExpiredCheckoutNotice({ hi }: { hi: boolean }) {
  return (
    <div className="workspace-notice" role="status">
      <p>
        {hi
          ? "इस चेकआउट की समय सीमा समाप्त हो गई है। भुगतान से पहले योजना फिर चुनें और नवीनतम राशि तथा MITC की समीक्षा करें।"
          : "This checkout has expired. Choose a plan again and review the latest price and MITC before paying."}
      </p>
      <a className="button secondary" href="#choose-plan">
        {hi ? "योजना फिर चुनें" : "Choose a plan again"}
      </a>
    </div>
  );
}

/** Default to QR, exposing instructions only after the server reserves an agreement-bound payment. */
export function PaymentChooser({
  order,
  view,
  action,
  run,
  pending,
  hi,
  api,
  checkout,
}: {
  order: OrderView;
  view: OnboardingView;
  action: Action;
  run: Run;
  pending: boolean;
  hi: boolean;
  api: string;
  checkout: (session: string, mode: string) => Promise<boolean>;
}) {
  const [method, setMethod] = useState(view.qrEnabled ? "qr" : "cashfree"),
    [payment, setPayment] = useState<QrPayment | null>(null),
    [loadError, setLoadError] = useState(false);
  const expired = useCheckoutExpired(order.expiresAt);
  const qr = order.paymentMethod === "qr";
  /** Recover the frozen payment after reload, including proof submission after quote expiry. */
  async function load() {
    setLoadError(false);
    try {
      setPayment(await privateRequest(`${api}/qr-payment/${order.id}`));
    } catch {
      setLoadError(true);
    }
  }
  useEffect(() => {
    let live = true;
    if (qr)
      privateRequest(`${api}/qr-payment/${order.id}`)
        .then((value) => {
          if (live) setPayment(value);
        })
        .catch(() => {
          if (live) setLoadError(true);
        });
    return () => {
      live = false;
    };
  }, [api, order.id, qr]);
  /** Retain the exact reference and evidence, then refresh the review state. */
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      async () => {
        const proof = await paymentFile(form.get("proof") as File, true);
        await action("qr-submit", {
          orderId: order.id,
          reference: form.get("reference"),
          paidAt: new Date(String(form.get("paidAt"))).toISOString(),
          proof,
        });
        await load();
      },
      hi
        ? "भुगतान प्रमाण जमा हो गया।"
        : "Payment proof submitted. Your RA will verify the funds received.",
    );
  }
  if (qr)
    return (
      <div className="payment-panel">
        {loadError ? (
          <p role="alert">
            Payment details could not load.{" "}
            <button type="button" onClick={() => void load()}>
              Retry payment details
            </button>
          </p>
        ) : !payment ? (
          <p role="status">Loading payment details…</p>
        ) : (
          <>
            <h3>
              <QrCode size={20} aria-hidden="true" />
              {hi ? "QR भुगतान" : "QR payment"}
            </h3>
            {order.dev && (
              <p className="settings-feedback">
                Development only. Use synthetic payment evidence; do not
                transfer money.
              </p>
            )}
            {payment.status === "started" ? (
              <>
                <div className="qr-payment-layout">
                  <div>
                    <img
                      className="payment-qr"
                      src={payment.config.image}
                      alt={`Payment QR for ${payment.config.payee}`}
                      width="240"
                      height="240"
                    />
                    <a
                      className="payment-download"
                      href={payment.config.image}
                      download="ra-payment-qr"
                    >
                      {hi ? "QR डाउनलोड करें" : "Download QR"}
                    </a>
                  </div>
                  <div>
                    <p className="payment-amount">{money(order.total)}</p>
                    <p>
                      <strong>{payment.config.payee}</strong>
                      <br />
                      {payment.config.upiId}
                    </p>
                    <p>{payment.config.instructions}</p>
                    <p>
                      Check the payee shown in your UPI app before paying. Enter
                      the exact amount above.
                    </p>
                    <p>
                      Pay only once. Cashfree is locked while this QR payment is
                      unresolved. Contact your RA if you have not paid and want
                      to close it.
                    </p>
                  </div>
                </div>
                {expired && (
                  <p className="settings-feedback">
                    The checkout window has ended. If you already paid, submit
                    your proof below. Otherwise contact your RA before making a
                    payment.
                  </p>
                )}
                <form
                  className="workspace-form onboarding-form"
                  onSubmit={submit}
                >
                  <label>
                    UTR / transaction reference
                    <input
                      name="reference"
                      required
                      pattern="[A-Za-z0-9]{6,40}"
                      maxLength={40}
                      autoComplete="off"
                    />
                  </label>
                  <label>
                    Payment date and time
                    <input name="paidAt" type="datetime-local" required />
                  </label>
                  <label>
                    Payment proof (PNG, JPEG or PDF; up to 2 MB)
                    <input
                      name="proof"
                      type="file"
                      accept="image/png,image/jpeg,application/pdf"
                      required
                    />
                  </label>
                  <button className="button primary" disabled={pending}>
                    {hi ? "भुगतान प्रमाण जमा करें" : "Submit payment proof"}
                  </button>
                </form>
              </>
            ) : (
              <div className="payment-review-state" role="status">
                <Clock3 size={22} aria-hidden="true" />
                <div>
                  <strong>
                    {payment.status === "submitted"
                      ? hi
                        ? "भुगतान सत्यापन की प्रतीक्षा"
                        : "Awaiting payment verification"
                      : payment.status === "approved"
                        ? "Payment approved"
                        : "Payment claim closed"}
                  </strong>
                  <p>Reference: {payment.reference || "No proof submitted"}</p>
                  {payment.status === "submitted" && (
                    <p>
                      Your RA will check the funds received. Access starts after
                      approval. Do not make another payment.
                    </p>
                  )}
                  {payment.reason && <p>{payment.reason}</p>}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  if (order.status === "cancelled") return null;
  if (order.status === "signed" && expired)
    return <ExpiredCheckoutNotice hi={hi} />;
  return (
    <div className="payment-panel">
      {order.status === "signed" && order.total > 0 && (
        <fieldset className="payment-methods" disabled={pending || expired}>
          <legend>
            {hi ? "भुगतान का तरीका चुनें" : "Choose payment method"}
          </legend>
          <label>
            <input
              type="radio"
              name={`method-${order.id}`}
              value="qr"
              checked={method === "qr"}
              disabled={!view.qrEnabled}
              onChange={() => setMethod("qr")}
            />
            <QrCode size={20} aria-hidden="true" />
            <span>
              <strong>QR Code</strong>
              <small>
                {view.qrEnabled
                  ? "Default · verified by your RA"
                  : "Not available for this RA"}
              </small>
            </span>
          </label>
          <label>
            <input
              type="radio"
              name={`method-${order.id}`}
              value="cashfree"
              checked={method === "cashfree"}
              disabled={!view.paymentEnabled}
              onChange={() => setMethod("cashfree")}
            />
            <CreditCard size={20} aria-hidden="true" />
            <span>
              <strong>Cashfree</strong>
              <small>
                {view.paymentEnabled
                  ? "Online checkout · automatic confirmation"
                  : "Awaiting activation"}
              </small>
            </span>
          </label>
        </fieldset>
      )}
      {order.status === "signed" &&
      method === "qr" &&
      view.qrEnabled &&
      order.total > 0 ? (
        <>
          <p>
            The QR payment is verified manually. Once you show the QR, contact
            your RA to close it before using another method.
          </p>
          <button
            className="button primary"
            disabled={pending || expired}
            onClick={() =>
              void run(() => action("qr-start", { orderId: order.id }))
            }
          >
            {hi ? "QR दिखाएँ और भुगतान करें" : "Show QR and pay"}
          </button>
        </>
      ) : (
        !expired && (
          <button
            className="button primary"
            disabled={pending || (!view.paymentEnabled && order.total !== 0)}
            onClick={() =>
              void run(
                async () => {
                  const result = await action("payment", { orderId: order.id });
                  if (
                    typeof result.session === "string" &&
                    (await checkout(result.session, String(result.mode)))
                  )
                    await action("confirm", { orderId: order.id });
                },
                order.total > 0
                  ? hi
                    ? "यदि सदस्यता अभी लंबित है, तो भुगतान की स्थिति जाँचें।"
                    : "If your subscription is still pending, check payment status."
                  : undefined,
              )
            }
          >
            {order.total === 0
              ? "Confirm no-charge subscription"
              : "Pay with Cashfree"}
          </button>
        )
      )}
      {order.status === "payment_pending" && (
        <button
          className="button secondary"
          disabled={pending}
          onClick={() =>
            void run(async () => {
              const result = await action("confirm", { orderId: order.id });
              if (!result.paid) throw new Error("payment_in_progress");
            }, "Payment confirmed.")
          }
        >
          Check payment status
        </button>
      )}
    </div>
  );
}

type QueueItem = {
  orderId: string;
  status: string;
  version: number;
  total: number;
  customerId: string;
  createdAt: string;
};
/** Keep manual bank verification distinct from provider reconciliation and expose attributable review controls. */
export function QrReviewQueue({
  api,
  run,
  pending,
}: {
  api: string;
  run: Run;
  pending: boolean;
}) {
  const [items, setItems] = useState<QueueItem[]>([]),
    [detail, setDetail] = useState<QrPayment | null>(null),
    [error, setError] = useState(false),
    [loading, setLoading] = useState(true);
  /** Reload bounded pending reviews after approval or rejection. */
  async function load() {
    setLoading(true);
    setError(false);
    try {
      setItems(await privateRequest(`${api}/qr-payments`));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    let live = true;
    privateRequest(`${api}/qr-payments`)
      .then((value) => {
        if (live) setItems(value);
      })
      .catch(() => {
        if (live) setError(true);
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [api]);
  /** Confirm the exact reviewed version and record a bank-check reason before changing entitlement. */
  function review(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget),
      submitter = (event.nativeEvent as SubmitEvent)
        .submitter as HTMLButtonElement;
    if (!submitter) return;
    void run(async () => {
      await privateRequest(`${api}/qr-review`, {
        orderId: detail!.orderId,
        version: detail!.version,
        approve: submitter.value === "approve",
        fundsChecked: form.get("fundsChecked") === "on",
        reason: form.get("reason"),
      });
      setDetail(null);
      await load();
    }, "QR payment review saved.");
  }
  return (
    <section
      className="payment-panel"
      aria-labelledby="qr-review-title"
      aria-busy={pending || loading}
    >
      <h2 id="qr-review-title">QR payment reviews</h2>
      <button
        className="button secondary"
        type="button"
        disabled={pending || loading}
        onClick={() => void load()}
      >
        Refresh QR reviews
      </button>
      <p>
        Check the receiving bank account before approving a claim or closing an
        unpaid attempt.
      </p>
      {error ? (
        <p role="alert">
          Reviews could not load.{" "}
          <button onClick={() => void load()}>Reload reviews</button>
        </p>
      ) : loading ? (
        <p role="status">Loading QR reviews…</p>
      ) : items.length === 0 ? (
        <p>No QR payments awaiting review.</p>
      ) : (
        <ul className="qr-review-list">
          {items.map((item) => (
            <li key={item.orderId}>
              <div>
                <strong>{money(item.total)}</strong>
                <span>
                  {item.status === "submitted"
                    ? "Proof submitted"
                    : "Awaiting investor proof"}
                </span>
                <a
                  href={`${api.replace("/api/workspaces/", "/ra/").replace("/onboarding", "/workspace/users")}/${item.customerId}`}
                >
                  View investor
                </a>
                <small>Order {item.orderId}</small>
              </div>
              <button
                className="button secondary"
                disabled={pending}
                onClick={() =>
                  void run(
                    async () =>
                      setDetail(
                        await privateRequest(
                          `${api}/qr-payment/${item.orderId}`,
                        ),
                      ),
                    undefined,
                    false,
                  )
                }
              >
                Review payment
              </button>
            </li>
          ))}
        </ul>
      )}
      {detail && (
        <form
          className="workspace-form onboarding-form qr-review-detail"
          key={detail.orderId}
          onSubmit={review}
        >
          <h3>Review {money(detail.total)}</h3>
          <p>
            Payee: {detail.config.payee} · {detail.config.upiId}
          </p>
          <p>
            UTR: {detail.reference || "Not submitted"}
            {detail.paidAt &&
              ` · Claimed payment: ${new Date(detail.paidAt).toLocaleString("en-IN")}`}
          </p>
          {detail.reference && (
            <a href={`${api}/qr-payment/${detail.orderId}/proof`}>
              Download payment proof
            </a>
          )}
          <label>
            Review reason / bank verification note
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={1000}
              aria-describedby="qr-review-note-help"
            />
          </label>
          <p id="qr-review-note-help">This note is visible to the investor.</p>
          <label className="payment-check">
            <input name="fundsChecked" type="checkbox" required />I checked the
            receiving bank account and the exact amount. If closing a claim with
            funds received, I have arranged resolution with the investor.
          </label>
          <div className="onboarding-actions">
            <button
              className="button primary"
              name="decision"
              value="approve"
              disabled={pending || detail.status !== "submitted"}
            >
              Approve received payment
            </button>
            <button
              className="button secondary"
              name="decision"
              value="reject"
              disabled={pending}
            >
              Reject / close claim
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              onClick={() => setDetail(null)}
            >
              Close review
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
