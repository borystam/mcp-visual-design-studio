import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startService } from "../src/server/service.js";
import { requestService, serviceUrl } from "../src/server/runtime.js";
import { createDocument } from "../src/domain/templates.js";
import { resolveDocument } from "../src/domain/design-system.js";
import type {
  DesignSystem,
  Document,
  MutationResult,
} from "../src/domain/model.js";
import type { SystemRef } from "../src/systems/library.js";
const rootDir = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "system service 日本語 "));
const system = (): DesignSystem => ({
  id: "original-system",
  name: "Original service fixture",
  version: "1.0.0",
  tokens: {
    "color.primary": { type: "color", value: "#173d36" },
    "color.accent": { type: "color", value: "#d67a51" },
    "color.paper": { type: "color", value: "#fffaf0" },
    "type.heading": { type: "fontFamily", value: "Lora" },
    "space.card": { type: "dimension", value: 20 },
  },
  fonts: [],
  assets: {},
  guidelines: ["Use generous whitespace."],
  sources: [{ name: "Original test fixture" }],
  roles: {
    primaryColor: "color.primary",
    accentColor: "color.accent",
    pageBackground: "color.paper",
    headingFont: "type.heading",
  },
  components: [
    {
      id: "callout",
      name: "Callout",
      element: {
        id: "source-root",
        type: "group",
        name: "Callout",
        x: 0,
        y: 0,
        width: 500,
        height: 160,
        style: { background: "#173d36", padding: 20 },
        tokenBindings: { background: "color.primary", padding: "space.card" },
        layout: "stack",
        gap: 12,
        children: [
          {
            id: "source-heading",
            type: "text",
            name: "Heading",
            x: 0,
            y: 0,
            width: 460,
            height: 50,
            style: { color: "#ffffff", fontFamily: "Lora", fontSize: 28 },
            text: "Original heading",
          },
        ],
      },
      variants: {},
      slots: { heading: { type: "text", elementId: "source-heading" } },
    },
  ],
});
test("immutable system/default creation, atomic mapping/undo, component retry, export and fresh-workspace import", async () => {
  const root = rootDir(),
    second = rootDir();
  let service = await startService(root),
    other: Awaited<ReturnType<typeof startService>> | undefined;
  const call = <T = any>(route: string, body?: unknown) =>
    requestService<T>(service.descriptor, route, body);
  try {
    const saved = await call("/api/design-systems", { system: system() }),
      ref: SystemRef = {
        id: saved.system.id,
        version: saved.system.version,
        digest: saved.digest,
      };
    assert.deepEqual(
      await call("/api/design-systems", { system: system() }),
      saved,
    );
    await assert.rejects(
      call("/api/design-systems", {
        system: { ...system(), name: "Conflicting release" },
      }),
      /immutable/i,
    );
    await call("/api/design-systems/default", { system: ref });
    let doc = await call<Document>("/api/documents", {
      name: "Branded brochure",
      template: "brochure",
    });
    assert.equal(doc.designSystem?.version, "1.0.0");
    assert.equal(doc.pages.length, 3);
    assert.equal(resolveDocument(doc).pages[0].background, "#fffaf0");
    const legacy = await call<Document>("/api/documents", {
      name: "Explicit legacy",
      template: "blank",
      designSystem: null,
    });
    assert.equal(legacy.designSystem, undefined);
    await assert.rejects(
      call(`/api/documents/${legacy.id}/operations`, {
        operationId: "forged-version",
        actor: "test",
        expectedRevision: 0,
        operations: [
          {
            type: "set_document",
            patch: {
              designSystem: { ...system(), name: "Forged known release" },
            },
          },
        ],
      }),
      /digest/i,
    );
    const component = {
      operationId: "insert-callout",
      actor: "agent:test",
      expectedRevision: doc.revision,
      componentId: "callout",
      pageId: doc.pages[1].id,
      slots: { heading: "An editable imported heading" },
      x: 48,
      y: 100,
    };
    const inserted = await call<MutationResult>(
      `/api/documents/${doc.id}/component`,
      component,
    );
    const repeated = await call<MutationResult>(
      `/api/documents/${doc.id}/component`,
      component,
    );
    assert.equal(repeated.revision, inserted.revision);
    assert.deepEqual(repeated.affectedElementIds, inserted.affectedElementIds);
    doc = inserted.document;
    const group = doc.pages[1].elements.at(-1)!;
    assert.equal(group.children?.[0].text, "An editable imported heading");
    assert.equal(group.componentSource?.componentId, "callout");
    const next = system();
    next.version = "1.1.0";
    next.tokens["color.primary"] = { type: "color", value: "#2446a8" };
    const release2 = await call("/api/design-systems", { system: next });
    const current = await call<Document>(`/api/documents/${doc.id}`);
    assert.equal(current.designSystem?.version, "1.0.0");
    const human = await call<MutationResult>(
      `/api/documents/${doc.id}/operations`,
      {
        operationId: "human-character",
        actor: "human",
        expectedRevision: doc.revision,
        operations: [
          {
            type: "update_element",
            elementId: group.children![0].id,
            patch: { text: "An editable imported heading!" },
          },
        ],
      },
    );
    const applied = await call<MutationResult>(
      `/api/documents/${doc.id}/design-system`,
      {
        id: next.id,
        version: next.version,
        digest: release2.digest,
        operationId: "upgrade-system",
        actor: "agent:test",
        expectedRevision: human.revision,
      },
    );
    assert.equal(
      resolveDocument(applied.document).pages[1].elements.at(-1)?.style
        .background,
      "#2446a8",
    );
    const undone = await call<MutationResult>(`/api/documents/${doc.id}/undo`, {
      operationId: "undo-upgrade",
      actor: "human",
      expectedRevision: applied.revision,
      targetOperationId: "upgrade-system",
    });
    assert.equal(undone.document.designSystem?.version, "1.0.0");
    assert.equal(
      undone.document.pages[1].elements.at(-1)?.children?.[0].text,
      "An editable imported heading!",
    );
    const check = await call(`/api/documents/${doc.id}/system-check`, {});
    assert.ok(Array.isArray(check.diagnostics));
    const exported = await call("/api/design-systems/export", ref);
    const response = await fetch(
      `${serviceUrl(service.descriptor)}${exported.url}`,
      { headers: { Authorization: `Bearer ${service.descriptor.token}` } },
    );
    assert.equal(response.status, 200);
    const bytes = Buffer.from(await response.arrayBuffer());
    other = await startService(second);
    const imported = await requestService<any>(
      other.descriptor,
      "/api/design-systems/preview",
      {
        files: [
          { name: "ported.vds-system.json", data: bytes.toString("base64") },
        ],
      },
    );
    assert.deepEqual(imported.validationErrors, []);
    assert.equal(imported.digest, ref.digest);
    await requestService(other.descriptor, "/api/design-systems", {
      system: imported.system,
    });
    await service.close();
    service = await startService(root);
    const workspace = await call("/api/workspace");
    assert.deepEqual(workspace.defaultDesignSystem, ref);
    assert.equal(
      (await call<Document>(`/api/documents/${doc.id}`)).designSystem?.version,
      "1.0.0",
    );
  } finally {
    await service.close();
    await other?.close();
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(second, { recursive: true, force: true });
  }
});
test("preview keeps missing font references repairable, saves require valid faces and unknown sources cannot execute", async () => {
  const root = rootDir();
  const service = await startService(root);
  const call = <T = any>(route: string, body?: unknown) =>
    requestService<T>(service.descriptor, route, body);
  try {
    const draft = system();
    draft.tokens["type.heading"] = {
      type: "fontFamily",
      value: "Missing Typeface",
    };
    const preview = await call("/api/design-systems/preview", {
      system: draft,
    });
    assert.ok(preview.validationErrors.some((s: string) => /font/i.test(s)));
    assert.equal(
      preview.system.tokens["type.heading"].value,
      "Missing Typeface",
    );
    await assert.rejects(
      call("/api/design-systems", { system: draft }),
      /font/i,
    );
    draft.tokens["type.heading"] = { type: "fontFamily", value: "Lora" };
    assert.deepEqual(
      (await call("/api/design-systems/preview", { system: draft }))
        .validationErrors,
      [],
    );
  } finally {
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
