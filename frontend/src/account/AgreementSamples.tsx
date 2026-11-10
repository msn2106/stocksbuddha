import { useLanguage } from "../i18n";

/** Open saved RA agreement samples without saving local edits or collecting client data. */
export function AgreementSamples() {
  const { tenantPath, locale } = useLanguage();
  const hi = locale === "hi";
  return (
    <div className="agreement-samples">
      <a
        href={`/api/workspaces/${tenantPath.split("/").at(-1)}/onboarding/sample-agreement`}
        target="_blank"
        rel="noreferrer"
      >
        {hi
          ? "सहेजे गए अनुबंध का नमूना देखें"
          : "Preview saved agreement sample"}
      </a>
      <p>
        {hi
          ? "नमूने में काल्पनिक ग्राहक विवरण हैं। पहले अपने बदलाव सहेजें। यह हस्ताक्षर के लिए नहीं है।"
          : "Uses synthetic client details and your saved terms. Save changes before previewing. Samples cannot be signed."}
      </p>
      {tenantPath === "/ra/stocksbuddha" && (
        <a
          href="/assets/brand/stocksbuddha-letterhead-v1.pdf"
          target="_blank"
          rel="noreferrer"
        >
          {hi ? "मूल लेटरहेड देखें" : "View original letterhead"}
        </a>
      )}
    </div>
  );
}
