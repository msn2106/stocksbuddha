import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "https://example.test/ra/example",
  pretendToBeVisual: true,
});
for (const name of [
  "window",
  "document",
  "navigator",
  "location",
  "localStorage",
  "HTMLElement",
  "Element",
  "Node",
  "NodeFilter",
  "Document",
  "DocumentFragment",
  "HTMLInputElement",
  "HTMLButtonElement",
  "HTMLSelectElement",
  "HTMLTextAreaElement",
  "Event",
  "MouseEvent",
  "KeyboardEvent",
  "CustomEvent",
  "MutationObserver",
  "getComputedStyle",
  "requestAnimationFrame",
  "cancelAnimationFrame",
]) {
  const value = dom.window[name as keyof typeof dom.window];
  Object.defineProperty(globalThis, name, {
    configurable: true,
    writable: true,
    value:
      typeof value === "function" && /^[a-z]/.test(name)
        ? value.bind(dom.window)
        : value,
  });
}
Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
  configurable: true,
  writable: true,
  value: true,
});

/** Reset browser-owned state between tests so storage, cookies and display settings cannot leak. */
export function resetDom() {
  dom.window.localStorage.clear();
  dom.window.document.documentElement.removeAttribute("style");
  for (const key of Object.keys(dom.window.document.documentElement.dataset))
    delete dom.window.document.documentElement.dataset[key];
  for (const cookie of dom.window.document.cookie.split(";"))
    dom.window.document.cookie = `${cookie.split("=")[0]}=; Max-Age=0; Path=/ra/example`;
}
