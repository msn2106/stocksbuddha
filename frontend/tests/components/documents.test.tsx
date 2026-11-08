import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { App } from "../../src/App";
import { makePage } from "../../../packages/contracts/tests/fixtures";
import type { PageData } from "@ra/contracts";
const originalFetch = globalThis.fetch;
const originalFormData = globalThis.FormData;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
  globalThis.FormData = originalFormData;
});
/** Build a document workspace with the existing role-scoped shell and locale provider. */
function page(role = "subscriber", platform = false, hi = false): PageData {
  return {
    ...makePage(),
    ...(platform ? { tenant: null, website: null } : {}),
    locale: hi ? "hi" : "en",
    page: "account",
    account: {
      mode: "workspace",
      section: "documents",
      area: platform
        ? "platform"
        : role === "subscriber"
          ? "investor"
          : "organisation",
      role,
      profile: {
        name: "Test User",
        email: "user@example.test",
        emailVerified: true,
      },
    },
  };
}

test("Documents offers the correct platform/tenant destinations and disables uploads until activation", async () => {
  globalThis.fetch = async (url) =>
    Response.json(
      String(url).endsWith("/customers")
        ? { customers: [] }
        : { configured: false, documents: [], nextCursor: null },
    );
  const view = render(<App data={page("platform_owner", true)} />);
  await screen.findByText("Document storage is awaiting activation.");
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Upload document",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  assert.equal(
    screen.getByRole("link", { name: "Documents" }).getAttribute("href"),
    "/workspace/documents?lang=en",
  );
  assert.ok(screen.getByRole("option", { name: "Owner / RA contract" }));
  assert.equal(screen.queryByRole("option", { name: "KYC document" }), null);
  view.unmount();
  render(<App data={page("analyst")} />);
  await screen.findByText("Document storage is awaiting activation.");
  assert.ok(screen.getByRole("option", { name: "Recommendation evidence" }));
  assert.equal(screen.queryByRole("option", { name: "KYC document" }), null);
});

test("Documents lists authenticated attachments, loads additional metadata and uploads raw bytes for the current customer", async () => {
  const data = page();
  const api = `/api/workspaces/${data.tenant!.slug}/documents`;
  const calls: { url: string; init?: RequestInit }[] = [];
  const file = new File(["%PDF-1.4\nProof"], "MITC-Signed.pdf", {
    type: "application/pdf",
  });
  // Browser FormData is provided by JSDOM; bridge it without replacing the native File bytes used by fetch.
  globalThis.FormData = class {
    get(name: string) {
      return name === "file" ? file : null;
    }
  } as unknown as typeof FormData;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (init?.method === "POST")
      return Response.json({ id: "new" }, { status: 201 });
    if (String(url).endsWith("/customers"))
      return Response.json({ customers: [] });
    return Response.json({
      configured: true,
      documents: [
        {
          id: String(url).includes("before=") ? "older" : "proof",
          name: "MITC-Signed.pdf",
          kind: "mitc",
          customerId: "customer-id",
          bytes: 1234,
          createdAt: "2026-11-07",
        },
      ],
      nextCursor: String(url).includes("before=") ? null : "cursor",
    });
  };
  render(<App data={data} />);
  const download = await screen.findByRole("link", {
    name: /^Download/,
  });
  assert.equal(download.getAttribute("href"), `${api}/proof/download`);
  assert.equal(screen.queryByLabelText("Customer"), null);
  fireEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() =>
    assert.equal(screen.getAllByRole("link", { name: /^Download/ }).length, 2),
  );
  fireEvent.change(screen.getByLabelText("Document type"), {
    target: { value: "mitc" },
  });
  fireEvent.submit(
    screen.getByRole("button", { name: "Upload document" }).closest("form")!,
  );
  await screen.findByText("Document uploaded.");
  const uploaded = calls.find((call) => call.init?.method === "POST")!;
  assert.equal(uploaded.url, api);
  assert.equal(uploaded.init?.body, file);
  assert.equal(
    (uploaded.init?.headers as Record<string, string>)["X-Document-Kind"],
    "mitc",
  );
  assert.equal(
    (uploaded.init?.headers as Record<string, string>)["X-Customer-Id"],
    "",
  );
});

test("Documents shows a localized loading failure and preserves validation messages after rejected uploads", async () => {
  globalThis.fetch = async () => new Response(null, { status: 503 });
  const view = render(<App data={page("subscriber", false, true)} />);
  await screen.findByText("दस्तावेज़ लोड नहीं हो सके। फिर प्रयास करें।");
  view.unmount();
  globalThis.fetch = async (url, init) =>
    init?.method === "POST"
      ? Response.json({ error: "invalid_document" }, { status: 400 })
      : Response.json(
          String(url).endsWith("/customers")
            ? { customers: [{ id: "customer-a", name: "Customer A" }] }
            : { configured: true, documents: [], nextCursor: null },
        );
  globalThis.FormData = class {
    get(name: string) {
      return name === "file"
        ? new File(["bad"], "fake.pdf", { type: "application/pdf" })
        : "customer-a";
    }
  } as unknown as typeof FormData;
  render(<App data={page("support")} />);
  await screen.findByText("No documents yet.");
  assert.ok(screen.getByRole("option", { name: "Customer A (customer-a)" }));
  fireEvent.submit(
    screen.getByRole("button", { name: "Upload document" }).closest("form")!,
  );
  await screen.findByText(
    "Choose a valid PDF, JPEG or PNG file with a matching extension.",
  );
});

test("document forms handle empty/oversized files, pending uploads, localized failures and pagination recovery", async () => {
  for (const hi of [false, true]) {
    let file: File | null = null;
    let failure: unknown = null;
    let rejected = false;
    let readFailure = false;
    let finish: (() => void) | undefined;
    let hold = false;
    globalThis.FormData = class {
      get(name: string) {
        return name === "file" ? file : "customer-a";
      }
    } as unknown as typeof FormData;
    globalThis.fetch = async (url, init) => {
      if (init?.method === "POST") {
        if (hold)
          await new Promise<void>((resolve) => {
            finish = resolve;
          });
        if (failure) throw failure;
        return rejected
          ? Response.json({ error: "invalid_document" }, { status: 400 })
          : Response.json({ id: "new" });
      }
      if (readFailure) return new Response(null, { status: 503 });
      return Response.json(
        String(url).endsWith("/customers")
          ? { customers: [] }
          : {
              configured: true,
              documents: [
                {
                  id: "owner-proof",
                  kind: "owner",
                  customerId: null,
                  name: "contract.pdf",
                  bytes: 512,
                },
              ],
              nextCursor: "cursor",
            },
      );
    };
    const view = render(<App data={page("owner", false, hi)} />);
    await screen.findByRole("cell", { name: "contract.pdf" });
    const submit = () =>
      fireEvent.submit(
        screen
          .getByRole("button", {
            name: hi ? "दस्तावेज़ अपलोड करें" : "Upload document",
          })
          .closest("form")!,
      );
    submit();
    await screen.findByText(
      hi
        ? "अधिकतम फ़ाइल आकार 10 MiB है।"
        : "Choose a nonempty file up to 10 MiB.",
    );
    file = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "big.pdf", {
      type: "application/pdf",
    });
    submit();
    file = new File(["%PDF-1.4"], "proof.pdf", { type: "application/pdf" });
    rejected = true;
    submit();
    await screen.findByText(
      hi
        ? "मान्य PDF, JPEG या PNG फ़ाइल चुनें।"
        : "Choose a valid PDF, JPEG or PNG file with a matching extension.",
    );
    rejected = false;
    failure = new Error("network");
    submit();
    await screen.findByText(
      hi
        ? "अपलोड पूरा नहीं हो सका। सूची जाँचें और फिर प्रयास करें।"
        : "Upload could not complete. Check the document list before trying again.",
    );
    failure = "non-error";
    submit();
    await waitFor(() =>
      assert.equal(
        (
          screen.getByRole("button", {
            name: hi ? "दस्तावेज़ अपलोड करें" : "Upload document",
          }) as HTMLButtonElement
        ).disabled,
        false,
      ),
    );
    failure = null;
    hold = true;
    submit();
    await screen.findByRole("button", {
      name: hi ? "अपलोड हो रहा है…" : "Uploading…",
    });
    finish!();
    await screen.findByText(
      hi ? "दस्तावेज़ अपलोड हो गया।" : "Document uploaded.",
    );
    readFailure = true;
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "और दिखाएँ" : "Load more" }),
    );
    await screen.findByText(
      hi ? "सूची लोड नहीं हो सकी।" : "Could not load documents.",
    );
    fireEvent.change(
      screen.getByLabelText(hi ? "दस्तावेज़ का प्रकार" : "Document type"),
      { target: { value: "kyc" } },
    );
    assert.equal(
      (
        screen.getByRole("button", {
          name: hi ? "दस्तावेज़ अपलोड करें" : "Upload document",
        }) as HTMLButtonElement
      ).disabled,
      true,
    );
    view.unmount();
  }
});

test("Hindi document listings and disabled setup state remain localized, and unmounted reads cannot update the page", async () => {
  globalThis.fetch = async (url) =>
    Response.json(
      String(url).endsWith("/customers")
        ? { customers: [{ id: "one", name: "Client" }] }
        : { configured: false, documents: [], nextCursor: null },
    );
  const view = render(<App data={page("support", false, true)} />);
  await screen.findByText("दस्तावेज़ स्टोरेज अभी उपलब्ध नहीं है।");
  assert.ok(screen.getByRole("option", { name: "ग्राहक चुनें" }));
  view.unmount();
  let complete!: (response: Response) => void;
  globalThis.fetch = async () =>
    new Promise<Response>((resolve) => {
      complete = resolve;
    });
  const pending = render(<App data={page()} />);
  pending.unmount();
  complete(Response.json({}));
  let reject!: (reason: Error) => void;
  globalThis.fetch = async () =>
    new Promise<Response>((_resolve, fail) => {
      reject = fail;
    });
  const failed = render(<App data={page()} />);
  failed.unmount();
  reject(new Error("unmounted"));
});
