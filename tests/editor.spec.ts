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
