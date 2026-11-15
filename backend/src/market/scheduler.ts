import { indiaDate } from "./policy";
import { downloadCatalogue } from "./catalogue";
/** Identify the most recent scheduled India-time refresh slot (06:30 / 08:30). */
export function catalogueSlot(now: Date): string | null {
  const india = new Date(now.getTime() + 19800000),
    minutes = india.getUTCHours() * 60 + india.getUTCMinutes();
  return minutes < 390
    ? null
    : `${indiaDate(now)}:${minutes < 510 ? "06:30" : "08:30"}`;
}
/** One serialized worker per process; failed slots retry, shutdown awaits in-flight bounded downloads. */
export function startCatalogueSync(
  directory: string,
  env: NodeJS.ProcessEnv,
  onError: () => void,
  download = downloadCatalogue,
  now = () => new Date(),
) {
  if (
    env.MARKET_SYNC_ENABLED !== "true" ||
    (env.NODE_ENV === "production" && env.MARKET_DATA_USAGE_APPROVED !== "true")
  )
    return async () => {};
  let completed: string | null = null,
    working: Promise<void> | undefined;
  /** Start one due refresh while preventing overlapping downloads and retrying failed slots. */
  const tick = () => {
    const slot = catalogueSlot(now());
    if (!slot || slot === completed || working) return;
    working = download(directory)
      .then(() => {
        completed = slot;
      })
      .catch(onError)
      .finally(() => {
        working = undefined;
      });
  };
  const timer = setInterval(tick, 60000);
  timer.unref();
  tick();
  return async () => {
    clearInterval(timer);
    await working;
  };
}
