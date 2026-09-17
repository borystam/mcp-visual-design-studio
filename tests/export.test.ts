import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright";
import { PDFDocument, PDFName, PDFDict, PDFArray } from "pdf-lib";
import { createDocument, templates } from "../src/domain/templates.js";
import {
  renderHtml,
  exportDocument,
  importBundle,
  importAsset,
  readVerifiedAsset,
  assetDiskPath,
} from "../src/export/index.js";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmV8AAAAASUVORK5CYII=",
  "base64",
);
const safeSvg = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30" viewBox="0 0 40 30"><title>A safe graphic</title><rect x="0" y="0" width="40" height="30" fill="#225544"/></svg>',
);
function temp() {
  return mkdtempSync(join(tmpdir(), "vds export 日本語 "));
}
const enabled = existsSync(chromium.executablePath());

test("generic templates validate and retain native content, fresh identity and explicit links", () => {
  for (const template of templates) {
    const a = createDocument("Example", template.id),
      b = createDocument("Other", template.id);
    assert.notEqual(a.id, b.id);
    assert.notEqual(a.pages[0].id, b.pages[0].id);
    assert.equal(Object.keys(a.assets).length, 0);
  }
  assert.equal(createDocument("Brochure", "brochure").pages.length, 3);
  assert.equal(createDocument("Report", "report").pages.length, 2);
  assert.throws(() => createDocument("Invalid", "unknown"));
});
test("imports content-addressed raster and safe SVG; bytes remain immutable", () => {
  const root = temp();
  try {
    const a = importAsset(png, "Small image", root);
    assert.equal(a.mime, "image/png");
    assert.deepEqual(readVerifiedAsset(a, root), png);
    assert.equal(importAsset(png, "Same bytes", root).id, a.id);
    const svg = importAsset(safeSvg, "Vector art", root);
    assert.equal(svg.mime, "image/svg+xml");
    assert.ok(readVerifiedAsset(svg, root).includes(Buffer.from("rect")));
    writeFileSync(assetDiskPath(root, a.id), "corrupt");
    assert.throws(
      () => importAsset(png, "Small image", root),
      /corrupt|integrity/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("rejects executable SVG, external fetches, declarations, malformed content and unknown attributes", () => {
  const root = temp();
  try {
    for (const body of [
      "<script>alert(1)</script>",
      "<foreignObject><div>bad</div></foreignObject>",
      '<image href="https://evil.invalid/image.png"/>',
      '<rect width="1" height="1" onclick="alert(1)"/>',
      '<rect width="1" style="fill:url(https://evil.invalid/x)"/>',
      '<rect fill="url(https://evil.invalid/x)"/>',
      '<animate attributeName="x"/>',
      '<a href="javascript:alert(1)"><rect/></a>',
    ])
      assert.throws(
        () =>
          importAsset(
            Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="30">${body}</svg>`,
            ),
            "Unsafe",
            root,
          ),
        /SVG/,
      );
    assert.throws(() =>
      importAsset(
        Buffer.from(
          '<!DOCTYPE svg [<!ENTITY ex SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&ex;</svg>',
        ),
        "DTD",
        root,
      ),
    );
    assert.throws(() =>
      importAsset(
        Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><g></svg>'),
        "Broken",
        root,
      ),
    );
    assert.throws(() =>
      importAsset(Buffer.from("<html>no</html>"), "HTML", root),
    );
    assert.equal(readdirSync(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("rejects image bombs, truncation, invalid asset paths and symlinks", () => {
  const root = temp();
  try {
    const bomb = Buffer.from(png);
    bomb.writeUInt32BE(100000, 16);
    assert.throws(() => importAsset(bomb, "Bomb", root), /dimensions/);
    assert.throws(() => importAsset(png.subarray(0, 30), "Truncated", root));
    assert.throws(() => assetDiskPath(root, "../../private"));
    const asset = importAsset(png, "Image", root);
    rmSync(assetDiskPath(root, asset.id));
    const elsewhere = join(root, "source");
    writeFileSync(elsewhere, png);
    try {
      symlinkSync(elsewhere, assetDiskPath(root, asset.id));
      assert.throws(() => readVerifiedAsset(asset, root), /corrupt/);
    } catch (error: any) {
      if (error.code !== "EPERM") throw error;
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("portable editable bundle round-trips in a fresh workspace with new document identity", async () => {
  const root = temp();
  try {
    const assets = join(root, "assets"),
      doc = createDocument("Shared project", "service-sheet");
    const asset = importAsset(safeSvg, "Approved vector", assets);
    doc.assets[asset.id] = asset;
    doc.pages[0].elements.push({
      id: "test_image",
      type: "image",
      name: "Graphic",
      x: 50,
      y: 50,
      width: 40,
      height: 30,
      style: {},
      assetId: asset.id,
    });
    doc.revision = 7;
    const out = await exportDocument(doc, "bundle", assets, join(root, "out"));
    const bytes = readFileSync(out.path);
    const restored = importBundle(bytes, join(root, "fresh assets"));
    assert.notEqual(restored.id, doc.id);
    assert.equal(restored.revision, 0);
    assert.deepEqual(restored.pages, doc.pages);
    assert.deepEqual(restored.assets, doc.assets);
    assert.deepEqual(
      readVerifiedAsset(restored.assets[asset.id], join(root, "fresh assets")),
      readVerifiedAsset(asset, assets),
    );
    assert.doesNotMatch(bytes.toString(), /bearer|localhost|\.local\/|token/i);
    const edited = structuredClone(restored);
    edited.pages[0].elements.find((e) => e.type === "text")!.text =
      "Still editable";
    assert.ok(
      edited.pages[0].elements.some((e) => e.text === "Still editable"),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("bundle import rejects mismatched hashes, IDs, executable fields and missing assets before writes", async () => {
  const root = temp();
  try {
    const assets = join(root, "assets"),
      doc = createDocument("Portable");
    const asset = importAsset(png, "Image", assets);
    doc.assets[asset.id] = asset;
    const out = await exportDocument(doc, "bundle", assets, root);
    const base = JSON.parse(readFileSync(out.path, "utf8"));
    for (const change of [
      (b: any) => (b.assets[0].id = "../../escape"),
      (b: any) => (b.document.assets[asset.id].sha256 = "0".repeat(64)),
      (b: any) => b.assets.push(b.assets[0]),
      (b: any) => b.assets.splice(0),
      (b: any) => (b.document.script = "alert(1)"),
      (b: any) =>
        b.document.pages[0].elements.push({
          id: "bad",
          type: "text",
          name: "Bad",
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          style: { background: "url(https://example.com)" },
          text: "Unsafe",
        }),
    ]) {
      const bad = structuredClone(base);
      change(bad);
      const target = join(root, "unwritten");
      assert.throws(() =>
        importBundle(Buffer.from(JSON.stringify(bad)), target),
      );
      assert.ok(!existsSync(target) || readdirSync(target).length === 0);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("standalone HTML embeds fonts, escapes text and retains link destinations with a strict CSP", () => {
  const doc = createDocument("Escaped <script>", "service-sheet");
  doc.pages[0].elements.find((e) => e.type === "text")!.text =
    '<script>alert("bad")</script>';
  const html = renderHtml(doc, () => {
    throw new Error("No assets expected");
  });
  assert.match(html, /data:font\/woff2;base64/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Content-Security-Policy/);
  assert.match(html, /href="https:\/\/example.com\/contact"/);
  assert.doesNotMatch(html, /src="https?:/);
  assert.doesNotMatch(html, /url\('\/assets\/fonts/);
});
test(
  "browser export verifies native PDF fonts, mixed page sizes, page count, links and stable revision",
  { skip: !enabled },
  async () => {
    const root = temp();
    try {
      const doc = createDocument("Saved revision", "service-sheet");
      doc.revision = 12;
      doc.pages.push({
        ...structuredClone(doc.pages[0]),
        id: "second_page",
        name: "Smaller second page",
        width: 500,
        height: 500,
        elements: [],
      });
      const task = exportDocument(doc, "pdf", join(root, "assets"), root);
      doc.name = "New live name";
      doc.revision = 13;
      doc.pages[0].elements = [];
      const out = await task;
      assert.equal(out.diagnostics.revision, 12);
      assert.equal(out.diagnostics.pageCount, 2);
      assert.ok(out.diagnostics.fonts.every((f) => f.loaded));
      assert.ok(
        out.diagnostics.links.some(
          (l) => l.href === "https://example.com/contact",
        ),
      );
      assert.deepEqual(out.diagnostics.overflow, []);
      const pdf = await PDFDocument.load(readFileSync(out.path));
      assert.equal(pdf.getPageCount(), 2);
      assert.ok(Math.abs(pdf.getPage(0).getWidth() - 794 * 0.75) < 1);
      assert.ok(Math.abs(pdf.getPage(0).getHeight() - 1123 * 0.75) < 1);
      assert.equal(pdf.getPage(1).getWidth(), 375);
      assert.equal(pdf.getPage(1).getHeight(), 375);
      assert.equal(pdf.getTitle(), "Saved revision");
      const first = pdf.getPage(0);
      assert.ok(first.node.lookup(PDFName.of("Annots"), PDFArray).size() > 0);
      const fonts = first.node.Resources()!.lookup(PDFName.of("Font"), PDFDict);
      assert.ok(fonts.keys().length > 0);
      const fontNames = fonts
        .values()
        .map((ref) =>
          pdf.context
            .lookup(ref, PDFDict)
            .get(PDFName.of("BaseFont"))
            ?.toString(),
        )
        .join(" ");
      assert.match(fontNames, /Inter/);
      assert.match(fontNames, /Lora/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test(
  "render diagnostics identify text overflow and PNG export produces actual image pixels",
  { skip: !enabled },
  async () => {
    const root = temp();
    try {
      const doc = createDocument("Overflow");
      doc.pages[0].elements = [
        {
          id: "overflow_text",
          type: "text",
          name: "Overflow",
          x: 760,
          y: 20,
          width: 100,
          height: 12,
          style: { fontSize: 28 },
          text: "Too much text to fit",
        },
      ];
      const out = await exportDocument(doc, "png", join(root, "assets"), root);
      assert.ok(
        out.diagnostics.overflow.some(
          (o) =>
            o.elementId === "overflow_text" &&
            o.reason.includes("outside page"),
        ),
      );
      const image = readFileSync(out.path);
      assert.ok(image.length > 1000);
      assert.equal(image.readUInt32BE(16), 794);
      assert.equal(image.readUInt32BE(20), 1123);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
test("cancelled export never publishes a partial file", async () => {
  const root = temp();
  try {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      exportDocument(
        createDocument("Cancelled"),
        "html",
        join(root, "assets"),
        root,
        { signal: controller.signal },
      ),
      /cancelled/,
    );
    assert.equal(readdirSync(root).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects symlinked asset and export directories without writing through them", async () => {
  const root = temp();
  try {
    const outside = join(root, "outside");
    mkdirSync(outside);
    const linked = join(root, "linked");
    try {
      symlinkSync(
        outside,
        linked,
        process.platform === "win32" ? "junction" : "dir",
      );
    } catch (error: any) {
      if (error.code === "EPERM") return;
      throw error;
    }
    assert.throws(
      () => importAsset(png, "Must stay local", linked),
      /symbolic links/,
    );
    await assert.rejects(
      exportDocument(createDocument("Local export"), "html", root, linked),
      /symbolic links/,
    );
    assert.deepEqual(readdirSync(outside), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
test("rich lists keep run formatting and link destinations in the shared renderer", () => {
  const doc = createDocument("Rich list");
  doc.pages[0].elements.push({
    id: "list",
    type: "text",
    name: "Rich list",
    x: 50,
    y: 50,
    width: 400,
    height: 200,
    style: { fontSize: 18 },
    list: "bullet",
    runs: [
      { text: "First item\n", bold: true },
      {
        text: "Linked second item",
        italic: true,
        href: "https://example.com/list",
      },
    ],
  });
  const html = renderHtml(doc, () => {
    throw new Error("No assets");
  });
  assert.match(html, /<ul>/);
  assert.match(html, /font-weight:700/);
  assert.match(html, /font-style:italic/);
  assert.match(html, /href="https:\/\/example.com\/list"/);
});
