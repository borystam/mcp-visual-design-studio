import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  renameSync,
  rmSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID, createHash } from "node:crypto";
import { chromium, type Browser, type Page as BrowserPage } from "playwright";
import { PDFDocument } from "pdf-lib";
import { create as createFont, type Font } from "fontkit";
import { DocumentView } from "../render/DocumentView.js";
import { documentCss, fontFiles } from "../render/styles.js";
import { parseUnicodeRanges } from "../domain/design-system.js";
import {
  validateDocument,
  type Document,
  type Asset,
} from "../domain/model.js";
import {
  importAsset,
  inspectAsset,
  readVerifiedAsset,
  safeDirectory,
  MAX_BUNDLE_BYTES,
  MAX_ASSET_BYTES,
} from "./assets.js";
export {
  importAsset,
  inspectFontMetadata,
  assetDiskPath,
  readVerifiedAsset,
  MAX_ASSET_BYTES,
  MAX_BUNDLE_BYTES,
} from "./assets.js";

const fontDir = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../assets/fonts",
);
let embeddedCss: string | undefined;
function exportCss() {
  return (embeddedCss ??= fontFiles.reduce(
    (css, [, , , file]) =>
      css.replaceAll(
        `/assets/fonts/${file}`,
        `data:font/woff2;base64,${readFileSync(join(fontDir, file)).toString("base64")}`,
      ),
    documentCss,
  ));
}
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function renderHtml(
  doc: Document,
  resolveAsset: (id: string) => string,
): string {
  const checked = validateDocument(doc);
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src &#39;none&#39;; img-src &#39;self&#39; data:; font-src &#39;self&#39; data:; style-src &#39;unsafe-inline&#39;; base-uri &#39;none&#39;; form-action &#39;none&#39;"><title>' +
    escape(checked.name) +
    "</title><style>" +
    exportCss() +
    "\nbody{margin:0;padding:24px;background:#e8e8e8;}a{cursor:pointer}</style></head><body>" +
    renderToStaticMarkup(
      React.createElement(DocumentView, {
        document: checked,
        assetUrl: resolveAsset,
      }),
    ) +
    "</body></html>"
  );
}
export type ExportDiagnostics = {
  revision: number;
  pageCount: number;
  pages: { id: string; width: number; height: number }[];
  fonts: {
    family: string;
    loaded: boolean;
    weight?: number;
    style?: string;
    missingGlyphs?: string[];
  }[];
  overflow: { elementId: string; pageId: string; reason: string }[];
  images: { elementId: string; loaded: boolean }[];
  links: { href: string; text: string }[];
  warnings: string[];
};
function emptyDiagnostics(doc: Document): ExportDiagnostics {
  return {
    revision: doc.revision,
    pageCount: doc.pages.length,
    pages: doc.pages.map((p) => ({
      id: p.id,
      width: p.width,
      height: p.height,
    })),
    fonts: [],
    overflow: [],
    images: [],
    links: [],
    warnings: [],
  };
}
export async function browserHealth(): Promise<object> {
  const executable = chromium.executablePath();
  if (!existsSync(executable))
    return {
      ok: false,
      exportBrowser: false,
      message:
        "Chromium is not installed. Ordinary editing and HTML/bundle export remain available.",
      command: "mcp-visual-design-studio setup-export",
    };
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch({ headless: true, timeout: 15000 });
    return { ok: true, exportBrowser: true, version: browser.version() };
  } catch (error) {
    return {
      ok: false,
      exportBrowser: false,
      message: String(error),
      command: "mcp-visual-design-studio setup-export",
      linuxHint:
        "On Linux, run npx playwright install-deps chromium if system libraries are missing.",
    };
  } finally {
    await browser?.close();
  }
}
async function diagnose(
  page: BrowserPage,
  doc: Document,
  fontData?: Map<string, Buffer>,
): Promise<ExportDiagnostics> {
  const result = await page.evaluate(async () => {
    await document.fonts.ready;
    const used = new Map<
      string,
      {
        family: string;
        cssFamily: string;
        weight: number;
        style: string;
        characters: Set<string>;
      }
    >();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode,
        parent = node.parentElement,
        element = parent?.closest<HTMLElement>("[data-element-id]");
      if (!parent || !element || !node.textContent?.trim()) continue;
      const style = getComputedStyle(parent),
        cssFamily = style.fontFamily
          .split(",")[0]
          .trim()
          .replace(/^['"]|['"]$/g, ""),
        weight = Number(style.fontWeight) || 400;
      const declared = element.dataset.fontFamily || "Inter";
      const family =
        declared === "serif"
          ? "Lora"
          : declared === "sans-serif"
            ? "Inter"
            : declared === "monospace"
              ? "IBM Plex Mono"
              : declared;
      const key = `${cssFamily}|${weight}|${style.fontStyle}`;
      let entry = used.get(key);
      if (!entry) {
        entry = {
          family,
          cssFamily,
          weight,
          style: style.fontStyle,
          characters: new Set(),
        };
        used.set(key, entry);
      }
      for (const character of node.textContent)
        if (entry.characters.size < 4096 && !/\s/.test(character))
          entry.characters.add(character);
    }
    const fonts = await Promise.all(
      [...used.values()].map(async (entry) => {
        const sample = [...entry.characters].join(""),
          query = `${entry.style} ${entry.weight} 16px "${entry.cssFamily}"`;
        try {
          const faces = await document.fonts.load(query, sample);
          return {
            family: entry.family,
            weight: entry.weight,
            style: entry.style,
            loaded:
              faces.length > 0 &&
              faces.every((face) => face.status === "loaded") &&
              document.fonts.check(query, sample),
            loadedFaces: faces.map((face) => ({
              weight: Number(face.weight),
              style: face.style,
            })),
            sample,
          };
        } catch {
          return {
            family: entry.family,
            weight: entry.weight,
            style: entry.style,
            loaded: false,
            loadedFaces: [],
            sample,
          };
        }
      }),
    );
    const overflow: { elementId: string; pageId: string; reason: string }[] =
      [];
    for (const element of document.querySelectorAll<HTMLElement>(
      "[data-element-id]",
    )) {
      const page = element.closest<HTMLElement>("[data-page-id]")!;
      const a = element.getBoundingClientRect(),
        b = page.getBoundingClientRect();
      const reasons = [];
      if (
        a.left < b.left - 0.5 ||
        a.top < b.top - 0.5 ||
        a.right > b.right + 0.5 ||
        a.bottom > b.bottom + 0.5
      )
        reasons.push("extends outside page");
      if (
        element.scrollHeight > element.clientHeight + 1 ||
        element.scrollWidth > element.clientWidth + 1
      )
        reasons.push("content exceeds element bounds");
      if (reasons.length)
        overflow.push({
          elementId: element.dataset.elementId!,
          pageId: page.dataset.pageId!,
          reason: reasons.join("; "),
        });
    }
    const images = await Promise.all(
      Array.from(
        document.querySelectorAll<HTMLImageElement>(".vds-image img"),
      ).map(async (img) => {
        try {
          await img.decode();
        } catch {}
        return {
          elementId:
            img.closest<HTMLElement>("[data-element-id]")!.dataset.elementId!,
          loaded: img.complete && img.naturalWidth > 0,
        };
      }),
    );
    const links = Array.from(
      document.querySelectorAll<HTMLAnchorElement>(".vds-element a"),
    ).map((a) => ({ href: a.href, text: a.textContent ?? "" }));
    return { fonts, overflow, images, links };
  });
  const parsedFonts = new Map<string, Font>();
  const fonts: ExportDiagnostics["fonts"] = result.fonts.map(
    ({ sample, loadedFaces, ...entry }) => {
      const familyFaces =
        doc.designSystem?.fonts.filter(
          (face) => face.family === entry.family,
        ) ?? [];
      if (!familyFaces.length || !fontData) return entry;
      const candidates = familyFaces.filter(
        (face) => face.style === entry.style,
      );
      const matchingStyle = candidates.length ? candidates : familyFaces;
      const distance = Math.min(
        ...matchingStyle.map((face) => Math.abs(face.weight - entry.weight)),
      );
      const faces = loadedFaces.length
        ? familyFaces.filter((face) =>
            loadedFaces.some(
              (loaded) =>
                loaded.weight === face.weight && loaded.style === face.style,
            ),
          )
        : matchingStyle.filter(
            (face) => Math.abs(face.weight - entry.weight) === distance,
          );
      try {
        const coverage = faces.map((face) => {
          let font = parsedFonts.get(face.assetId);
          if (!font) {
            const bytes = fontData.get(face.assetId);
            if (!bytes) throw new Error("Missing font data");
            const parsed = createFont(bytes);
            if ("fonts" in parsed) throw new Error("Font collection");
            font = parsed;
            parsedFonts.set(face.assetId, font);
          }
          return {
            font,
            ranges: face.unicodeRange
              ? parseUnicodeRanges(face.unicodeRange)
              : undefined,
          };
        });
        const missingGlyphs = [...sample].filter((character) => {
          const point = character.codePointAt(0)!;
          return !coverage.some(
            ({ font, ranges }) =>
              (!ranges ||
                ranges.some(
                  (range) => point >= range.start && point <= range.end,
                )) &&
              font.hasGlyphForCodePoint(point),
          );
        });
        return { ...entry, ...(missingGlyphs.length ? { missingGlyphs } : {}) };
      } catch {
        return { ...entry, loaded: false };
      }
    },
  );
  return {
    ...emptyDiagnostics(doc),
    ...result,
    fonts,
    warnings: [
      ...(fonts.some((f) => !f.loaded)
        ? ["One or more fonts used by document text did not load."]
        : []),
      ...(fonts.some((f) => f.missingGlyphs?.length)
        ? [
            "Some characters are missing from a custom font and use browser fallback.",
          ]
        : []),
      ...(result.images.some((i) => !i.loaded)
        ? ["One or more images could not be decoded."]
        : []),
    ],
  };
}

function base64(data: unknown, max = MAX_ASSET_BYTES): Buffer {
  if (
    typeof data !== "string" ||
    data.length > Math.ceil(max / 3) * 4 ||
    data.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  )
    throw new Error("Invalid or oversized base64 data");
  const result = Buffer.from(data, "base64");
  if (result.length > max) throw new Error("Decoded data exceeds size limit");
  return result;
}
function keys(
  value: unknown,
  allowed: string[],
): asserts value is Record<string, unknown> {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).some((k) => !allowed.includes(k))
  )
    throw new Error("Invalid project bundle structure");
}
export function importBundle(data: Buffer, assetsDir: string): Document {
  if (data.length === 0 || data.length > MAX_BUNDLE_BYTES)
    throw new Error("Project bundle must contain 1 byte–100 MiB");
  let bundle: unknown;
  try {
    bundle = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
  } catch {
    throw new Error("Project bundle must be valid UTF-8 JSON");
  }
  keys(bundle, ["format", "version", "document", "assets"]);
  if (
    bundle.format !== "mcp-visual-design-studio" ||
    bundle.version !== 1 ||
    !Array.isArray(bundle.assets) ||
    bundle.assets.length > 1000
  )
    throw new Error("Unsupported project bundle format");
  const doc = validateDocument(bundle.document);
  const pending: { asset: Asset; data: Buffer }[] = [];
  const seen = new Set<string>();
  let total = 0;
  for (const item of bundle.assets) {
    keys(item, ["id", "data"]);
    if (
      typeof item.id !== "string" ||
      seen.has(item.id) ||
      !Object.hasOwn(doc.assets, item.id)
    )
      throw new Error("Bundle asset IDs must be unique and match the document");
    seen.add(item.id);
    const raw = base64(item.data);
    total += raw.length;
    if (total > 75 * 1024 * 1024)
      throw new Error("Bundle assets exceed 75 MiB");
    const asset = doc.assets[item.id];
    const checked = inspectAsset(raw);
    if (
      checked.data.length !== asset.bytes ||
      checked.sha256 !== asset.sha256 ||
      checked.mime !== asset.mime ||
      asset.id !== `asset_${checked.sha256}` ||
      !checked.data.equals(raw)
    )
      throw new Error(`Bundle asset metadata or hash mismatch: ${asset.name}`);
    pending.push({ asset, data: raw });
  }
  if (seen.size !== Object.keys(doc.assets).length)
    throw new Error("Bundle is missing document assets");
  // Validate the entire bundle before writing any asset. Immutable content-addressed writes are safe to retry.
  for (const { asset, data: raw } of pending)
    importAsset(raw, asset.name, assetsDir);
  const now = new Date().toISOString();
  return validateDocument({
    ...doc,
    id: `doc_${randomUUID().replaceAll("-", "")}`,
    revision: 0,
    createdAt: now,
    updatedAt: now,
  });
}
export async function exportDocument(
  input: Document,
  format: "pdf" | "png" | "html" | "bundle",
  assetsDir: string,
  outDir: string,
  options: { pageId?: string; signal?: AbortSignal } = {},
): Promise<{ filename: string; path: string; diagnostics: ExportDiagnostics }> {
  // Clone and validate at entry: callers may continue editing another revision during export.
  const original = validateDocument(structuredClone(input));
  if (!["pdf", "png", "html", "bundle"].includes(format))
    throw new Error("Unsupported export format");
  if (options.signal?.aborted) throw new Error("Export cancelled");
  const selected = options.pageId
    ? original.pages.filter((p) => p.id === options.pageId)
    : original.pages;
  if (!selected.length) throw new Error("Page does not exist");
  const doc =
    format === "bundle"
      ? original
      : {
          ...original,
          pages: selected,
          comments: original.comments.filter(
            (c) => !c.pageId || selected.some((p) => p.id === c.pageId),
          ),
        };
  // Selection is a rendering concern; anchored comments may reference other pages, so validate original only.
  const renderDoc = { ...doc, comments: [] };
  if (
    Object.values(original.assets).reduce(
      (sum, asset) => sum + asset.bytes,
      0,
    ) >
    75 * 1024 * 1024
  )
    throw new Error("Document assets exceed the 75 MiB export limit");
  const assets = new Map(
    Object.values(original.assets).map((asset) => [
      asset.id,
      { asset, data: readVerifiedAsset(asset, assetsDir) },
    ]),
  );
  const fontData = new Map(
    [...assets.values()]
      .filter(({ asset }) => asset.mime.startsWith("font/"))
      .map(({ asset, data }) => [asset.id, data]),
  );
  const resolver = (id: string) => {
    const entry = assets.get(id);
    if (!entry) throw new Error(`Missing asset ${id}`);
    return `data:${entry.asset.mime};base64,${entry.data.toString("base64")}`;
  };
  const filename = `${
    original.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "document"
  }-r${original.revision}-${randomUUID().slice(0, 8)}.${format === "bundle" ? "vds.json" : format}`;
  safeDirectory(outDir, true);
  const path = join(resolve(outDir), filename);
  const temporary = `${path}.tmp`;
  let bytes: Buffer,
    diagnostics = emptyDiagnostics(doc);
  if (format === "bundle") {
    bytes = Buffer.from(
      JSON.stringify(
        {
          format: "mcp-visual-design-studio",
          version: 1,
          document: original,
          assets: Array.from(assets.values()).map(({ asset, data }) => ({
            id: asset.id,
            data: data.toString("base64"),
          })),
        },
        null,
        2,
      ),
    );
    if (bytes.length > MAX_BUNDLE_BYTES)
      throw new Error("Project bundle exceeds the 100 MiB limit");
    diagnostics.warnings.push(
      "Portable source bundle; browser layout diagnostics are available through PNG or PDF rendering.",
    );
  } else if (format === "html") {
    bytes = Buffer.from(renderHtml(renderDoc, resolver));
    diagnostics.warnings.push(
      "Standalone HTML includes bundled fonts and assets; browser layout diagnostics are available through PNG or PDF rendering.",
    );
  } else {
    if (doc.pages.some((p) => p.width * p.height > 40_000_000))
      throw new Error(
        "Export pages are limited to 40 megapixels. Reduce the page dimensions.",
      );
    const fullWidth = Math.ceil(Math.max(...doc.pages.map((p) => p.width))),
      fullHeight = Math.ceil(
        doc.pages.reduce((n, p) => n + p.height, 0) +
          (doc.pages.length - 1) * 24,
      );
    if (
      format === "png" &&
      (fullWidth > 32767 ||
        fullHeight > 32767 ||
        fullWidth * fullHeight > 100_000_000)
    )
      throw new Error(
        "PNG is too large. Export one page using pageId or reduce dimensions.",
      );
    let browser: Browser | undefined;
    let timer: NodeJS.Timeout | undefined;
    let cancelled = false;
    const abort = () => {
      cancelled = true;
      void browser?.close();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      if (!existsSync(chromium.executablePath()))
        throw new Error(
          "Export browser is missing. Run: mcp-visual-design-studio setup-export",
        );
      browser = await chromium.launch({ headless: true, timeout: 15000 });
      if (options.signal?.aborted) throw new Error("Export cancelled");
      timer = setTimeout(abort, 90000);
      timer.unref();
      const context = await browser.newContext({
        javaScriptEnabled: false,
        serviceWorkers: "block",
        viewport: { width: Math.min(fullWidth, 10000), height: 1000 },
        deviceScaleFactor: 1,
      });
      await context.route("**/*", (route) => route.abort("blockedbyclient"));
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      if (format === "png") {
        await page.setContent(renderHtml(renderDoc, resolver), {
          waitUntil: "load",
        });
        diagnostics = await diagnose(page, doc, fontData);
        bytes = await page
          .locator(".vds-document")
          .screenshot({ type: "png", animations: "disabled", timeout: 30000 });
      } else {
        const pdf = await PDFDocument.create();
        diagnostics = emptyDiagnostics(doc);
        for (const sourcePage of doc.pages) {
          if (cancelled)
            throw new Error(
              "Export cancelled or exceeded the 90-second time limit",
            );
          await page.setContent(
            renderHtml({ ...renderDoc, pages: [sourcePage] }, resolver),
            { waitUntil: "load" },
          );
          const current = await diagnose(
            page,
            {
              ...renderDoc,
              pages: [sourcePage],
            },
            fontData,
          );
          for (const font of current.fonts)
            if (
              !diagnostics.fonts.some(
                (old) =>
                  old.family === font.family &&
                  old.weight === font.weight &&
                  old.style === font.style &&
                  old.loaded === font.loaded &&
                  JSON.stringify(old.missingGlyphs) ===
                    JSON.stringify(font.missingGlyphs),
              )
            )
              diagnostics.fonts.push(font);
          diagnostics.overflow.push(...current.overflow);
          diagnostics.images.push(...current.images);
          diagnostics.links.push(...current.links);
          diagnostics.warnings.push(...current.warnings);
          await page.emulateMedia({ media: "print" });
          const output = await page.pdf({
            width: `${sourcePage.width}px`,
            height: `${sourcePage.height}px`,
            printBackground: true,
            margin: { top: 0, right: 0, bottom: 0, left: 0 },
            scale: 1,
            tagged: true,
          });
          const part = await PDFDocument.load(output);
          if (part.getPageCount() !== 1)
            throw new Error(
              `Page ${sourcePage.name} unexpectedly produced ${part.getPageCount()} PDF pages`,
            );
          const [copy] = await pdf.copyPages(part, [0]);
          copy.setSize(sourcePage.width * 0.75, sourcePage.height * 0.75);
          pdf.addPage(copy);
        }
        pdf.setTitle(original.name);
        pdf.setCreator("MCP Visual Design Studio");
        pdf.setProducer("MCP Visual Design Studio / Chromium");
        bytes = Buffer.from(await pdf.save());
      }
      await context.close();
    } catch (error) {
      if (cancelled || options.signal?.aborted)
        throw new Error(
          "Export cancelled or exceeded the 90-second time limit",
        );
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener("abort", abort);
      await browser?.close();
    }
  }
  if (options.signal?.aborted) throw new Error("Export cancelled");
  try {
    writeFileSync(temporary, bytes, { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
  diagnostics.warnings = [...new Set(diagnostics.warnings)];
  return { filename, path, diagnostics };
}
