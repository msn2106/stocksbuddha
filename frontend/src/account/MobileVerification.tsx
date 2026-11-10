import { useEffect, useState } from "react";

type MobileState = {
  mobile: string;
  verified: boolean;
  recoveryEnabled: boolean;
  recoveryMobile?: string | null;
};
type Challenge = {
  challengeId: string;
  expiresIn: number;
  retryAfter: number;
  sendsRemaining: number;
  attemptsRemaining: number;
};
/** Explain OTP failures in the selected language without exposing vendor diagnostics. */
export function smsError(code: string, hi: boolean): string {
  const messages: Record<string, [string, string]> = {
    paid_mobile_change_requires_review: [
      "Changing a paid client’s KYC mobile requires RA review. Contact your RA; your existing service remains active.",
      "भुगतान कर चुके ग्राहक का केवाईसी मोबाइल बदलने के लिए आरए की समीक्षा चाहिए। अपने आरए से संपर्क करें; वर्तमान सेवा जारी रहेगी।",
    ],
    sms_encoding_mismatch: [
      "Use Unicode encoding with an approved regional-language template.",
      "स्थानीय भाषा के स्वीकृत टेम्पलेट के लिए यूनिकोड एन्कोडिंग चुनें।",
    ],
    sms_recovery_unavailable: [
      "SMS recovery is awaiting activation. Email password recovery remains available.",
      "एसएमएस रिकवरी अभी सक्रिय नहीं है। ईमेल से पासवर्ड रीसेट उपलब्ध है।",
    ],
    sms_separate_accounts_required: [
      "Use a separate RA SMS account. The platform recovery account cannot be shared with an RA.",
      "आरए के लिए अलग एसएमएस खाता उपयोग करें। प्लेटफ़ॉर्म रिकवरी खाता आरए के साथ साझा नहीं हो सकता।",
    ],
    invalid_mobile: [
      "Enter a valid Indian mobile number.",
      "सही भारतीय मोबाइल नंबर दर्ज करें।",
    ],
    sms_trial_destination: [
      "Trial SMS is available only for the approved test number.",
      "परीक्षण एसएमएस केवल स्वीकृत नंबर पर उपलब्ध है।",
    ],
    sms_rate_limited: [
      "The SMS limit was reached. Wait before trying again, or use email recovery.",
      "एसएमएस सीमा पूरी हुई। प्रतीक्षा करें या ईमेल से पासवर्ड रीसेट करें।",
    ],
    invalid_or_expired_sms_code: [
      "The code is incorrect, expired, or has no attempts remaining.",
      "कोड गलत है, समाप्त है या प्रयास सीमा पूरी हो गई है।",
    ],
    invalid_password: [
      "Check your password and confirmation.",
      "पासवर्ड और पुष्टि जाँचें।",
    ],
    recovery_not_eligible: [
      "Verify your mobile first. SMS recovery is available only for investor-only accounts.",
      "पहले मोबाइल सत्यापित करें। एसएमएस रिकवरी केवल निवेशक खातों के लिए है।",
    ],
    recovery_mobile_unavailable: [
      "This number cannot be enabled for account recovery. Use another number or email recovery.",
      "इस नंबर से खाता रिकवरी उपलब्ध नहीं है। दूसरा नंबर या ईमेल उपयोग करें।",
    ],
    version_conflict: [
      "Settings changed. Close and reopen SMS settings before saving.",
      "सेटिंग बदल गई हैं। एसएमएस सेटिंग फिर खोलें।",
    ],
    invalid_sms_settings: [
      "Check the credentials, sender, DLT IDs and template placeholders.",
      "क्रेडेंशियल, प्रेषक, डीएलटी आईडी और टेम्पलेट जाँचें।",
    ],
    sms_delivery_uncertain: [
      "Delivery could not be confirmed. If a code arrives, use it; wait before resending.",
      "डिलीवरी की पुष्टि नहीं हुई। कोड मिले तो उपयोग करें; फिर भेजने से पहले रुकें।",
    ],
  };
  return (
    messages[code]?.[hi ? 1 : 0] ??
    (hi
      ? "एसएमएस सेवा उपलब्ध नहीं है। बाद में प्रयास करें या अपने आरए से संपर्क करें।"
      : "SMS is unavailable. Try later or contact your RA.")
  );
}
/** Send same-origin JSON actions; server quotas and authorization remain authoritative. */
export async function smsRequest(api: string, action: string, body?: unknown) {
  const response = await fetch(
    `${api}/${action}`,
    body === undefined
      ? undefined
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
  );
  const result = await response.json();
  if (!response.ok) throw new Error(result.error);
  return result;
}
/** Verify the investor's own mobile and explicitly manage the independent global recovery contact. */
export function MobileVerification({
  slug,
  hi,
  onVerified,
}: {
  slug: string;
  hi: boolean;
  onVerified: () => void;
}) {
  const api = `/api/sms/${slug}`;
  const [state, setState] = useState<MobileState | null>(null),
    [mobile, setMobile] = useState("");
  const [changingMobile, setChangingMobile] = useState(false);
  const [challenge, setChallenge] = useState<Challenge | null>(null),
    [code, setCode] = useState("");
  const [wait, setWait] = useState(0),
    [expiry, setExpiry] = useState(0),
    [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    let live = true;
    smsRequest(api, "mobile")
      .then((next) => {
        if (live) {
          setState(next);
          setMobile(next.mobile);
        }
      })
      .catch(() => {
        if (live) setError("sms_unavailable");
      });
    return () => {
      live = false;
    };
  }, [api]);
  useEffect(() => {
    const timer = setInterval(() => {
      setWait((value) => Math.max(0, value - 1));
      setExpiry((value) => Math.max(0, value - 1));
    }, 1000);
    return () => clearInterval(timer);
  }, []);
  /** Keep failures local and clear password material after every enrollment attempt. */
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await task();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "sms_unavailable");
    } finally {
      setBusy(false);
      setPassword("");
    }
  }
  return (
    <section
      className="workspace-form"
      aria-label={hi ? "मोबाइल सत्यापन" : "Mobile verification"}
      aria-busy={busy}
    >
      <h3>
        {state?.verified
          ? hi
            ? "मोबाइल सत्यापित है"
            : "Mobile verified"
          : hi
            ? "पहला चरण: मोबाइल सत्यापित करें"
            : "First step: verify your mobile"}
      </h3>
      {error && <p role="alert">{smsError(error, hi)}</p>}
      {message && <p role="status">{message}</p>}
      {!state && !error && (
        <p role="status">
          {hi
            ? "मोबाइल सत्यापन स्थिति जाँची जा रही है…"
            : "Checking mobile verification…"}
        </p>
      )}
      {state?.verified && (
        <p>
          {hi ? "सत्यापित मोबाइल:" : "Verified mobile:"} {state.mobile}
        </p>
      )}
      {state?.verified && !changingMobile && (
        <button
          type="button"
          className="button secondary"
          onClick={() => setChangingMobile(true)}
        >
          {hi ? "मोबाइल नंबर बदलें" : "Change mobile number"}
        </button>
      )}
      {state && (!state.verified || changingMobile) && (
        <>
          <form
            method="post"
            onSubmit={(event) => {
              event.preventDefault();
              void run(async () => {
                const next = await smsRequest(api, "send", {
                  mobile,
                  key: crypto.randomUUID(),
                });
                setChallenge(next);
                setWait(next.retryAfter);
                setExpiry(next.expiresIn);
                setCode("");
                setMessage(
                  next.deliveryUncertain
                    ? smsError("sms_delivery_uncertain", hi)
                    : hi
                      ? "कोड भेजने का अनुरोध हुआ। कोड किसी से साझा न करें।"
                      : "Code requested. Never share it with anyone.",
                );
              });
            }}
          >
            <label>
              {hi ? "मोबाइल नंबर" : "Mobile number"}
              <input
                type="tel"
                autoComplete="tel"
                required
                maxLength={20}
                value={mobile}
                onChange={(event) => {
                  setMobile(event.target.value);
                  setChallenge(null);
                }}
              />
            </label>
            <button
              className="button secondary"
              disabled={busy || wait > 0 || !state}
            >
              {wait > 0
                ? `${hi ? "फिर भेजें" : "Resend in"} ${wait}s`
                : hi
                  ? "कोड भेजें"
                  : "Send mobile code"}
            </button>
          </form>
          {challenge && (
            <form
              method="post"
              onSubmit={(event) => {
                event.preventDefault();
                void run(async () => {
                  setChallenge((previous) =>
                    previous
                      ? {
                          ...previous,
                          attemptsRemaining: Math.max(
                            0,
                            previous.attemptsRemaining - 1,
                          ),
                        }
                      : null,
                  );
                  await smsRequest(api, "verify", {
                    challengeId: challenge.challengeId,
                    code,
                  });
                  const next = await smsRequest(api, "mobile");
                  setState(next);
                  setMobile(next.mobile);
                  setChallenge(null);
                  setCode("");
                  setChangingMobile(false);
                  onVerified();
                });
              }}
            >
              <p role="status">
                {hi ? "कोड की अवधि (सेकंड):" : "Code expires in seconds:"}{" "}
                {expiry}. {hi ? "शेष प्रेषण:" : "Sends remaining:"}{" "}
                {challenge.sendsRemaining}.{" "}
                {hi ? "शेष प्रयास:" : "Attempts remaining:"}{" "}
                {challenge.attemptsRemaining}
              </p>
              <label>
                {hi ? "छह अंकों का कोड" : "Six-digit mobile code"}
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={code}
                  onChange={(event) => setCode(event.target.value)}
                />
              </label>
              <button
                className="button primary"
                disabled={
                  busy || expiry === 0 || challenge.attemptsRemaining === 0
                }
              >
                {hi ? "मोबाइल सत्यापित करें" : "Verify mobile"}
              </button>
            </form>
          )}
          {changingMobile && (
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => {
                setChangingMobile(false);
                setMobile(state!.mobile);
                setChallenge(null);
                setCode("");
                setError("");
                setMessage("");
              }}
            >
              {hi ? "नंबर बदलना रद्द करें" : "Cancel number change"}
            </button>
          )}
        </>
      )}
      {state?.verified && (
        <form
          method="post"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              await smsRequest(api, "recovery-contact", {
                password,
                enabled: !state.recoveryEnabled,
              });
              setState(await smsRequest(api, "mobile"));
              setMessage(
                hi ? "रिकवरी सेटिंग सहेजी गई।" : "Recovery preference saved.",
              );
            });
          }}
        >
          <h4>
            {hi
              ? "एसएमएस से पासवर्ड रीसेट (वैकल्पिक)"
              : "Reset your password by SMS (optional)"}
          </h4>
          <p>
            {hi
              ? "पासवर्ड भूलने पर इस सत्यापित नंबर पर रीसेट कोड प्राप्त करें। यह केवाईसी का चरण नहीं है। ईमेल से पासवर्ड रीसेट भी उपलब्ध है।"
              : "If you forget your password, receive a reset code on this verified number. This is separate from KYC. Email password reset remains available."}
          </p>
          <p>
            {hi
              ? "एसएमएस पासवर्ड रिकवरी वैकल्पिक है और सभी आरए में आपके साझा खाते पर लागू है। आपका आरए इसे सक्षम नहीं कर सकता।"
              : "SMS password recovery is optional and applies to your shared account across RAs. Your RA cannot enable it for you."}
          </p>
          {state.recoveryEnabled && (
            <p>
              {hi ? "रिकवरी मोबाइल:" : "Recovery mobile:"}{" "}
              {state.recoveryMobile}.{" "}
              {hi
                ? "नंबर बदलने के लिए रिकवरी बंद करके फिर सक्षम करें।"
                : "To change this number, disable recovery and enable it again after verification."}
            </p>
          )}
          <label>
            {hi ? "वर्तमान पासवर्ड" : "Current password"}
            <input
              type="password"
              autoComplete="current-password"
              required
              maxLength={128}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />
          </label>
          <button className="button secondary" disabled={busy}>
            {state.recoveryEnabled
              ? hi
                ? "एसएमएस रिकवरी बंद करें"
                : "Disable SMS recovery"
              : hi
                ? "एसएमएस रिकवरी सक्षम करें"
                : "Enable SMS recovery"}
          </button>
        </form>
      )}
    </section>
  );
}
