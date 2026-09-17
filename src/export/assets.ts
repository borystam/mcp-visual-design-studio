import { createHash } from "node:crypto";
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  lstatSync,
  existsSync,
  openSync,
  closeSync,
  fstatSync,
  constants,
} from "node:fs";
import { resolve, join } from "node:path";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import type { Asset } from "../domain/model.js";
import { AssetSchema } from "../domain/model.js";

export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const MAX_BUNDLE_BYTES = 100 * 1024 * 1024;
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const dimensions = (width: number, height: number) => {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width < 1 ||
    height < 1 ||
    width > 10000 ||
    height > 10000 ||
    width * height > 40_000_000
  )
    throw new Error(
      "Image dimensions must be 1–10000 pixels and at most 40 megapixels",
    );
};
function validateRaster(data: Buffer): Asset["mime"] | undefined {
  if (
    data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  ) {
    if (
      data.length < 45 ||
      data.toString("ascii", 12, 16) !== "IHDR" ||
      data.readUInt32BE(8) !== 13
    )
      throw new Error("Invalid PNG header");
    dimensions(data.readUInt32BE(16), data.readUInt32BE(20));
    let offset = 8,
      ended = false,
      hasData = false;
    while (offset + 12 <= data.length) {
      const n = data.readUInt32BE(offset);
      if (n > data.length - offset - 12) throw new Error("Truncated PNG chunk");
      const kind = data.toString("ascii", offset + 4, offset + 8);
      if (["acTL", "fcTL", "fdAT"].includes(kind))
        throw new Error("Animated PNG is not supported");
      if (kind === "IDAT") hasData = true;
      if (kind === "IEND") {
        if (n !== 0 || offset + 12 !== data.length)
          throw new Error("Invalid PNG end");
        ended = true;
        break;
      }
      offset += n + 12;
    }
    if (!ended || !hasData) throw new Error("Incomplete PNG");
    return "image/png";
  }
  if (data[0] === 0xff && data[1] === 0xd8) {
    let at = 2,
      found = false;
    while (at < data.length) {
      if (data[at++] !== 0xff) throw new Error("Invalid JPEG marker");
      while (data[at] === 0xff) at++;
      const m = data[at++];
      if (m === 0xd9 || m === 0xda) break;
      if (m === 0x01 || (m >= 0xd0 && m <= 0xd7)) continue;
      if (at + 2 > data.length) throw new Error("Truncated JPEG");
      const length = data.readUInt16BE(at);
      if (length < 2 || at + length > data.length)
        throw new Error("Invalid JPEG segment");
      if (
        [
          0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd,
          0xce, 0xcf,
        ].includes(m)
      ) {
        if (length < 8) throw new Error("Invalid JPEG dimensions");
        dimensions(data.readUInt16BE(at + 5), data.readUInt16BE(at + 3));
        found = true;
      }
      at += length;
    }
    if (
      !found ||
      data[data.length - 2] !== 0xff ||
      data[data.length - 1] !== 0xd9
    )
      throw new Error("Incomplete JPEG");
    return "image/jpeg";
  }
  if (
    data.length >= 16 &&
    ["GIF87a", "GIF89a"].includes(data.toString("ascii", 0, 6))
  ) {
    const width = data.readUInt16LE(6),
      height = data.readUInt16LE(8);
    dimensions(width, height);
    let at = 13 + (data[10] & 128 ? 3 * (1 << ((data[10] & 7) + 1)) : 0),
      frames = 0,
      ended = false;
    const blocks = () => {
      while (at < data.length) {
        const size = data[at++];
        if (!size) return;
        if (at + size > data.length) throw new Error("Truncated GIF data");
        at += size;
      }
      throw new Error("Truncated GIF block");
    };
    while (at < data.length) {
      const tag = data[at++];
      if (tag === 0x3b) {
        ended = at === data.length;
        break;
      }
      if (tag === 0x21) {
        if (at >= data.length) throw new Error("Invalid GIF extension");
        at++;
        blocks();
      } else if (tag === 0x2c) {
        if (++frames > 1) throw new Error("Animated GIF is not supported");
        if (at + 9 > data.length) throw new Error("Truncated GIF frame");
        const x = data.readUInt16LE(at),
          y = data.readUInt16LE(at + 2),
          w = data.readUInt16LE(at + 4),
          h = data.readUInt16LE(at + 6),
          packed = data[at + 8];
        dimensions(w, h);
        if (x + w > width || y + h > height)
          throw new Error("GIF frame exceeds canvas");
        at += 9 + (packed & 128 ? 3 * (1 << ((packed & 7) + 1)) : 0);
        if (data[at] < 2 || data[at] > 8)
          throw new Error("Invalid GIF encoding");
        at++;
        blocks();
      } else throw new Error("Invalid GIF block");
    }
    if (!ended || frames !== 1) throw new Error("Incomplete GIF");
    return "image/gif";
  }
  if (
    data.length >= 30 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    if (data.readUInt32LE(4) + 8 !== data.length)
      throw new Error("Invalid WebP length");
    const codec = data.toString("ascii", 12, 16);
    if (codec === "VP8X") {
      dimensions(1 + data.readUIntLE(24, 3), 1 + data.readUIntLE(27, 3));
      if (data[20] & 2) throw new Error("Animated WebP is not supported");
    } else if (codec === "VP8 ") {
      if (!data.subarray(23, 26).equals(Buffer.from([157, 1, 42])))
        throw new Error("Invalid WebP frame");
      dimensions(data.readUInt16LE(26) & 16383, data.readUInt16LE(28) & 16383);
    } else if (codec === "VP8L") {
      if (data[20] !== 0x2f) throw new Error("Invalid WebP lossless frame");
      const bits = data.readUInt32LE(21);
      dimensions((bits & 16383) + 1, ((bits >>> 14) & 16383) + 1);
    } else throw new Error("Unsupported WebP codec");
    return "image/webp";
  }
}
const svgNodes = new Set([
  "svg",
  "g",
  "path",
  "rect",
  "circle",
  "ellipse",
  "line",
  "polyline",
  "polygon",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "title",
  "desc",
]);
const numericAttrs = new Set([
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "width",
  "height",
  "stroke-width",
  "stroke-miterlimit",
  "opacity",
  "fill-opacity",
  "stroke-opacity",
  "offset",
  "stop-opacity",
  "fx",
  "fy",
]);
const num = "[-+]?(?:[0-9]+(?:\\.[0-9]*)?|\\.[0-9]+)(?:[eE][-+]?[0-9]+)?";
const numberRE = new RegExp(`^${num}%?$`);
const numberListRE = new RegExp(`^${num}(?:[ ,]+${num})*$`);
const paintRE =
  /^(?:#[a-fA-F0-9]{3,8}|none|transparent|currentColor|black|white|red|green|blue|gray|grey|yellow|orange|purple|url\(#[A-Za-z][A-Za-z0-9_-]{0,99}\))$/;
function safeSvg(data: Buffer): Buffer {
  if (data.length > 1024 * 1024)
    throw new Error("SVG files are limited to 1 MiB");
  const input = new TextDecoder("utf-8", { fatal: true }).decode(data);
  if (/<!DOCTYPE|<!ENTITY|<\?/i.test(input.replace(/^\s*<\?xml\s[^?]*\?>/, "")))
    throw new Error(
      "SVG declarations and processing instructions are prohibited",
    );
  let invalid = false;
  const doc = new DOMParser({
    onError: () => {
      invalid = true;
    },
  }).parseFromString(input, "image/svg+xml");
  if (invalid || !doc.documentElement || doc.documentElement.tagName !== "svg")
    throw new Error("Invalid SVG document");
  let count = 0;
  const inspect = (node: globalThis.Node | any, depth: number) => {
    if (++count > 10000 || depth > 20) throw new Error("SVG is too complex");
    if (node.nodeType === 3) {
      if (
        node.parentNode?.nodeName !== "title" &&
        node.parentNode?.nodeName !== "desc" &&
        node.nodeValue.trim()
      )
        throw new Error("Unexpected SVG text");
      return;
    }
    if (node.nodeType === 8) {
      node.parentNode.removeChild(node);
      return;
    }
    if (
      node.nodeType !== 1 ||
      !svgNodes.has(node.tagName) ||
      node.namespaceURI !== "http://www.w3.org/2000/svg"
    )
      throw new Error("SVG contains a prohibited element or namespace");
    for (const attr of Array.from(node.attributes) as any[]) {
      const k = attr.name,
        v = attr.value;
      let ok = false;
      if (k === "xmlns")
        ok = node === doc.documentElement && v === "http://www.w3.org/2000/svg";
      else if (k === "id") ok = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/.test(v);
      else if (numericAttrs.has(k))
        ok = numberRE.test(v) && Math.abs(Number(v.replace("%", ""))) < 100000;
      else if (k === "viewBox")
        ok = numberListRE.test(v) && v.trim().split(/[ ,]+/).length === 4;
      else if (k === "d")
        ok =
          v.length <= 200000 && /^[MmZzLlHhVvCcSsQqTtAa0-9eE.,+\-\s]+$/.test(v);
      else if (k === "points" || k === "stroke-dasharray")
        ok = numberListRE.test(v);
      else if (["fill", "stroke", "stop-color", "color"].includes(k))
        ok = paintRE.test(v);
      else if (k === "transform" || k === "gradientTransform")
        ok =
          /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\([-+0-9eE.,\s]+\)\s*)+$/.test(
            v,
          );
      else if (k === "clip-path")
        ok = /^url\(#[A-Za-z][A-Za-z0-9_-]{0,99}\)$/.test(v);
      else if (k === "fill-rule" || k === "clip-rule")
        ok = /^(nonzero|evenodd)$/.test(v);
      else if (k === "stroke-linecap") ok = /^(butt|round|square)$/.test(v);
      else if (k === "stroke-linejoin") ok = /^(miter|round|bevel)$/.test(v);
      else if (k === "gradientUnits" || k === "clipPathUnits")
        ok = /^(userSpaceOnUse|objectBoundingBox)$/.test(v);
      else if (k === "spreadMethod") ok = /^(pad|reflect|repeat)$/.test(v);
      else if (k === "preserveAspectRatio")
        ok =
          /^(none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max)(?: (?:meet|slice))?)$/.test(
            v,
          );
      if (!ok) throw new Error(`SVG attribute is prohibited or invalid: ${k}`);
    }
    for (const child of Array.from(node.childNodes)) inspect(child, depth + 1);
  };
  inspect(doc.documentElement, 0);
  for (const child of Array.from(doc.childNodes))
    if (
      child !== doc.documentElement &&
      child.nodeType !== 8 &&
      !(child.nodeType === 3 && !child.nodeValue?.trim())
    )
      throw new Error("Unexpected SVG document content");
  const root = doc.documentElement,
    view = (root.getAttribute("viewBox") ?? "")
      .trim()
      .split(/[ ,]+/)
      .map(Number);
  dimensions(
    Number(root.getAttribute("width") || view[2] || 300),
    Number(root.getAttribute("height") || view[3] || 150),
  );
  return Buffer.from(
    new XMLSerializer().serializeToString(doc.documentElement),
  );
}
export function inspectAsset(data: Buffer): {
  data: Buffer;
  mime: Asset["mime"];
  sha256: string;
} {
  if (
    !Buffer.isBuffer(data) ||
    data.length === 0 ||
    data.length > MAX_ASSET_BYTES
  )
    throw new Error("Asset must contain 1 byte–20 MiB");
  const mime = validateRaster(data);
  if (mime) return { data, mime, sha256: hash(data) };
  if (
    /^\s*(?:<\?xml[^?]*\?>\s*)?<svg[\s>]/.test(data.toString("utf8", 0, 1024))
  ) {
    const safe = safeSvg(data);
    return { data: safe, mime: "image/svg+xml", sha256: hash(safe) };
  }
  throw new Error(
    "Supported image formats: PNG, JPEG, WebP, GIF, or a safe SVG",
  );
}
export function safeDirectory(directory: string, create = false): void {
  if (create) mkdirSync(directory, { recursive: true, mode: 0o700 });
  const stat = lstatSync(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink())
    throw new Error("Asset and export directories must not be symbolic links");
}
export function assetDiskPath(assetsDir: string, id: string): string {
  if (!/^asset_[a-f0-9]{64}$/.test(id))
    throw new Error("Invalid content-addressed asset ID");
  return join(resolve(assetsDir), id);
}
export function readVerifiedAsset(asset: Asset, assetsDir: string): Buffer {
  safeDirectory(assetsDir);
  const path = assetDiskPath(assetsDir, asset.id);
  const st = lstatSync(path);
  if (!st.isFile() || st.isSymbolicLink() || st.size !== asset.bytes)
    throw new Error(`Missing or corrupt asset: ${asset.name}`);
  const fd = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let data: Buffer;
  try {
    const actual = fstatSync(fd);
    if (!actual.isFile() || actual.size !== asset.bytes)
      throw new Error(`Missing or corrupt asset: ${asset.name}`);
    data = readFileSync(fd);
  } finally {
    closeSync(fd);
  }
  if (hash(data) !== asset.sha256 || asset.id !== `asset_${asset.sha256}`)
    throw new Error(`Asset integrity check failed: ${asset.name}`);
  return data;
}
export function importAsset(
  data: Buffer,
  name: string,
  assetsDir: string,
): Asset {
  const checked = inspectAsset(data);
  const asset = AssetSchema.parse({
    id: `asset_${checked.sha256}`,
    name,
    mime: checked.mime,
    bytes: checked.data.length,
    sha256: checked.sha256,
  });
  safeDirectory(assetsDir, true);
  const path = assetDiskPath(assetsDir, asset.id);
  if (existsSync(path)) {
    readVerifiedAsset(asset, assetsDir);
  } else {
    try {
      writeFileSync(path, checked.data, { flag: "wx", mode: 0o600 });
    } catch (error: any) {
      if (error.code !== "EEXIST") throw error;
      readVerifiedAsset(asset, assetsDir);
    }
  }
  return asset;
}
