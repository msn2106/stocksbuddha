import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function noOverflow(page: Page) {
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth > innerWidth + 1
      ? Array.from(document.querySelectorAll("body *"))
          .filter(
            (element) => element.getBoundingClientRect().right > innerWidth + 1,
          )
          .map((element) => ({
            tag: element.tagName,
            cls: element.getAttribute("class"),
            text: element.textContent?.trim().slice(0, 50),
          }))
          .slice(-15)
      : [],
  );
  expect(overflow).toEqual([]);
}
async function scan(page: Page) {
  const result = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa", "best-practice"])
    .analyze();
  expect(
    result.violations.map(({ id, nodes }) => ({
      id,
      targets: nodes.map((node) => ({
        target: node.target,
        summary: node.failureSummary,
      })),
    })),
  ).toEqual([]);
}

test("Hindi is server rendered, translated across sections and dialogs, and retained by navigation", async ({
  page,
  request,
}) => {
  const response = await request.get("/ra/stocks-buddha?lang=hi");
  const html = await response.text();
  expect(html).toContain('<html lang="hi">');
  expect(html).toContain("बाज़ार के शोर में स्पष्ट सोच।");
  expect(html).toContain("Stocks Buddha | स्वतंत्र अनुसंधान");
  expect(html).not.toContain("<!--app-lang-->");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/ra/stocks-buddha");
  await page.getByRole("link", { name: "हिन्दी", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "बाज़ार के शोर में स्पष्ट सोच।",
  );
  await expect(page.locator(".hero-description")).toContainText(
    "स्वतंत्र अनुसंधान",
  );
  await expect(page.locator(".research-card h3").first()).toHaveText(
    "इक्विटी अनुसंधान",
  );
  await expect(page.locator(".about-copy .large-body")).toContainText(
    "Stocks Buddha का आधार",
  );
  await expect(page.locator(".risk-disclosure")).toContainText(
    "निवेश करने से पहले सभी संबंधित दस्तावेज़ ध्यान से पढ़ें",
  );
  await page
    .getByText("क्या निवेश पर रिटर्न की गारंटी है?", { exact: true })
    .click();
  await expect(page.locator("details[open]")).toContainText(
    "पूँजी का नुकसान हो सकता है",
  );
  await page.getByRole("button", { name: "सदस्यता की उपलब्धता देखें" }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "सदस्यता शुरू होने से पहले",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "सदस्यता लें", exact: true }).click();
  await expect(page).toHaveURL(/lang=hi#plans$/);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await page.goto("/ra/alpha");
  await expect(page.locator("html")).toHaveAttribute("lang", "hi");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "भारतीय इक्विटी पर एक धैर्यपूर्ण नज़रिया।",
  );
  await page.getByRole("link", { name: "English", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A patient perspective on Indian equities.",
  );
  expect(errors).toEqual([]);
});

test("keyboard skip link, focus indication, preference dialog trap, Escape and mobile menu", async ({
  page,
}) => {
  await page.goto("/ra/stocks-buddha");
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "Skip to content" });
  await expect(skip).toBeFocused();
  await expect(skip).toBeInViewport();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.goto("/ra/stocks-buddha");
  for (let index = 0; index < 4; index++) await page.keyboard.press("Tab");
  const trigger = page.getByRole("button", {
    name: "Display preferences",
    exact: true,
  });
  await expect(trigger).toBeFocused();
  expect(
    await trigger.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  // Tab and reverse-Tab repeatedly remain inside the modal.
  for (const key of ["Tab", "Shift+Tab"])
    for (let index = 0; index < 14; index++) {
      await page.keyboard.press(key);
      expect(
        await dialog.evaluate((element) =>
          element.contains(document.activeElement),
        ),
      ).toBe(true);
    }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await page.setViewportSize({ width: 390, height: 844 });
  const menu = page.getByRole("button", { name: "Open navigation" });
  await menu.focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).toBeVisible();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("navigation", { name: "Mobile navigation" }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open navigation" }),
  ).toBeFocused();
});

test("display settings enlarge text, persist, reduce motion, offer help, and reset", async ({
  page,
}) => {
  await page.goto("/ra/stocks-buddha");
  const textSize = () =>
    page
      .locator(".hero-description")
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  expect(await textSize()).toBe(18);
  expect(
    await page
      .locator(".risk-disclosure p")
      .first()
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  await page
    .getByRole("button", { name: "Display preferences", exact: true })
    .click();
  await page
    .getByRole("radio", { name: "Double size (200%)", exact: true })
    .check();
  await expect.poll(textSize).toBe(36);
  await page
    .getByRole("checkbox", { name: "High contrast", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Reduce motion", exact: true })
    .check();
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
  await expect(page.locator("html")).toHaveAttribute(
    "data-reduced-motion",
    "true",
  );
  expect(
    await page
      .locator(".dialog-content")
      .evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgb(0, 0, 0)");
  await page.getByText("Accessibility help", { exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Tab and Shift+Tab");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  expect(
    await page
      .locator("html")
      .evaluate((element) => getComputedStyle(element).scrollBehavior),
  ).toBe("auto");
  await page.reload();
  await expect.poll(textSize).toBe(36);
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "high");
  await page
    .getByRole("button", { name: "Display preferences", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Reset preferences", exact: true })
    .click();
  await expect.poll(textSize).toBe(18);
  await expect(page.locator("html")).toHaveAttribute(
    "data-contrast",
    "standard",
  );
  await expect(
    page.getByRole("checkbox", { name: "Reduce motion", exact: true }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator("html")
      .evaluate((element) => getComputedStyle(element).scrollBehavior),
  ).toBe("auto");
});

for (const language of ["en", "hi"])
  test(`${language}: accessibility scan, mobile/tablet reflow, 200% text and spacing overrides`, async ({
    page,
  }) => {
    await page.goto(`/ra/stocks-buddha?lang=${language}`);
    await scan(page);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: `test-results/${language}-desktop.png`,
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `test-results/${language}-mobile.png`,
      fullPage: true,
    });
    await page.screenshot({
      path: `test-results/${language}-mobile-viewport.png`,
    });
    for (const width of [1440, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      await noOverflow(page);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("button", {
        name:
          language === "en" ? "Display preferences" : "प्रदर्शन प्राथमिकताएँ",
        exact: true,
      })
      .click();
    await scan(page);
    await page
      .getByRole("radio", {
        name: language === "en" ? "Double size (200%)" : "दोगुना आकार (200%)",
        exact: true,
      })
      .check();
    await page
      .getByRole("checkbox", {
        name: language === "en" ? "High contrast" : "उच्च कंट्रास्ट",
        exact: true,
      })
      .check();
    await scan(page);
    expect(
      await page
        .getByRole("dialog")
        .evaluate((element) => element.scrollWidth <= element.clientWidth + 1),
    ).toBe(true);
    await page.keyboard.press("Escape");
    for (const width of [768, 390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      await noOverflow(page);
      // Text and interactive controls must not be clipped by their own boxes.
      const clipped = await page
        .locator("button,p,summary,h1,h2,h3")
        .evaluateAll((elements) =>
          elements
            .filter(
              (element) =>
                element.getClientRects().length &&
                (element.scrollWidth > element.clientWidth + 2 ||
                  element.scrollHeight > element.clientHeight + 2),
            )
            .map((element) => element.textContent?.trim().slice(0, 70)),
        );
      expect(clipped).toEqual([]);
    }
    await scan(page);
    await page.addStyleTag({
      content:
        "p,li,button,a,summary { line-height: 1.5 !important; letter-spacing: .12em !important; word-spacing: .16em !important; } p { margin-bottom: 2em !important; }",
    });
    await noOverflow(page);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: `test-results/${language}-200-percent-contrast.png`,
      fullPage: true,
    });
  });

test("language and display controls work when browser storage is unavailable", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Storage.prototype.getItem = () => {
      throw new Error("Storage unavailable");
    };
    Storage.prototype.setItem = () => {
      throw new Error("Storage unavailable");
    };
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/ra/stocks-buddha?lang=hi");
  await page
    .getByRole("button", { name: "प्रदर्शन प्राथमिकताएँ", exact: true })
    .click();
  await page.getByRole("radio", { name: "बड़ा (125%)", exact: true }).check();
  await expect(page.locator("html")).toHaveCSS("font-size", "20px");
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});

test("language links work without JavaScript and error pages keep their language", async ({
  browser,
  request,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:3100/ra/stocks-buddha?lang=hi");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "बाज़ार के शोर में स्पष्ट सोच।",
    );
    await page.getByRole("link", { name: "English", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Clarity in a market full of noise.",
    );
    await page.goto("http://127.0.0.1:3100/ra/missing?lang=hi");
    await expect(page.locator("html")).toHaveAttribute("lang", "hi");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "इस पते पर अनुसंधान",
    );
    const invalid = await request.get("/ra/stocks-buddha?lang=invalid");
    expect(await invalid.text()).toContain('<html lang="en">');
  } finally {
    await context.close();
  }
});
