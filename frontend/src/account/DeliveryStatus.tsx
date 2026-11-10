import { useEffect, useState } from "react";

type Job = {
  id: string;
  paymentStatus: string;
  paymentMethod?: string | null;
  deliveryStatus: string | null;
  attempts: number;
  queuedAt: string;
  availableAt: string | null;
};
/** Show tenant-admin delivery and payment recovery without customer identity or provider payloads. */
export function DeliveryStatus({ api, hi }: { api: string; hi: boolean }) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);
  /** Fetch bounded current status; explicit refresh also recovers from failed requests. */
  async function refresh() {
    const response = await fetch(`${api}/jobs`);
    if (!response.ok) throw new Error("queue_unavailable");
    setJobs(await response.json());
  }
  useEffect(() => {
    refresh().catch(() => setError(true));
  }, [api]);
  /** Request a server-authorized retry and refresh status, retaining visible failure feedback. */
  async function retry(orderId?: string) {
    setPending(true);
    setError(false);
    try {
      if (orderId) {
        const response = await fetch(`${api}/retry-job`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ orderId }),
        });
        if (!response.ok) throw new Error("retry_failed");
      }
      await refresh();
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <section
      aria-label={
        hi ? "भुगतान और दस्तावेज़ वितरण" : "Payments and document delivery"
      }
      aria-busy={pending}
    >
      <h2>
        {hi ? "भुगतान और दस्तावेज़ वितरण" : "Payments and document delivery"}
      </h2>
      <button
        className="button secondary"
        type="button"
        disabled={pending}
        onClick={() => void retry()}
      >
        {hi ? "वितरण स्थिति रीफ़्रेश करें" : "Refresh delivery status"}
      </button>
      {error && (
        <p role="alert">
          {hi
            ? "स्थिति या पुनः प्रयास उपलब्ध नहीं है। फिर कोशिश करें।"
            : "Status or retry unavailable. Please try again."}
        </p>
      )}
      {jobs.length === 0 ? (
        <p>
          {hi
            ? "कोई भुगतान या वितरण कार्य नहीं।"
            : "No payment or delivery jobs."}
        </p>
      ) : (
        <ul>
          {jobs.map((job) => (
            <li key={job.id} style={{ overflowWrap: "anywhere" }}>
              <p>
                {job.id}: {job.paymentStatus} / {job.deliveryStatus ?? "—"}
              </p>
              <p>
                {hi ? "प्रयास" : "Attempts"}: {job.attempts} ·{" "}
                {hi ? "कतार में" : "Queued"}: {job.queuedAt} ·{" "}
                {hi ? "अगला प्रयास" : "Next attempt"}: {job.availableAt ?? "—"}
              </p>
              {job.paymentMethod === "qr" &&
              job.paymentStatus === "payment_pending" ? (
                <p>
                  {hi
                    ? "ऊपर QR भुगतान समीक्षा में जाँचें।"
                    : "Use QR payment reviews above to check this payment."}
                </p>
              ) : (
                (job.paymentStatus === "payment_pending" ||
                  job.deliveryStatus === "pending" ||
                  job.deliveryStatus === "sending") && (
                  <button
                    className="button secondary"
                    type="button"
                    disabled={pending}
                    onClick={() => void retry(job.id)}
                  >
                    {hi ? "पुनः प्रयास" : "Retry"}
                  </button>
                )
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
