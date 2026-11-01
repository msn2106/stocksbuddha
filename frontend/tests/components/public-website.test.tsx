import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  render,
  screen,
  cleanup,
  within,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../../src/App";
import { SectionRenderer } from "../../src/websites/SectionRenderer";
import { makePage } from "../../../packages/contracts/tests/fixtures";
import { resetDom } from "../dom";

afterEach(() => {
  cleanup();
  resetDom();
});

test("configured section order, tenant links and compass interactions reflect the supplied page", async () => {
  const user = userEvent.setup();
  const page = makePage();
  render(<App data={page} />);
  assert.equal(
    screen.getByRole("heading", { level: 1 }).textContent,
    page.website!.content["site.hero"],
  );
  assert.ok(
    screen
      .getAllByRole("link")
      .some((link) => link.getAttribute("href") === "/ra/example?lang=en"),
  );
  const compass = screen.getByRole("group", {
    name: page.website!.content["compass.accessibleLabel"],
  });
  const options = within(compass).getAllByRole("button");
  assert.equal(options[0].getAttribute("aria-pressed"), "true");
  await user.click(options[1]);
  assert.equal(options[0].getAttribute("aria-pressed"), "false");
  assert.equal(options[1].getAttribute("aria-pressed"), "true");
});

test("mobile navigation closes on selection and Escape restores focus to its toggle", async () => {
  const user = userEvent.setup();
  render(<App data={makePage()} />);
  await user.click(screen.getByRole("button", { name: "Open navigation" }));
  const nav = screen.getByRole("navigation", { name: "Mobile navigation" });
  // Exercise menu state here; actual link navigation belongs to browser tests.
  nav.addEventListener("click", (event) => event.preventDefault(), {
    once: true,
  });
  await user.click(within(nav).getByRole("link", { name: "Research" }));
  assert.equal(
    screen.queryByRole("navigation", { name: "Mobile navigation" }),
    null,
  );
  await user.click(screen.getByRole("button", { name: "Open navigation" }));
  fireEvent.keyDown(
    screen.getByRole("navigation", { name: "Mobile navigation" }),
    { key: "Escape" },
  );
  assert.equal(
    screen.queryByRole("navigation", { name: "Mobile navigation" }),
    null,
  );
  assert.equal(
    document.activeElement,
    screen.getByRole("button", { name: "Open navigation" }),
  );
});

test("login links retain tenant context and policy dialogs display scoped content", async () => {
  const user = userEvent.setup();
  render(<App data={makePage()} />);
  assert.equal(
    screen.getByRole("link", { name: "Log in" }).getAttribute("href"),
    "/ra/example/login?lang=en",
  );
  for (const name of ["Terms of service", "Privacy policy", "Refund policy"]) {
    await user.click(screen.getByRole("button", { name }));
    assert.ok(
      screen.getByRole("dialog").textContent?.includes("Example Organization"),
    );
    await user.keyboard("{Escape}");
  }
});

test("unavailable pages omit tenant content and editorial layouts follow configured reading order", () => {
  const page = makePage();
  page.website!.layout.template = "editorial";
  page.website!.layout.sections = [
    "hero",
    "about",
    "research",
    "approach",
    "expectations",
    "plans",
    "investor",
  ];
  const view = render(<App data={page} />);
  assert.deepEqual(
    [...view.container.querySelectorAll("main section[id]")].map(
      (section) => section.id,
    ),
    page.website!.layout.sections.filter((id) => id !== "principles"),
  );
  assert.equal(
    screen.queryByRole("group", {
      name: page.website!.content["compass.accessibleLabel"],
    }),
    null,
  );
  view.rerender(
    <App
      data={{ tenant: null, website: null, locale: "en", page: "not-found" }}
    />,
  );
  assert.equal(screen.queryByText(page.website!.content["site.hero"]), null);
  assert.ok(screen.getByRole("link", { name: "Visit Stocks Buddha" }));
});

test("section renderer selects only approved supplied nodes in the specified order", () => {
  const sections = Object.fromEntries(
    ["hero", "research", "about"].map((id) => [id, <span key={id}>{id}</span>]),
  ) as Parameters<typeof SectionRenderer>[0]["sections"];
  const { container } = render(
    <SectionRenderer sections={sections} order={["about", "hero"]} />,
  );
  assert.equal(container.textContent, "abouthero");
});

test("sample, subscription and investor dialogs display their distinct content and close controls work", async () => {
  const user = userEvent.setup();
  const page = makePage();
  page.tenant!.synthetic = false;
  page.tenant!.profile.registration = "EXAMPLE-REGISTRATION";
  render(<App data={page} />);
  for (const [name, expected] of [
    [
      page.website!.content["research.reportStructure"],
      "A look inside the research.",
    ],
    [
      page.website!.content["plans.availability"],
      "Research plans are in preparation.",
    ],
    ["Investor Charter", "Investor Charter"],
    ["Investor complaints", "Investor complaints"],
    ["Grievance redressal", "Grievance redressal"],
  ]) {
    await user.click(
      screen.getByRole("button", {
        name: (accessibleName) => accessibleName.startsWith(name),
      }),
    );
    assert.ok(
      within(screen.getByRole("dialog")).getByRole("heading", {
        name: expected,
      }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: "Close dialog",
      }),
    );
    await waitFor(() => assert.equal(screen.queryByRole("dialog"), null));
  }
  await user.click(screen.getByRole("button", { name: "Open navigation" }));
  const nav = screen.getByRole("navigation", { name: "Mobile navigation" });
  fireEvent.keyDown(nav, { key: "Tab" });
  assert.ok(screen.getByRole("navigation", { name: "Mobile navigation" }));
  await user.click(within(nav).getByRole("link", { name: "Member log in" }));
  assert.equal(
    screen.queryByRole("navigation", { name: "Mobile navigation" }),
    null,
  );
});

test("published navigation, images, footer and section presentation use the supplied revision", () => {
  const page = makePage();
  page.website!.layout.navigation = [
    { section: "about", label: { en: "Meet the analyst", hi: "विश्लेषक" } },
  ];
  page.website!.layout.images = {
    about: {
      src: "https://example.test/analyst.jpg",
      alt: { en: "Research analyst", hi: "विश्लेषक" },
    },
  };
  page.website!.layout.sectionStyles = { about: "stacked" };
  page.website!.layout.footer = "compact";
  page.website!.content["footer.explore"] = "Explore our work";
  const view = render(<App data={page} />);
  assert.equal(
    screen.getByRole("link", { name: "Meet the analyst" }).getAttribute("href"),
    "/ra/example?lang=en#about",
  );
  assert.equal(
    screen.getByRole("img", { name: "Research analyst" }).getAttribute("src"),
    "https://example.test/analyst.jpg",
  );
  assert.ok(view.container.querySelector("#about.section-layout-stacked"));
  assert.ok(view.container.querySelector('footer[data-footer="compact"]'));
  assert.ok(screen.getByRole("heading", { name: "Explore our work" }));
});

test("private preview renders optional contact links and configured media without exposing editor controls", async () => {
  const page = makePage();
  page.preview = true;
  page.tenant!.synthetic = false;
  page.website!.contact = {
    email: "research@example.test",
    phone: "+919999999999",
  };
  page.website!.layout.navigation = [
    { section: "hero", label: { en: "Introduction", hi: "परिचय" } },
  ];
  page.website!.layout.images = {
    hero: {
      src: "https://example.test/hero.jpg",
      alt: { en: "Research overview", hi: "शोध" },
    },
    research: {
      src: "https://example.test/chart.jpg",
      alt: { en: "Research process", hi: "शोध" },
    },
  };
  const view = render(<App data={page} />);
  assert.ok(screen.getByText(/Private draft preview/));
  assert.equal(
    screen.getByRole("link", { name: "Introduction" }).getAttribute("href"),
    "/ra/example/workspace/website/preview?lang=en#hero",
  );
  assert.equal(
    screen
      .getByRole("link", { name: "research@example.test" })
      .getAttribute("href"),
    "mailto:research@example.test",
  );
  assert.ok(screen.getByRole("link", { name: "+919999999999" }));
  assert.ok(screen.getByRole("img", { name: "Research overview" }));
  assert.ok(screen.getByRole("img", { name: "Research process" }));
  fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
  assert.equal(
    within(screen.getByRole("navigation", { name: "Mobile navigation" }))
      .getByRole("link", { name: "Introduction" })
      .getAttribute("href"),
    "/ra/example/workspace/website/preview?lang=en#hero",
  );
  assert.equal(screen.queryByRole("button", { name: "Save draft" }), null);
  view.rerender(
    <App
      data={{
        ...page,
        website: { ...page.website!, contact: { phone: "+919999999999" } },
      }}
    />,
  );
  assert.equal(
    screen.queryByRole("link", { name: "research@example.test" }),
    null,
  );
});
