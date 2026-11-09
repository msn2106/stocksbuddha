import { useEffect, useState } from "react";
import { smsError, smsRequest } from "./MobileVerification";
/** Offer SMS as an optional investor recovery channel, retaining the existing email route. */
export function SmsRecovery({ slug, hi }: { slug: string; hi: boolean }) {
  const [challenge, setChallenge] = useState(""),
    [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [requests, setRequests] = useState<{ email: string; at: number }[]>([]);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const recent = requests.filter(
    (request) =>
      request.email === email.trim().toLowerCase() &&
      request.at > now - 86400000,
  );
  const exhausted = recent.length >= 3;
  const cooldown = recent.length
    ? Math.max(0, Math.ceil((recent.at(-1)!.at + 60000 - now) / 1000))
    : 0;
  /** Send only to a previously enrolled contact and show the same message for unknown accounts. */
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!challenge && (exhausted || cooldown > 0)) return;
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const api = `/api/sms/${slug}`;
      if (!challenge) {
        const result = await smsRequest(api, "public/send", {
          email,
          key: crypto.randomUUID(),
        });
        const at = Date.now();
        setNow(at);
        setRequests((previous) => [
          ...previous.filter((request) => request.at > at - 86400000),
          { email: email.trim().toLowerCase(), at },
        ]);
        setChallenge(result.challengeId);
        setMessage(
          hi
            ? "यदि एसएमएस रिकवरी सक्षम है और सीमा बाकी है, तो कोड भेजा गया है। कोड 5 मिनट में समाप्त होगा। सीमा पूरी होने पर ईमेल का उपयोग करें।"
            : "If SMS recovery is enabled and within its limit, a code has been sent. The code expires in 5 minutes. If the limit is reached, use email recovery.",
        );
      } else {
        await smsRequest(api, "public/reset", {
          challengeId: challenge,
          code: form.get("code"),
          password: form.get("password"),
          confirmPassword: form.get("confirmPassword"),
        });
        setChallenge("");
        setMessage(
          hi
            ? "पासवर्ड बदल गया। नए पासवर्ड से लॉगिन करें।"
            : "Password changed. Sign in with your new password.",
        );
      }
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "sms_unavailable");
    } finally {
      setBusy(false);
    }
  }
  return (
    <details>
      <summary>
        {hi ? "एसएमएस से पासवर्ड रीसेट करें" : "Reset password by SMS"}
      </summary>
      <p>
        {hi
          ? "सत्यापित रिकवरी नंबर पर 24 घंटे में अधिकतम 3 एसएमएस भेजे जाते हैं। अगले अनुरोध से पहले एक मिनट रुकें। ईमेल से 24 घंटे में अधिकतम 5 रीसेट लिंक माँग सकते हैं।"
          : "Up to 3 SMS sends per rolling 24 hours to your verified recovery number. Wait one minute between requests. Email recovery is available anytime, with up to 5 reset-link sends per rolling 24 hours."}
      </p>
      <a href="#account-email">
        {hi ? "ईमेल से पासवर्ड रीसेट करें" : "Use email recovery"}
      </a>
      {exhausted && (
        <p role="status">
          {hi
            ? "आपने 3 एसएमएस कोड माँगे हैं। ईमेल का उपयोग करें या दैनिक सीमा रीसेट होने की प्रतीक्षा करें।"
            : "You have requested 3 SMS codes. Use email recovery or wait for the daily limit to reset."}
        </p>
      )}
      {error && <p role="alert">{smsError(error, hi)}</p>}
      {message && <p role="status">{message}</p>}
      <form
        method="post"
        className="workspace-form"
        onSubmit={submit}
        aria-busy={busy}
      >
        {!challenge ? (
          <label>
            Email
            <input
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </label>
        ) : (
          <>
            <label>
              {hi ? "एसएमएस कोड" : "SMS code"}
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                pattern="[0-9]{6}"
                maxLength={6}
              />
            </label>
            <label>
              {hi ? "नया पासवर्ड" : "New password"}
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
              />
            </label>
            <label>
              {hi ? "पासवर्ड की पुष्टि करें" : "Confirm new password"}
              <input
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
              />
            </label>
          </>
        )}
        <button
          className="button primary"
          disabled={busy || (!challenge && (exhausted || cooldown > 0))}
        >
          {busy
            ? hi
              ? "प्रक्रिया जारी है…"
              : "Working…"
            : challenge
              ? hi
                ? "पासवर्ड रीसेट करें"
                : "Reset password with code"
              : cooldown > 0
                ? hi
                  ? `अगला अनुरोध ${cooldown}s में`
                  : `Request code in ${cooldown}s`
                : hi
                  ? "रिकवरी कोड माँगें"
                  : "Request recovery code"}
        </button>
        {challenge && (
          <button
            type="button"
            className="button secondary"
            disabled={busy}
            onClick={() => {
              setChallenge("");
              setError("");
              setMessage("");
            }}
          >
            {hi ? "फिर शुरू करें" : "Start again"}
          </button>
        )}
      </form>
    </details>
  );
}
