import "./dom";
import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { act } from "react";
import { render } from "../src/entry-server";
import { makePage } from "../../packages/contracts/tests/fixtures";

test("client bootstrap hydrates the server projection without changing tenant content", async () => {
  const data = makePage();
  const rendered = render(data);
  document.body.innerHTML = `<div id="root">${rendered.html}</div>${rendered.data}`;
  // CSS remains exercised by Vite builds and browser tests, not Node's module loader.
  const hooks = registerHooks({
    load(url, context, nextLoad) {
      return url.endsWith(".css")
        ? { format: "module", source: "", shortCircuit: true }
        : nextLoad(url, context);
    },
  });
  let client: typeof import("../src/entry-client") | undefined;
  try {
    await act(async () => {
      client = await import("../src/entry-client");
    });
    assert.equal(
      document.querySelector("h1")?.textContent,
      data.website!.content["site.hero"],
    );
    assert.equal(
      document.querySelector(".site-shell")?.getAttribute("data-tenant"),
      data.tenant!.id,
    );
  } finally {
    if (client) await act(async () => client!.root.unmount());
    hooks.deregister();
    document.body.innerHTML = "";
  }
});
