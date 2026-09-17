import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startService } from "../src/server/service.js";
import { editorUrl, requestService } from "../src/server/runtime.js";
import type { DesignSystem, Document, Element } from "../src/domain/model.js";

let service: Awaited<ReturnType<typeof startService>>, workspace: string;
test.beforeAll(async () => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "studio-systems-browser-"));
  service = await startService(workspace);
});
test.afterAll(async () => {
  await service?.close();
  fs.rmSync(workspace, { recursive: true, force: true });
});
const api = <T = any>(route: string, body?: unknown) =>
  requestService<T>(service.descriptor, route, body);
const current = (id: string) => api<Document>(`/api/documents/${id}`);
const mark = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="110" viewBox="0 0 320 110"><rect width="320" height="110" fill="#e8ecdf"/><circle cx="160" cy="55" r="35" fill="#274f42"/><circle cx="160" cy="55" r="17" fill="#e8ecdf"/><rect x="206" y="20" width="36" height="70" rx="3" fill="#cb6b43"/><path d="M78 20h36v70H78z" fill="#bccf94"/></svg>',
);
const capture = async (page: Page, name: string) => {
  fs.mkdirSync("artifacts/byo-ui", { recursive: true });
  await page.screenshot({
    path: `artifacts/byo-ui/${name}.png`,
    fullPage: true,
  });
};
const fontPath = path.resolve("assets/fonts/inter-latin-400-normal.woff2");
function system(id: string, name: string): DesignSystem {
  const card: Element = {
    id: "card-root",
    name: "System card",
    type: "group",
    x: 0,
    y: 0,
    width: 360,
    height: 210,
    layout: "position",
    style: { padding: 16, background: "#fffef9" },
    tokenBindings: { background: "color.paper" },
    children: [
      {
        id: "card-title",
        type: "text",
        name: "Card headline",
        x: 18,
        y: 16,
        width: 320,
        height: 50,
        text: "A thoughtful headline",
        style: { fontSize: 28, fontFamily: "Lora", color: "#123456" },
        tokenBindings: { color: "color.primary", fontFamily: "font.heading" },
      },
      {
        id: "card-image",
        type: "image",
        name: "Card image",
        x: 18,
        y: 80,
        width: 320,
        height: 110,
        style: {},
        fit: "cover",
      },
    ],
  };
  return {
    id,
    name,
    version: "1.0.0",
    tokens: {
      "color.primary": { type: "color", value: "#274f42" },
      "color.accent": { type: "color", value: "#cb6b43" },
      "color.paper": { type: "color", value: "#fffef9" },
      "font.heading": { type: "fontFamily", value: "Lora" },
      "font.body": { type: "fontFamily", value: "Inter" },
      "size.body": { type: "dimension", value: 16 },
    },
    fonts: [],
    assets: {},
    guidelines: ["Lead with useful, clear headlines.", "Use generous margins."],
    sources: [{ name: "Browser regression fixture" }],
    roles: {
      primaryColor: "color.primary",
      accentColor: "color.accent",
      pageBackground: "color.paper",
      headingFont: "font.heading",
      bodyFont: "font.body",
    },
    rules: { requireTokenBindings: true, minimumFontSize: 14 },
    components: [
      {
        id: "card",
        name: "Editorial card",
        description: "An editable headline and image.",
        element: card,
        variants: { compact: { ...structuredClone(card), height: 190 } },
        slots: {
          headline: { type: "text", elementId: "card-title" },
          hero: { type: "image", elementId: "card-image" },
        },
      },
    ],
  };
}
async function openLegacy(page: Page, name: string) {
  const doc = await api<Document>("/api/documents", {
    name,
    template: "service-sheet",
    designSystem: null,
  });
  await page.goto(editorUrl(service.descriptor, doc.id));
  await expect(page.getByTestId("canvas")).toBeVisible();
  await expect(page.getByText("Saved locally")).toBeVisible();
  return doc;
}
async function importSystem(page: Page, value: DesignSystem) {
  await page
    .getByRole("button", { name: "Design Systems", exact: true })
    .click();
  await page
    .getByLabel("Import design system files", { exact: true })
    .setInputFiles({
      name: `${value.id}.json`,
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
  await expect(
    page.getByRole("textbox", { name: "System name", exact: true }),
  ).toHaveValue(value.name);
}
const allElements = (elements: Element[]): Element[] =>
  elements.flatMap((element) => [
    element,
    ...allElements(element.children ?? []),
  ]);

function sourceZip(files: Record<string, string>) {
  const local: Buffer[] = [],
    directory: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const filename = Buffer.from(name),
      data = Buffer.from(text);
    let crc = 0xffffffff;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const header = Buffer.alloc(30),
      entry = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    entry.writeUInt32LE(0x02014b50);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0x800, 8);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(filename.length, 28);
    entry.writeUInt32LE(offset, 42);
    local.push(header, filename, data);
    directory.push(entry, filename);
    offset += header.length + filename.length + data.length;
  }
  const body = Buffer.concat(local),
    index = Buffer.concat(directory),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(body.length, 16);
  return Buffer.concat([body, index, end]);
}

test("design system lifecycle imports, reviews custom files, saves a default, creates editable component variants and exports a portable system", async ({
  page,
}) => {
  await openLegacy(page, "System lifecycle starting point");
  const value = system("browser-editorial", "Editorial Workshop");
  await importSystem(page, value);
  await page.getByRole("tab", { name: "Assets", exact: true }).click();
  const family = page.getByRole("textbox", {
    name: "Font family name",
    exact: true,
  });
  await family.fill("Workshop Sans");
  await family.press("Enter");
  const license = page.getByRole("textbox", {
    name: "Font license reference",
    exact: true,
  });
  await license.fill("SIL Open Font License 1.1");
  await license.press("Enter");
  await page.getByLabel("Upload system assets", { exact: true }).setInputFiles([
    {
      name: "workshop.woff2",
      mimeType: "font/woff2",
      buffer: fs.readFileSync(fontPath),
    },
    { name: "workshop-mark.svg", mimeType: "image/svg+xml", buffer: mark },
  ]);
  await expect(
    page.getByText("Files added to the draft.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /^Tokens/ }).click();
  const bodyFont = page.getByRole("textbox", {
    name: "Value for font.body",
    exact: true,
  });
  await bodyFont.fill("Workshop Sans");
  await bodyFont.press("Enter");
  await page
    .getByRole("button", { name: "Review & preview", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Save immutable version", exact: true }),
  ).toBeEnabled();
  await capture(page, "library-review-specimen");
  await page
    .getByRole("button", { name: "Save immutable version", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Use as workspace default", exact: true })
    .click();
  await expect
    .poll(async () => (await api("/api/design-systems")).defaultSystem?.id)
    .toBe(value.id);
  await page
    .getByRole("button", { name: "Export system", exact: true })
    .click();
  const download = page.getByRole("link", {
    name: /Download .*\.vds-system\.json/,
  });
  await expect(download).toBeVisible();
  const exported = await page.request.get(
    new URL((await download.getAttribute("href"))!, page.url()).toString(),
  );
  expect(exported.ok()).toBe(true);
  const exportedBytes = await exported.body();
  const portable = JSON.parse(exportedBytes.toString());
  expect(portable.format).toBe("mcp-visual-design-system");
  await page
    .getByLabel("Import design system files", { exact: true })
    .setInputFiles({
      name: "roundtrip.vds-system.json",
      mimeType: "application/json",
      buffer: exportedBytes,
    });
  await page.getByRole("tab", { name: "Assets", exact: true }).click();
  await expect(page.getByText("Workshop Sans", { exact: true })).toBeVisible();
  await page
    .getByRole("button", { name: "Save immutable version", exact: true })
    .click();
  expect(
    (await api("/api/design-systems")).systems.filter(
      (summary: any) => summary.id === value.id,
    ),
  ).toHaveLength(1);
  await page
    .getByRole("button", { name: "Close Design Systems", exact: true })
    .click();
  await page.getByRole("button", { name: "New design", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New design name", exact: true })
    .fill("From the workspace default");
  await expect(
    page.getByRole("combobox", {
      name: "Design system for new design",
      exact: true,
    }),
  ).toHaveValue("workspace");
  await page
    .getByRole("button", {
      name: "Blank canvas A clean A4 page, ready for your ideas.",
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Create design", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const documentId = await page.getByTestId("document-select").inputValue();
  expect((await current(documentId)).designSystem?.id).toBe(value.id);
  await page.getByRole("button", { name: "Brand", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Design system component", exact: true })
    .selectOption("card");
  await page
    .getByRole("combobox", { name: "Component variant", exact: true })
    .selectOption("compact");
  await page
    .getByRole("textbox", { name: "Text slot headline", exact: true })
    .fill("A headline supplied in the browser");
  const savedBefore = await current(documentId),
    imageAsset = Object.values(savedBefore.assets).find(
      (asset) => asset.name === "workshop-mark.svg",
    )!;
  await page
    .getByRole("combobox", { name: "Image slot hero", exact: true })
    .selectOption(imageAsset.id);
  await page
    .getByRole("button", { name: "Insert component", exact: true })
    .click();
  await expect
    .poll(async () => (await current(documentId)).pages[0].elements.length)
    .toBe(1);
  let instance = (await current(documentId)).pages[0].elements[0];
  expect(instance.componentSource).toMatchObject({
    systemId: value.id,
    systemVersion: "1.0.0",
    componentId: "card",
    variant: "compact",
  });
  expect(instance.height).toBe(190);
  expect(
    instance.children!.find((element) => element.type === "image")!.assetId,
  ).toBe(imageAsset.id);
  await page.locator(".layer").filter({ hasText: "Card headline" }).click();
  await expect(page.getByTestId("text-editor")).toHaveValue(
    "A headline supplied in the browser",
  );
  await page
    .getByRole("combobox", { name: "fontFamily token", exact: true })
    .selectOption("font.body");
  await expect(
    page.getByRole("combobox", { name: "Font family", exact: true }),
  ).toHaveValue("Workshop Sans");
  const headingId = instance.children!.find(
    (element) => element.type === "text",
  )!.id;
  await expect(
    page.getByTestId("canvas").locator(`[data-element-id="${headingId}"]`),
  ).toHaveAttribute("data-font-family", "Workshop Sans");
  await page.getByTestId("text-editor").fill("Still directly editable");
  await page.getByTestId("save-text").click();
  await expect
    .poll(
      async () =>
        allElements((await current(documentId)).pages[0].elements).find(
          (element) => element.name === "Card headline",
        )!.text,
    )
    .toBe("Still directly editable");
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  await expect(
    page.getByRole("combobox", { name: "Font family", exact: true }),
  ).toHaveValue("Workshop Sans");
  await expect
    .poll(
      async () =>
        (await current(documentId)).pages[0].elements.find(
          (element) => element.name === "Text block",
        )?.tokenBindings?.fontFamily,
    )
    .toBe("font.body");
  await page.getByRole("spinbutton", { name: "Y", exact: true }).fill("330");
  await page.getByRole("spinbutton", { name: "Y", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Brand", exact: true }).click();
  await page
    .getByRole("combobox", { name: "System image asset", exact: true })
    .selectOption(imageAsset.id);
  await page
    .getByRole("button", { name: "Insert system image", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await current(documentId)).pages[0].elements.find(
          (element) => element.type === "image",
        )?.assetId,
    )
    .toBe(imageAsset.id);
  await page.getByRole("spinbutton", { name: "X", exact: true }).fill("475");
  await page.getByRole("spinbutton", { name: "X", exact: true }).press("Enter");
  await page.getByRole("button", { name: "Brand", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Design system component", exact: true })
    .selectOption("card");
  await capture(page, "document-controls");
  await page
    .getByRole("button", { name: "Run system checks", exact: true })
    .click();
  await expect(
    page.getByLabel("System check results", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "New design", exact: true }).click();
  await page
    .getByRole("combobox", {
      name: "Design system for new design",
      exact: true,
    })
    .selectOption("none");
  await page
    .getByRole("button", { name: "Create design", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    (await current(await page.getByTestId("document-select").inputValue()))
      .designSystem,
  ).toBeUndefined();
});

test("application preview maps explicit targets, preserves an active text draft, and token controls respect literal overrides", async ({
  page,
}) => {
  const doc = await openLegacy(page, "Explicit application");
  const target = doc.pages[0].elements.find(
    (element) => element.type === "text",
  )!;
  const other = doc.pages[0].elements.find(
    (element) => element.type === "text" && element.id !== target.id,
  )!;
  const value = system("browser-mapping", "Mapping Workshop");
  const saved = await api("/api/design-systems", { system: value });
  await page.locator(".layer").filter({ hasText: target.name }).click();
  await page
    .getByTestId("text-editor")
    .fill("Retain this unsaved draft during application");
  await page
    .getByTestId("text-editor")
    .evaluate((input: HTMLTextAreaElement) => {
      input.focus();
      input.setSelectionRange(12, 12);
    });
  await api("/api/design-systems/default", {
    system: { id: value.id, version: value.version, digest: saved.digest },
  });
  await expect(page.getByTestId("text-editor")).toBeFocused();
  expect(
    await page
      .getByTestId("text-editor")
      .evaluate((input: HTMLTextAreaElement) => input.selectionStart),
  ).toBe(12);
  await page.getByRole("button", { name: "New design", exact: true }).click();
  await expect(
    page.getByRole("combobox", {
      name: "Design system for new design",
      exact: true,
    }),
  ).toContainText(`Workspace default · ${value.name}`);
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", { name: "Design Systems", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: `Open ${value.name} version 1.0.0`,
      exact: true,
    })
    .click();
  await page
    .getByRole("button", { name: "Preview application", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Close application preview",
      exact: true,
    }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Apply this mapping", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("button", {
      name: "Close application preview",
      exact: true,
    }),
  ).toBeFocused();
  await page
    .getByRole("combobox", {
      name: `Map color for ${target.name}`,
      exact: true,
    })
    .selectOption("color.accent");
  await page
    .getByRole("combobox", {
      name: `Background token for ${doc.pages[0].name}`,
      exact: true,
    })
    .selectOption("color.paper");
  await capture(page, "explicit-application-preview");
  expect((await current(doc.id)).revision).toBe(0);
  await page
    .getByRole("button", { name: "Apply this mapping", exact: true })
    .click();
  await expect(
    page.getByRole("region", {
      name: "Preview design system application",
      exact: true,
    }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Close Design Systems", exact: true })
    .click();
  await expect(page.getByTestId("text-editor")).toHaveValue(
    "Retain this unsaved draft during application",
  );
  const mapped = await current(doc.id);
  expect(
    mapped.pages[0].elements.find((element) => element.id === target.id)!
      .tokenBindings?.color,
  ).toBe("color.accent");
  expect(
    mapped.pages[0].elements.find((element) => element.id === other.id)!.style,
  ).toEqual(other.style);
  expect(
    mapped.pages[0].elements.find((element) => element.id === other.id)!
      .tokenBindings,
  ).toBeUndefined();
  expect(mapped.pages[0].backgroundToken).toBe("color.paper");
  await page.getByLabel("Text color", { exact: true }).fill("#112233");
  await expect
    .poll(
      async () =>
        (await current(doc.id)).pages[0].elements.find(
          (element) => element.id === target.id,
        )!.style.color,
    )
    .toBe("#112233");
  expect(
    (await current(doc.id)).pages[0].elements.find(
      (element) => element.id === target.id,
    )!.tokenBindings?.color,
  ).toBeUndefined();
  await page
    .getByRole("combobox", { name: "color token", exact: true })
    .selectOption("color.primary");
  await expect
    .poll(
      async () =>
        (await current(doc.id)).pages[0].elements.find(
          (element) => element.id === target.id,
        )!.tokenBindings?.color,
    )
    .toBe("color.primary");
  await page
    .getByRole("combobox", { name: "color token", exact: true })
    .selectOption("");
  await expect
    .poll(
      async () =>
        (await current(doc.id)).pages[0].elements.find(
          (element) => element.id === target.id,
        )!.style.color,
    )
    .toBe("#274f42");
  await api("/api/design-systems", {
    system: {
      ...value,
      version: "1.0.1",
      tokens: {
        ...value.tokens,
        "color.primary": { type: "color", value: "#553311" },
      },
    },
  });
  expect((await current(doc.id)).designSystem?.version).toBe("1.0.0");
  expect(saved.digest).toBeTruthy();
});

test("DTCG missing-font review can be repaired with a subset font; CSS and source ZIP are inspected without executing code", async ({
  page,
}) => {
  await openLegacy(page, "Source review");
  await page
    .getByRole("button", { name: "Design Systems", exact: true })
    .click();
  const input = page.getByLabel("Import design system files", { exact: true });
  const dtcg = {
    color: { primary: { $type: "color", $value: "#385b74" } },
    typography: { body: { $type: "fontFamily", $value: "Source Sans" } },
  };
  await input.setInputFiles({
    name: "source-tokens.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(dtcg)),
  });
  await expect(
    page.getByText("Resolve before saving", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Save immutable version", exact: true }),
  ).toBeDisabled();
  await capture(page, "missing-font-review");
  await page.getByRole("tab", { name: "Assets", exact: true }).click();
  const family = page.getByRole("textbox", {
    name: "Font family name",
    exact: true,
  });
  await family.fill("Source Sans");
  await family.press("Enter");
  const range = page.getByRole("textbox", {
    name: "Font Unicode range (optional)",
    exact: true,
  });
  await range.fill("U+0000-00FF");
  await range.press("Enter");
  await page.getByLabel("Upload system assets", { exact: true }).setInputFiles({
    name: "source-sans.woff2",
    mimeType: "font/woff2",
    buffer: fs.readFileSync(fontPath),
  });
  await expect(
    page.getByText("Files added to the draft.", { exact: false }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Body font role", exact: true })
    .selectOption("typography.body");
  await page
    .getByRole("button", { name: "Review & preview", exact: true })
    .click();
  await expect(
    page.getByText("Resolve before saving", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Save immutable version", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Create new version", exact: true }),
  ).toBeVisible();
  const summaries = (await api("/api/design-systems")).systems;
  const summary = summaries.find(
    (entry: any) => entry.name === "source-tokens",
  );
  expect(summary).toBeTruthy();
  const saved = await api(
    `/api/design-systems/${summary.id}/${summary.version}`,
  );
  expect(saved.system.fonts[0]).toMatchObject({
    family: "Source Sans",
    unicodeRange: "U+0-FF",
  });
  const zip = sourceZip({
    "styles.css":
      ":root { --brand-primary: #6b5140; --space-card: 24px; } .card { background: #fff8ee; padding: 24px; } h1 { color: #6b5140; font-size: 32px; }",
    "index.html":
      '<section class="card"><h1>Source package heading</h1><p>This becomes editable content.</p></section>',
    "App.tsx":
      "globalThis.__sourceCodeRan = true; export default function App(){ return null; }",
    "guidelines.md": "Use plain language and generous spacing.",
  });
  const response = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/design-systems/preview") &&
      response.request().method() === "POST",
  );
  await input.setInputFiles({
    name: "source-package.zip",
    mimeType: "application/zip",
    buffer: zip,
  });
  const imported = await (await response).json();
  expect(imported.report.executableFiles).toContain("App.tsx");
  await expect(
    page.getByText(/code file\(s\) were not executed or converted/),
  ).toBeVisible();
  expect(imported.system.tokens["brand-primary"]).toMatchObject({
    type: "color",
    value: "#6b5140",
  });
  expect(imported.system.components.length).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => (window as any).__sourceCodeRan),
  ).toBeUndefined();
  await page.getByRole("tab", { name: /^Tokens/ }).click();
  await expect(
    page.getByRole("textbox", { name: "Value for brand-primary", exact: true }),
  ).toHaveValue("#6b5140");
  await page.getByRole("tab", { name: "Components", exact: true }).click();
  await expect(
    page.getByRole("textbox", {
      name: "Component definitions JSON",
      exact: true,
    }),
  ).toHaveValue(/Source package heading/);
});
