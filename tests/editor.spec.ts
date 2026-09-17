import { test, expect, type Page } from "@playwright/test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startService } from "../src/server/service.js";
import { editorUrl, requestService } from "../src/server/runtime.js";
import type { Document, MutationResult } from "../src/domain/model.js";
let service: Awaited<ReturnType<typeof startService>>;
let root: string;
test.beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-browser ü "));
  service = await startService(root);
});
test.afterAll(async () => {
  await service?.close();
  fs.rmSync(root, { recursive: true, force: true });
});
async function call<T = any>(route: string, body?: unknown) {
  return requestService<T>(service.descriptor, route, body);
}
async function setup(page: Page, name: string) {
  const doc = await call<Document>("/api/documents", {
    name,
    template: "service-sheet",
  });
  await page.goto(editorUrl(service.descriptor, doc.id));
  await expect(page.getByTestId("canvas")).toBeVisible();
  await expect(page.getByText("Saved locally")).toBeVisible();
  return doc;
}
async function current(id: string) {
  return call<Document>(`/api/documents/${id}`);
}
async function agent(id: string, operations: unknown[]) {
  const doc = await current(id);
  return call<MutationResult>(`/api/documents/${id}/operations`, {
    operationId: crypto.randomUUID(),
    actor: "test-agent",
    expectedRevision: doc.revision,
    operations,
  });
}

test("live agent edits preserve text draft, caret and composition; conflicting text has explicit resolution", async ({
  page,
}) => {
  const doc = await setup(page, "Live collaboration");
  const target = doc.pages[0].elements.find((e) => e.type === "text")!;
  await page.locator(".layer").filter({ hasText: target.name }).click();
  const editor = page.getByTestId("text-editor");
  await editor.fill("My local draft");
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(3, 3);
  });
  await agent(doc.id, [
    {
      type: "update_element",
      elementId: target.id,
      patch: { style: { color: "#123456" } },
    },
  ]);
  await expect(page.getByText("Revision 1", { exact: false })).toBeVisible();
  await expect(editor).toHaveValue("My local draft");
  expect(
    await editor.evaluate((e: HTMLTextAreaElement) => e.selectionStart),
  ).toBe(3);
  await expect(editor).toBeFocused();
  await editor.dispatchEvent("compositionstart", { data: "あ" });
  await agent(doc.id, [
    { type: "set_document", patch: { name: "Changed by agent" } },
  ]);
  await expect(page.getByTestId("document-select")).toContainText(
    "Changed by agent",
  );
  await expect(editor).toHaveValue("My local draft");
  expect(
    await editor.evaluate((e: HTMLTextAreaElement) => e.selectionStart),
  ).toBe(3);
  await editor.press("Meta+Enter");
  expect(
    (await current(doc.id)).pages[0].elements.find((e) => e.id === target.id)!
      .text,
  ).toBe(target.text);
  await editor.dispatchEvent("compositionend", { data: "あ" });
  await agent(doc.id, [
    {
      type: "update_element",
      elementId: target.id,
      patch: { text: "Remote draft" },
    },
  ]);
  await expect(page.getByTestId("conflict-keep-mine")).toBeVisible();
  await expect(editor).toHaveValue("My local draft");
  await page.getByTestId("conflict-keep-mine").click();
  await expect
    .poll(
      async () =>
        (await current(doc.id)).pages[0].elements.find(
          (e) => e.id === target.id,
        )!.text,
    )
    .toBe("My local draft");
  await expect(page.getByTestId("conflict-keep-mine")).toHaveCount(0);
  await editor.fill("Another local draft");
  await agent(doc.id, [
    {
      type: "update_element",
      elementId: target.id,
      patch: { text: "The saved version" },
    },
  ]);
  await page.getByTestId("conflict-use-saved").click();
  await expect(editor).toHaveValue("The saved version");
});

test("human editing, image upload, drag and keyboard, comments, guarded agent undo, snapshot, variation and exports", async ({
  page,
}) => {
  const doc = await setup(page, "Complete editing loop");
  const target = doc.pages[0].elements.find((e) => e.type === "text")!;
  await page.locator(".layer").filter({ hasText: target.name }).click();
  await page.getByTestId("text-editor").fill(target.text + "!");
  await page.getByTestId("save-text").click();
  await expect.poll(async () => (await current(doc.id)).revision).toBe(1);
  await agent(doc.id, [
    {
      type: "update_element",
      elementId: target.id,
      patch: { style: { color: "#445566" } },
    },
  ]);
  await expect(page.getByText("Revision 2", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("button", { name: "Undo revision 2", exact: true })
    .click();
  await expect.poll(async () => (await current(doc.id)).revision).toBe(3);
  expect(
    (await current(doc.id)).pages[0].elements.find((e) => e.id === target.id)!
      .text,
  ).toBe(target.text + "!");
  await page.getByRole("button", { name: "Design", exact: true }).click();
  await page.getByRole("button", { name: "Comment on this element" }).click();
  await page
    .getByRole("textbox", { name: "Comment text" })
    .fill("Please keep this heading.");
  await page.getByTestId("add-comment").click();
  await expect
    .poll(
      async () =>
        (await call(`/api/documents/${doc.id}/selection`)).comments.length,
    )
    .toBe(1);
  expect((await current(doc.id)).comments[0].elementId).toBe(target.id);
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=",
    "base64",
  );
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({ name: "sample.png", mimeType: "image/png", buffer: png });
  await expect
    .poll(
      async () =>
        (await current(doc.id)).pages[0].elements.filter(
          (e) => e.type === "image",
        ).length,
    )
    .toBe(1);
  await page.getByRole("button", { name: "Design", exact: true }).click();
  const image = (await current(doc.id)).pages[0].elements.find(
    (e) => e.type === "image",
  )!;
  await page.locator(".layer").filter({ hasText: "sample.png" }).click();
  const canvasImage = page
    .getByTestId("canvas")
    .locator(`[data-element-id="${image.id}"]`);
  const bounds = await canvasImage.boundingBox();
  expect(bounds).toBeTruthy();
  await page.mouse.move(bounds!.x + 30, bounds!.y + 30);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + 64, bounds!.y + 44);
  await page.mouse.up();
  await expect
    .poll(
      async () =>
        (await current(doc.id)).pages[0].elements.find(
          (e) => e.id === image.id,
        )!.x,
    )
    .toBe(114);
  await page.getByTestId("canvas").focus();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(
      async () =>
        (await current(doc.id)).pages[0].elements.find(
          (e) => e.id === image.id,
        )!.x,
    )
    .toBe(115);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Snapshot name" })
    .fill("Ready for review");
  await page
    .getByRole("button", { name: "Save snapshot", exact: true })
    .click();
  await expect(
    page.getByText("Ready for review", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Create variation", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Compare variations" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByTestId("export-button").click();
  await page.getByText("Editable project", { exact: true }).click();
  await page
    .getByRole("button", { name: "Create export", exact: true })
    .click();
  await expect(page.getByText("Your export is ready.")).toBeVisible();
  const link = page.getByRole("link", { name: /Download/ });
  expect(await link.getAttribute("href")).toContain("/api/downloads/");
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.reload();
  await expect(page.getByTestId("canvas")).toBeVisible();
  await expect(
    page.locator(".layer").filter({ hasText: "sample.png" }),
  ).toBeVisible();
});

test("browser reconnect refetches missed edits without replacing its text draft", async ({
  page,
  context,
}) => {
  const doc = await setup(page, "Reconnect");
  const target = doc.pages[0].elements.find((e) => e.type === "text")!;
  await page.locator(".layer").filter({ hasText: target.name }).click();
  await page.getByTestId("text-editor").fill("A draft during reconnect");
  await context.setOffline(true);
  await expect(page.getByText("Reconnecting…", { exact: true })).toBeVisible();
  await agent(doc.id, [
    { type: "set_document", patch: { name: "Updated while disconnected" } },
  ]);
  await context.setOffline(false);
  await expect(page.getByTestId("document-select")).toContainText(
    "Updated while disconnected",
  );
  await expect(page.getByTestId("text-editor")).toHaveValue(
    "A draft during reconnect",
  );
});

test("new design, rich text selection, clearing links, grouped comments and keyboard modal navigation", async ({
  page,
}) => {
  await setup(page, "Starting point");
  await page.getByRole("button", { name: "New design", exact: true }).click();
  await page
    .getByRole("textbox", { name: "New design name" })
    .fill("My structured design");
  await page
    .getByRole("button", {
      name: "Blank canvas A clean A4 page, ready for your ideas.",
    })
    .click();
  await page
    .getByRole("button", { name: "Create design", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const id = await page.getByTestId("document-select").inputValue();
  await page.getByRole("button", { name: "Add text", exact: true }).click();
  const editor = page.getByTestId("text-editor");
  await editor.fill("Hello rich world");
  await page.getByTestId("save-text").click();
  await expect.poll(async () => (await current(id)).revision).toBe(2);
  const text = (await current(id)).pages[0].elements[0];
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(6, 10);
  });
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await current(id)).pages[0].elements[0].runs?.find(
          (r) => r.text === "rich",
        )?.bold,
    )
    .toBe(true);
  const link = page.getByRole("textbox", { name: "Link URL", exact: true });
  await link.fill("https://example.com");
  await link.press("Enter");
  await expect
    .poll(async () => (await current(id)).pages[0].elements[0].href)
    .toBe("https://example.com");
  await link.fill("");
  await link.press("Enter");
  await expect
    .poll(async () => (await current(id)).pages[0].elements[0].href)
    .toBeUndefined();
  await agent(id, [
    {
      type: "add_comment",
      comment: {
        id: crypto.randomUUID(),
        elementId: text.id,
        pageId: (await current(id)).pages[0].id,
        text: "Keep this wording",
        author: "test-agent",
        createdAt: new Date().toISOString(),
        resolved: false,
      },
    },
  ]);
  await page.getByRole("button", { name: "Add shape", exact: true }).click();
  await page
    .locator(".layer")
    .filter({ hasText: "Text block" })
    .click({ modifiers: ["Shift"] });
  await page
    .getByRole("button", { name: "Group 2 elements", exact: true })
    .click();
  await expect
    .poll(async () => (await current(id)).pages[0].elements[0].type)
    .toBe("group");
  expect((await current(id)).comments[0].elementId).toBe(text.id);
  await page.getByRole("button", { name: "Ungroup section" }).click();
  await expect
    .poll(async () => (await current(id)).pages[0].elements.length)
    .toBe(2);
  expect((await current(id)).comments).toHaveLength(1);
  const exportButton = page.getByTestId("export-button");
  await exportButton.click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(exportButton).toBeFocused();
});

test("saved brand logo is reusable in another design; template previews remain within dialog", async ({
  page,
}) => {
  const source = await setup(page, "Brand source");
  await page.getByRole("button", { name: "Brand", exact: true }).click();
  await page.getByLabel("primary", { exact: true }).fill("#2657aa");
  await expect
    .poll(
      async () =>
        (await current(source.id)).pages[0].elements[0].style.background,
    )
    .toBe("#2657aa");
  await page
    .getByRole("combobox", { name: "heading font" })
    .selectOption("Inter");
  await expect
    .poll(
      async () =>
        (await current(source.id)).pages[0].elements.find((e) =>
          e.text?.includes("Good ideas."),
        )!.style.fontFamily,
    )
    .toBe("Inter");
  await page
    .getByRole("textbox", { name: "Brand name", exact: true })
    .fill("Reusable studio");
  await page
    .getByRole("textbox", { name: "Brand name", exact: true })
    .press("Enter");
  const upload = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload logo", exact: true }).click();
  const chooser = await upload;
  await chooser.setFiles({
    name: "mark.png",
    mimeType: "image/png",
    buffer: Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=",
      "base64",
    ),
  });
  await expect(page.getByAltText("Brand logo")).toBeVisible();
  await page
    .getByRole("button", { name: "Save brand kit", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText("Brand kit saved");
  await page.getByRole("button", { name: "New design", exact: true }).click();
  const modal = page.getByRole("dialog");
  expect(
    await modal.evaluate((el) => el.scrollWidth <= el.clientWidth + 1),
  ).toBe(true);
  expect(await page.locator(".template-card").count()).toBe(4);
  const cards = await page
    .locator(".template-card")
    .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().width));
  expect(cards.every((w) => w > 150 && w < 250)).toBe(true);
  await page
    .getByRole("textbox", { name: "New design name" })
    .fill("Brand destination");
  await page
    .getByRole("button", { name: "Create design", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByTestId("document-select")).not.toHaveValue(source.id);
  const id = await page.getByTestId("document-select").inputValue();
  await page.getByRole("button", { name: "Brand", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Saved brand kit" })
    .selectOption({ label: "Reusable studio" });
  await expect(page.getByAltText("Brand logo")).toBeVisible();
  const saved = await current(id);
  expect(saved.brand.logoAssetId).toBeTruthy();
  expect(saved.assets[saved.brand.logoAssetId!]).toBeTruthy();
  await page
    .getByRole("button", { name: "Add logo to page", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await current(id)).pages[0].elements.filter((e) => e.type === "image")
          .length,
    )
    .toBe(1);
});

test("overlapping browser edits wait for the prior save response, including image registration", async ({
  page,
}) => {
  const doc = await setup(page, "Queued browser writes");
  const target = doc.pages[0].elements.find((e) => e.type === "text")!;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: () => void;
  const firstCommitted = new Promise<void>((resolve) => {
    committed = resolve;
  });
  let operationRequests = 0,
    assetRequests = 0;
  await page.route(`**/api/documents/${doc.id}/operations`, async (route) => {
    operationRequests++;
    const response = await route.fetch();
    if (operationRequests === 1) {
      committed();
      await held;
    }
    await route.fulfill({ response });
  });
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url().endsWith(`/${doc.id}/assets`)
    )
      assetRequests++;
  });
  await page.locator(".layer").filter({ hasText: target.name }).click();
  await page.getByTestId("text-editor").fill(target.text + " queued");
  await page.getByTestId("save-text").click();
  await firstCommitted;
  const link = page.getByRole("textbox", { name: "Link URL", exact: true });
  await link.fill("https://example.com/queued");
  await link.press("Enter");
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "queued.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZ1sAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  // Flushing a browser event loop turn proves queued actions cannot send an older revision.
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  expect(operationRequests).toBe(1);
  expect(assetRequests).toBe(0);
  release();
  await expect.poll(async () => (await current(doc.id)).revision).toBe(4);
  const saved = await current(doc.id);
  expect(saved.pages[0].elements.find((e) => e.id === target.id)!.href).toBe(
    "https://example.com/queued",
  );
  expect(
    saved.pages[0].elements.filter((e) => e.type === "image"),
  ).toHaveLength(1);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("an ambiguous failed save cancels queued writes without automatically replaying either", async ({
  page,
}) => {
  const doc = await setup(page, "Bounded failed writes");
  const target = doc.pages[0].elements.find((e) => e.type === "text")!;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: () => void;
  const firstCommitted = new Promise<void>((resolve) => {
    committed = resolve;
  });
  let requests = 0;
  await page.route(`**/api/documents/${doc.id}/operations`, async (route) => {
    requests++;
    const response = await route.fetch();
    if (requests === 1) {
      committed();
      await held;
      await route.abort("failed");
    } else await route.fulfill({ response });
  });
  await page.locator(".layer").filter({ hasText: target.name }).click();
  await page.getByTestId("text-editor").fill(target.text + " committed");
  await page.getByTestId("save-text").click();
  await firstCommitted;
  const link = page.getByRole("textbox", { name: "Link URL", exact: true });
  await link.fill("https://example.com/not-replayed");
  await link.press("Enter");
  release();
  await expect(page.locator(".toast[role=alert]")).toContainText(
    "Pending changes were cancelled",
  );
  expect(requests).toBe(1);
  expect((await current(doc.id)).revision).toBe(1);
  expect(
    (await current(doc.id)).pages[0].elements.find((e) => e.id === target.id)!
      .href,
  ).toBeUndefined();
});

test("switching designs cancels queued old-document edits and ignores its late save response", async ({
  page,
}) => {
  const first = await setup(page, "Original before switch");
  const second = await call<Document>("/api/documents", {
    name: "Destination after switch",
    template: "blank",
  });
  await expect(page.getByTestId("document-select")).toContainText(second.name);
  const target = first.pages[0].elements.find((e) => e.type === "text")!;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: () => void;
  const firstCommitted = new Promise<void>((resolve) => {
    committed = resolve;
  });
  let requests = 0;
  await page.route(`**/api/documents/${first.id}/operations`, async (route) => {
    requests++;
    const response = await route.fetch();
    if (requests === 1) {
      committed();
      await held;
    }
    await route.fulfill({ response });
  });
  await page.locator(".layer").filter({ hasText: target.name }).click();
  await page.getByTestId("text-editor").fill(target.text + " original save");
  await page.getByTestId("save-text").click();
  await firstCommitted;
  const link = page.getByRole("textbox", { name: "Link URL", exact: true });
  await link.fill("https://example.com/old-document");
  await link.press("Enter");
  await page.getByTestId("document-select").selectOption(second.id);
  release();
  await expect(page.getByRole("alert")).toContainText(
    "The document changed before this edit could be saved",
  );
  await expect(page.getByTestId("document-select")).toHaveValue(second.id);
  expect(requests).toBe(1);
  expect(
    (await current(first.id)).pages[0].elements.find((e) => e.id === target.id)!
      .href,
  ).toBeUndefined();
  expect((await current(second.id)).revision).toBe(0);
});

test("queued browser edits never silently overwrite a new agent revision", async ({
  page,
}) => {
  const doc = await setup(page, "Queued external conflict");
  const target = doc.pages[0].elements.find((e) => e.type === "text")!;
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let committed!: () => void;
  const firstCommitted = new Promise<void>((resolve) => {
    committed = resolve;
  });
  let requests = 0;
  await page.route(`**/api/documents/${doc.id}/operations`, async (route) => {
    requests++;
    const response = await route.fetch();
    if (requests === 1) {
      committed();
      await held;
    }
    await route.fulfill({ response });
  });
  await page.locator(".layer").filter({ hasText: target.name }).click();
  await page.getByTestId("text-editor").fill(target.text + " queued");
  await page.getByTestId("save-text").click();
  await firstCommitted;
  const link = page.getByRole("textbox", { name: "Link URL", exact: true });
  await link.fill("https://example.com/browser");
  await link.press("Enter");
  await agent(doc.id, [
    {
      type: "update_element",
      elementId: target.id,
      patch: { href: "https://example.com/agent" },
    },
  ]);
  await expect(page.getByText("Revision 2", { exact: false })).toBeVisible();
  release();
  await expect(page.locator(".toast[role=alert]")).toContainText(
    "changed elsewhere while this edit was waiting",
  );
  expect(requests).toBe(1);
  expect(
    (await current(doc.id)).pages[0].elements.find((e) => e.id === target.id)!
      .href,
  ).toBe("https://example.com/agent");
});

test("editing plain text preserves unaffected bold, italic, Unicode and hyperlink runs", async ({
  page,
}) => {
  const doc = await setup(page, "Editable rich text");
  const target = doc.pages[0].elements.find((e) => e.type === "text")!;
  const runs = [
    { text: "Bold opening, ", bold: true },
    {
      text: "linked 😀 words",
      href: "https://example.com/retained",
      underline: true,
    },
    { text: ", and a quiet ending.", italic: true },
  ];
  const original = runs.map((r) => r.text).join("");
  await agent(doc.id, [
    {
      type: "update_element",
      elementId: target.id,
      patch: { text: original, runs },
    },
  ]);
  await expect(page.getByText("Revision 1", { exact: false })).toBeVisible();
  await page.locator(".layer").filter({ hasText: target.name }).click();
  const edited = `New: ${original} Done.`;
  await page.getByTestId("text-editor").fill(edited);
  await expect(
    page
      .getByTestId("canvas")
      .getByRole("link", { name: "linked 😀 words", exact: true }),
  ).toHaveAttribute("href", "https://example.com/retained");
  await page.getByTestId("save-text").click();
  await expect
    .poll(
      async () =>
        (await current(doc.id)).pages[0].elements.find(
          (e) => e.id === target.id,
        )!.text,
    )
    .toBe(edited);
  const saved = (await current(doc.id)).pages[0].elements.find(
    (e) => e.id === target.id,
  )!;
  expect(saved.runs?.find((r) => r.text === "Bold opening, ")?.bold).toBe(true);
  expect(saved.runs?.find((r) => r.text === "linked 😀 words")?.href).toBe(
    "https://example.com/retained",
  );
  expect(
    saved.runs?.find((r) => r.text === ", and a quiet ending.")?.italic,
  ).toBe(true);
});

test("deleted dirty text has a visible retained draft that can be recovered or discarded", async ({
  page,
}) => {
  const doc = await setup(page, "Retained deleted draft");
  const target = doc.pages[0].elements.find((e) => e.type === "text")!;
  await page.locator(".layer").filter({ hasText: target.name }).click();
  await page
    .getByTestId("text-editor")
    .fill("This unsaved wording must survive deletion.");
  await agent(doc.id, [{ type: "delete_element", elementId: target.id }]);
  const recovery = page.getByTestId("deleted-draft");
  await expect(recovery).toBeVisible();
  await expect(recovery.getByRole("textbox")).toHaveValue(
    "This unsaved wording must survive deletion.",
  );
  await page.getByRole("button", { name: "Brand", exact: true }).click();
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Recover as new text", exact: true })
    .click();
  await expect(recovery).toHaveCount(0);
  await expect
    .poll(async () =>
      (await current(doc.id)).pages[0].elements.some(
        (e) => e.text === "This unsaved wording must survive deletion.",
      ),
    )
    .toBe(true);
  const restored = (await current(doc.id)).pages[0].elements.find(
    (e) => e.text === "This unsaved wording must survive deletion.",
  )!;
  expect(restored.id).not.toBe(target.id);
  await expect(page.getByTestId("text-editor")).toHaveValue(restored.text!);
  await page
    .getByTestId("text-editor")
    .fill("A second local draft to discard.");
  await agent(doc.id, [{ type: "delete_element", elementId: restored.id }]);
  await expect(recovery).toBeVisible();
  await recovery
    .getByRole("button", { name: "Discard draft", exact: true })
    .click();
  await expect(recovery).toHaveCount(0);
  expect(
    (await current(doc.id)).pages[0].elements.some(
      (e) => e.text === "A second local draft to discard.",
    ),
  ).toBe(false);
});

test("draft recovery works when an agent removes the entire edited page", async ({
  page,
}) => {
  const doc = await call<Document>("/api/documents", {
    name: "Deleted page recovery",
    template: "brochure",
  });
  await page.goto(editorUrl(service.descriptor, doc.id));
  await page.getByTestId("canvas").waitFor();
  const sourcePage = doc.pages[1],
    target = sourcePage.elements.find((e) => e.type === "text")!;
  await page
    .getByRole("button", { name: `Select ${sourcePage.name}`, exact: true })
    .click();
  await page.locator(".layer").filter({ hasText: target.name }).click();
  await page
    .getByTestId("text-editor")
    .fill("Recover me onto the remaining page.");
  await agent(doc.id, [{ type: "delete_page", pageId: sourcePage.id }]);
  await page
    .getByTestId("deleted-draft")
    .getByRole("button", { name: "Recover as new text", exact: true })
    .click();
  await expect(page.getByTestId("deleted-draft")).toHaveCount(0);
  const saved = await current(doc.id);
  expect(saved.pages).toHaveLength(2);
  expect(
    saved.pages[0].elements.some(
      (e) => e.text === "Recover me onto the remaining page.",
    ),
  ).toBe(true);
});

async function holdNextOperation(page: Page, documentId: string) {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let notify!: () => void;
  const committed = new Promise<void>((resolve) => {
    notify = resolve;
  });
  let first = true;
  await page.route(
    `**/api/documents/${documentId}/operations`,
    async (route) => {
      const hold = first;
      first = false;
      const response = await route.fetch();
      if (hold) {
        notify();
        await gate;
      }
      await route.fulfill({ response });
    },
  );
  return { release, committed };
}

test("save and rich-format acknowledgements retain typing and caret entered while responses wait", async ({
  page,
}) => {
  const doc = await setup(page, "Typing during save");
  const target = doc.pages[0].elements.find((e) => e.type === "text")!;
  await page.locator(".layer").filter({ hasText: target.name }).click();
  const editor = page.getByTestId("text-editor");
  const save = await holdNextOperation(page, doc.id);
  await editor.fill("Submitted text");
  await page.getByTestId("save-text").click();
  await save.committed;
  await editor.fill("Submitted text plus newer typing");
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(7, 7);
  });
  save.release();
  await expect(page.getByTestId("save-text")).toBeEnabled();
  await expect(editor).toHaveValue("Submitted text plus newer typing");
  await expect(editor).toBeFocused();
  expect(
    await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart),
  ).toBe(7);
  expect(
    (await current(doc.id)).pages[0].elements.find((e) => e.id === target.id)!
      .text,
  ).toBe("Submitted text");
  await page.getByTestId("save-text").click();
  await expect.poll(async () => (await current(doc.id)).revision).toBe(2);
  await expect(page.getByTestId("save-text")).toBeDisabled();
  const format = await holdNextOperation(page, doc.id);
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(0, 9);
  });
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await format.committed;
  await editor.fill("Submitted text plus newer typing and another edit");
  await editor.evaluate((el: HTMLTextAreaElement) => {
    el.focus();
    el.setSelectionRange(12, 12);
  });
  format.release();
  await expect(page.getByTestId("save-text")).toBeEnabled();
  await expect(editor).toHaveValue(
    "Submitted text plus newer typing and another edit",
  );
  expect(
    await editor.evaluate((el: HTMLTextAreaElement) => el.selectionStart),
  ).toBe(12);
  await page.getByTestId("save-text").click();
  await expect.poll(async () => (await current(doc.id)).revision).toBe(4);
  expect(
    (await current(doc.id)).pages[0].elements
      .find((e) => e.id === target.id)!
      .runs?.some((r) => r.text === "Submitted" && r.bold),
  ).toBe(true);
});

test("a late own save acknowledgement preserves a newer local draft and newer agent conflict", async ({
  page,
}) => {
  const doc = await setup(page, "Acknowledgement conflict");
  const target = doc.pages[0].elements.find((e) => e.type === "text")!;
  await page.locator(".layer").filter({ hasText: target.name }).click();
  const editor = page.getByTestId("text-editor");
  const save = await holdNextOperation(page, doc.id);
  await editor.fill("Own submitted text");
  await page.getByTestId("save-text").click();
  await save.committed;
  await editor.fill("Newer unsaved local text");
  await agent(doc.id, [
    {
      type: "update_element",
      elementId: target.id,
      patch: { text: "Newer agent text" },
    },
  ]);
  await expect(page.getByTestId("conflict-use-saved")).toBeVisible();
  save.release();
  await expect(page.getByText("Saved locally", { exact: true })).toBeVisible();
  await expect(editor).toHaveValue("Newer unsaved local text");
  await expect(page.locator(".conflict")).toContainText("Newer agent text");
  await page.getByTestId("conflict-use-saved").click();
  await expect(editor).toHaveValue("Newer agent text");
});

test("draft identities are isolated across documents that reuse the same element ID", async ({
  page,
}) => {
  const first = await call<Document>("/api/documents", {
      name: "Shared ID first",
      template: "blank",
    }),
    second = await call<Document>("/api/documents", {
      name: "Shared ID second",
      template: "blank",
    });
  const shared = {
    id: "shared_title",
    name: "Shared title",
    type: "text",
    x: 48,
    y: 48,
    width: 350,
    height: 120,
    text: "Shared saved text",
    style: { fontSize: 24 },
  };
  for (const doc of [first, second])
    await agent(doc.id, [
      { type: "add_element", pageId: doc.pages[0].id, element: shared },
    ]);
  await page.goto(editorUrl(service.descriptor, first.id));
  await page.getByTestId("canvas").waitFor();
  await page.locator(".layer").filter({ hasText: "Shared title" }).click();
  await page
    .getByTestId("text-editor")
    .fill("Draft belonging only to the first document");
  await page.getByTestId("document-select").selectOption(second.id);
  await page.locator(".layer").filter({ hasText: "Shared title" }).click();
  await expect(page.getByTestId("text-editor")).toHaveValue(
    "Shared saved text",
  );
  await page
    .getByTestId("text-editor")
    .fill("Draft belonging only to the second document");
  await page.getByTestId("document-select").selectOption(first.id);
  await page.locator(".layer").filter({ hasText: "Shared title" }).click();
  await expect(page.getByTestId("text-editor")).toHaveValue(
    "Draft belonging only to the first document",
  );
  await agent(first.id, [{ type: "delete_element", elementId: shared.id }]);
  await expect(
    page.getByTestId("deleted-draft").getByRole("textbox"),
  ).toHaveValue("Draft belonging only to the first document");
  await page.getByTestId("document-select").selectOption(second.id);
  await expect(page.getByTestId("deleted-draft")).toHaveCount(0);
  await page.locator(".layer").filter({ hasText: "Shared title" }).click();
  await expect(page.getByTestId("text-editor")).toHaveValue(
    "Draft belonging only to the second document",
  );
  await agent(second.id, [{ type: "delete_element", elementId: shared.id }]);
  await expect(
    page.getByTestId("deleted-draft").getByRole("textbox"),
  ).toHaveValue("Draft belonging only to the second document");
  await page.getByTestId("document-select").selectOption(first.id);
  await expect(
    page.getByTestId("deleted-draft").getByRole("textbox"),
  ).toHaveValue("Draft belonging only to the first document");
  await page
    .getByRole("button", { name: "Recover as new text", exact: true })
    .click();
  await expect
    .poll(async () => (await current(first.id)).pages[0].elements[0]?.text)
    .toBe("Draft belonging only to the first document");
  expect((await current(second.id)).pages[0].elements).toHaveLength(0);
});
