import "../dom";
import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  cleanup,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import type { ResearchSnapshot, ResearchItem } from "@ra/contracts";
import { Recommendations } from "../../src/account/Recommendations";
import { ResearchEditor } from "../../src/account/ResearchEditor";
const originalFetch = globalThis.fetch;
afterEach(() => {
  cleanup();
  globalThis.fetch = originalFetch;
});
const snapshot: ResearchSnapshot = {
  title: "Example research",
  offering: "equity",
  validUntil: "2026-12-01T00:00:00Z",
  rationale: "Research rationale based on valuation.",
  disclosures: "No material financial interest or compensation.",
  aiDisclosure: "None",
  legs: [
    {
      instrumentKey: "NSE_EQ|1",
      side: "buy",
      quantity: 1,
      horizon: "swing",
      entryMin: 100,
      entryMax: 105,
      stopLoss: 95,
      targets: [120],
      rationale: "Valuation supports the trade.",
      note: "",
    },
  ],
  instruments: [
    {
      key: "NSE_EQ|1",
      name: "Example Industries",
      symbol: "EXAMPLE",
      exchange: "NSE",
      type: "EQ",
      underlying: "NSE_EQ|1",
      expiry: null,
      strike: null,
      lotSize: 1,
      tickSize: 0.05,
    },
  ],
  attachments: [],
  issuer: { name: "Example RA", registration: "TEST", author: "Admin" },
  status: "active",
  reason: "",
  publishedAt: "2026-11-17T06:00:00Z",
  version: 2,
};
const item: ResearchItem = {
  id: "report",
  version: 2,
  status: "active",
  latest: snapshot,
  unread: true,
};
test("investor opens a delivered report, marks it read and can inspect earlier versions without author controls", async () => {
  const calls: string[] = [];
  globalThis.fetch = async (url) => {
    const path = String(url);
    calls.push(path);
    return new Response(
      JSON.stringify(
        path.endsWith("/read")
          ? {}
          : path.endsWith("/report")
            ? {
                ...item,
                history: [
                  snapshot,
                  {
                    ...snapshot,
                    version: 1,
                    rationale: "Original research rationale.",
                  },
                ],
              }
            : { items: [item], hasMore: false },
      ),
      { status: 200 },
    );
  };
  render(<Recommendations slug="example" />);
  assert.ok(await screen.findByText("Unread"));
  fireEvent.click(screen.getByRole("button", { name: "View research" }));
  await screen.findByText("Research rationale based on valuation.");
  await waitFor(() => assert.equal(screen.queryByText("Unread"), null));
  assert.ok(calls.some((p) => p.endsWith("/report/read")));
  assert.equal(
    screen.queryByRole("button", { name: "Create recommendation" }),
    null,
  );
  fireEvent.change(screen.getByLabelText("Publication history"), {
    target: { value: "1" },
  });
  assert.ok(screen.getByText("Original research rationale."));
});

test("owner can request and refresh Telegram delivery and include closure updates", async () => {
  const calls: { path: string; body?: string }[] = [];
  const ownerItem = {
    ...item,
    draft,
    recipientCount: 1,
    telegramDelivery: { pending: 1 },
  };
  globalThis.fetch = async (url, init) => {
    const path = String(url);
    calls.push({ path, body: init?.body?.toString() });
    return Response.json(
      path.endsWith("/report")
        ? { ...ownerItem, history: [snapshot] }
        : path.includes("/recommendations?")
          ? { items: [ownerItem], hasMore: false }
          : {},
    );
  };
  render(<Recommendations slug="example" owner />);
  fireEvent.click(await screen.findByRole("button", { name: "View research" }));
  fireEvent.click(
    await screen.findByRole("button", {
      name: "Send latest version to Telegram",
    }),
  );
  await screen.findByText(
    "Telegram delivery requested. Refresh delivery status to see the results. Repeated requests will not resend this version.",
  );
  assert.ok(calls.some(({ path }) => path.endsWith("/report/telegram")));
  fireEvent.click(
    screen.getByRole("button", { name: "Refresh delivery status" }),
  );
  await waitFor(() =>
    assert.equal(
      (
        screen.getByRole("button", {
          name: "Confirm status update",
        }) as HTMLButtonElement
      ).disabled,
      false,
    ),
  );
  fireEvent.change(screen.getByLabelText("Reason (retained in history)"), {
    target: { value: "New information changes the recommendation." },
  });
  fireEvent.click(
    screen.getByRole("checkbox", {
      name: "Also send this status update on Telegram",
    }),
  );
  fireEvent.click(
    screen.getByRole("button", { name: "Confirm status update" }),
  );
  await waitFor(() =>
    assert.ok(calls.some(({ path }) => path.endsWith("/report/close"))),
  );
  assert.equal(
    JSON.parse(calls.find(({ path }) => path.endsWith("/report/close"))!.body!)
      .sendTelegram,
    true,
  );
});

test("failed list stays visibly retryable and an empty success is distinct", async () => {
  let fail = true;
  globalThis.fetch = async (url) =>
    String(url).endsWith("/telegram")
      ? Response.json({ connected: false })
      : new Response(
          JSON.stringify(fail ? {} : { items: [], hasMore: false }),
          {
            status: fail ? 503 : 200,
          },
        );
  render(<Recommendations slug="example" />);
  assert.ok(await screen.findByRole("alert"));
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  await waitFor(() => assert.equal(screen.queryByRole("alert"), null));
  assert.ok(screen.getByText(/No recommendations/i));
});
test("editor switches between normal and hedge legs and requires explicit audience selection", () => {
  render(
    <ResearchEditor
      slug="example"
      item={null}
      options={{
        plans: [{ id: "plan", name: "Monthly" }],
        groups: [],
        clients: [],
        attachments: [],
      }}
      request={async () => ({})}
      onClose={() => {}}
      onSaved={() => {}}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Hedge trade" }));
  assert.equal(screen.getAllByLabelText("Direction").length, 2);
  fireEvent.change(screen.getByLabelText("Target clients"), {
    target: { value: "plans" },
  });
  assert.ok(screen.getByRole("checkbox", { name: "Monthly" }));
  fireEvent.click(screen.getByRole("button", { name: "Normal trade" }));
  assert.equal(screen.getAllByLabelText("Direction").length, 1);
  assert.equal(
    screen.queryByRole("button", { name: "Publish recommendation" }),
    null,
  );
});

import { LanguageProvider } from "../../src/i18n";
import { ResearchReport } from "../../src/account/ResearchReport";
import type {
  ResearchDraft,
  ResearchPreview,
  ResearchOptions,
} from "@ra/contracts";
import userEvent from "@testing-library/user-event";
const draft: ResearchDraft = {
  title: snapshot.title,
  offering: snapshot.offering,
  validUntil: snapshot.validUntil,
  rationale: snapshot.rationale,
  disclosures: snapshot.disclosures,
  aiDisclosure: snapshot.aiDisclosure,
  legs: snapshot.legs,
  attachmentIds: [],
  audience: { mode: "all", ids: [] },
};
const file = {
  id: "file",
  name: "Evidence.pdf",
  mime: "application/pdf",
  bytes: 123,
  sha256: "abc",
};
const options: ResearchOptions = {
  plans: [{ id: "plan", name: "Monthly" }],
  groups: [
    { id: "group", name: "Swing", version: 1, membershipIds: ["client"] },
  ],
  clients: [
    { id: "client", name: "Example Client" },
    { id: "other", name: "Other Client" },
  ],
  attachments: [file],
};
function localized(locale: "en" | "hi", node: React.ReactNode) {
  return (
    <LanguageProvider locale={locale} tenant={null} website={null}>
      {node}
    </LanguageProvider>
  );
}
function change(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}
for (const locale of ["en", "hi"] as const) {
  const hi = locale === "hi";
  test(`${locale}: editor saves reviewed content, invalidates previews, uploads evidence and publishes`, async () => {
    const calls: { path: string; body: unknown }[] = [];
    let failSave = false,
      failPublish = false,
      uploadFail = false,
      saved = 0,
      closed = 0;
    let preview: ResearchPreview = {
      snapshot: { ...snapshot, attachments: [file] },
      check: { allowed: true, reasons: [], conflicts: [] },
      recipientCount: 1,
      reasons: [],
      token: "a".repeat(64),
    };
    globalThis.fetch = async (url) =>
      String(url).includes("/documents")
        ? new Response(JSON.stringify(uploadFail ? {} : { id: "uploaded" }), {
            status: uploadFail ? 503 : 200,
          })
        : new Response(
            JSON.stringify({
              instruments: [
                {
                  ...snapshot.instruments[0],
                  type: "CE",
                  key: "NSE_FO|1",
                  expiry: "2026-11-30",
                },
              ],
            }),
          );
    const request = async (path: string, body: unknown) => {
      calls.push({ path, body });
      if (path.endsWith("/preview")) return preview;
      if (path.endsWith("/publish")) {
        if (failPublish) throw Error("Publication changed");
        return {};
      }
      if (failSave) throw Error("Save conflict");
      return { version: 2 };
    };
    const view = render(
      localized(
        locale,
        <ResearchEditor
          slug="example"
          item={{ ...item, latest: null, status: "draft", draft, version: 1 }}
          options={options}
          request={request}
          onSaved={() => saved++}
          onClose={() => closed++}
        />,
      ),
    );
    change(hi ? "शीर्षक" : "Recommendation title", "Updated research title");
    change(hi ? "रिसर्च श्रेणी" : "Research offering", "options");
    change(hi ? "नाम / सिंबल" : "Name / symbol", "EXAMPLE");
    await screen.findByRole("option", { name: "NSE · EXAMPLE · CE" });
    change(hi ? "मिलते हुए इंस्ट्रूमेंट" : "Matching instruments", "NSE_FO|1");
    change(hi ? "दिशा" : "Direction", "sell");
    change(hi ? "समय सीमा" : "Horizon", "intraday");
    change(hi ? "मात्रा (यूनिट)" : "Quantity (units)", "50");
    for (const [en, hindi, value] of [
      ["Entry minimum (₹)", "न्यूनतम एंट्री (₹)", "100"],
      ["Entry maximum (₹)", "अधिकतम एंट्री (₹)", "105"],
      ["Stop-loss (₹)", "स्टॉप लॉस (₹)", "110"],
    ])
      change(hi ? hindi : en, value);
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "लक्ष्य जोड़ें" : "Add target" }),
    );
    change(hi ? "लक्ष्य 1 (₹)" : "Target 1 (₹)", "90");
    change(hi ? "लक्ष्य 2 (₹)" : "Target 2 (₹)", "80");
    fireEvent.click(screen.getByRole("button", { name: "Remove target 2" }));
    change(
      hi ? "नोट (वैकल्पिक)" : "Note (optional)",
      "Wait for entry confirmation",
    );
    change(
      hi ? "इस लेग का आधार" : "Leg rationale",
      "Updated technical rationale.",
    );
    change(
      hi ? "संयुक्त रिसर्च का आधार" : "Overall research rationale",
      "Updated analysis based on audited data.",
    );
    change(
      hi ? /भौतिक हित और प्रकटीकरण/ : /Material interests & disclosures/,
      "No material conflicts or compensation declared.",
    );
    change(hi ? "AI उपकरणों का उपयोग" : "Extent of AI use", "No AI used");
    fireEvent.change(
      view.baseElement.querySelector('input[type="datetime-local"]')!,
      { target: { value: "2027-01-01T12:00" } },
    );
    change(hi ? "क्लाइंट चुनें" : "Target clients", "plans");
    fireEvent.click(screen.getByLabelText("Monthly"));
    fireEvent.click(screen.getByLabelText("Monthly"));
    fireEvent.click(screen.getByLabelText("Monthly"));
    change(hi ? "क्लाइंट चुनें" : "Target clients", "groups");
    fireEvent.click(screen.getByLabelText("Swing"));
    change(
      hi ? "पहले अपलोड की गई फ़ाइल" : "Attach an existing RA file",
      "file",
    );
    change(
      hi ? "पहले अपलोड की गई फ़ाइल" : "Attach an existing RA file",
      "file",
    );
    change(hi ? "पहले अपलोड की गई फ़ाइल" : "Attach an existing RA file", "");
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "हटाएँ" : "Remove",
      }),
    );
    const upload = view.baseElement.querySelector('input[type="file"]')!;
    fireEvent.change(upload, { target: { files: [] } });
    uploadFail = true;
    fireEvent.change(upload, {
      target: {
        files: [new File(["test"], "fail.pdf", { type: "application/pdf" })],
      },
    });
    assert.match(
      (await screen.findByRole("alert")).textContent!,
      /Upload failed/,
    );
    uploadFail = false;
    fireEvent.change(upload, {
      target: {
        files: [
          new File(["test"], "evidence.pdf", { type: "application/pdf" }),
        ],
      },
    });
    await screen.findByText(/evidence.pdf/);
    const form = view.baseElement.querySelector("form")!;
    failSave = true;
    fireEvent.submit(form);
    assert.match(
      (await screen.findByRole("alert")).textContent!,
      /Save conflict/,
    );
    failSave = false;
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "ड्राफ्ट सुरक्षित करें" : "Save draft",
      }),
    );
    await waitFor(() => assert.ok(saved > 0));
    preview = {
      ...preview,
      token: null,
      reasons: ["no_eligible_recipients", "unknown_reason"],
      check: {
        allowed: false,
        reasons: ["personal_trade_lookback"],
        conflicts: [
          {
            id: "conflict",
            symbol: "EXAMPLE",
            date: "2026-11-16",
            until: "2026-12-17",
          },
        ],
      },
    };
    fireEvent.submit(form);
    await screen.findByText(/No selected subscribers/);
    assert.ok(
      (
        screen.getByRole("button", {
          name: hi ? "अनुशंसा प्रकाशित करें" : "Publish recommendation",
        }) as HTMLButtonElement
      ).disabled,
    );
    preview = {
      ...preview,
      token: "a".repeat(64),
      check: { allowed: true, reasons: [], conflicts: [] },
      reasons: [],
    };
    change(hi ? "शीर्षक" : "Recommendation title", "Another reviewed title");
    assert.equal(screen.queryByText(/No selected subscribers/), null);
    fireEvent.submit(form);
    await screen.findByRole("checkbox", {
      name: hi ? /मैं रिसर्च/ : /I confirm the research/,
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: hi ? /मैं रिसर्च/ : /I confirm the research/,
      }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Also send to investors on Telegram",
      }),
    );
    failPublish = true;
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "अनुशंसा प्रकाशित करें" : "Publish recommendation",
      }),
    );
    assert.match(
      (await screen.findByRole("alert")).textContent!,
      /Publication changed/,
    );
    failPublish = false;
    fireEvent.submit(form);
    await screen.findByRole("checkbox", {
      name: hi ? /मैं रिसर्च/ : /I confirm the research/,
    });
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: hi ? /मैं रिसर्च/ : /I confirm the research/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "अनुशंसा प्रकाशित करें" : "Publish recommendation",
      }),
    );
    await waitFor(() => assert.equal(closed, 1));
    assert.ok(calls.some((c) => c.path.endsWith("/publish")));
    assert.equal(
      (
        calls.filter((c) => c.path.endsWith("/publish")).at(-1)!.body as {
          sendTelegram: boolean;
        }
      ).sendTelegram,
      true,
    );
  });
  test(`${locale}: multi-leg editing and published update controls preserve locked scope`, async () => {
    let closed = 0;
    const user = userEvent.setup();
    const props = {
      slug: "example",
      options,
      request: async (path: string) =>
        path.endsWith("/preview")
          ? {
              snapshot,
              check: { allowed: true, reasons: [], conflicts: [] },
              recipientCount: 1,
              reasons: [],
              token: "a".repeat(64),
            }
          : { version: 3 },
      onSaved: () => {},
      onClose: () => closed++,
    };
    let view = render(
      localized(locale, <ResearchEditor {...props} item={null} />),
    );
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "हेज ट्रेड" : "Hedge trade" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "हेज ट्रेड" : "Hedge trade" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "एक और लेग जोड़ें" : "Add another leg",
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove leg 2" }));
    assert.equal(screen.getAllByLabelText(hi ? "दिशा" : "Direction").length, 2);
    fireEvent.click(
      screen.getAllByRole("button", {
        name: hi ? "लक्ष्य जोड़ें" : "Add target",
      })[0],
    );
    fireEvent.click(screen.getByRole("button", { name: "Remove target 1" }));
    await user.keyboard("{Escape}");
    assert.equal(closed, 0);
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "बदलाव छोड़ें" : "Discard changes",
      }),
    );
    assert.equal(closed, 1);
    view.unmount();
    view = render(
      localized(
        locale,
        <ResearchEditor {...props} item={{ ...item, draft, version: 2 }} />,
      ),
    );
    assert.ok(
      (
        screen.getByLabelText(
          hi ? "क्लाइंट चुनें" : "Target clients",
        ) as HTMLSelectElement
      ).disabled,
    );
    fireEvent.submit(view.baseElement.querySelector("form")!);
    await screen.findByLabelText(hi ? "अपडेट का कारण" : "Reason for update");
    change(
      hi ? "अपडेट का कारण" : "Reason for update",
      "New earnings justify this updated target.",
    );
    fireEvent.click(
      screen.getByRole("checkbox", {
        name: hi ? /मैं रिसर्च/ : /I confirm the research/,
      }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "अपडेट प्रकाशित करें" : "Publish update",
      }),
    );
    await waitFor(() => assert.equal(closed, 2));
  });
  test(`${locale}: reports show derivative facts, attachments and retained update reasons`, () => {
    const view = render(
      localized(
        locale,
        <ResearchReport
          report={{
            ...snapshot,
            reason: "Updated after results",
            legs: [{ ...snapshot.legs[0], note: "Risk note" }],
            instruments: [
              {
                ...snapshot.instruments[0],
                type: "CE",
                expiry: "2026-12-31",
                strike: 100,
              },
            ],
            attachments: [file],
          }}
          attachmentBase="/files"
        />,
      ),
    );
    assert.equal(
      screen.getByRole("link", { name: "Evidence.pdf" }).getAttribute("href"),
      "/files/file",
    );
    assert.ok(screen.getByText("Risk note"));
    view.unmount();
    render(
      localized(
        locale,
        <ResearchReport
          report={{ ...snapshot, instruments: [], attachments: [file] }}
        />,
      ),
    );
    assert.equal(screen.queryByRole("link"), null);
    assert.ok(screen.getByText(/NSE_EQ\|1/));
  });
}
for (const locale of ["en", "hi"] as const) {
  const hi = locale === "hi";
  test(`${locale}: owner manages groups, drafts, updates and closure with retryable failures`, async () => {
    const published = { ...item, draft, recipientCount: 1, version: 3 };
    const privateDraft = {
      ...item,
      id: "private",
      latest: null,
      status: "draft",
      draft,
    };
    let rows = [published, privateDraft],
      failure = "",
      closed = false;
    const writes: { path: string; body: Record<string, unknown> }[] = [];
    globalThis.fetch = async (url, init) => {
      const path = String(url);
      let value: unknown;
      if (failure && path.endsWith(failure))
        return new Response(
          JSON.stringify({ error: "research_version_conflict" }),
          { status: 409 },
        );
      if (init?.method === "POST") {
        writes.push({ path, body: JSON.parse(String(init.body)) });
        if (path.endsWith("/close")) closed = true;
        value = { version: 4 };
      } else if (path.endsWith("/options")) value = options;
      else if (path.endsWith("/report"))
        value = {
          ...published,
          status: closed ? "closed" : "active",
          history: [snapshot],
        };
      else value = { items: rows, hasMore: true };
      return new Response(JSON.stringify(value));
    };
    const view = render(
      localized(locale, <Recommendations slug="example" owner />),
    );
    await screen.findByText(
      hi
        ? "निजी ड्राफ्ट — अभी भेजा नहीं गया"
        : "Private draft — not yet delivered",
    );
    await screen.findByRole("button", {
      name: hi ? "ड्राफ्ट खोलें" : "Edit draft",
    });
    fireEvent.click(screen.getByRole("button", { name: hi ? "अगला" : "Next" }));
    await waitFor(() => assert.ok(screen.getByText(hi ? "पृष्ठ 2" : "Page 2")));
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "पिछला" : "Previous" }),
    );
    await waitFor(() => assert.ok(screen.getByText(hi ? "पृष्ठ 1" : "Page 1")));
    failure = "/options";
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "अनुशंसा बनाएँ" : "Create recommendation",
      }),
    );
    await screen.findByRole("alert");
    failure = "";
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "फिर प्रयास करें" : "Retry" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "क्लाइंट समूह" : "Client groups",
      }),
    );
    await screen.findByLabelText(hi ? "समूह का नाम" : "Group name");
    change(hi ? "समूह" : "Group", "group");
    assert.equal(
      (
        screen.getByLabelText(
          hi ? "समूह का नाम" : "Group name",
        ) as HTMLInputElement
      ).value,
      "Swing",
    );
    fireEvent.click(screen.getByLabelText("Example Client"));
    fireEvent.click(screen.getByLabelText("Other Client"));
    change(hi ? "समूह का नाम" : "Group name", "Updated swing group");
    const groupForm = screen
      .getByRole("button", { name: hi ? "समूह सुरक्षित करें" : "Save group" })
      .closest("form")!;
    failure = "/groups";
    fireEvent.submit(groupForm);
    await screen.findByRole("alert");
    failure = "";
    fireEvent.submit(groupForm);
    await waitFor(() =>
      assert.equal(
        (
          screen.getByLabelText(
            hi ? "समूह का नाम" : "Group name",
          ) as HTMLInputElement
        ).value,
        "",
      ),
    );
    change(hi ? "समूह" : "Group", "group");
    change(hi ? "समूह" : "Group", "");
    change(hi ? "समूह का नाम" : "Group name", "New group");
    fireEvent.click(screen.getByLabelText("Example Client"));
    fireEvent.submit(groupForm);
    await waitFor(() =>
      assert.equal(writes.filter((w) => w.path.endsWith("/groups")).length, 2),
    );
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "बंद करें" : "Close groups" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "ड्राफ्ट खोलें" : "Edit draft" }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", { name: hi ? "रद्द करें" : "Cancel" }),
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "अपडेट तैयार करें" : "Prepare update",
      }),
    );
    await screen.findByRole("dialog");
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "बंद करें" : "Close editor",
      }),
    );
    failure = "/report";
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "रिसर्च देखें" : "View research",
      }),
    );
    await screen.findByRole("alert");
    failure = "";
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "रिसर्च देखें" : "View research",
      }),
    );
    await screen.findByLabelText(hi ? "स्थिति" : "Status");
    change(hi ? "स्थिति" : "Status", "withdrawn");
    change(
      hi ? "कारण (इतिहास में रहेगा)" : "Reason (retained in history)",
      "Withdrawn after review of new information",
    );
    const closureForm = screen
      .getByRole("button", {
        name: hi ? "स्थिति की पुष्टि करें" : "Confirm status update",
      })
      .closest("form")!;
    failure = "/close";
    fireEvent.submit(closureForm);
    await screen.findByRole("alert");
    failure = "";
    fireEvent.submit(closureForm);
    await waitFor(() =>
      assert.equal(!!screen.queryByLabelText(hi ? "स्थिति" : "Status"), false),
    );
    assert.equal(
      writes.find((w) => w.path.endsWith("/close"))?.body.status,
      "withdrawn",
    );
    fireEvent.click(
      screen.getByRole("button", {
        name: hi ? "रिपोर्ट बंद करें" : "Close report",
      }),
    );
    rows = [];
    view.unmount();
    render(localized(locale, <Recommendations slug="example" owner />));
    await screen.findByText(
      hi ? "अपनी पहली अनुशंसा तैयार करें" : "Prepare your first recommendation",
    );
  });
  test(`${locale}: compact investor dashboard links to history and handles empty or unavailable feeds`, async () => {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          items: [item, item, item, item].map((v, n) => ({
            ...v,
            id: String(n),
          })),
          hasMore: true,
        }),
      );
    let v = render(
      localized(locale, <Recommendations slug="example" compact />),
    );
    await screen.findAllByRole("button", {
      name: hi ? "रिसर्च देखें" : "View research",
    });
    assert.equal(
      screen.getAllByRole("button", {
        name: hi ? "रिसर्च देखें" : "View research",
      }).length,
      3,
    );
    assert.ok(
      screen.getByRole("link", {
        name: hi ? "सभी अनुशंसाएँ देखें" : "View all recommendations",
      }),
    );
    v.unmount();
    globalThis.fetch = async (url) =>
      String(url).endsWith("/telegram")
        ? Response.json({ connected: false })
        : new Response("{}", { status: 503 });
    v = render(localized(locale, <Recommendations slug="example" />));
    await screen.findByRole("alert");
    v.unmount();
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ items: [], hasMore: false }));
    render(localized(locale, <Recommendations slug="example" />));
    await screen.findByText(
      hi ? "अभी कोई अनुशंसा नहीं" : "No recommendations yet",
    );
  });
}

test("both hedge entry points create two legs and dirty drafts require a disposition", async () => {
  let closed = 0;
  const writes: unknown[] = [];
  render(
    <ResearchEditor
      slug="example"
      item={{ ...item, latest: null, status: "draft", draft }}
      options={options}
      request={async (_path, body) => {
        writes.push(body);
        return { version: 3 };
      }}
      onSaved={() => {}}
      onClose={() => closed++}
    />,
  );
  change("Research offering", "hedges");
  assert.equal(screen.getAllByLabelText("Direction").length, 2);
  assert.ok(screen.getByText(snapshot.legs[0].instrumentKey));
  fireEvent.click(screen.getByRole("button", { name: "Close editor" }));
  assert.ok(screen.getByRole("alertdialog", { name: "Unsaved changes" }));
  fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));
  assert.equal(closed, 0);
  change("Research offering", "equity");
  assert.equal(screen.getAllByLabelText("Direction").length, 1);
  fireEvent.click(screen.getByRole("button", { name: "Hedge trade" }));
  assert.equal(screen.getAllByLabelText("Direction").length, 2);
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Discard changes" }));
  assert.equal(closed, 1);
  assert.equal(writes.length, 0);
});

test("save and close preserves edits and failed saves keep the editor open", async () => {
  let closed = 0,
    fail = true;
  render(
    <ResearchEditor
      slug="example"
      item={{ ...item, latest: null, status: "draft", draft }}
      options={options}
      request={async () => {
        if (fail) throw Error("Save failed");
        return { version: 3 };
      }}
      onSaved={() => {}}
      onClose={() => closed++}
    />,
  );
  change("Recommendation title", "Changed title");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Save and close" }));
  await screen.findByText("Save failed");
  assert.equal(closed, 0);
  fail = false;
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  fireEvent.click(screen.getByRole("button", { name: "Save and close" }));
  await waitFor(() => assert.equal(closed, 1));
});

test("preview is explicitly unpublished and unavailable groups are explained", async () => {
  globalThis.fetch = async () =>
    Response.json({ instrument: snapshot.instruments[0] });
  render(
    <ResearchEditor
      slug="example"
      item={{ ...item, latest: null, status: "draft", draft }}
      options={{ ...options, groups: [] }}
      request={async (path) =>
        path.endsWith("/preview")
          ? {
              snapshot,
              check: { allowed: true, reasons: [], conflicts: [] },
              reasons: [],
              recipientCount: 0,
              token: null,
              recipientSummary: {
                candidates: 2,
                historical: false,
                outsideGroup: 0,
                kyc: 0,
                subscriptionOrOffering: 2,
                outsidePlan: 0,
              },
            }
          : { version: 3 }
      }
      onSaved={() => {}}
      onClose={() => {}}
    />,
  );
  assert.ok(screen.getByRole("dialog", { name: "Edit draft" }));
  assert.ok(
    (
      screen.getByRole("option", {
        name: "Specific client groups",
      }) as HTMLOptionElement
    ).disabled,
  );
  assert.ok(screen.getByText(/No client groups exist yet/));
  assert.equal(screen.queryByText(/Option prices are premiums/), null);
  fireEvent.click(
    screen.getByRole("button", { name: "Preview & check recipients" }),
  );
  await screen.findByText("Unpublished preview");
  assert.ok(screen.getByText(/Preview generated:/));
  assert.ok(screen.getByText(/Proposed version/));
  assert.equal(screen.queryByText("active", { exact: true }), null);
  assert.ok(screen.getByText("How recipients were selected"));
});
