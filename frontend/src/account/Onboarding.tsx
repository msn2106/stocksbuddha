import { SignatureInput } from "./SignatureInput";
import type { SignatureMark } from "@ra/contracts";
import {
  PaymentChooser,
  QrReviewQueue,
  ExpiredCheckoutNotice,
  useCheckoutExpired,
} from "./Payments";
import { MobileVerification } from "./MobileVerification";
import { DeliveryStatus } from "./DeliveryStatus";
import { AgreementSamples } from "./AgreementSamples";
import { LetterheadSettings } from "./LetterheadSettings";
import { AgreementPdfPreview } from "./AgreementPdfPreview";
import { sampleResearchAgreement } from "@ra/contracts";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  CheckCircle2,
  Clock3,
  FileCheck2,
  ShieldCheck,
  CreditCard,
  LoaderCircle,
} from "lucide-react";
import type {
  AgreementSettings,
  Coupon,
  KycView,
  OnboardingView,
  OrderView,
  PageData,
  Plan,
} from "@ra/contracts";
import { useLanguage } from "../i18n";

type Result = Record<string, unknown>;
type Action = (action: string, body: Result) => Promise<Result>;
type Run = (
  task: () => Promise<unknown>,
  message?: string,
  refresh?: boolean,
) => Promise<void>;
const errors: Record<string, [string, string]> = {
  invalid_payment_file: [
    "Use valid payment proof up to 2 MB (PNG, JPEG or PDF).",
    "PNG, JPEG या PDF प्रमाण (अधिकतम 2 MB) चुनें।",
  ],
  invalid_qr_submission: [
    "Enter a transaction reference (6–40 letters or digits), date and payment proof.",
    "लेनदेन संदर्भ (6–40 अक्षर या अंक), तारीख और प्रमाण दर्ज करें।",
  ],
  invalid_payment_date: [
    "Payment time must be after you started this QR payment and cannot be in the future.",
    "भुगतान समय QR भुगतान शुरू होने के बाद का होना चाहिए और भविष्य का नहीं हो सकता।",
  ],
  payment_reference_used: [
    "This transaction reference was already submitted to this RA. Contact your RA to resolve it.",
    "यह लेनदेन संदर्भ पहले जमा हो चुका है। अपने आरए से संपर्क करें।",
  ],
  payment_method_locked: [
    "A payment is already in progress. Resolve it before choosing another method.",
    "भुगतान जारी है। दूसरा तरीका चुनने से पहले इसे सुलझाएँ।",
  ],
  qr_manual_review_required: [
    "QR payments require a bank check in QR payment reviews.",
    "QR भुगतान की बैंक जाँच QR भुगतान समीक्षा में करें।",
  ],
  qr_already_submitted: [
    "Payment proof is already submitted. Refresh to see its review status.",
    "प्रमाण जमा हो चुका है। समीक्षा स्थिति के लिए रीफ़्रेश करें।",
  ],
  qr_already_reviewed: [
    "This payment has already been reviewed. Refresh the page.",
    "इस भुगतान की समीक्षा हो चुकी है। पेज रीफ़्रेश करें।",
  ],
  invalid_qr_review: [
    "Enter a review note and confirm that you checked the receiving bank account.",
    "समीक्षा नोट दर्ज करें और बैंक खाते की जाँच की पुष्टि करें।",
  ],
  qr_proof_required: [
    "The investor must submit payment proof before approval.",
    "अनुमोदन से पहले निवेशक को भुगतान प्रमाण जमा करना होगा।",
  ],
  qr_unavailable: [
    "QR payments are unavailable for this RA. Refresh to see other methods.",
    "इस आरए के लिए QR भुगतान उपलब्ध नहीं है। अन्य तरीकों के लिए रीफ़्रेश करें।",
  ],
  version_conflict: [
    "This record changed. Refresh and review it before saving again.",
    "यह रिकॉर्ड बदल गया है। रीफ़्रेश करके फिर जाँचें।",
  ],
  record_exists: [
    "This PAN or discount code is already registered in this RA.",
    "यह पैन या छूट कोड इस आरए में पहले से दर्ज है।",
  ],
  mobile_verification_required: [
    "Verify this mobile number before submitting KYC or starting checkout.",
    "केवाईसी या चेकआउट से पहले यह मोबाइल नंबर सत्यापित करें।",
  ],
  kyc_required: [
    "Complete KYC verification before choosing a plan.",
    "योजना चुनने से पहले केवाईसी सत्यापन पूरा करें।",
  ],
  pan_document_required: [
    "Upload the PAN document before submitting.",
    "जमा करने से पहले पैन दस्तावेज़ अपलोड करें।",
  ],
  invalid_pan: [
    "Enter a valid individual PAN number.",
    "सही व्यक्तिगत पैन नंबर दर्ज करें।",
  ],
  invalid_dob: ["Enter a valid date of birth.", "सही जन्मतिथि दर्ज करें।"],
  adult_individuals_only: [
    "This flow currently supports individual investors aged 18 and over.",
    "यह प्रक्रिया अभी 18 वर्ष या अधिक आयु के व्यक्तिगत निवेशकों के लिए है।",
  ],
  invalid_or_expired_code: [
    "The confirmation code is incorrect or expired. Request a new code if needed.",
    "पुष्टि कोड गलत है या समाप्त हो गया है। ज़रूरत हो तो नया कोड माँगें।",
  ],
  code_hourly_limit: [
    "You have requested too many codes. Try again in an hour.",
    "बहुत अधिक कोड माँगे गए हैं। एक घंटे बाद प्रयास करें।",
  ],
  code_rate_limited: [
    "Wait one minute before requesting another code.",
    "अगला कोड माँगने से पहले एक मिनट रुकें।",
  ],
  code_attempts_exhausted: [
    "Too many attempts. Cancel this checkout and start again.",
    "बहुत अधिक प्रयास। यह चेकआउट रद्द करके फिर शुरू करें।",
  ],
  invalid_signature: [
    "Choose a clear, nonempty signature image or draw your signature again.",
    "स्पष्ट हस्ताक्षर चुनें या फिर से बनाएं।",
  ],
  signature_checkout_required: [
    "Start a fresh checkout to add a visible signature.",
    "दिखने वाले हस्ताक्षर के लिए नया चेकआउट शुरू करें।",
  ],
  signing_unavailable: [
    "Agreement signing is awaiting activation. Contact your RA.",
    "अनुबंध हस्ताक्षर अभी उपलब्ध नहीं हैं। अपने आरए से संपर्क करें।",
  ],
  agreement_not_ready: [
    "Your RA is preparing the agreement. Please check again later.",
    "आपके आरए अनुबंध तैयार कर रहे हैं। बाद में फिर देखें।",
  ],
  payments_unavailable: [
    "Online payments are awaiting activation for this RA.",
    "इस आरए के लिए ऑनलाइन भुगतान अभी उपलब्ध नहीं है।",
  ],
  checkout_expired: [
    "This checkout expired. Cancel it and select your plan again.",
    "चेकआउट समाप्त हो गया। इसे रद्द करके योजना फिर चुनें।",
  ],
  coupon_unavailable: [
    "This discount code is unavailable or does not apply to this plan.",
    "यह छूट कोड उपलब्ध नहीं है या इस योजना पर लागू नहीं है।",
  ],
  invalid_coupon: [
    "Use 3–32 letters, numbers, hyphens or underscores for the discount code, with no spaces. For example: DIWALI10 or DIWALI-OFFER.",
    "छूट कोड में 3–32 अक्षर, अंक, हाइफ़न या अंडरस्कोर रखें; स्पेस न दें। उदाहरण: DIWALI10 या DIWALI-OFFER।",
  ],
  coupon_exhausted: [
    "This discount code has reached its usage limit.",
    "इस छूट कोड की उपयोग सीमा पूरी हो गई है।",
  ],
  family_fee_limit: [
    "This purchase would exceed the configured annual family fee limit. Contact your RA.",
    "इस खरीद से परिवार की वार्षिक शुल्क सीमा पार होगी। आरए से संपर्क करें।",
  ],
  existing_checkout_or_subscription: [
    "You already have a checkout or an active subscription. Continue it below.",
    "आपका चेकआउट या सदस्यता पहले से सक्रिय है। नीचे से आगे बढ़ें।",
  ],
  signature_name_mismatch: [
    "Type your full name exactly as shown in the agreement.",
    "अपना पूरा नाम अनुबंध के अनुसार दर्ज करें।",
  ],
  kra_remediation_required: [
    "Approval requires a KYC VALIDATED result. Request corrections for other KRA results.",
    "अनुमोदन के लिए KYC VALIDATED परिणाम चाहिए। अन्य परिणामों पर सुधार माँगें।",
  ],
  verification_evidence_required: [
    "Upload separate KFIN verification evidence for this investor.",
    "इस निवेशक के लिए अलग KFIN सत्यापन प्रमाण अपलोड करें।",
  ],
  tax_details_required: [
    "Your RA must configure tax registration details for this plan.",
    "आरए को इस योजना के लिए कर पंजीकरण विवरण भरना होगा।",
  ],
  payment_in_progress: [
    "A payment is pending. Check its status before making changes.",
    "भुगतान लंबित है। बदलाव से पहले उसकी स्थिति जाँचें।",
  ],
};
/** Present stable rupee values from integer paise returned by the server. */
export function rupees(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
  }).format(paise / 100);
}
/** Convert a browser currency field to integer paise; server validation remains authoritative. */
export function paise(value: FormDataEntryValue | null): number {
  const result = String(value ?? "");
  if (!/^\d+(\.\d{1,2})?$/.test(result)) throw new Error("invalid_fields");
  return Math.round(Number(result) * 100);
}
/** Render a consistently labelled native field within the existing workspace form system. */
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
/** Load the official Cashfree SDK only when an authenticated investor starts a configured hosted checkout. */
export async function hostedCheckout(
  session: string,
  mode: string,
): Promise<void> {
  const target = window as typeof window & {
    Cashfree?: (options: { mode: string }) => {
      checkout: (options: {
        paymentSessionId: string;
        redirectTarget: string;
      }) => Promise<unknown>;
    };
  };
  if (!target.Cashfree)
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://sdk.cashfree.com/js/v3/cashfree.js";
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        script.remove();
        reject(new Error("payments_unavailable"));
      };
      document.head.append(script);
    });
  if (!target.Cashfree) throw new Error("payments_unavailable");
  await target
    .Cashfree({ mode })
    .checkout({ paymentSessionId: session, redirectTarget: "_self" });
}
/** Render role-scoped onboarding, offer management and user detail inside the established workspace shell. */
export function Onboarding({
  data,
  overview = false,
}: {
  data: PageData;
  overview?: boolean;
}) {
  const { locale } = useLanguage(),
    hi = locale === "hi";
  const [view, setView] = useState<OnboardingView | null>(null),
    [pending, setPending] = useState(false),
    [message, setMessage] = useState(""),
    [error, setError] = useState("");
  const api = `/api/workspaces/${data.tenant!.slug}/onboarding`,
    customer = data.account?.customerId;
  const query = customer ? `?customer=${encodeURIComponent(customer)}` : "";
  /** Refresh the authenticated projection without persisting identity details in browser storage. */
  async function load(before?: string) {
    const response = await fetch(
      `${api}${query}${before ? `${query ? "&" : "?"}before=${before}` : ""}`,
    );
    if (!response.ok) throw new Error("onboarding_unavailable");
    const next: OnboardingView = await response.json();
    setView((previous) =>
      before && previous
        ? { ...next, users: [...previous.users, ...next.users] }
        : next,
    );
  }
  useEffect(() => {
    let live = true;
    fetch(`${api}${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error("onboarding_unavailable");
        const next = await response.json();
        if (live) setView(next);
      })
      .catch(() => {
        if (live) setError("onboarding_unavailable");
      });
    return () => {
      live = false;
    };
  }, [api, query]);
  /** Post a bounded application action; all price, role and progression checks run again on the server. */
  const action: Action = async (name, body) => {
    const response = await fetch(`${api}/${name}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    return result;
  };
  /** Keep feedback, pending state and recovery consistent across business forms. */
  const run: Run = async (task, notice, refresh = true) => {
    setPending(true);
    setError("");
    setMessage("");
    try {
      await task();
      if (refresh) await load();
      setMessage(notice ?? (hi ? "बदलाव सहेजे गए।" : "Changes saved."));
    } catch (failure) {
      setError(
        failure instanceof Error ? failure.message : "onboarding_unavailable",
      );
    } finally {
      setPending(false);
    }
  };
  const base = `/ra/${data.tenant!.slug}`;
  const title = view?.admin
    ? data.account?.section === "plans"
      ? hi
        ? "योजनाएँ और छूट"
        : "Plans and discounts"
      : hi
        ? "निवेशक"
        : "Users"
    : hi
      ? "आपकी निवेशक यात्रा"
      : "Your investor journey";
  return (
    <section className="onboarding" aria-busy={pending}>
      <header className="onboarding-heading">
        <p className="eyebrow">{data.tenant!.profile.name}</p>
        <h1>{title}</h1>
        <p>
          {hi
            ? "हर चरण की स्थिति और अगले कदम एक जगह।"
            : "Your progress, documents and next steps, in one place."}
        </p>
      </header>
      {error && (
        <p role="alert" className="account-error">
          {errors[error]?.[hi ? 1 : 0] ??
            (hi
              ? "कार्रवाई पूरी नहीं हुई। विवरण जाँचें और फिर प्रयास करें।"
              : "The action could not complete. Check your details and try again.")}
        </p>
      )}
      {message && (
        <p role="status" className="workspace-notice">
          {message}
        </p>
      )}
      {view?.admin && (
        <>
          <QrReviewQueue api={api} run={run} pending={pending} />
          <DeliveryStatus key={api} api={api} hi={hi} />
        </>
      )}
      {!view ? (
        <p role="status">{hi ? "लोड हो रहा है…" : "Loading your workspace…"}</p>
      ) : view.admin ? (
        data.account?.section === "plans" ? (
          <Plans
            view={view}
            action={action}
            run={run}
            pending={pending}
            hi={hi}
          />
        ) : view.customer ? (
          <>
            <a href={`${base}/workspace/users`}>
              {hi ? "सभी निवेशक" : "All users"}
            </a>
            <Kyc
              key={`${view.customer.id}-${view.customer.version}`}
              customer={view.customer}
              admin
              action={action}
              run={run}
              pending={pending}
              hi={hi}
              base={base}
            />
          </>
        ) : (
          <>
            <p>
              {hi
                ? "इस आरए के निवेशक। व्यक्तिगत जानकारी के लिए संपादित करें चुनें।"
                : "Investors in this RA. Open a user to review details and complete KYC."}
            </p>
            <div
              className="workspace-table"
              role="region"
              aria-label={hi ? "निवेशक" : "Investor list"}
              tabIndex={0}
            >
              <table>
                <caption>
                  {hi ? "निवेशक और सत्यापन" : "Investors and verification"}
                </caption>
                <thead>
                  <tr>
                    {[
                      hi ? "नाम" : "Name",
                      "Email",
                      hi ? "फ़ोन" : "Phone",
                      "PAN",
                      "KYC",
                      hi ? "कार्रवाई" : "Action",
                    ].map((label) => (
                      <th key={label}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {view.users.map((user) => (
                    <tr key={user.id}>
                      <td>{user.name}</td>
                      <td>{user.email}</td>
                      <td>{user.profile.phone || "—"}</td>
                      <td>{user.profile.pan || "—"}</td>
                      <td>{status(user.status, hi)}</td>
                      <td>
                        <a href={`${base}/workspace/users/${user.id}`}>
                          {hi ? "संपादित करें" : "Edit user"}
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!view.users.length && (
              <p>
                {hi
                  ? "अभी कोई निवेशक नहीं है।"
                  : "No investors have joined this RA yet."}
              </p>
            )}
            {view.nextCursor && (
              <button
                disabled={pending}
                className="button secondary"
                onClick={() =>
                  void run(() => load(view.nextCursor!), undefined, false)
                }
              >
                {hi ? "और दिखाएँ" : "Load more users"}
              </button>
            )}
          </>
        )
      ) : (
        <Investor
          view={view}
          overview={overview}
          base={base}
          action={action}
          run={run}
          pending={pending}
          hi={hi}
        />
      )}
      <button
        className="button secondary onboarding-refresh"
        disabled={pending}
        onClick={() =>
          void run(
            () => load(),
            hi ? "स्थिति अपडेट की गई।" : "Status refreshed.",
            false,
          )
        }
      >
        {hi ? "स्थिति रीफ़्रेश करें" : "Refresh status"}
      </button>
    </section>
  );
}
/** Translate status without equating a development simulation with a genuine verification. */
export function status(value: string, hi: boolean): string {
  const labels: Record<string, [string, string]> = {
    not_started: ["Not started", "शुरू नहीं हुआ"],
    draft: ["Draft", "प्रारूप"],
    pending: ["Under review", "समीक्षा में"],
    changes: ["Changes requested", "सुधार आवश्यक"],
    rejected: ["Rejected", "अस्वीकृत"],
    verified: ["Verified", "सत्यापित"],
    skipped_dev: ["Skipped in development", "डेवलपमेंट में छोड़ा गया"],
    quoted: ["Awaiting signature", "हस्ताक्षर लंबित"],
    signed: ["Signed; payment due", "हस्ताक्षरित; भुगतान बाकी"],
    payment_pending: ["Payment pending", "भुगतान लंबित"],
    paid: ["Confirmed", "पुष्टि हो गई"],
    cancelled: ["Cancelled", "रद्द"],
  };
  return labels[value]?.[hi ? 1 : 0] ?? value;
}
/** Build plan, coupon and legal-setting forms from the current authoritative versions. */
function Plans({
  view,
  action,
  run,
  pending,
  hi,
}: {
  view: OnboardingView;
  action: Action;
  run: Run;
  pending: boolean;
  hi: boolean;
}) {
  const [plan, setPlan] = useState<Plan | null>(null),
    [coupon, setCoupon] = useState<Coupon | null>(null);
  /** Preserve canonical IDs and versions while converting displayed currency inputs. */
  function savePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      await action("plan", {
        id: plan?.id,
        version: plan?.version ?? 0,
        name: form.get("name"),
        description: form.get("description"),
        days: Number(form.get("days")),
        price: paise(form.get("price")),
        taxBps: Math.round(Number(form.get("tax")) * 100),
        active: form.get("active") === "on",
      });
      setPlan(null);
    });
  }
  /** Scope a discount to this RA and optionally one plan, with explicit UTC validity dates. */
  function saveCoupon(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(async () => {
      const type = form.get("type");
      await action("coupon", {
        id: coupon?.id,
        version: coupon?.version ?? 0,
        code: form.get("code"),
        type,
        value:
          type === "fixed"
            ? paise(form.get("value"))
            : Number(form.get("value")),
        planId: form.get("planId") || null,
        startsAt: `${form.get("starts")}T00:00:00Z`,
        endsAt: `${form.get("ends")}T23:59:59Z`,
        limit: Number(form.get("limit")),
        perUser: Number(form.get("perUser")),
        active: form.get("active") === "on",
      });
      setCoupon(null);
    });
  }
  return (
    <div className="onboarding-stack">
      <section aria-labelledby="plans-title">
        <h2 id="plans-title">
          {hi ? "सदस्यता योजनाएँ" : "Subscription plans"}
        </h2>
        <p>
          {hi
            ? "नई खरीद पर बदलाव लागू होंगे। मौजूदा अनुबंध सुरक्षित रहेंगे।"
            : "Changes apply to new purchases. Existing agreements retain their original terms."}
        </p>
        <ul className="onboarding-records">
          {view.plans.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.name}</strong>
                <p>
                  {rupees(entry.price)} · {entry.days} {hi ? "दिन" : "days"} ·{" "}
                  {entry.active
                    ? hi
                      ? "सक्रिय"
                      : "Active"
                    : hi
                      ? "निष्क्रिय"
                      : "Inactive"}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => setPlan(entry)}
              >
                {hi ? "संपादित करें" : "Edit"} {entry.name}
              </button>
            </li>
          ))}
        </ul>
        <form
          key={plan ? `${plan.id}-${plan.version}` : `new-${view.plans.length}`}
          className="workspace-form onboarding-form"
          onSubmit={savePlan}
        >
          <h3>
            {plan
              ? hi
                ? "योजना संपादित करें"
                : "Edit plan"
              : hi
                ? "योजना जोड़ें"
                : "Add plan"}
          </h3>
          <Field label={hi ? "योजना का नाम" : "Plan name"}>
            <input
              name="name"
              required
              maxLength={120}
              defaultValue={plan?.name}
            />
          </Field>
          <Field label={hi ? "सेवाएँ और सुविधाएँ" : "Services and offerings"}>
            <textarea
              name="description"
              required
              maxLength={4000}
              defaultValue={plan?.description}
            />
          </Field>
          <div className="onboarding-fields">
            <Field label={hi ? "अवधि (दिन)" : "Duration in days"}>
              <input
                name="days"
                type="number"
                min={1}
                max={365}
                required
                defaultValue={plan?.days ?? 30}
              />
            </Field>
            <Field label={hi ? "मूल शुल्क (₹)" : "Base fee (INR)"}>
              <input
                name="price"
                type="number"
                min={1}
                step="0.01"
                required
                defaultValue={plan ? plan.price / 100 : ""}
              />
            </Field>
            <Field label={hi ? "कर दर (%)" : "Tax rate (%)"}>
              <input
                name="tax"
                type="number"
                min={0}
                max={30}
                step="0.01"
                required
                defaultValue={plan ? plan.taxBps / 100 : 0}
              />
            </Field>
          </div>
          <Field
            label={hi ? "नई खरीद के लिए सक्रिय" : "Active for new purchases"}
          >
            <input
              name="active"
              type="checkbox"
              defaultChecked={plan?.active ?? true}
            />
          </Field>
          <button className="button primary" disabled={pending}>
            {hi ? "योजना सहेजें" : "Save plan"}
          </button>
          {plan && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setPlan(null)}
            >
              {hi ? "नई योजना" : "New plan"}
            </button>
          )}
        </form>
      </section>
      <section aria-labelledby="discount-title">
        <h2 id="discount-title">{hi ? "छूट कोड" : "Discount codes"}</h2>
        <ul className="onboarding-records">
          {view.coupons.map((entry) => (
            <li key={entry.id}>
              <div>
                <strong>{entry.code}</strong>
                <p>
                  {entry.type === "percent"
                    ? `${entry.value}%`
                    : rupees(entry.value)}{" "}
                  ·{" "}
                  {entry.active
                    ? hi
                      ? "सक्रिय"
                      : "Active"
                    : hi
                      ? "निष्क्रिय"
                      : "Inactive"}
                </p>
              </div>
              <button
                className="button secondary"
                onClick={() => setCoupon(entry)}
              >
                {hi ? "संपादित करें" : "Edit"} {entry.code}
              </button>
            </li>
          ))}
        </ul>
        <form
          key={
            coupon
              ? `${coupon.id}-${coupon.version}`
              : `new-${view.coupons.length}`
          }
          className="workspace-form onboarding-form"
          onSubmit={saveCoupon}
        >
          <Field label={hi ? "छूट कोड" : "Discount code"}>
            <input
              name="code"
              required
              pattern={"[A-Za-z0-9_\\-]{3,32}"}
              title={
                hi
                  ? "3–32 अक्षर, अंक, हाइफ़न या अंडरस्कोर; स्पेस नहीं।"
                  : "3–32 letters, numbers, hyphens or underscores; no spaces."
              }
              aria-describedby="coupon-code-help"
              defaultValue={coupon?.code}
            />
          </Field>
          <p id="coupon-code-help" className="onboarding-help">
            {hi
              ? "उदाहरण: DIWALI10 या DIWALI-OFFER। स्पेस न दें। कोड बड़े अक्षरों में सहेजे जाते हैं।"
              : "For example: DIWALI10 or DIWALI-OFFER. No spaces; codes are saved in uppercase."}
          </p>
          <div className="onboarding-fields">
            <Field label={hi ? "छूट का प्रकार" : "Discount type"}>
              <select name="type" defaultValue={coupon?.type ?? "percent"}>
                <option value="percent">{hi ? "प्रतिशत" : "Percentage"}</option>
                <option value="fixed">
                  {hi ? "निश्चित राशि (₹)" : "Fixed amount (INR)"}
                </option>
              </select>
            </Field>
            <Field label={hi ? "छूट का मूल्य" : "Discount value"}>
              <input
                name="value"
                type="number"
                required
                min="0.01"
                step="0.01"
                defaultValue={
                  coupon
                    ? coupon.type === "fixed"
                      ? coupon.value / 100
                      : coupon.value
                    : ""
                }
              />
            </Field>
          </div>
          <Field label={hi ? "लागू योजना" : "Eligible plan"}>
            <select name="planId" defaultValue={coupon?.planId ?? ""}>
              <option value="">{hi ? "सभी योजनाएँ" : "All plans"}</option>
              {view.plans.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="onboarding-fields">
            <Field label={hi ? "शुरुआत (UTC तारीख)" : "Starts (UTC date)"}>
              <input
                name="starts"
                type="date"
                required
                defaultValue={coupon?.startsAt.slice(0, 10)}
              />
            </Field>
            <Field label={hi ? "समाप्ति (UTC तारीख)" : "Ends (UTC date)"}>
              <input
                name="ends"
                type="date"
                required
                defaultValue={coupon?.endsAt.slice(0, 10)}
              />
            </Field>
            <Field label={hi ? "कुल उपयोग सीमा" : "Total usage limit"}>
              <input
                name="limit"
                type="number"
                min={1}
                max={1000000}
                required
                defaultValue={coupon?.limit ?? 100}
              />
            </Field>
            <Field label={hi ? "प्रति निवेशक सीमा" : "Limit per investor"}>
              <input
                name="perUser"
                type="number"
                min={1}
                max={1000}
                required
                defaultValue={coupon?.perUser ?? 1}
              />
            </Field>
          </div>
          <Field label={hi ? "छूट सक्रिय है" : "Discount is active"}>
            <input
              name="active"
              type="checkbox"
              defaultChecked={coupon?.active ?? true}
            />
          </Field>
          <button className="button primary" disabled={pending}>
            {hi ? "छूट सहेजें" : "Save discount"}
          </button>
          {coupon && (
            <button
              type="button"
              className="button secondary"
              onClick={() => setCoupon(null)}
            >
              {hi ? "नया कोड" : "New code"}
            </button>
          )}
        </form>
      </section>
      <Settings
        settings={view.settings}
        action={action}
        run={run}
        pending={pending}
        hi={hi}
      />
    </div>
  );
}
/** Require explicit RA review of the legal wording and billing identity before publishing checkout. */
function Settings({
  settings,
  action,
  run,
  pending,
  hi,
}: {
  settings: AgreementSettings | null;
  action: Action;
  run: Run;
  pending: boolean;
  hi: boolean;
}) {
  const termsInput = useRef<HTMLTextAreaElement>(null);
  const reviewedInput = useRef<HTMLInputElement>(null);
  return (
    <section aria-labelledby="agreement-title">
      <h2 id="agreement-title">
        {hi ? "अनुबंध और बिलिंग विवरण" : "Agreement and billing details"}
      </h2>
      <AgreementSamples />
      <LetterheadSettings />
      <p>
        {hi
          ? "अनुमोदित सेवा शर्तें और MITC दर्ज करें। यह कानूनी समीक्षा का विकल्प नहीं है।"
          : "Enter your approved research-service terms, including MITC. Have the wording and signing method reviewed before live use."}
      </p>
      <form
        key={settings?.version ?? 0}
        className="workspace-form onboarding-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void run(() =>
            action("settings", {
              version: settings?.version ?? 0,
              terms: form.get("terms"),
              contact: form.get("contact"),
              address: form.get("address"),
              gstin: form.get("gstin"),
              annualLimit: paise(form.get("annualLimit")),
              reviewed: form.get("reviewed") === "on",
            }),
          );
        }}
      >
        <div className="account-field">
          <label htmlFor="agreement-terms">
            {hi ? "अनुमोदित शर्तें और MITC" : "Approved terms and MITC"}
          </label>
          <textarea
            id="agreement-terms"
            className="onboarding-terms-editor"
            name="terms"
            required
            minLength={500}
            maxLength={30000}
            ref={termsInput}
            defaultValue={settings?.terms ?? sampleResearchAgreement}
            onChange={() => {
              if (reviewedInput.current) reviewedInput.current.checked = false;
            }}
          />
        </div>
        <p className="onboarding-help">
          {hi
            ? "यह शुरुआती प्रारूप है। आरए इसे संपादित या अपने अनुबंध से बदल सकते हैं। इस्तेमाल से पहले आरए-विशिष्ट विवरण और वर्तमान अनुमोदित MITC की समीक्षा करें।"
            : "This is a starter draft. Edit it or replace it with your own agreement. Review RA-specific details and the current approved MITC before use."}
        </p>
        <button
          type="button"
          className="button secondary"
          disabled={pending}
          onClick={() => {
            if (termsInput.current)
              termsInput.current.value = sampleResearchAgreement;
            if (reviewedInput.current) reviewedInput.current.checked = false;
          }}
        >
          {hi ? "नमूना अनुबंध लोड करें" : "Load sample agreement"}
        </button>
        <p className="onboarding-help">
          {hi
            ? "नाम, योजना और अंतिम राशि अनुबंध में स्वतः जोड़े जाते हैं। वैकल्पिक फ़ील्ड:"
            : "The agreement automatically includes investor, RA, plan and final pricing details. Optional fields:"}{" "}
          <code>{"{{clientName}}, {{planName}}, {{total}}, {{days}}"}</code>
        </p>
        <Field label={hi ? "संपर्क विवरण" : "Contact details"}>
          <input
            name="contact"
            required
            maxLength={254}
            defaultValue={settings?.contact}
          />
        </Field>
        <Field label={hi ? "आरए का पता" : "RA address"}>
          <textarea
            name="address"
            required
            maxLength={1000}
            defaultValue={settings?.address}
          />
        </Field>
        <div className="onboarding-fields">
          <Field label="GSTIN">
            <input name="gstin" maxLength={15} defaultValue={settings?.gstin} />
          </Field>
          <Field
            label={
              hi
                ? "वार्षिक पारिवारिक शुल्क सीमा (₹)"
                : "Annual family fee limit (INR)"
            }
          >
            <input
              name="annualLimit"
              type="number"
              required
              min={1}
              max={151000}
              step="0.01"
              defaultValue={settings ? settings.annualLimit / 100 : 151000}
            />
          </Field>
        </div>
        <Field
          label={
            hi
              ? "इन सेवा शर्तों और MITC की समीक्षा और अनुमोदन हुआ है।"
              : "These research-service terms and MITC have been reviewed and approved."
          }
        >
          <input
            name="reviewed"
            ref={reviewedInput}
            type="checkbox"
            defaultChecked={settings?.reviewed}
          />
        </Field>
        <button className="button primary" disabled={pending}>
          {hi ? "अनुबंध विवरण सहेजें" : "Save agreement details"}
        </button>
      </form>
    </section>
  );
}
/** Collect PAN evidence and support admin-assisted corrections without impersonating the investor. */
function Kyc({
  customer,
  admin = false,
  action,
  run,
  pending,
  hi,
  base,
}: {
  customer: KycView;
  admin?: boolean;
  action: Action;
  run: Run;
  pending: boolean;
  hi: boolean;
  base: string;
}) {
  const [documentId, setDocumentId] = useState(customer.profile.documentId),
    [evidenceId, setEvidenceId] = useState("");
  const [reviewDecision, setReviewDecision] = useState("changes");
  const editable = admin || !["pending", "verified"].includes(customer.status);
  /** Upload bytes through the existing tenant-scoped document service and retain only its application ID. */
  async function upload(file: File, evidence = false) {
    const response = await fetch(
      `/api/workspaces/${base.split("/")[2]}/documents`,
      {
        method: "POST",
        headers: {
          "Content-Type": file.type,
          "X-Document-Name": encodeURIComponent(file.name),
          "X-Document-Kind": "kyc",
          ...(admin ? { "X-Customer-Id": customer.id } : {}),
        },
        body: file,
      },
    );
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    if (evidence) setEvidenceId(result.id);
    else setDocumentId(result.id);
  }
  /** Submit validated personal facts without modifying the shared global login identity. */
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(() =>
      action("kyc-submit", {
        customerId: admin ? customer.id : undefined,
        version: customer.version,
        fullName: form.get("fullName"),
        phone: form.get("phone"),
        pan: form.get("pan"),
        dob: form.get("dob"),
        familyPan: form.get("familyPan"),
        declaration: form.get("declaration") === "on",
        documentId,
      }),
    );
  }
  return (
    <section aria-labelledby="kyc-title">
      <h2 id="kyc-title">
        {admin
          ? customer.name
          : hi
            ? "अपना केवाईसी पूरा करें"
            : "Complete your KYC"}
      </h2>
      <p className="onboarding-state">
        <ShieldCheck size={22} />
        <strong>{status(customer.status, hi)}</strong>
      </p>
      {admin && (
        <p>
          {customer.mobileVerified
            ? hi
              ? "मोबाइल सत्यापित"
              : "Mobile verified"
            : hi
              ? "मोबाइल सत्यापन बाकी"
              : "Mobile verification pending"}
        </p>
      )}
      {!admin && (
        <MobileVerification
          slug={base.split("/")[2]}
          hi={hi}
          onVerified={() => {
            void run(
              async () => {},
              hi ? "मोबाइल सत्यापित।" : "Mobile verified.",
            );
          }}
        />
      )}
      {customer.reason && <p>{customer.reason}</p>}
      {customer.checkedAt && (
        <p>
          {hi ? "पिछली समीक्षा:" : "Last reviewed:"}{" "}
          {new Date(customer.checkedAt).toLocaleString(hi ? "hi-IN" : "en-IN")}
        </p>
      )}
      {editable ? (
        <form className="workspace-form onboarding-form" onSubmit={save}>
          <fieldset disabled={!admin && !customer.mobileVerified}>
            <div className="onboarding-fields">
              <Field
                label={hi ? "पैन के अनुसार पूरा नाम" : "Full name as on PAN"}
              >
                <input
                  name="fullName"
                  autoComplete="name"
                  required
                  maxLength={160}
                  defaultValue={customer.profile.fullName}
                />
              </Field>
              <Field label={hi ? "फ़ोन नंबर" : "Phone number"}>
                <input
                  name="phone"
                  readOnly={!admin}
                  type="tel"
                  autoComplete="tel"
                  required
                  maxLength={16}
                  defaultValue={
                    customer.verifiedMobile ?? customer.profile.phone
                  }
                />
              </Field>
              <Field label={hi ? "पैन नंबर" : "PAN number"}>
                <input
                  name="pan"
                  required
                  minLength={10}
                  maxLength={10}
                  pattern="[A-Za-z]{3}[Pp][A-Za-z][0-9]{4}[A-Za-z]"
                  defaultValue={customer.profile.pan}
                />
              </Field>
              <Field label={hi ? "जन्मतिथि" : "Date of birth"}>
                <input
                  name="dob"
                  type="date"
                  required
                  defaultValue={customer.profile.dob}
                />
              </Field>
            </div>
            <Field
              label={
                hi
                  ? "पैन दस्तावेज़ (PDF, JPEG, PNG; अधिकतम 10 MiB)"
                  : "PAN document (PDF, JPEG, PNG; maximum 10 MiB)"
              }
            >
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                disabled={pending}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file)
                    void run(
                      () => upload(file),
                      hi
                        ? "पैन दस्तावेज़ अपलोड हो गया।"
                        : "PAN document uploaded.",
                    );
                }}
              />
            </Field>
            {documentId && (
              <p>
                <a
                  href={`/api/workspaces/${base.split("/")[2]}/documents/${documentId}/download`}
                >
                  {hi ? "पैन दस्तावेज़ डाउनलोड करें" : "Download PAN document"}
                </a>
              </p>
            )}
            <details>
              <summary>
                {hi
                  ? "क्या आप परिवार के आश्रित सदस्य हैं?"
                  : "Are you a dependent family member?"}
              </summary>
              <p>
                {hi
                  ? "आश्रित होने पर आय अर्जित करने वाले सदस्य का पैन दें ताकि परिवार का संयुक्त शुल्क सही गिना जाए।"
                  : "If your assets originate from another family member's income, enter that earning member's PAN so family fees can be counted together."}
              </p>
              <Field
                label={
                  hi
                    ? "आय अर्जित करने वाले सदस्य का पैन (वैकल्पिक)"
                    : "Earning family member PAN (if applicable)"
                }
              >
                <input
                  name="familyPan"
                  maxLength={10}
                  defaultValue={
                    customer.profile.familyPan === customer.profile.pan
                      ? ""
                      : customer.profile.familyPan
                  }
                />
              </Field>
            </details>
            <Field
              label={
                hi
                  ? "मैं पुष्टि करता/करती हूँ कि जानकारी और पारिवारिक विवरण सही हैं और केवाईसी जाँच के लिए सहमति देता/देती हूँ।"
                  : "I confirm these identity and family details are correct and consent to their use for KYC verification."
              }
            >
              <input
                name="declaration"
                type="checkbox"
                required
                defaultChecked={customer.profile.declaration}
              />
            </Field>
            <button
              className="button primary"
              disabled={pending || !documentId}
            >
              {admin
                ? hi
                  ? "सहेजें और समीक्षा के लिए भेजें"
                  : "Save and submit for review"
                : hi
                  ? "सत्यापन के लिए जमा करें"
                  : "Submit for verification"}
            </button>
          </fieldset>
        </form>
      ) : (
        <p>
          {customer.status === "pending"
            ? hi
              ? "आपके आरए की समीक्षा लंबित है। बदलाव चाहिए तो उनसे संपर्क करें।"
              : "Your RA is reviewing your submission. Contact them if details need correction."
            : hi
              ? "आपकी पहचान सत्यापित है।"
              : "Your identity has been verified."}
        </p>
      )}
      {admin && customer.status === "pending" && (
        <form
          className="workspace-form onboarding-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            if (reviewDecision === "verified" && !evidenceId) {
              void run(async () => {
                throw new Error("verification_evidence_required");
              });
              return;
            }
            void run(() =>
              action("review", {
                customerId: customer.id,
                version: customer.version,
                status: form.get("status"),
                providerStatus: form.get("providerStatus"),
                reference: form.get("reference"),
                evidenceId,
                reason: form.get("reason"),
              }),
            );
          }}
        >
          <h3>{hi ? "KFIN समीक्षा" : "KFIN review"}</h3>
          <a
            className="button secondary"
            href="https://www.kfinkra.in/"
            target="_blank"
            rel="noreferrer"
          >
            {hi ? "KFIN KRA खोलें" : "Open KFIN KRA"}
          </a>
          <Field label={hi ? "निर्णय" : "Decision"}>
            <select
              name="status"
              value={reviewDecision}
              onChange={(event) => setReviewDecision(event.target.value)}
            >
              <option value="changes">
                {hi ? "सुधार माँगें" : "Request changes"}
              </option>
              <option value="verified">
                {hi ? "केवाईसी अनुमोदित करें" : "Approve KYC"}
              </option>
              <option value="rejected">
                {hi ? "अस्वीकार करें" : "Reject"}
              </option>
            </select>
          </Field>
          <Field label={hi ? "KFIN परिणाम" : "KFIN result"}>
            <select
              name="providerStatus"
              required={reviewDecision === "verified"}
            >
              <option value="">{hi ? "परिणाम चुनें" : "Select result"}</option>
              <option value="KYC VALIDATED">KYC VALIDATED</option>
              <option value="KYC REGISTERED">KYC REGISTERED</option>
              <option value="ON HOLD">ON HOLD</option>
              <option value="REJECTED">REJECTED</option>
            </select>
          </Field>
          <Field label={hi ? "सत्यापन संदर्भ" : "Verification reference"}>
            <input
              name="reference"
              maxLength={200}
              required={reviewDecision === "verified"}
            />
          </Field>
          <Field
            label={
              hi
                ? "अलग KFIN सत्यापन प्रमाण"
                : "Separate KFIN verification evidence"
            }
          >
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              required={reviewDecision === "verified" && !evidenceId}
              aria-describedby="kfin-evidence-help"
              disabled={pending}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file)
                  void run(
                    () => upload(file, true),
                    hi
                      ? "सत्यापन प्रमाण अपलोड हो गया।"
                      : "Verification evidence uploaded.",
                  );
              }}
            />
          </Field>
          <p id="kfin-evidence-help" className="onboarding-help">
            {hi
              ? "केवाईसी अनुमोदन के लिए KFIN परिणाम का स्क्रीनशॉट या PDF अपलोड करें। यह निवेशक के पैन दस्तावेज़ से अलग होना चाहिए। सुधार माँगने या अस्वीकार करने के लिए यह आवश्यक नहीं है।"
              : "To approve KYC, upload a screenshot or PDF of the KFIN verification result, separate from the investor’s PAN document. Evidence is not required when requesting changes or rejecting a request."}
          </p>
          {evidenceId && (
            <p>
              {hi
                ? "सत्यापन प्रमाण तैयार है।"
                : "Verification evidence is ready."}
            </p>
          )}
          <Field
            label={
              hi ? "कारण / निवेशक को संदेश" : "Reason / message to investor"
            }
          >
            <textarea
              name="reason"
              maxLength={1000}
              required={reviewDecision !== "verified"}
              minLength={reviewDecision === "verified" ? undefined : 5}
              aria-describedby="kyc-review-reason-help"
            />
          </Field>
          <p id="kyc-review-reason-help" className="onboarding-help">
            {hi
              ? "अनुमोदन के लिए कारण वैकल्पिक है। सुधार माँगने या अस्वीकार करने पर कम से कम 5 अक्षर का कारण दें।"
              : "Reason is optional when approving KYC. Enter at least 5 characters when requesting changes or rejecting."}
          </p>
          <button className="button primary" disabled={pending}>
            {hi ? "समीक्षा निर्णय सहेजें" : "Save review decision"}
          </button>
        </form>
      )}
    </section>
  );
}
/** Present the gated investor journey and preserve a resumable checkout after reloads or failed payments. */
function Investor({
  view,
  overview,
  base,
  action,
  run,
  pending,
  hi,
}: {
  view: OnboardingView;
  overview: boolean;
  base: string;
  action: Action;
  run: Run;
  pending: boolean;
  hi: boolean;
}) {
  const customer = view.customer!,
    verified = ["verified", "skipped_dev"].includes(customer.status);
  const current = view.orders.find((order) => order.status !== "cancelled");
  const currentExpired = useCheckoutExpired(current?.expiresAt);
  const active =
    current?.status === "paid" &&
    Boolean(current.endsAt && Date.parse(current.endsAt) > Date.now());
  return (
    <>
      <ol
        className="onboarding-progress"
        aria-label={hi ? "अगले कदम" : "Next steps"}
      >
        {[
          [ShieldCheck, hi ? "केवाईसी" : "KYC", verified],
          [
            FileCheck2,
            hi ? "योजना और MITC" : "Plan and MITC",
            Boolean(current?.signedAt),
          ],
          [CreditCard, hi ? "भुगतान" : "Payment", active],
        ].map(([Icon, label, done], index) => {
          const Symbol = Icon as typeof ShieldCheck;
          return (
            <li key={index} data-complete={Boolean(done)}>
              <Symbol size={24} />
              <span>{label as string}</span>
              {done ? (
                <CheckCircle2 size={20} aria-label={hi ? "पूरा" : "Complete"} />
              ) : (
                <Clock3 size={20} aria-label={hi ? "बाकी" : "Pending"} />
              )}
            </li>
          );
        })}
      </ol>
      {view.devSkip && (
        <p className="workspace-notice">
          {hi
            ? "डेवलपमेंट मोड: छोड़े गए चरण वास्तविक सत्यापन या हस्ताक्षर नहीं हैं।"
            : "Development mode: skipped steps do not represent real verification or signatures."}
        </p>
      )}
      {overview ? (
        <>
          <p>
            {hi ? "स्थिति:" : "KYC status:"}{" "}
            <strong>{status(customer.status, hi)}</strong>
          </p>
          <a className="button primary" href={`${base}/account/onboarding`}>
            {hi ? "अगला चरण पूरा करें" : "Continue onboarding"}
          </a>
        </>
      ) : (
        <div className="onboarding-stack">
          <Kyc
            key={`${customer.id}-${customer.version}-${customer.verifiedMobile ?? ""}`}
            customer={customer}
            action={action}
            run={run}
            pending={pending}
            hi={hi}
            base={base}
          />
          {view.devSkip && !verified && (
            <button
              disabled={pending}
              className="button secondary"
              onClick={() => void run(() => action("skip", { step: "kyc" }))}
            >
              Skip KYC — DEV only
            </button>
          )}
          {verified && !active && (
            <section aria-labelledby="choose-plan">
              <h2 id="choose-plan">
                {hi ? "अपनी योजना चुनें" : "Choose your plan"}
              </h2>
              {!view.plans.length && (
                <p>
                  {hi
                    ? "आपके आरए ने अभी योजनाएँ प्रकाशित नहीं की हैं।"
                    : "Your RA has not published any plans yet."}
                </p>
              )}
              {!active &&
                (!current ||
                  current.status === "cancelled" ||
                  (currentExpired &&
                    ["quoted", "signed"].includes(current.status)) ||
                  (current.status === "paid" && !active)) && (
                  <form
                    className="workspace-form onboarding-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const form = new FormData(event.currentTarget);
                      void run(() =>
                        action("quote", {
                          planId: form.get("planId"),
                          code: form.get("code"),
                          key: crypto.randomUUID(),
                        }),
                      );
                    }}
                  >
                    {view.plans.map((plan) => (
                      <label className="onboarding-plan" key={plan.id}>
                        <input
                          type="radio"
                          name="planId"
                          value={plan.id}
                          required
                        />
                        <span>
                          <strong>{plan.name}</strong>
                          <span>{plan.description}</span>
                          <span>
                            {rupees(plan.price)} + {plan.taxBps / 100}%{" "}
                            {hi ? "कर" : "tax"} · {plan.days}{" "}
                            {hi ? "दिन" : "days"}
                          </span>
                        </span>
                      </label>
                    ))}
                    {!!view.plans.length && (
                      <>
                        <Field
                          label={
                            hi
                              ? "छूट कोड (वैकल्पिक)"
                              : "Discount code (optional)"
                          }
                        >
                          <input name="code" maxLength={32} />
                        </Field>
                        <button disabled={pending} className="button primary">
                          {hi
                            ? "अंतिम राशि और अनुबंध देखें"
                            : "Review final price and agreement"}
                        </button>
                      </>
                    )}
                  </form>
                )}
            </section>
          )}
          {current && (
            <Checkout
              key={`${current.id}-${current.status}-${current.agreementId}`}
              order={current}
              view={view}
              action={action}
              run={run}
              pending={pending}
              hi={hi}
              base={base}
            />
          )}
          {view.orders
            .filter(
              (order) =>
                (order.status === "paid" ||
                  (order.status === "cancelled" &&
                    order.paymentMethod === "qr")) &&
                order.id !== current?.id,
            )
            .map((order) => (
              <Checkout
                key={order.id}
                order={order}
                view={view}
                action={action}
                run={run}
                pending={pending}
                hi={hi}
                base={base}
              />
            ))}
        </div>
      )}
    </>
  );
}
/** Collect agreement-bound consent before enabling payment, then expose authenticated evidence downloads. */
function Checkout({
  order,
  view,
  action,
  run,
  pending,
  hi,
  base,
}: {
  order: OrderView;
  view: OnboardingView;
  action: Action;
  run: Run;
  pending: boolean;
  hi: boolean;
  base: string;
}) {
  const expired = useCheckoutExpired(order.expiresAt);
  const [previewOpen, setPreviewOpen] = useState(order.status === "quoted");
  const [mark, setMark] = useState<SignatureMark | null>({
    mode: "typed",
    font: "allura",
  });
  const [enteredName, setEnteredName] = useState("");
  const signatureName = order.signatureName ?? enteredName;
  const [signingAction, setSigningAction] = useState<"code" | "sign" | null>(
    null,
  );
  const [signatureBusy, setSignatureBusy] = useState(false);
  const signingDisabled =
    pending || signatureBusy || signingAction !== null || !view.signingEnabled;
  /** Keep the initiating button busy through the action and its checkout refresh. */
  async function runSigning(
    kind: "code" | "sign",
    body: Result,
    notice?: string,
  ) {
    if (signingDisabled) return;
    setSigningAction(kind);
    try {
      await run(() => action(kind, body), notice);
    } finally {
      setSigningAction(null);
    }
  }

  const agreementUrl = order.agreementId
    ? `/api/workspaces/${base.split("/").at(-1)}/documents/${order.agreementId}/download`
    : `/api/workspaces/${base.split("/").at(-1)}/onboarding/agreement/${order.id}`;
  return (
    <section aria-labelledby={`order-${order.id}`}>
      <h2 id={`order-${order.id}`}>{order.planName}</h2>
      <p>
        <strong>{status(order.status, hi)}</strong>
        {order.dev && " · DEVELOPMENT / SANDBOX"}
      </p>
      <dl className="onboarding-totals">
        {[
          [hi ? "शुल्क" : "Fee", order.subtotal],
          [hi ? "छूट" : "Discount", -order.discount],
          [hi ? "कर" : "Tax", order.tax],
          [hi ? "अंतिम राशि" : "Final amount", order.total],
        ].map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{rupees(Number(value))}</dd>
          </div>
        ))}
      </dl>
      {order.status !== "paid" && order.status !== "cancelled" && (
        <p>
          {hi ? "चेकआउट की समय सीमा:" : "Checkout valid until:"}{" "}
          {new Date(order.expiresAt).toLocaleString(hi ? "hi-IN" : "en-IN")}
        </p>
      )}
      {expired && order.status === "quoted" && (
        <ExpiredCheckoutNotice hi={hi} />
      )}
      <details
        open={previewOpen}
        onToggle={(event) => setPreviewOpen(event.currentTarget.open)}
      >
        <summary>
          {hi ? "अनुबंध और MITC पढ़ें" : "Read agreement and MITC"}
        </summary>
        {previewOpen && (
          <AgreementPdfPreview
            hi={hi}
            signature={
              order.status === "quoted" &&
              mark &&
              signatureName &&
              order.signatureBox
                ? { mark, name: signatureName, box: order.signatureBox }
                : undefined
            }
            url={agreementUrl}
          />
        )}
        <a href={agreementUrl} target="_blank" rel="noreferrer">
          {hi
            ? "अनुबंध PDF नई विंडो में खोलें"
            : "Open agreement PDF in a new tab"}
        </a>
        <details>
          <summary>
            {hi ? "अनुबंध का पाठ संस्करण पढ़ें" : "Read text version"}
          </summary>
          <pre className="onboarding-agreement">{order.text}</pre>
        </details>
      </details>
      {order.status === "quoted" && !expired && (
        <form
          className="workspace-form onboarding-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = new FormData(event.currentTarget);
            if (order.signatureBox && !mark) return;
            void runSigning("sign", {
              orderId: order.id,
              name: signatureName,
              code: form.get("code"),
              consent: form.get("consent") === "on",
              hash: order.hash,
              ...(order.signatureBox ? { mark } : {}),
            });
          }}
        >
          <Field
            label={
              hi
                ? "मैंने सेवा शर्तें, MITC और अंतिम राशि पढ़ी है और सहमत हूँ।"
                : "I have read and agree to the service terms, MITC and final payable amount."
            }
          >
            <input name="consent" type="checkbox" required />
          </Field>
          <Field
            label={hi ? "हस्ताक्षर के लिए पूरा नाम" : "Full name for signature"}
          >
            <input
              name="signature"
              value={signatureName}
              readOnly={order.signatureName !== undefined}
              onChange={(event) => setEnteredName(event.target.value)}
              required
              maxLength={160}
              autoComplete="name"
            />
          </Field>
          {order.signatureBox ? (
            <SignatureInput
              value={mark}
              onChange={setMark}
              onBusy={setSignatureBusy}
              name={signatureName}
              hi={hi}
              disabled={pending || signatureBusy}
            />
          ) : (
            <p>
              {hi
                ? "यह पुराना चेकआउट ईमेल पुष्टि का उपयोग करता है। हर पृष्ठ पर हस्ताक्षर जोड़ने के लिए नया चेकआउट शुरू करें।"
                : "This older checkout uses email confirmation. Start a fresh checkout to add a visible signature to every page."}
            </p>
          )}
          <button
            type="button"
            disabled={signingDisabled}
            aria-busy={signingAction === "code"}
            className="button secondary"
            onClick={() =>
              void runSigning(
                "code",
                { orderId: order.id },
                hi
                  ? "पुष्टि कोड आपके ईमेल पर भेजा गया।"
                  : "A confirmation code was sent to your verified email.",
              )
            }
          >
            {signingAction === "code" ? (
              <>
                <LoaderCircle
                  className="signing-spinner"
                  size={18}
                  aria-hidden="true"
                />
                {hi ? "कोड भेजा जा रहा है…" : "Sending email code…"}
              </>
            ) : hi ? (
              "ईमेल पुष्टि कोड भेजें"
            ) : (
              "Send email confirmation code"
            )}
          </button>
          <Field label={hi ? "ईमेल पुष्टि कोड" : "Email confirmation code"}>
            <input
              name="code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
            />
          </Field>
          <button
            disabled={signingDisabled || Boolean(order.signatureBox && !mark)}
            aria-busy={signingAction === "sign"}
            className="button primary"
          >
            {signingAction === "sign" ? (
              <>
                <LoaderCircle
                  className="signing-spinner"
                  size={18}
                  aria-hidden="true"
                />
                {hi ? "हस्ताक्षर सहेजे जा रहे हैं…" : "Saving signature…"}
              </>
            ) : hi ? (
              "हस्ताक्षर करें और आगे बढ़ें"
            ) : (
              "Sign and continue"
            )}
          </button>
        </form>
      )}
      {order.status === "quoted" && view.devSkip && !expired && (
        <button
          disabled={pending}
          className="button secondary"
          onClick={() =>
            void run(() => action("skip", { step: "mitc", orderId: order.id }))
          }
        >
          Skip MITC — DEV only
        </button>
      )}
      {(["signed", "payment_pending"].includes(order.status) ||
        (order.status === "cancelled" && order.paymentMethod === "qr")) && (
        <PaymentChooser
          order={order}
          view={view}
          action={action}
          run={run}
          pending={pending}
          hi={hi}
          api={`/api/workspaces/${base.split("/").at(-1)}/onboarding`}
          checkout={hostedCheckout}
        />
      )}
      {["quoted", "signed"].includes(order.status) && (
        <button
          className="button secondary"
          disabled={pending}
          onClick={() =>
            void run(() => action("cancel", { orderId: order.id }))
          }
        >
          {hi ? "चेकआउट रद्द करें" : "Cancel checkout"}
        </button>
      )}
      {order.status === "paid" && (
        <p>
          {hi ? "सेवा अवधि:" : "Service period:"}{" "}
          {order.startsAt &&
            new Date(order.startsAt).toLocaleDateString(
              hi ? "hi-IN" : "en-IN",
            )}{" "}
          –{" "}
          {order.endsAt &&
            new Date(order.endsAt).toLocaleDateString(hi ? "hi-IN" : "en-IN")}
        </p>
      )}
      <div className="onboarding-actions">
        {[
          [
            order.agreementId,
            hi
              ? "हस्ताक्षरित अनुबंध डाउनलोड करें"
              : "Download signed agreement",
          ],
          [order.invoiceId, hi ? "चालान डाउनलोड करें" : "Download invoice"],
        ].map(([id, label]) =>
          id ? (
            <a
              className="button secondary"
              key={id}
              href={`/api/workspaces/${base.split("/")[2]}/documents/${id}/download`}
            >
              {label}
            </a>
          ) : null,
        )}
      </div>
      {order.status === "paid" && !order.invoiceId && (
        <p>
          {hi
            ? "चालान और ईमेल तैयार हो रहे हैं। थोड़ी देर में स्थिति रीफ़्रेश करें।"
            : "Your invoice and email are being prepared. Refresh shortly to download your documents."}
        </p>
      )}
    </section>
  );
}
