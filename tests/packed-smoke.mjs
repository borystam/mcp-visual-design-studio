/** Exercises the installed release tarball, never imports its source modules. */
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { gunzipSync } from "node:zlib";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { PDFDocument } from "pdf-lib";

const repository = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const root = mkdtempSync(path.join(tmpdir(), "Studio packed 日本語 spaces "));
const install = path.join(root, "clean install"),
  workspace = path.join(root, "first workspace"),
  second = path.join(root, "second workspace"),
  missing = path.join(root, "missing browser workspace");
const packageName = JSON.parse(
  readFileSync(path.join(repository, "package.json"), "utf8"),
).name;
const clients = new Set();
const workspaces = new Set();
const npmCli = process.env.npm_execpath;
assert.ok(
  npmCli && /\.(?:c?js)$/.test(npmCli),
  "Run this test with npm run test:pack so the npm CLI can be invoked portably through Node (including Windows).",
);
let cli;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function run(
  command,
  args,
  { cwd = repository, env = {}, timeout = 120000, input } = {},
) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let stdout = "",
      stderr = "";
    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    const timer = setTimeout(() => {
      child.kill();
      reject(
        new Error(
          `Command exceeded ${timeout}ms: ${path.basename(command)} ${args[0] ?? ""}`,
        ),
      );
    }, timeout);
    child.once("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new Error(
            `Command failed (${code}): ${args.join(" ")}\n${stderr}\n${stdout}`,
          ),
        );
      else resolve({ stdout, stderr });
    });
    child.stdin.end(input ?? "");
  });
}
const npm = (args, options = {}) =>
  run(process.execPath, [npmCli, ...args], options);
async function connect(target, env = {}) {
  workspaces.add(target);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", "--workspace", target],
    env: { ...process.env, ...env },
    stderr: "pipe",
  });
  const client = new Client({ name: "packed-release-smoke", version: "1.0.0" });
  let stderr = "";
  transport.stderr?.on("data", (data) => (stderr += data.toString()));
  await client.connect(transport);
  clients.add(client);
  return { client, stderr: () => stderr };
}
async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError)
    throw new Error(
      `${name}: ${result.content
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n")}`,
    );
  return (
    result.structuredContent ??
    JSON.parse(result.content.find((item) => item.type === "text").text)
  );
}
async function close(client) {
  await client.close();
  clients.delete(client);
}
async function endpoint(client) {
  const opened = await call(client, "workspace_open");
  const url = new URL(opened.editorUrl);
  return {
    origin: url.origin,
    token: new URLSearchParams(url.hash.slice(1)).get("token"),
    workspaceId: opened.workspaceId,
  };
}
async function http(endpoint, route, body) {
  const response = await fetch(`${endpoint.origin}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  assert.ok(
    response.ok,
    `HTTP ${route}: ${response.status} ${response.ok ? "" : await response.text()}`,
  );
  return response.json();
}
async function download(endpoint, url) {
  const response = await fetch(new URL(url, endpoint.origin), {
    headers: { Authorization: `Bearer ${endpoint.token}` },
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  return Buffer.from(await response.arrayBuffer());
}
function tarFiles(tarball) {
  const data = gunzipSync(readFileSync(tarball)),
    files = [];
  for (let at = 0; at + 512 <= data.length;) {
    const header = data.subarray(at, at + 512);
    if (header.every((byte) => byte === 0)) break;
    const decode = (a, b) =>
      header.subarray(a, b).toString().replace(/\0.*$/s, "");
    const name = [decode(345, 500), decode(0, 100)].filter(Boolean).join("/"),
      size = parseInt(decode(124, 136).trim() || "0", 8);
    assert.ok(Number.isFinite(size) && size >= 0);
    const type = decode(156, 157);
    assert.ok(
      type === "0" || type === "" || type === "5",
      `Unexpected tar entry type ${type}: ${name}`,
    );
    const body = data.subarray(at + 512, at + 512 + size);
    files.push({ name, body });
    at += 512 + Math.ceil(size / 512) * 512;
  }
  return files;
}
function assertSafePackage(files) {
  assert.ok(files.some((file) => file.name === "package/dist/cli.js"));
  assert.ok(files.some((file) => file.name === "package/dist/ui/index.html"));
  assert.ok(
    files.some((file) => file.name.endsWith("inter-latin-400-normal.woff2")),
  );
  for (const { name, body } of files) {
    assert.ok(
      !name.includes("..") && !name.startsWith("/") && !name.includes("\\"),
      `Unsafe archive path: ${name}`,
    );
    assert.doesNotMatch(
      name,
      /(?:^|\/)(?:\.local|\.runtime|\.git|artifacts|node_modules|tests)(?:\/|$)/,
    );
    assert.match(
      name,
      /^package\/(?:dist\/|assets\/|docs\/|package\.json$|README\.md$|LICENSE$|THIRD_PARTY_NOTICES\.md$)/,
    );
    if (/\.(?:js|json|md|css|html|txt)$/.test(name)) {
      const text = body.toString("utf8");
      assert.doesNotMatch(
        text,
        /\/Users\/[a-zA-Z][^\s"'<>]+|C:\\\\Users\\\\|\/home\/[A-Za-z][A-Za-z0-9_-]*\//,
        `Machine-specific path in ${name}`,
      );
      assert.doesNotMatch(
        text,
        /(?:ghp_|github_pat_|sk-proj-)[a-zA-Z0-9_]{20,}|-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/,
        `Credential pattern in ${name}`,
      );
    }
  }
}
async function stop(target) {
  if (!cli) return;
  await run(process.execPath, [cli, "stop", "--workspace", target], {
    timeout: 15000,
  }).catch(() => {});
}
const elementsIn = (items) =>
  items.flatMap((item) => [item, ...elementsIn(item.children ?? [])]);
async function verifyDesignSystems(
  client,
  api,
  freshProjectClient,
  browserAvailable,
  legacyDocumentId,
) {
  console.log(
    "Verifying installed design-system import, font subsets, immutable pins and native components…",
  );
  const installedAssets = path.join(
    path.dirname(path.dirname(cli)),
    "assets",
    "fonts",
  );
  const latin = readFileSync(
    path.join(installedAssets, "inter-latin-400-normal.woff2"),
  );
  const extended = readFileSync(
    path.join(installedAssets, "inter-latin-ext-400-normal.woff2"),
  );
  const license = readFileSync(path.join(installedAssets, "Inter-OFL.txt"));
  assert.match(license.toString(), /SIL OPEN FONT LICENSE/i);
  const css = `
    :root { --brand-primary: #184f44; --brand-accent: #df774f; --surface-background: #f7f9f6;
      --font-body: "Packed Sans"; --font-heading: "Packed Sans"; --space-card: 16px; }
    @font-face { font-family: "Packed Sans"; src: url("fonts/latin.woff2"); font-weight: 400;
      font-style: normal; unicode-range: U+0000-00FF; }
    @font-face { font-family: "Packed Sans"; src: url("fonts/extended.woff2"); font-weight: 400;
      font-style: normal; unicode-range: U+0100-02FF; }
    .card { width: 480px; padding: var(--space-card); background: var(--surface-background);
      color: var(--brand-primary); font-family: var(--font-body); }
    h2 { font-size: 24px; font-weight: 400; line-height: 1.3; font-family: var(--font-heading); }
    p { font-size: 18px; font-weight: 400; line-height: 1.4; }
  `;
  const sourceFile = (name, bytes) => ({
    name,
    data: Buffer.from(bytes).toString("base64"),
  });
  const draft = await call(client, "design_system_preview", {
    name: "Packed custom design system",
    version: "1.0.0",
    files: [
      sourceFile("brand.css", css),
      sourceFile(
        "card.html",
        '<section data-component="Packed card" class="card"><h2>Imported headline</h2><p>Original component copy.</p></section>',
      ),
      sourceFile("fonts/latin.woff2", latin),
      sourceFile("fonts/extended.woff2", extended),
      sourceFile("Inter-OFL.txt", license),
      sourceFile(
        "brand-guidelines.md",
        "Use the supplied typefaces and keep components editable.",
      ),
    ],
  });
  assert.deepEqual(draft.validationErrors, []);
  assert.equal(draft.report.importKind, "html");
  assert.equal(draft.system.fonts.length, 2);
  assert.deepEqual(draft.system.fonts.map((face) => face.unicodeRange).sort(), [
    "U+0-FF",
    "U+100-2FF",
  ]);
  assert.ok(
    draft.system.guidelines.some((value) =>
      value.includes("SIL OPEN FONT LICENSE"),
    ),
  );
  assert.ok(draft.system.components.length);
  assert.equal(draft.system.tokens["font-body"].value, "Packed Sans");
  assert.equal(draft.specimen.designSystem.id, draft.system.id);
  const unsaved = await call(client, "design_system_list");
  assert.equal(unsaved.systems.length, 0, "Preview must not save a release");
  const saved = await call(client, "design_system_save", {
    system: draft.system,
  });
  assert.deepEqual(
    saved.system,
    draft.system,
    "Save must pin the exact normalized review",
  );
  assert.equal(saved.digest, draft.digest);
  const ref = {
    id: saved.system.id,
    version: saved.system.version,
    digest: saved.digest,
  };
  const read = await call(client, "design_system_read", {
    id: ref.id,
    version: ref.version,
  });
  assert.deepEqual(read.system, saved.system);
  assert.equal(read.digest, saved.digest);
  assert.equal(
    (await call(client, "design_system_save", { system: saved.system })).digest,
    ref.digest,
  );
  const mismatch = structuredClone(saved.system);
  mismatch.name = "Changed without a version bump";
  const rejected = await client.callTool({
    name: "design_system_save",
    arguments: { system: mismatch },
  });
  assert.equal(rejected.isError, true);
  assert.match(
    rejected.content.find((item) => item.type === "text").text,
    /immutable/i,
  );
  await call(client, "design_system_set_default", { system: ref });
  assert.deepEqual(
    (await call(client, "design_system_list")).defaultSystem,
    ref,
  );
  const pinned = await call(client, "document_create", {
    name: "Packed system document",
    template: "blank",
  });
  assert.deepEqual(pinned.document.designSystem, saved.system);
  assert.equal(
    pinned.document.pages[0].backgroundToken,
    saved.system.roles.pageBackground,
  );
  assert.equal(
    (await call(client, "document_read", { documentId: legacyDocumentId }))
      .designSystem,
    undefined,
  );
  const optOut = await call(client, "document_create", {
    name: "Explicit default opt out",
    designSystem: null,
  });
  assert.equal(optOut.document.designSystem, undefined);
  const applied = await call(client, "design_system_apply", {
    ...ref,
    documentId: optOut.documentId,
    operationId: "packed-system-apply",
    actor: "packed",
    expectedRevision: 0,
  });
  assert.deepEqual(applied.document.designSystem, saved.system);
  const component = saved.system.components[0];
  const [slotName, slot] = Object.entries(component.slots).find(
    ([, value]) => value.type === "text",
  );
  const submittedText = "Custom design: Zażółć";
  const insertion = {
    documentId: pinned.documentId,
    operationId: "packed-component-insert",
    actor: "packed",
    expectedRevision: 0,
    pageId: pinned.document.pages[0].id,
    componentId: component.id,
    slots: { [slotName]: submittedText },
    x: 48,
    y: 48,
  };
  const inserted = await call(client, "component_insert", insertion);
  assert.equal(inserted.revision, 1);
  assert.deepEqual(
    await call(client, "component_insert", insertion),
    inserted,
    "Component insertion retries must deduplicate",
  );
  const copied = inserted.document.pages[0].elements[0];
  assert.deepEqual(copied.componentSource, {
    systemId: ref.id,
    systemVersion: ref.version,
    componentId: component.id,
  });
  const changedText = elementsIn([copied]).find(
    (item) => item.text === submittedText,
  );
  assert.ok(changedText);
  assert.notEqual(changedText.id, slot.elementId);
  const editedText = "Editable custom type: Zażółć";
  const edited = await call(client, "document_apply", {
    documentId: pinned.documentId,
    batch: {
      operationId: "packed-component-edit",
      actor: "human:packed",
      expectedRevision: 1,
      operations: [
        {
          type: "update_element",
          elementId: changedText.id,
          patch: { text: editedText },
        },
      ],
    },
  });
  assert.equal(edited.revision, 2);
  assert.deepEqual(
    await call(client, "component_insert", insertion),
    inserted,
    "An old exact retry must not replace later text",
  );
  assert.equal(
    elementsIn(
      (await call(client, "document_read", { documentId: pinned.documentId }))
        .pages[0].elements,
    ).find((item) => item.id === changedText.id).text,
    editedText,
  );
  const check = await call(client, "design_system_check", {
    documentId: pinned.documentId,
  });
  assert.equal(check.revision, 2);
  assert.ok(
    check.diagnostics.every((diagnostic) => diagnostic.severity !== "error"),
  );
  const next = structuredClone(saved.system);
  next.version = "1.1.0";
  next.tokens["brand-primary"].value = "#553377";
  const later = await call(client, "design_system_save", { system: next });
  await call(client, "design_system_set_default", {
    system: { id: next.id, version: next.version, digest: later.digest },
  });
  assert.equal(
    (await call(client, "document_read", { documentId: pinned.documentId }))
      .designSystem.version,
    "1.0.0",
  );
  assert.equal(
    (await call(client, "document_create", { name: "New default version" }))
      .document.designSystem.version,
    "1.1.0",
  );
  let project;
  for (const format of [
    "html",
    "bundle",
    ...(browserAvailable ? ["pdf", "png"] : []),
  ]) {
    const output = await call(client, "document_export", {
      documentId: pinned.documentId,
      revision: 2,
      format,
      ...(format === "png" ? { pageId: pinned.document.pages[0].id } : {}),
    });
    const bytes = await download(api, output.url);
    assert.equal(output.revision, 2);
    assert.ok(bytes.length > 100);
    if (format === "bundle") {
      project = bytes;
      const parsed = JSON.parse(bytes);
      assert.deepEqual(parsed.document.designSystem, saved.system);
      for (const face of saved.system.fonts)
        assert.ok(parsed.assets.some((asset) => asset.id === face.assetId));
    }
    if (format === "html") {
      assert.match(bytes.toString(), /unicode-range:U\+0-FF/);
      assert.match(bytes.toString(), /unicode-range:U\+100-2FF/);
      assert.match(bytes.toString(), /VDS_Packed Sans/);
      assert.ok(bytes.toString().includes(editedText));
      assert.ok(bytes.toString().includes(latin.toString("base64")));
      assert.ok(bytes.toString().includes(extended.toString("base64")));
    }
    if (format === "pdf" || format === "png") {
      const importedFonts = output.diagnostics.fonts.filter(
        (font) => font.family === "Packed Sans",
      );
      assert.ok(
        importedFonts.length,
        "Render diagnostics must inspect the imported font",
      );
      assert.ok(
        importedFonts.every(
          (font) => font.loaded && !font.missingGlyphs?.length,
        ),
        JSON.stringify(output.diagnostics),
      );
      assert.deepEqual(output.diagnostics.overflow, []);
      if (format === "pdf")
        assert.equal((await PDFDocument.load(bytes)).getPageCount(), 1);
      else {
        assert.equal(bytes.readUInt32BE(16), pinned.document.pages[0].width);
        assert.equal(bytes.readUInt32BE(20), pinned.document.pages[0].height);
      }
    }
  }
  const portable = await call(client, "design_system_export", ref);
  const portableBytes = await download(api, portable.url);
  const portableData = JSON.parse(portableBytes);
  assert.equal(portableData.digest, ref.digest);
  assert.deepEqual(portableData.system, saved.system);
  const clean = await connect(path.join(root, "portable system workspace"));
  assert.equal(
    (await call(clean.client, "design_system_list")).systems.length,
    0,
  );
  const incoming = await call(clean.client, "design_system_preview", {
    files: [sourceFile("brand.vds-system.json", portableBytes)],
  });
  assert.deepEqual(incoming.validationErrors, []);
  assert.deepEqual(incoming.system, saved.system);
  assert.equal(incoming.digest, ref.digest);
  const imported = await call(clean.client, "design_system_save", {
    system: incoming.system,
  });
  assert.equal(imported.digest, ref.digest);
  await call(clean.client, "design_system_set_default", { system: ref });
  assert.deepEqual(
    (await call(clean.client, "document_create", { name: "Portable default" }))
      .document.designSystem,
    saved.system,
  );
  assert.equal(
    (await call(freshProjectClient, "design_system_list")).systems.length,
    0,
  );
  const importedProject = await call(freshProjectClient, "project_import", {
    data: project.toString("base64"),
  });
  assert.deepEqual(importedProject.designSystem, saved.system);
  assert.equal(importedProject.revision, 0);
  assert.equal(
    (await call(freshProjectClient, "design_system_list")).systems.length,
    0,
    "Project snapshots remain self-contained without silently installing a library",
  );
  const continued = await call(freshProjectClient, "document_apply", {
    documentId: importedProject.id,
    batch: {
      operationId: "packed-system-fresh-edit",
      actor: "packed:fresh",
      expectedRevision: 0,
      operations: [
        {
          type: "update_element",
          elementId: changedText.id,
          patch: { text: "Still editable with the imported font" },
        },
      ],
    },
  });
  assert.equal(continued.revision, 1);
  const finalExport = await call(freshProjectClient, "document_export", {
    documentId: importedProject.id,
    revision: 1,
    format: browserAvailable ? "pdf" : "html",
  });
  if (browserAvailable)
    assert.ok(
      finalExport.diagnostics.fonts.some(
        (font) => font.family === "Packed Sans" && font.loaded,
      ),
    );
  console.log(
    "Verified installed BYO tools, CSS/HTML/font import, exact version pins, editable components, font subset rendering, portable systems and self-contained project round-trips.",
  );
}
try {
  mkdirSync(install, { recursive: true });
  writeFileSync(
    path.join(install, "package.json"),
    JSON.stringify({
      name: "studio-packed-smoke",
      private: true,
      version: "1.0.0",
    }),
  );
  console.log("Packing the release and inspecting its complete allowlist…");
  const packed = await npm(["pack", "--json", "--pack-destination", root], {
    timeout: 120000,
  });
  const match = packed.stdout.match(/(\[\s*\{[\s\S]*\}\s*\])\s*$/);
  assert.ok(match, "npm pack did not produce JSON metadata");
  const [metadata] = JSON.parse(match[1]);
  const tarball = path.join(root, metadata.filename);
  assertSafePackage(tarFiles(tarball));
  console.log(
    `Installing ${metadata.filename} into a clean path with spaces and non-ASCII characters…`,
  );
  await npm(
    ["install", "--prefer-offline", "--no-audit", "--no-fund", tarball],
    {
      cwd: install,
      env: { PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1" },
      // Dependency provisioning can be slow on a clean hosted Windows runner.
      // This remains a clean install; only npm's verified download cache is reused.
      timeout: 240000,
    },
  );
  cli = path.join(
    install,
    "node_modules",
    ...packageName.split("/"),
    "dist/cli.js",
  );
  assert.ok(existsSync(cli));
  const version = (await run(process.execPath, [cli, "version"])).stdout.trim();
  assert.equal(version, metadata.version);
  const doctor = JSON.parse(
    (await run(process.execPath, [cli, "doctor", "--workspace", workspace]))
      .stdout,
  );
  assert.equal(doctor.version, version);
  assert.equal(doctor.supportedNode, true);
  const browserAvailable = doctor.exportBrowser.ok === true;
  if (process.env.CI)
    assert.equal(
      browserAvailable,
      true,
      "The CI release gate must exercise the installed package's PDF, PNG and preview rendering.",
    );
  console.log(
    `Installed CLI is healthy. Chromium available: ${browserAvailable}.`,
  );
  const first = await connect(workspace);
  const client = first.client;
  const tools = await client.listTools();
  for (const name of [
    "workspace_open",
    "document_create",
    "document_apply",
    "asset_import",
    "preview_render",
    "document_export",
    "project_import",
    "history_undo",
    "design_system_list",
    "design_system_read",
    "design_system_preview",
    "design_system_save",
    "design_system_asset_import",
    "design_system_set_default",
    "design_system_apply",
    "design_system_check",
    "design_system_export",
    "component_insert",
  ])
    assert.ok(tools.tools.some((tool) => tool.name === name));
  assert.match(
    JSON.stringify(
      tools.tools.find((tool) => tool.name === "design_system_save")
        .inputSchema,
    ),
    /unicodeRange/,
  );
  assert.match(
    JSON.stringify(
      tools.tools.find((tool) => tool.name === "document_apply").inputSchema,
    ),
    /tokenBindings/,
  );
  let api = await endpoint(client);
  const firstWorkspaceId = api.workspaceId;
  const created = await call(client, "document_create", {
    name: "Packed release brochure",
    template: "brochure",
  });
  let document = created.document;
  assert.equal(document.pages.length, 3);
  const documentId = document.id;
  const heading = document.pages[0].elements.find(
    (element) => element.type === "text",
  );
  const originalColor = heading.style.color;
  const streamController = new AbortController();
  const events = await fetch(`${api.origin}/api/events`, {
    headers: { Authorization: `Bearer ${api.token}` },
    signal: streamController.signal,
  });
  assert.equal(events.status, 200);
  const reader = events.body.getReader();
  let eventText = new TextDecoder().decode((await reader.read()).value);
  assert.match(eventText, /event: ready/);
  async function awaitRevision(revision) {
    const deadline = Date.now() + 5000;
    while (!eventText.includes(`"revision":${revision}`)) {
      assert.ok(Date.now() < deadline, "SSE did not deliver the new revision");
      const next = await Promise.race([
        reader.read(),
        delay(5000).then(() => {
          throw new Error("SSE event timeout");
        }),
      ]);
      eventText += new TextDecoder().decode(next.value);
    }
  }
  const manualText = heading.text + "!";
  const manual = await http(api, `/api/documents/${documentId}/operations`, {
    operationId: "packed-human-character",
    actor: "human:packed",
    expectedRevision: 0,
    operations: [
      {
        type: "update_element",
        elementId: heading.id,
        patch: { text: manualText },
      },
    ],
  });
  assert.equal(manual.revision, 1);
  await awaitRevision(1);
  const agent = await call(client, "document_apply", {
    documentId,
    batch: {
      operationId: "packed-agent-style",
      actor: "agent:packed",
      expectedRevision: 1,
      operations: [
        {
          type: "update_element",
          elementId: heading.id,
          patch: { style: { color: "#3d5c44" } },
        },
      ],
    },
  });
  assert.equal(agent.revision, 2);
  await awaitRevision(2);
  const other = document.pages[0].elements.find(
    (element) => element.type === "shape",
  );
  const moved = await http(api, `/api/documents/${documentId}/operations`, {
    operationId: "packed-human-move",
    actor: "human:packed",
    expectedRevision: 2,
    operations: [
      {
        type: "update_element",
        elementId: other.id,
        patch: { x: other.x + 1 },
      },
    ],
  });
  assert.equal(moved.revision, 3);
  const commented = await call(client, "comment_add", {
    documentId,
    elementId: heading.id,
    pageId: document.pages[0].id,
    text: "Please keep this heading.",
    actor: "human:packed",
    expectedRevision: 3,
    operationId: "packed-comment",
    commentId: "packed_comment",
    createdAt: new Date().toISOString(),
  });
  assert.equal(commented.revision, 4);
  await http(api, `/api/documents/${documentId}/selection`, {
    elementIds: [heading.id],
    pageId: document.pages[0].id,
  });
  const selected = await call(client, "selection_read", { documentId });
  assert.ok(
    selected.comments.some(
      (comment) => comment.text === "Please keep this heading.",
    ),
  );
  const undo = await call(client, "history_undo", {
    documentId,
    operationId: "packed-undo-agent",
    actor: "human:packed",
    expectedRevision: 4,
    targetOperationId: "packed-agent-style",
  });
  document = undo.document;
  assert.equal(undo.revision, 5);
  assert.equal(
    document.pages[0].elements.find((e) => e.id === heading.id).text,
    manualText,
  );
  assert.equal(
    document.pages[0].elements.find((e) => e.id === heading.id).style.color,
    originalColor,
  );
  assert.equal(
    document.pages[0].elements.find((e) => e.id === other.id).x,
    other.x + 1,
  );
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><rect width="32" height="32" rx="8" fill="#782e27"/></svg>',
  );
  const importedAsset = await call(client, "asset_import", {
    documentId,
    name: "Approved original mark",
    data: svg.toString("base64"),
    expectedRevision: 5,
    operationId: "packed-image-import",
    actor: "human:packed",
  });
  assert.equal(importedAsset.revision, 6);
  const placed = await call(client, "document_apply", {
    documentId,
    batch: {
      expectedRevision: 6,
      operationId: "packed-image-place",
      actor: "human:packed",
      operations: [
        {
          type: "add_element",
          pageId: document.pages[0].id,
          element: {
            id: "packed_image",
            type: "image",
            name: "Original mark",
            x: 705,
            y: 1018,
            width: 32,
            height: 32,
            style: {},
            assetId: importedAsset.asset.id,
            fit: "contain",
          },
        },
      ],
    },
  });
  assert.equal(placed.revision, 7);
  const snapshot = await call(client, "snapshot_create", {
    documentId,
    name: "Approved before restart",
  });
  assert.ok(snapshot.id);
  streamController.abort();
  await reader.cancel().catch(() => {});
  await close(client);
  assert.doesNotMatch(first.stderr(), /Unhandled|SyntaxError/);
  // A raw EOF must also exit the MCP child without terminating the shared workspace service.
  await run(process.execPath, [cli, "mcp", "--workspace", workspace], {
    timeout: 15000,
  });
  const afterEof = await http(api, `/api/documents/${documentId}`);
  assert.equal(afterEof.revision, 7);
  await stop(workspace);
  await delay(150);
  const reconnected = await connect(workspace);
  const restarted = reconnected.client;
  api = await endpoint(restarted);
  assert.equal(api.workspaceId, firstWorkspaceId);
  const recovered = await call(restarted, "document_read", { documentId });
  assert.equal(recovered.revision, 7);
  assert.equal(
    recovered.pages[0].elements.find((e) => e.id === heading.id).text,
    manualText,
  );
  const history = await call(restarted, "history_read", { documentId });
  assert.ok(
    history.snapshots.some((s) => s.name === "Approved before restart"),
  );
  const duplicate = await call(restarted, "document_duplicate", {
    documentId,
    name: "Packed variation",
    revision: 7,
  });
  assert.notEqual(duplicate.id, documentId);
  assert.equal(duplicate.pages.length, 3);
  console.log(
    "Verified installed MCP, HTTP human edits, SSE, comments, safe undo, EOF, restart and variations.",
  );
  let bundleBytes;
  for (const format of [
    "html",
    "bundle",
    ...(browserAvailable ? ["pdf", "png"] : []),
  ]) {
    const output = await call(restarted, "document_export", {
      documentId,
      revision: 7,
      format,
      ...(format === "png" ? { pageId: recovered.pages[0].id } : {}),
    });
    assert.equal(output.revision, 7);
    assert.equal(output.diagnostics.revision, 7);
    const bytes = await download(api, output.url);
    assert.ok(bytes.length > 100);
    if (format === "bundle") {
      bundleBytes = bytes;
      assert.equal(JSON.parse(bytes).document.revision, 7);
    }
    if (format === "html") {
      assert.match(bytes.toString(), /data:font\/woff2;base64/);
      assert.match(bytes.toString(), /data:image\/svg\+xml;base64/);
      assert.ok(bytes.toString().includes(manualText));
    }
    if (format === "pdf") {
      const pdf = await PDFDocument.load(bytes);
      assert.equal(pdf.getPageCount(), 3);
      assert.equal(pdf.getPage(0).getWidth(), 794 * 0.75);
      assert.ok(output.diagnostics.fonts.every((font) => font.loaded));
      assert.deepEqual(output.diagnostics.overflow, []);
    }
    if (format === "png") {
      assert.equal(bytes.readUInt32BE(16), 794);
      assert.equal(bytes.readUInt32BE(20), 1123);
      assert.ok(output.diagnostics.images.every((image) => image.loaded));
    }
  }
  if (browserAvailable) {
    const preview = await restarted.callTool({
      name: "preview_render",
      arguments: { documentId, revision: 7, pageId: recovered.pages[0].id },
    });
    assert.notEqual(preview.isError, true);
    const image = preview.content.find((item) => item.type === "image");
    assert.equal(image.mimeType, "image/png");
    assert.ok(Buffer.from(image.data, "base64").length > 1000);
  }
  const fresh = await connect(second);
  const restored = await call(fresh.client, "project_import", {
    data: bundleBytes.toString("base64"),
  });
  assert.notEqual(restored.id, documentId);
  assert.equal(restored.pages.length, 3);
  assert.equal(restored.revision, 0);
  assert.ok(restored.assets[importedAsset.asset.id]);
  const continued = await call(fresh.client, "document_apply", {
    documentId: restored.id,
    batch: {
      operationId: "packed-fresh-edit",
      actor: "agent:fresh",
      expectedRevision: 0,
      operations: [
        {
          type: "update_element",
          elementId: heading.id,
          patch: { text: "Editable in a fresh workspace" },
        },
      ],
    },
  });
  assert.equal(continued.revision, 1);
  await verifyDesignSystems(
    restarted,
    api,
    fresh.client,
    browserAvailable,
    documentId,
  );
  const absentPath = path.join(root, "no installed browsers");
  const noBrowserDoctor = JSON.parse(
    (
      await run(process.execPath, [cli, "doctor", "--workspace", missing], {
        env: { PLAYWRIGHT_BROWSERS_PATH: absentPath },
      })
    ).stdout,
  );
  assert.equal(noBrowserDoctor.exportBrowser.ok, false);
  assert.match(noBrowserDoctor.exportBrowser.command, /setup-export/);
  const browserless = await connect(missing, {
    PLAYWRIGHT_BROWSERS_PATH: absentPath,
  });
  const plain = await call(browserless.client, "document_create", {
    name: "Works without Chromium",
  });
  await call(browserless.client, "document_export", {
    documentId: plain.documentId,
    revision: 0,
    format: "html",
  });
  const refused = await browserless.client.callTool({
    name: "document_export",
    arguments: { documentId: plain.documentId, revision: 0, format: "pdf" },
  });
  assert.equal(refused.isError, true);
  assert.match(
    refused.content.find((item) => item.type === "text").text,
    /setup-export/,
  );
  assert.ok(
    !existsSync(absentPath),
    "MCP handshake must not provision a browser",
  );
  console.log(
    `Packed release smoke passed: ${browserAvailable ? "PDF, PNG, preview pixels, HTML" : "HTML (PDF/PNG skipped: Chromium not installed)"}, editable bundle round-trip, fresh edits, and actionable missing-browser behavior.`,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const client of clients) await client.close().catch(() => {});
  for (const target of workspaces) await stop(target);
  await delay(150);
  if (process.env.STUDIO_KEEP_PACK_TEST === "1")
    console.log(`Packed test fixtures retained at ${root}`);
  else
    rmSync(root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 150,
    });
}
