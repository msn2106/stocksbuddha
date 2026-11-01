import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { WebsiteEditor } from "../../src/websites/WebsiteEditor";
import {
  makeTenant,
  makeWebsite,
} from "../../../packages/contracts/tests/fixtures";
import type { WebsiteEditorState } from "@ra/contracts";

const originalFetch = globalThis.fetch;
const originalConfirm = window.confirm;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  window.confirm = originalConfirm;
});

/** Provide a complete draft and controlled HTTP receipts without depending on a browser or database. */
function fixture(initial?: WebsiteEditorState) {
  const site = makeWebsite();
  const data: WebsiteEditorState = initial ?? {
    id: "00000000-0000-4000-8000-000000000001",
    version: 1,
    revision: 2,
    snapshot: {
      schemaVersion: 1,
      publicProfile: makeTenant().profile,
      branding: site.branding,
      layout: site.layout,
      languages: site.languages,
      content: site.content,
    },
  };
  const calls: { body: Record<string, unknown>; key: string }[] = [];
  const control = {
    status: 200,
    result: {} as Record<string, unknown>,
    failure: undefined as unknown,
    reads: 0,
  };
  globalThis.fetch = (async (_url, options) => {
    if (!options?.method) {
      control.reads++;
      return Response.json(data);
    }
    const body = JSON.parse(options.body as string);
    calls.push({
      body,
      key: (options.headers as Record<string, string>)["Idempotency-Key"],
    });
    if (control.failure !== undefined) throw control.failure;
    return Response.json(
      control.status === 200
        ? {
            id: data.id ?? "00000000-0000-4000-8000-000000000002",
            version: Number(body.version) + 1,
            revision: 2,
          }
        : control.result,
      { status: control.status },
    );
  }) as typeof fetch;
  window.confirm = () => true;
  return { data, calls, control };
}
/** Wait for the asynchronous owner-only source to reach its editable state. */
async function openEditor() {
  render(<WebsiteEditor tenant={makeTenant()} />);
  await screen.findByLabelText("Website name", { exact: true });
}
/** Change a labeled control as a single browser change event. */
function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label, { exact: true }), {
    target: { value },
  });
}
/** Trigger an editor action through its accessible button name. */
function click(name: string) {
  fireEvent.click(screen.getByRole("button", { name }));
}
/** Save the current draft and return its submitted snapshot for behavior assertions. */
async function save(h: ReturnType<typeof fixture>) {
  click("Save draft");
  await screen.findByText("Draft saved. Your live website has not changed.");
  return h.calls.at(-1)!.body.snapshot as WebsiteEditorState["snapshot"];
}

test("branding and language edits remain local until save and preserve the source identity", async () => {
  const h = fixture();
  await openEditor();
  const clean = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(clean);
  assert.equal(clean.defaultPrevented, false);
  change("Website name", "My Research");
  change("Legal name", "My Legal Name");
  change("Brand initials", "mr");
  change("Registration number", "INH-123");
  change("Contact email", "hello@example.test");
  change("Contact phone", "+919999999999");
  change("Theme colour", "#112233");
  change("Visual background", "#ffffff");
  change("Font", "sans");
  change("Page layout", "editorial");
  change("Default language", "hi");
  assert.equal(
    (screen.getByLabelText("Enable Hindi content") as HTMLInputElement)
      .disabled,
    true,
  );
  change("Default language", "en");
  fireEvent.click(screen.getByLabelText("Enable Hindi content"));
  let snapshot = await save(h);
  assert.deepEqual(snapshot.languages.enabled, ["en"]);
  assert.equal(snapshot.content.hi, undefined);
  assert.equal(snapshot.publicProfile.name, "My Research");
  assert.equal(snapshot.branding.accent, "#112233");
  assert.equal(snapshot.layout.template, "editorial");
  assert.equal(h.data.snapshot.publicProfile.name, "Example Research");
  fireEvent.click(screen.getByLabelText("Enable Hindi content"));
  change("Contact email", "");
  change("Contact phone", "");
  change("Registration number", "");
  const dirty = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(dirty);
  assert.equal(dirty.defaultPrevented, true);
  snapshot = await save(h);
  assert.deepEqual(snapshot.content.hi, {});
  assert.equal(snapshot.publicProfile.contactEmail, null);
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Publish website",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
});

test("navigation editing preserves bilingual labels, ordering and enabled section destinations", async () => {
  const h = fixture();
  await openEditor();
  click("Navigation");
  fireEvent.change(screen.getAllByLabelText("English label")[0], {
    target: { value: "Research library" },
  });
  fireEvent.change(screen.getAllByLabelText("Hindi label")[0], {
    target: { value: "शोध" },
  });
  fireEvent.change(screen.getAllByLabelText("Section", { exact: true })[0], {
    target: { value: "plans" },
  });
  click("Move Approach link up");
  click("Remove About the analyst link");
  click("Add navigation link");
  const snapshot = await save(h);
  assert.equal(snapshot.layout.navigation?.[0].section, "approach");
  assert.deepEqual(
    snapshot.layout.navigation?.find((n) => n.section === "plans")?.label,
    { en: "Research library", hi: "शोध" },
  );
  assert.equal(snapshot.layout.navigation?.at(-1)?.section, "hero");
});

test("section editing changes ordered components, safe images, translations and footer settings", async () => {
  const h = fixture();
  await openEditor();
  click("Sections");
  change("Section layout", "stacked");
  change("Image URL", "https://example.test/first.jpg");
  change("Image description (English)", "Research analyst");
  change("Image description (Hindi)", "विश्लेषक");
  change("Image URL", "https://example.test/final.jpg");
  change("Hero headline", "A clear perspective");
  change("Editing language", "hi");
  change("Hero headline", "स्पष्ट दृष्टि");
  click("Move Research up");
  click("Move Research down");
  click("Remove Questions & answers");
  click("Add Questions & answers");
  click("ResearchRequired");
  change("Services equity title", "Equity research");
  click("ApproachRequired");
  change("Framework business label", "Business quality");
  click("About the analystRequired");
  change("Section layout", "reversed");
  change("Image URL", "https://example.test/remove.jpg");
  change("Image URL", "");
  click("Footer");
  change("Footer layout", "compact");
  change("Footer thinking", "Long-term thinking");
  click("Content");
  change("Website description", "Read our research");
  const snapshot = await save(h);
  assert.equal(
    snapshot.layout.images?.hero?.src,
    "https://example.test/final.jpg",
  );
  assert.equal(snapshot.layout.images?.about, undefined);
  assert.equal(snapshot.layout.sectionStyles?.about, "reversed");
  assert.equal(snapshot.layout.footer, "compact");
  assert.equal(snapshot.content.hi?.["site.hero"], "स्पष्ट दृष्टि");
  assert.equal(snapshot.content.en?.["site.hero"], "A clear perspective");
  assert.equal(snapshot.content.hi?.["footer.thinking"], "Long-term thinking");
});

test("saved preview supports mobile sizing and publication requires explicit confirmation", async () => {
  const h = fixture();
  await openEditor();
  click("Preview");
  assert.match(
    screen.getByTitle("Website draft preview").getAttribute("src")!,
    /workspace\/website\/preview\?lang=en/,
  );
  click("Mobile view");
  assert.equal(
    (screen.getByTitle("Website draft preview") as HTMLIFrameElement).style
      .width,
    "375px",
  );
  click("Desktop view");
  click("Preview");
  assert.equal(screen.queryByTitle("Website draft preview"), null);
  window.confirm = () => false;
  click("Publish website");
  assert.equal(h.calls.length, 0);
  window.confirm = () => true;
  click("Publish website");
  await screen.findByText(
    "Website published. Visitors can see this revision now.",
  );
  assert.equal(h.calls[0].body.action, "publish");
  assert.equal(h.calls[0].body.snapshot, undefined);
  assert.ok(screen.getByText("Published · revision 2"));
  await save(h);
  assert.equal(h.calls.at(-1)!.body.id, null);
});

test("partial starting sites expose missing content and approved default styles without borrowing marketing text", async () => {
  const h = fixture({
    id: null,
    version: 0,
    revision: 0,
    snapshot: {
      schemaVersion: 1,
      publicProfile: {},
      branding: {},
      layout: {},
      languages: { default: "en", enabled: ["en"] },
      content: {},
    },
  });
  await openEditor();
  assert.ok(screen.getByText("New website"));
  click("Sections");
  assert.equal(
    (screen.getByLabelText("Hero headline") as HTMLTextAreaElement).value,
    "",
  );
  change("Hero headline", "My introduction");
  click("Navigation");
  change("Brand tagline", "Independent research");
  click("Footer");
  assert.equal(
    (screen.getByLabelText("Footer layout") as HTMLSelectElement).value,
    "columns",
  );
  const snapshot = await save(h);
  assert.equal(snapshot.content.en?.["site.hero"], "My introduction");
  assert.ok(screen.getByText(/content fields need completing/));
});

test("save errors preserve local edits and reuse a retry key until the request changes", async () => {
  const h = fixture();
  await openEditor();
  change("Website name", "Unsaved name");
  for (const status of [401, 403, 422, 500]) {
    h.control.status = status;
    h.control.result =
      status === 422 ? { issues: ["Complete the legal name"] } : {};
    click("Save draft");
    await screen.findByRole("alert");
    assert.equal(
      (screen.getByLabelText("Website name") as HTMLInputElement).value,
      "Unsaved name",
    );
  }
  assert.equal(h.calls[0].key, h.calls[3].key);
  h.control.failure = new Error("Network offline");
  click("Save draft");
  await screen.findByText("Network offline");
  h.control.failure = "lost response";
  click("Save draft");
  await screen.findByText("The request failed. Try again.");
  h.control.failure = undefined;
  h.control.status = 200;
  change("Website name", "Recovered name");
  const snapshot = await save(h);
  assert.equal(snapshot.publicProfile.name, "Recovered name");
  assert.notEqual(h.calls.at(-1)!.key, h.calls[0].key);
});

test("stale publications support explicit rebase and stale drafts reload only after confirmation", async () => {
  const h = fixture();
  await openEditor();
  h.control.status = 409;
  h.control.result = { error: "stale_publication" };
  click("Publish website");
  await screen.findByRole("alert");
  window.confirm = () => false;
  click("Update publishing base");
  assert.equal(h.calls.length, 1);
  window.confirm = () => true;
  h.control.status = 200;
  click("Update publishing base");
  await screen.findByText(
    "Publishing base updated. Preview this draft before publishing.",
  );
  assert.equal(h.calls.at(-1)!.body.action, "rebase");
  assert.ok(h.calls.at(-1)!.body.snapshot);
  change("Website name", "Local change");
  h.control.status = 409;
  h.control.result = { error: "stale_draft" };
  click("Save draft");
  await screen.findByRole("alert");
  assert.equal(
    screen.queryByRole("button", { name: "Update publishing base" }),
    null,
  );
  window.confirm = () => false;
  click("Reload saved draft");
  assert.equal(h.control.reads, 1);
  window.confirm = () => true;
  click("Reload saved draft");
  await waitFor(() => assert.equal(h.control.reads, 2));
  await screen.findByDisplayValue("Example Research");
});

test("loading failures can be retried and unmounting cancels the pending read", async () => {
  const h = fixture();
  let fail = true;
  const adapter = globalThis.fetch;
  globalThis.fetch = (async (...args) =>
    fail
      ? new Response("unavailable", { status: 503 })
      : adapter(...args)) as typeof fetch;
  render(<WebsiteEditor tenant={makeTenant()} />);
  await screen.findByRole("alert");
  fail = false;
  click("Try again");
  await screen.findByLabelText("Website name");
  assert.equal(h.control.reads, 1);
  cleanup();
  let signal: AbortSignal | undefined;
  let reject!: (error: unknown) => void;
  globalThis.fetch = ((_url, options) => {
    signal = options?.signal as AbortSignal;
    return new Promise((_resolve, fail) => {
      reject = fail;
    });
  }) as typeof fetch;
  const view = render(<WebsiteEditor tenant={makeTenant()} />);
  assert.ok(screen.getByText("Loading your website…"));
  view.unmount();
  assert.equal(signal?.aborted, true);
  await act(async () => reject(new Error("Aborted")));
});
