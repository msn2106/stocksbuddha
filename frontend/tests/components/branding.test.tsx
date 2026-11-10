import "../dom";
import { test, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  render,
  cleanup,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { useState } from "react";
import { BrandLogo } from "../../src/components/BrandLogo";
import { LogoSettings, normalizeLogo } from "../../src/websites/LogoSettings";
import { AgreementSamples } from "../../src/account/AgreementSamples";
import { LanguageProvider } from "../../src/i18n";
import { Brand } from "../../src/websites/PublicWebsite";
import { makePage } from "../../../packages/contracts/tests/fixtures";
import type { BrandLogos } from "@ra/contracts";
const originalBitmap = globalThis.createImageBitmap;
afterEach(() => {
  cleanup();
  globalThis.createImageBitmap = originalBitmap;
});
const logo = "data:image/png;base64,aGVsbG8=";

test("shared artwork supports both surfaces, uploaded variants, explicit removal and tenant initials", () => {
  for (const props of [
    {},
    { stocksBuddha: true },
    { logos: { logoLight: logo } },
    { logos: { logoDark: logo } },
    { logos: { logoLight: logo, logoDark: logo } },
    { stocksBuddha: true, logos: { logoLight: null, logoDark: null } },
    { logos: { logoLight: null } },
    { logos: { logoDark: null } },
  ]) {
    const view = render(<BrandLogo {...props} />);
    if (props.stocksBuddha && !props.logos)
      assert.match(view.container.innerHTML, /stocksbuddha-light.png/);
    if (props.logos?.logoLight || props.logos?.logoDark)
      assert.equal(view.container.querySelectorAll("img").length, 2);
    view.unmount();
  }
  const data = makePage("hi");
  data.tenant!.slug = "stocksbuddha";
  data.website!.branding.logoLight = logo;
  render(
    <LanguageProvider locale="hi" tenant={data.tenant} website={data.website}>
      <Brand tenant={data.tenant!} footer />
      <AgreementSamples />
    </LanguageProvider>,
  );
  assert.equal(
    document.querySelector(".brand-artwork-dark img")?.getAttribute("src"),
    logo,
  );
  assert.ok(screen.getByRole("link", { name: "मूल लेटरहेड देखें" }));
  assert.match(
    screen
      .getByRole("link", { name: "सहेजे गए अनुबंध का नमूना देखें" })
      .getAttribute("href")!,
    /stocksbuddha\/onboarding\/sample-agreement/,
  );
  cleanup();
  render(<AgreementSamples />);
  assert.ok(
    screen.getByRole("link", { name: "Preview saved agreement sample" }),
  );
});

test("logo normalization rejects unsupported files, excessive dimensions and processing failures, and closes decoded resources", async (context) => {
  let width = 1000,
    height = 500,
    closed = 0,
    available = true,
    encoded = logo;
  globalThis.createImageBitmap = async () =>
    ({
      width,
      height,
      close() {
        closed++;
      },
    }) as ImageBitmap;
  context.mock.method(window.HTMLCanvasElement.prototype, "getContext", (() =>
    available
      ? { drawImage() {} }
      : null) as unknown as HTMLCanvasElement["getContext"]);
  context.mock.method(
    window.HTMLCanvasElement.prototype,
    "toDataURL",
    () => encoded,
  );
  const file = new File(["pixels"], "logo.png", { type: "image/png" });
  assert.equal(await normalizeLogo(file), logo);
  width = 200;
  height = 100;
  assert.equal(await normalizeLogo(file), logo);
  for (const dimensions of [
    [0, 1],
    [1, 0],
    [4097, 1],
    [1, 4097],
  ]) {
    [width, height] = dimensions;
    await assert.rejects(normalizeLogo(file), /dimensions/);
  }
  width = 10;
  height = 10;
  available = false;
  await assert.rejects(normalizeLogo(file), /unavailable/);
  available = true;
  encoded = "x".repeat(131095);
  await assert.rejects(normalizeLogo(file), /detailed/);
  for (const invalid of [
    new File(["svg"], "x.svg", { type: "image/svg+xml" }),
    new File([], "x.png", { type: "image/png" }),
    new File([new Uint8Array(2097153)], "x.png", { type: "image/png" }),
  ])
    await assert.rejects(normalizeLogo(invalid), /Choose/);
  assert.equal(closed, 8);
  globalThis.createImageBitmap = async () => {
    throw new Error("Malformed raster");
  };
  await assert.rejects(normalizeLogo(file), /Malformed/);
});

test("logo upload preserves previous artwork on failure, blocks actions while processing, and supports removal and restoring originals", async (context) => {
  const changes: BrandLogos[] = [];
  const busy: boolean[] = [];
  let finish: ((value: ImageBitmap) => void) | undefined;
  globalThis.createImageBitmap = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  context.mock.method(
    window.HTMLCanvasElement.prototype,
    "getContext",
    (() => ({ drawImage() {} })) as unknown as HTMLCanvasElement["getContext"],
  );
  context.mock.method(
    window.HTMLCanvasElement.prototype,
    "toDataURL",
    () => logo,
  );
  function Editor() {
    const [logos, setLogos] = useState<BrandLogos>({});
    return (
      <LogoSettings
        logos={logos}
        stocksBuddha
        onBusy={(value) => busy.push(value)}
        onChange={(value) => {
          changes.push(value);
          setLogos(value);
        }}
      />
    );
  }
  render(<Editor />);
  const input = screen.getByLabelText("Logo for light backgrounds");
  fireEvent.change(input, { target: { files: [] } });
  assert.equal(changes.length, 0);
  fireEvent.change(input, {
    target: { files: [new File(["image"], "logo.png", { type: "image/png" })] },
  });
  assert.ok(screen.getByRole("status"));
  assert.equal(
    (
      screen.getByRole("button", {
        name: "Remove logos and use initials",
      }) as HTMLButtonElement
    ).disabled,
    true,
  );
  await act(async () =>
    finish!({ width: 100, height: 100, close() {} } as ImageBitmap),
  );
  await waitFor(() => assert.equal(changes[0].logoLight, logo));
  globalThis.createImageBitmap = async () =>
    ({ width: 50, height: 50, close() {} }) as ImageBitmap;
  fireEvent.change(
    screen.getByLabelText("Logo for dark backgrounds (optional)"),
    {
      target: {
        files: [new File(["image"], "logo.webp", { type: "image/webp" })],
      },
    },
  );
  await waitFor(() => assert.equal(changes.at(-1)?.logoDark, logo));
  fireEvent.change(input, {
    target: {
      files: [new File(["svg"], "logo.svg", { type: "image/svg+xml" })],
    },
  });
  await screen.findByRole("alert");
  assert.equal(changes.length, 2);
  fireEvent.click(
    screen.getByRole("button", { name: "Remove logos and use initials" }),
  );
  assert.deepEqual(changes.at(-1), { logoLight: null, logoDark: null });
  fireEvent.click(
    screen.getByRole("button", { name: "Restore Stocks Buddha logos" }),
  );
  assert.deepEqual(changes.at(-1), {
    logoLight: undefined,
    logoDark: undefined,
  });
  assert.deepEqual(busy, [true, false, true, false, true, false]);
  cleanup();
  render(
    <LogoSettings
      logos={{}}
      stocksBuddha={false}
      onBusy={() => {}}
      onChange={() => {}}
    />,
  );
  assert.equal(
    screen.queryByRole("button", { name: "Restore Stocks Buddha logos" }),
    null,
  );
});

test("Stocks Buddha English samples expose the original letterhead", () => {
  const data = makePage();
  data.tenant!.slug = "stocksbuddha";
  render(
    <LanguageProvider locale="en" tenant={data.tenant} website={data.website}>
      <AgreementSamples />
    </LanguageProvider>,
  );
  assert.equal(
    screen
      .getByRole("link", { name: "View original letterhead" })
      .getAttribute("href"),
    "/assets/brand/stocksbuddha-letterhead-v1.pdf",
  );
});
