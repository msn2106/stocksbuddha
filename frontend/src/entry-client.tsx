import { hydrateRoot } from "react-dom/client";
import { App } from "./App";
import type { PageData } from "@ra/contracts";
import "./styles.css";

const data: PageData = JSON.parse(
  document.getElementById("page-data")!.textContent!,
);
/** Hydrated page root, also exposed for controlled teardown in client bootstrap tests. */
export const root = hydrateRoot(
  document.getElementById("root")!,
  <App data={data} />,
);
