import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { inflateSync } from "node:zlib";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "playwright";
import { PDFDocument, PDFDict, PDFName, PDFArray } from "pdf-lib";
import { createDocument } from "../src/domain/templates.js";
import {
  validateDocument,
  type Document,
  type DesignSystem,
} from "../src/domain/model.js";
import { PageView } from "../src/render/DocumentView.js";
import { customFontCss, scopedFontFamily } from "../src/render/fonts.js";
import {
  exportDocument,
  importAsset,
  importBundle,
  inspectFontMetadata,
  readVerifiedAsset,
  renderHtml,
} from "../src/export/index.js";
import { inspectAsset } from "../src/export/assets.js";

const inter = readFileSync(
  new URL("../assets/fonts/inter-latin-400-normal.woff2", import.meta.url),
);
const lora = readFileSync(
  new URL("../assets/fonts/lora-latin-400-normal.woff2", import.meta.url),
);
const woff = readFileSync(
  new URL(
    "../node_modules/@fontsource/inter/files/inter-latin-400-normal.woff",
    import.meta.url,
  ),
);
const enabled = existsSync(chromium.executablePath());
const temp = () => mkdtempSync(join(tmpdir(), "vds fonts 日本語 "));

// Reconstruct the licensed Inter SFNT from its WOFF container, with original table checksums.
function sfntFromWoff(data: Buffer): Buffer {
  const count = data.readUInt16BE(12),
    out = Buffer.alloc(data.readUInt32BE(16));
  data.copy(out, 0, 4, 8);
  out.writeUInt16BE(count, 4);
  const power = 2 ** Math.floor(Math.log2(count));
  out.writeUInt16BE(power * 16, 6);
  out.writeUInt16BE(Math.log2(power), 8);
  out.writeUInt16BE(count * 16 - power * 16, 10);
  let offset = 12 + count * 16;
  for (let i = 0; i < count; i++) {
    const source = 44 + i * 20,
      target = 12 + i * 16;
    const at = data.readUInt32BE(source + 4),
      length = data.readUInt32BE(source + 8),
      original = data.readUInt32BE(source + 12);
    data.copy(out, target, source, source + 4);
    data.copy(out, target + 4, source + 16, source + 20);
    out.writeUInt32BE(offset, target + 8);
    out.writeUInt32BE(original, target + 12);
    const raw =
      length < original
        ? inflateSync(data.subarray(at, at + length))
        : data.subarray(at, at + length);
    raw.copy(out, offset);
    offset += Math.ceil(original / 4) * 4;
  }
  return out;
}
function customDocument(root: string, bytes = inter): Document {
  const asset = importAsset(bytes, "Licensed custom font", root);
  const doc = createDocument("Custom font proof", "blank");
  const system: DesignSystem = {
    id: "system_custom",
    name: "Example studio",
    version: "1.0.0",
    fonts: [
      {
        family: "Studio Custom",
        assetId: asset.id,
        weight: 400,
        style: "normal",
        license: "SIL Open Font License 1.1",
      },
    ],
    assets: { [asset.id]: asset },
    components: [],
    guidelines: [],
    sources: [],
    tokens: {
      "color.ink": { type: "color", value: "#173F38" },
      "color.paper": { type: "color", value: "#FBF5EA" },
      "type.body": { type: "fontFamily", value: "Studio Custom" },
      "type.size": { type: "dimension", value: 32 },
    },
    roles: { bodyFont: "type.body", headingFont: "type.body" },
  };
  doc.designSystem = system;
  doc.assets = { [asset.id]: asset };
  doc.pages[0].width = 600;
  doc.pages[0].height = 300;
  doc.pages[0].backgroundToken = "color.paper";
  doc.pages[0].elements = [
    {
      id: "custom_text",
      type: "text",
      name: "Editable custom type",
      x: 30,
      y: 40,
      width: 540,
      height: 200,
      style: { fontSize: 12, color: "#000000", lineHeight: 1.3 },
      tokenBindings: { color: "color.ink", fontSize: "type.size" },
      text: "Custom studio typography.\nNative editable text, 123.",
    },
  ];
  return validateDocument(doc);
}

test("imports licensed WOFF2, WOFF and reconstructed TTF with bounded metadata", () => {
  const ttf = sfntFromWoff(woff);
  for (const [bytes, mime] of [
    [inter, "font/woff2"],
    [woff, "font/woff"],
    [ttf, "font/ttf"],
  ] as const) {
    assert.equal(inspectAsset(bytes).mime, mime);
    const metadata = inspectFontMetadata(bytes);
    assert.equal(metadata.family, "Inter");
    assert.equal(metadata.weight, 400);
    assert.equal(metadata.style, "normal");
    assert.equal(metadata.postscriptName, "Inter-Regular");
  }
  assert.equal(inspectFontMetadata(lora).family, "Lora");
});

test("font import rejects truncation, decompression bombs, table overlap, external glyph containers and invalid names", () => {
  const ttf = sfntFromWoff(woff);
  const changed = (bytes: Buffer, mutate: (copy: Buffer) => void) => {
    const copy = Buffer.from(bytes);
    mutate(copy);
    return copy;
  };
  const nameDirectory = Array.from(
    { length: ttf.readUInt16BE(4) },
    (_, i) => 12 + i * 16,
  ).find((at) => ttf.toString("ascii", at, at + 4) === "name")!;
  const invalid = [
    inter.subarray(0, 30),
    woff.subarray(0, woff.length - 1),
    ttf.subarray(0, 32),
    Buffer.from("OTTO"),
    Buffer.from("ttcf"),
    changed(inter, (copy) => copy.writeUInt32BE(0x7fffffff, 16)),
    changed(inter, (copy) => copy.writeUInt16BE(257, 12)),
    changed(woff, (copy) => copy.writeUInt32BE(0xffffffff, 48)),
    changed(woff, (copy) => copy.writeUInt32BE(0x7fffffff, 56)),
    changed(ttf, (copy) => copy.writeUInt32BE(copy.readUInt32BE(20), 36)),
    changed(ttf, (copy) => copy.write("SVG ", 12, "ascii")),
    changed(ttf, (copy) => copy.writeUInt32BE(0x7fffffff, 20)),
    changed(ttf, (copy) =>
      copy.writeUInt16BE(0xffff, copy.readUInt32BE(nameDirectory + 8) + 14),
    ),
  ];
  const root = temp();
  try {
    for (const bytes of invalid)
      assert.throws(() => importAsset(bytes, "Malformed font", root));
    assert.deepEqual(readdirSync(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shared page and export renderer resolve tokens, embed custom font data and reject external font URLs", () => {
  const root = temp();
  try {
    const doc = customDocument(root),
      original = structuredClone(doc),
      face = doc.designSystem!.fonts[0];
    const resolveAsset = (id: string) =>
      `data:${doc.assets[id].mime};base64,${readVerifiedAsset(doc.assets[id], root).toString("base64")}`;
    const html = renderHtml(doc, resolveAsset);
    assert.match(html, /data:font\/woff2;base64/);
    assert.ok(html.includes(scopedFontFamily(face.family, doc.designSystem)));
    assert.match(html, /font-size:32px/);
    assert.match(html, /color:#173F38/);
    assert.match(html, /background:#FBF5EA/);
    assert.doesNotMatch(html, /file:\/\/|<script|https?:\/\/[^<]*\.woff/);
    const page = renderToStaticMarkup(
      React.createElement(PageView, {
        page: doc.pages[0],
        brand: doc.brand,
        designSystem: doc.designSystem,
        assets: doc.assets,
        assetUrl: resolveAsset,
      }),
    );
    assert.match(page, /font-size:32px/);
    assert.match(page, /background:#FBF5EA/);
    assert.ok(page.includes(scopedFontFamily(face.family, doc.designSystem)));
    assert.deepEqual(doc, original);
    assert.throws(
      () =>
        customFontCss(
          doc.designSystem,
          doc.assets,
          () => "https://remote.invalid/font.woff2",
        ),
      /local immutable asset/,
    );
    assert.throws(
      () =>
        customFontCss(
          doc.designSystem,
          doc.assets,
          () => "file:///private/font.woff2",
        ),
      /local immutable asset/,
    );
    assert.match(
      customFontCss(doc.designSystem, doc.assets, (id) => `/api/assets/${id}`),
      /src:url/,
    );
    const other = customDocument(join(root, "other"), lora);
    assert.notEqual(
      scopedFontFamily(face.family, doc.designSystem),
      scopedFontFamily(face.family, other.designSystem),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("portable bundle preserves font snapshot and editable tokens in a fresh workspace; corrupt font hashes fail before writes", async () => {
  const root = temp();
  try {
    const assets = join(root, "assets"),
      doc = customDocument(assets);
    const output = await exportDocument(
      doc,
      "bundle",
      assets,
      join(root, "out"),
    );
    const bundle = readFileSync(output.path),
      fresh = join(root, "fresh");
    const restored = importBundle(bundle, fresh);
    assert.notEqual(restored.id, doc.id);
    assert.deepEqual(restored.designSystem, doc.designSystem);
    assert.deepEqual(restored.pages, doc.pages);
    const font = Object.values(restored.assets)[0];
    assert.deepEqual(readVerifiedAsset(font, fresh), inter);
    restored.pages[0].elements[0].text = "Edited after import";
    const html = await exportDocument(
      restored,
      "html",
      fresh,
      join(root, "freshout"),
    );
    assert.match(readFileSync(html.path, "utf8"), /Edited after import/);
    const corrupted = JSON.parse(bundle.toString());
    corrupted.assets[0].data = lora.toString("base64");
    const target = join(root, "unwritten");
    assert.throws(
      () => importBundle(Buffer.from(JSON.stringify(corrupted)), target),
      /hash mismatch/,
    );
    assert.ok(!existsSync(target));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "custom faces actually load for PNG and remain embedded native PDF fonts",
  { skip: !enabled },
  async () => {
    const root = temp();
    try {
      const assets = join(root, "assets"),
        doc = customDocument(assets);
      const png = await exportDocument(doc, "png", assets, root);
      assert.ok(
        png.diagnostics.fonts.some(
          (face) => face.family === "Studio Custom" && face.loaded,
        ),
      );
      assert.deepEqual(png.diagnostics.warnings, []);
      assert.deepEqual(png.diagnostics.overflow, []);
      const image = readFileSync(png.path);
      assert.equal(image.readUInt32BE(16), 600);
      assert.equal(image.readUInt32BE(20), 300);
      assert.ok(image.length > 2000);
      const other = customDocument(assets, lora),
        alternate = await exportDocument(other, "png", assets, root);
      assert.notDeepEqual(readFileSync(alternate.path), image);
      const output = await exportDocument(doc, "pdf", assets, root);
      assert.ok(
        output.diagnostics.fonts.some(
          (face) => face.family === "Studio Custom" && face.loaded,
        ),
      );
      const pdf = await PDFDocument.load(readFileSync(output.path));
      const fonts = pdf
        .getPage(0)
        .node.Resources()!
        .lookup(PDFName.of("Font"), PDFDict);
      const native = fonts
        .values()
        .map((ref) => pdf.context.lookup(ref, PDFDict))
        .find((font) =>
          /Inter/.test(font.get(PDFName.of("BaseFont"))?.toString() ?? ""),
        );
      assert.ok(
        native,
        "Custom CSS family must embed the real Inter font in the PDF",
      );
      assert.ok(
        native.get(PDFName.of("ToUnicode")),
        "Native text needs a Unicode mapping",
      );
      const descendant = native
        .lookup(PDFName.of("DescendantFonts"), PDFArray)
        .lookup(0, PDFDict);
      const descriptor = descendant.lookup(
        PDFName.of("FontDescriptor"),
        PDFDict,
      );
      assert.ok(
        descriptor.get(PDFName.of("FontFile2")),
        "PDF must embed the TrueType font program",
      );
      const bundle = await exportDocument(doc, "bundle", assets, root);
      const fresh = join(root, "fresh"),
        imported = importBundle(readFileSync(bundle.path), fresh);
      const repeated = await exportDocument(imported, "png", fresh, root);
      assert.deepEqual(readFileSync(repeated.path), image);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "font diagnostics report unsupported custom-font characters instead of hiding fallback",
  { skip: !enabled },
  async () => {
    const root = temp();
    try {
      const doc = customDocument(root);
      doc.pages[0].elements[0].text = "Latin and 漢";
      const output = await exportDocument(doc, "png", root, root);
      const face = output.diagnostics.fonts.find(
        (font) => font.family === "Studio Custom",
      );
      assert.equal(face?.loaded, true);
      assert.ok(face?.missingGlyphs?.includes("漢"));
      assert.ok(
        output.diagnostics.warnings.some((warning) =>
          warning.includes("missing from a custom font"),
        ),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("verified immutable assets reject forged MIME metadata even with matching hashes", () => {
  const root = temp();
  try {
    const asset = importAsset(inter, "Inter", root);
    assert.throws(
      () => readVerifiedAsset({ ...asset, mime: "image/png" }, root),
      /MIME/,
    );
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmV8AAAAASUVORK5CYII=",
      "base64",
    );
    const image = importAsset(png, "Pixel", root);
    assert.throws(
      () => readVerifiedAsset({ ...image, mime: "font/woff2" }, root),
      /MIME/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test(
  "original CFF OpenType face imports and renders as native embedded OTF",
  { skip: !enabled },
  async () => {
    const root = temp();
    try {
      const otf = readFileSync(
        new URL("./fixtures/custom-outline.otf", import.meta.url),
      );
      assert.equal(inspectAsset(otf).mime, "font/otf");
      assert.equal(inspectFontMetadata(otf).family, "Studio Outline");
      const doc = customDocument(root, otf);
      doc.designSystem!.fonts[0].license = "MIT";
      doc.pages[0].elements[0].text = "A A A";
      const output = await exportDocument(doc, "pdf", root, root);
      assert.deepEqual(output.diagnostics.warnings, []);
      assert.equal(
        output.diagnostics.fonts.find((face) => face.family === "Studio Custom")
          ?.loaded,
        true,
      );
      const pdf = await PDFDocument.load(readFileSync(output.path));
      const fonts = pdf
        .getPage(0)
        .node.Resources()!
        .lookup(PDFName.of("Font"), PDFDict);
      const native = fonts
        .values()
        .map((ref) => pdf.context.lookup(ref, PDFDict))
        .find((font) =>
          /StudioOutline/.test(
            font.get(PDFName.of("BaseFont"))?.toString() ??
              font
                .lookup(PDFName.of("FontDescriptor"), PDFDict)
                .get(PDFName.of("FontName"))
                ?.toString() ??
              "",
          ),
        );
      assert.ok(native?.get(PDFName.of("ToUnicode")));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "disjoint Unicode font subsets share a family and diagnostics combine actual glyph coverage",
  { skip: !enabled },
  async () => {
    const root = temp();
    try {
      const doc = customDocument(root);
      const extendedBytes = readFileSync(
        new URL(
          "../node_modules/@fontsource/inter/files/inter-latin-ext-400-normal.woff2",
          import.meta.url,
        ),
      );
      const extended = importAsset(extendedBytes, "Inter extended Latin", root);
      doc.assets[extended.id] = extended;
      doc.designSystem!.assets[extended.id] = extended;
      doc.designSystem!.fonts[0].unicodeRange = "U+0-FF";
      doc.designSystem!.fonts.push({
        family: "Studio Custom",
        assetId: extended.id,
        weight: 400,
        style: "normal",
        unicodeRange: "U+100-24F",
      });
      doc.pages[0].elements[0].text = "A Ā";
      const validated = validateDocument(doc);
      const output = await exportDocument(validated, "png", root, root);
      assert.deepEqual(output.diagnostics.warnings, []);
      assert.equal(
        output.diagnostics.fonts.find((face) => face.family === "Studio Custom")
          ?.loaded,
        true,
      );
      const css = customFontCss(
        validated.designSystem,
        validated.assets,
        (id) => `/api/assets/${id}`,
      );
      assert.match(css, /unicode-range:U\+0-FF/);
      assert.match(css, /unicode-range:U\+100-24F/);
      const previousName = scopedFontFamily(
        "Studio Custom",
        validated.designSystem,
      );
      validated.designSystem!.fonts[1].unicodeRange = "U+180-24F";
      assert.notEqual(
        scopedFontFamily("Studio Custom", validated.designSystem),
        previousName,
      );
      const restricted = await exportDocument(validated, "png", root, root);
      assert.ok(
        restricted.diagnostics.fonts
          .find((face) => face.family === "Studio Custom")
          ?.missingGlyphs?.includes("Ā"),
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test(
  "missing-glyph checks follow Chromium weight selection instead of nearest-weight guessing",
  { skip: !enabled },
  async () => {
    const root = temp();
    try {
      const doc = customDocument(root);
      const extendedBytes = readFileSync(
        new URL(
          "../node_modules/@fontsource/inter/files/inter-latin-ext-400-normal.woff2",
          import.meta.url,
        ),
      );
      const extended = importAsset(extendedBytes, "Inter extended Latin", root);
      doc.assets[extended.id] = extended;
      doc.designSystem!.assets[extended.id] = extended;
      doc.designSystem!.fonts[0].weight = 500;
      doc.designSystem!.fonts.push({
        family: "Studio Custom",
        assetId: extended.id,
        weight: 400,
        style: "normal",
      });
      doc.pages[0].elements[0].style.fontWeight = 450;
      doc.pages[0].elements[0].text = "A Ā";
      const output = await exportDocument(doc, "png", root, root);
      const face = output.diagnostics.fonts.find(
        (font) => font.family === "Studio Custom",
      );
      assert.equal(face?.loaded, true);
      assert.equal(face?.weight, 450);
      assert.ok(
        face?.missingGlyphs?.includes("Ā"),
        "CSS selects the 500 face for 450; the 400 face must not hide its missing glyph",
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
