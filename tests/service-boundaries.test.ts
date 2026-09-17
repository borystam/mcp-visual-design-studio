import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import net from "node:net";
import { startService } from "../src/server/service.js";
import {
  requestService,
  serviceUrl,
  workspacePath,
  type Descriptor,
} from "../src/server/runtime.js";
import type {
  Asset,
  BrandKit,
  Document,
  Element,
  MutationResult,
} from "../src/domain/model.js";

function temp(t: TestContext) {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), "Studio boundaries 日本語 "),
  );
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
async function service(t: TestContext) {
  const root = temp(t);
  const running = await startService(root);
  t.after(() => running.close());
  return { root, ...running };
}
async function create(d: Descriptor, name = "Boundary document") {
  return requestService<Document>(d, "/api/documents", {
    name,
    template: "blank",
  });
}
async function sessionCookie(d: Descriptor) {
  const response = await fetch(`${serviceUrl(d)}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token: d.token }),
  });
  assert.equal(response.status, 200);
  const cookie = response.headers.get("set-cookie");
  assert.ok(cookie);
  assert.match(cookie, /HttpOnly; SameSite=Strict/);
  return cookie.split(";")[0];
}
async function port() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const value = (server.address() as net.AddressInfo).port;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return value;
}

test("workspace-specific session cookies authorize two simultaneous local workspaces", async (t) => {
  const a = await service(t),
    b = await service(t);
  const first = await sessionCookie(a.descriptor),
    second = await sessionCookie(b.descriptor);
  assert.notEqual(first.split("=")[0], second.split("=")[0]);
  const allCookies = `${first}; ${second}`;
  for (const running of [a, b]) {
    const response = await fetch(
      `${serviceUrl(running.descriptor)}/api/workspace`,
      { headers: { Cookie: allCookies } },
    );
    assert.equal(response.status, 200);
    assert.equal(
      ((await response.json()) as { workspaceId: string }).workspaceId,
      running.descriptor.workspaceId,
    );
  }
  assert.equal(
    (
      await fetch(`${serviceUrl(a.descriptor)}/api/workspace`, {
        headers: { Cookie: second },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await fetch(`${serviceUrl(b.descriptor)}/api/workspace`, {
        headers: { Cookie: first },
      })
    ).status,
    401,
  );
});

test("failed workspace identity initialization closes its listener and releases ownership", async (t) => {
  const root = workspacePath(temp(t)),
    requestedPort = await port();
  fs.writeFileSync(
    path.join(root, "workspace.json"),
    JSON.stringify({ id: "damaged", schemaVersion: 99 }),
  );
  await assert.rejects(
    startService(root, { port: requestedPort }),
    /damaged workspace identity/,
  );
  assert.equal(fs.existsSync(path.join(root, ".runtime/owner")), false);
  assert.equal(fs.existsSync(path.join(root, ".runtime/service.json")), false);
  // Rebinding the exact failed startup port proves that no inaccessible server remains.
  fs.writeFileSync(
    path.join(root, "workspace.json"),
    JSON.stringify({ id: "repaired-workspace", schemaVersion: 1 }),
  );
  const running = await startService(root, { port: requestedPort });
  try {
    assert.equal(running.descriptor.port, requestedPort);
    assert.equal(
      (
        await requestService<{ workspaceId: string }>(
          running.descriptor,
          "/api/workspace",
        )
      ).workspaceId,
      "repaired-workspace",
    );
  } finally {
    await running.close();
  }
});

test("migration creates a fresh revision-zero document and leaves legacy input and source untouched", async (t) => {
  const running = await service(t),
    d = running.descriptor;
  const source = await create(d, "Legacy source");
  const changed = await requestService<MutationResult>(
    d,
    `/api/documents/${source.id}/operations`,
    {
      operationId: "source-edit",
      actor: "human",
      expectedRevision: 0,
      operations: [
        { type: "set_document", patch: { name: "Preserved original" } },
      ],
    },
  );
  const legacy: any = structuredClone(changed.document);
  legacy.schemaVersion = 0;
  delete legacy.rendererVersion;
  delete legacy.comments;
  const sourcePath = path.join(running.root, "imports", "legacy source.json"),
    originalBytes = JSON.stringify(legacy, null, 2);
  fs.writeFileSync(sourcePath, originalBytes);
  const migrated = await requestService<Document>(d, "/api/migrate", {
    document: JSON.parse(fs.readFileSync(sourcePath, "utf8")),
  });
  assert.notEqual(migrated.id, source.id);
  assert.equal(migrated.revision, 0);
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.rendererVersion, 1);
  assert.equal(migrated.name, "Preserved original");
  assert.deepEqual(migrated.pages, changed.document.pages);
  assert.equal(fs.readFileSync(sourcePath, "utf8"), originalBytes);
  assert.deepEqual(
    await requestService<Document>(d, `/api/documents/${source.id}`),
    changed.document,
  );
});

test("forged asset registration rejects its entire operation batch before persistence", async (t) => {
  const { descriptor: d } = await service(t),
    doc = await create(d);
  const forged: Asset = {
    id: `asset_${"0".repeat(64)}`,
    name: "Missing image",
    mime: "image/png",
    bytes: 20,
    sha256: "0".repeat(64),
  };
  await assert.rejects(
    requestService(d, `/api/documents/${doc.id}/operations`, {
      operationId: "forged",
      actor: "agent",
      expectedRevision: 0,
      operations: [
        { type: "set_document", patch: { name: "Must not be saved" } },
        { type: "register_asset", asset: forged },
      ],
    }),
    /ENOENT|Missing|Invalid|corrupt/i,
  );
  assert.deepEqual(
    await requestService<Document>(d, `/api/documents/${doc.id}`),
    doc,
  );
  assert.deepEqual(
    await requestService(d, `/api/documents/${doc.id}/history`),
    [],
  );
});

test("recursive brand kit inputs have a bounded validation failure and leave the service usable", async (t) => {
  const running = await service(t),
    d = running.descriptor;
  let nested: Element = {
    id: "leaf",
    type: "text",
    name: "Leaf",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    style: {},
    text: "Bounded",
  };
  for (let i = 0; i < 60; i++)
    nested = {
      id: `group_${i}`,
      type: "group",
      name: "Nested",
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      style: {},
      children: [nested],
    };
  const response = await fetch(`${serviceUrl(d)}/api/brands`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${d.token}`,
    },
    body: JSON.stringify({
      id: "deep_brand",
      name: "Deep",
      fonts: { heading: "Inter", body: "Inter" },
      colors: { primary: "#112233" },
      components: [nested],
    }),
  });
  assert.equal(response.status, 400);
  assert.equal(((await response.json()) as { code: string }).code, "LIMIT");
  assert.deepEqual(fs.readdirSync(path.join(running.root, "brands")), []);
  assert.equal((await create(d, "Still responsive")).name, "Still responsive");
});

test("saved logo and image-component brand kits survive source undo, restart, and repeated application", async (t) => {
  const root = temp(t);
  let running = await startService(root);
  t.after(() => running.close());
  const call = <T = unknown>(route: string, body?: unknown) =>
    requestService<T>(running.descriptor, route, body);
  const source = await create(running.descriptor, "Brand asset source");
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="#245577"/></svg>',
  );
  const imported = await call<MutationResult & { asset: Asset }>(
    `/api/documents/${source.id}/assets`,
    {
      name: "Generic square logo",
      data: svg.toString("base64"),
      operationId: "logo-import",
      actor: "human",
      expectedRevision: 0,
    },
  );
  const brand: BrandKit = {
    id: "reusable_brand",
    name: "Reusable brand",
    colors: { primary: "#245577" },
    fonts: { heading: "Lora", body: "Inter" },
    logoAssetId: imported.asset.id,
    components: [
      {
        id: "reusable_image",
        type: "image",
        name: "Image component",
        x: 0,
        y: 0,
        width: 40,
        height: 40,
        style: {},
        assetId: imported.asset.id,
      },
    ],
  };
  assert.deepEqual(await call("/api/brands", brand), brand);
  // The source document already contains the asset: applying its saved brand is still legal.
  const sourceBranded = await call<MutationResult>(
    `/api/documents/${source.id}/brand`,
    {
      brandId: brand.id,
      operationId: "brand-source",
      actor: "human",
      expectedRevision: 1,
    },
  );
  assert.equal(sourceBranded.revision, 2);
  await call(`/api/documents/${source.id}/undo`, {
    operationId: "undo-source-brand",
    actor: "human",
    expectedRevision: 2,
    targetOperationId: "brand-source",
  });
  await call(`/api/documents/${source.id}/undo`, {
    operationId: "undo-source-asset",
    actor: "human",
    expectedRevision: 3,
    targetOperationId: "logo-import",
  });
  assert.deepEqual(
    (await call<Document>(`/api/documents/${source.id}`)).assets,
    {},
  );
  await running.close();
  running = await startService(root);
  const target = await create(running.descriptor, "Fresh branded document");
  const request = {
    brandId: brand.id,
    operationId: "brand-target",
    actor: "human",
    expectedRevision: 0,
  };
  const branded = await call<MutationResult>(
    `/api/documents/${target.id}/brand`,
    request,
  );
  assert.deepEqual(branded.document.brand, brand);
  assert.deepEqual(branded.document.assets[imported.asset.id], imported.asset);
  assert.deepEqual(
    await call(`/api/documents/${target.id}/brand`, request),
    branded,
  );
  const again = await call<MutationResult>(
    `/api/documents/${target.id}/brand`,
    { ...request, operationId: "brand-again", expectedRevision: 1 },
  );
  assert.equal(again.revision, 2);
  assert.equal(Object.keys(again.document.assets).length, 1);
  const response = await fetch(
    `${serviceUrl(running.descriptor)}/api/assets/${imported.asset.id}`,
    { headers: { Authorization: `Bearer ${running.descriptor.token}` } },
  );
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<rect/);
  const edited = await call<MutationResult>(
    `/api/documents/${target.id}/operations`,
    {
      operationId: "use-component",
      actor: "human",
      expectedRevision: 2,
      operations: [
        {
          type: "add_element",
          pageId: target.pages[0].id,
          element: { ...brand.components[0], id: "placed_logo" },
        },
      ],
    },
  );
  const exported = await call<{ filename: string; url: string }>(
    `/api/documents/${target.id}/export`,
    { format: "html", revision: edited.revision },
  );
  const html = await fetch(`${serviceUrl(running.descriptor)}${exported.url}`, {
    headers: { Authorization: `Bearer ${running.descriptor.token}` },
  });
  assert.equal(html.status, 200);
  assert.match(await html.text(), /data:image\/svg\+xml;base64/);
});
