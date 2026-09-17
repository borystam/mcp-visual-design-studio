import path from "node:path";
import { createHash } from "node:crypto";
import yauzl from "yauzl";
import postcss from "postcss";
import { cssColor, cssValue, tokenPath, parseStylesheet } from "./css.js";
import { parse as parseHtml } from "parse5";
import { z } from "zod";
import { validateDesignSystem, resolveToken } from "../domain/design-system.js";
import {
  assertSafeData,
  BaseDesignSystemSchema,
  type DesignSystem,
  type Asset,
  type Element,
  type Style,
} from "../domain/model.js";
import {
  importAsset,
  inspectAsset,
  inspectFontMetadata,
  MAX_BUNDLE_BYTES,
} from "../export/assets.js";
import { systemDigest } from "./library.js";
import { extractHtmlComponents, assertHtmlBounds } from "./html.js";

export const ImportRequestSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    version: z.string().max(64).optional(),
    files: z
      .array(
        z
          .object({
            name: z.string().min(1).max(300),
            data: z.string().max(140 * 1024 * 1024),
          })
          .strict(),
      )
      .max(1000)
      .optional(),
    system: z.unknown().optional(),
  })
  .strict();
export type SourceFile = { name: string; data: Buffer };
const MAX_TOTAL = 75 * 1024 * 1024;
const MAX_TOKENS = 2000;
const MAX_ALIAS_DEPTH = 64;
const text = (data: Buffer) =>
  new TextDecoder("utf-8", { fatal: true }).decode(data);
export function decodeBase64(data: string, max = MAX_BUNDLE_BYTES) {
  if (
    data.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      data,
    )
  )
    throw new Error("Invalid or oversized base64 source file.");
  return Buffer.from(data, "base64");
}
function safeName(name: string) {
  if (
    !name ||
    name.length > 300 ||
    /^[A-Za-z]:|^[/\\]|[\\\x00-\x1f\x7f]/.test(name) ||
    name.split("/").some((s) => s === ".." || s === ".")
  )
    throw new Error("Source file paths must be safe relative paths.");
  return name.normalize("NFC");
}
export async function unpackSources(
  input: SourceFile[],
): Promise<SourceFile[]> {
  const files: SourceFile[] = [],
    seen = new Set<string>();
  let total = 0;
  const add = (file: SourceFile) => {
    const name = safeName(file.name),
      key = name.toLowerCase();
    if (seen.has(key))
      throw new Error("Source archive has duplicate file paths.");
    seen.add(key);
    total += file.data.length;
    if (
      files.length >= 1000 ||
      total > MAX_TOTAL ||
      file.data.length > 20 * 1024 * 1024
    )
      throw new Error(
        "Source import exceeds file count or size limits (1,000 files, 20 MiB each, 75 MiB total).",
      );
    files.push({ name, data: file.data });
  };
  for (const file of input) {
    safeName(file.name);
    if (file.data.length > MAX_BUNDLE_BYTES)
      throw new Error("Source archive exceeds 100 MiB.");
    if (!/\.zip$/i.test(file.name)) {
      add(file);
      continue;
    }
    await new Promise<void>((resolve, reject) => {
      yauzl.fromBuffer(
        file.data,
        {
          lazyEntries: true,
          decodeStrings: true,
          validateEntrySizes: true,
          strictFileNames: true,
        },
        (err, zip) => {
          if (err || !zip)
            return reject(err || new Error("Invalid ZIP archive."));
          let count = 0,
            failed = false;
          const fail = (e: unknown) => {
            if (failed) return;
            failed = true;
            zip.close();
            reject(e);
          };
          zip.on("error", fail);
          zip.on("end", () => {
            if (!failed) resolve();
          });
          zip.on("entry", (entry: yauzl.Entry) => {
            try {
              if (++count > 1200)
                throw new Error("ZIP archive has too many entries.");
              safeName(entry.fileName.replace(/\/$/, ""));
              if (
                ((entry.externalFileAttributes >>> 16) & 0o170000) ===
                0o120000
              )
                throw new Error("ZIP symbolic links are not allowed.");
              if (entry.generalPurposeBitFlag & 1)
                throw new Error("Encrypted ZIP archives are not supported.");
              if (
                entry.uncompressedSize > 20 * 1024 * 1024 ||
                entry.uncompressedSize + total > MAX_TOTAL
              )
                throw new Error("ZIP decompressed contents exceed limits.");
              if (/\/$/.test(entry.fileName)) {
                zip.readEntry();
                return;
              }
              zip.openReadStream(entry, (err, stream) => {
                if (err || !stream)
                  return fail(err || new Error("Could not read ZIP entry."));
                const chunks: Buffer[] = [];
                let size = 0;
                stream.on("data", (chunk: Buffer) => {
                  size += chunk.length;
                  if (size > 20 * 1024 * 1024 || size + total > MAX_TOTAL) {
                    stream.destroy();
                    fail(new Error("ZIP decompressed contents exceed limits."));
                  } else chunks.push(chunk);
                });
                stream.on("error", fail);
                stream.on("end", () => {
                  if (failed) return;
                  try {
                    add({ name: entry.fileName, data: Buffer.concat(chunks) });
                    zip.readEntry();
                  } catch (e) {
                    fail(e);
                  }
                });
              });
            } catch (e) {
              fail(e);
            }
          });
          zip.readEntry();
        },
      );
    });
  }
  return files;
}
function addToken(
  system: DesignSystem,
  name: string,
  token: DesignSystem["tokens"][string],
  warnings: string[],
) {
  name = tokenPath(name);
  if (!name) return;
  if (
    !Object.hasOwn(system.tokens, name) &&
    Object.keys(system.tokens).length >= MAX_TOKENS
  )
    throw new Error("Design systems support at most 2,000 tokens.");
  if (
    Object.hasOwn(system.tokens, name) &&
    JSON.stringify(system.tokens[name]) !== JSON.stringify(token)
  ) {
    warnings.push(
      `Conflicting token ${name}: kept its first definition. Review theme-specific overrides.`,
    );
    return;
  }
  system.tokens[name] = token;
}
function dtcg(
  system: DesignSystem,
  input: unknown,
  warnings: string[],
  prefix = "",
  inherited?: string,
) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return;
  const object = input as Record<string, any>;
  const type = object.$type || inherited;
  if (
    Object.hasOwn(object, "$value") ||
    (Object.hasOwn(object, "value") && Object.hasOwn(object, "type"))
  ) {
    const value = object.$value ?? object.value,
      t = type ?? object.type;
    if (!prefix) return;
    if (t === "typography" && value && typeof value === "object") {
      for (const [key, v] of Object.entries(value))
        dtcg(
          system,
          {
            $type:
              key === "fontSize" || key === "letterSpacing"
                ? "dimension"
                : key === "fontFamily"
                  ? "fontFamily"
                  : key === "fontWeight"
                    ? "fontWeight"
                    : "number",
            $value: v,
          },
          warnings,
          `${prefix}.${key}`,
        );
      return;
    }
    let normalized: DesignSystem["tokens"][string] | undefined;
    if (typeof value === "string" && /^\{[A-Za-z0-9_.-]+\}$/.test(value))
      normalized = {
        type: [
          "color",
          "dimension",
          "number",
          "fontFamily",
          "fontWeight",
        ].includes(t)
          ? t
          : "color",
        value: { ref: tokenPath(value.slice(1, -1)) },
      };
    else if (t === "color") {
      let color = typeof value === "string" ? cssColor(value) : undefined;
      if (
        value &&
        typeof value === "object" &&
        value.colorSpace === "srgb" &&
        Array.isArray(value.components) &&
        value.components.length === 3 &&
        value.components.every(
          (n: any) =>
            typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1,
        )
      )
        color = cssColor(
          `rgb(${value.components.map((n: number) => n * 255).join(" ")} / ${value.alpha ?? 1})`,
        );
      if (color) normalized = { type: "color", value: color };
    } else if (t === "dimension") {
      if (
        (value &&
          typeof value === "object" &&
          ["rem", "em"].includes(value.unit)) ||
        (typeof value === "string" && /(?:rem|em)$/.test(value))
      )
        warnings.push(
          "DTCG rem/em dimensions use a 16px import base; review spacing and typography.",
        );
      if (
        value &&
        typeof value === "object" &&
        typeof value.value === "number" &&
        ["px", "rem", "em", "pt"].includes(value.unit)
      )
        normalized = {
          type: "dimension",
          value:
            value.value *
            { px: 1, rem: 16, em: 16, pt: 96 / 72 }[value.unit as "px"]!,
        };
      else if (typeof value === "string") normalized = cssValue(value, "size");
      else if (typeof value === "number")
        normalized = { type: "dimension", value };
    } else if (t === "fontFamily") {
      const f = Array.isArray(value) ? value[0] : value;
      if (typeof f === "string") normalized = { type: "fontFamily", value: f };
    } else if (t === "fontWeight") {
      const weights: Record<string, number> = {
        thin: 100,
        extralight: 200,
        light: 300,
        normal: 400,
        regular: 400,
        medium: 500,
        semibold: 600,
        bold: 700,
        extrabold: 800,
        black: 900,
      };
      const v =
        typeof value === "string"
          ? (weights[value.toLowerCase().replace(/[ -]/g, "")] ?? Number(value))
          : value;
      if (typeof v === "number" && Number.isFinite(v))
        normalized = { type: "fontWeight", value: v };
    } else if (t === "number" && typeof value === "number")
      normalized = { type: "number", value };
    else if (!t && typeof value === "string")
      normalized = cssValue(value, prefix);
    if (normalized) addToken(system, prefix, normalized, warnings);
    else
      warnings.push(
        `Unsupported token ${prefix} (${String(t ?? "unknown type")}); it was not silently approximated.`,
      );
    return;
  }
  for (const [key, value] of Object.entries(object))
    if (!key.startsWith("$"))
      dtcg(system, value, warnings, prefix ? `${prefix}.${key}` : key, type);
}
function portable(input: any, assetsDir: string): DesignSystem {
  if (
    input.version !== 1 ||
    Object.keys(input).some(
      (k) => !["format", "version", "system", "digest", "assets"].includes(k),
    ) ||
    !Array.isArray(input.assets)
  )
    throw new Error("Unsupported portable design system format.");
  const system = validateDesignSystem(input.system);
  if (input.digest !== systemDigest(system))
    throw new Error("Portable design system digest mismatch.");
  const pending: { asset: Asset; data: Buffer }[] = [],
    seen = new Set<string>();
  let total = 0;
  for (const item of input.assets) {
    if (
      !item ||
      Object.keys(item).some((k) => !["id", "data"].includes(k)) ||
      typeof item.data !== "string" ||
      !Object.hasOwn(system.assets, item.id) ||
      seen.has(item.id)
    )
      throw new Error("Invalid portable design system assets.");
    seen.add(item.id);
    const asset = system.assets[item.id],
      data = decodeBase64(item.data, 20 * 1024 * 1024),
      checked = inspectAsset(data);
    total += data.length;
    if (
      total > MAX_TOTAL ||
      checked.mime !== asset.mime ||
      checked.sha256 !== asset.sha256 ||
      checked.data.length !== asset.bytes ||
      asset.id !== `asset_${checked.sha256}` ||
      !checked.data.equals(data)
    )
      throw new Error(
        "Portable design system asset metadata or hash mismatch.",
      );
    pending.push({ asset, data });
  }
  if (seen.size !== Object.keys(system.assets).length)
    throw new Error("Portable design system is missing required assets.");
  for (const item of pending)
    importAsset(item.data, item.asset.name, assetsDir);
  return system;
}
export async function previewImport(input: unknown, assetsDir: string) {
  const request = ImportRequestSchema.parse(input),
    warnings: string[] = [];
  if (request.system !== undefined) {
    assertSafeData(request.system);
    const system = BaseDesignSystemSchema.parse(request.system);
    return {
      system,
      digest: systemDigest(system),
      warnings,
      report: {
        sourceFiles: [],
        ignoredFiles: [],
        executableFiles: [],
        importKind: "native",
      },
    };
  }
  if (!request.files?.length)
    throw new Error("Choose at least one source file.");
  const encodedTotal = request.files.reduce((n, f) => n + f.data.length, 0);
  if (encodedTotal > 140 * 1024 * 1024)
    throw new Error("Source files exceed the import limit.");
  if (request.files.length === 1 && /\.json$/i.test(request.files[0].name)) {
    const raw = decodeBase64(request.files[0].data);
    const parsed = JSON.parse(text(raw));
    if (parsed?.format === "mcp-visual-design-system") {
      const system = portable(parsed, assetsDir);
      return {
        system,
        digest: systemDigest(system),
        warnings,
        report: {
          sourceFiles: [safeName(request.files[0].name)],
          ignoredFiles: [],
          executableFiles: [],
          importKind: "portable",
        },
      };
    }
  }
  const files = await unpackSources(
    request.files.map((f) => ({ name: f.name, data: decodeBase64(f.data) })),
  );
  const sourceFiles: string[] = [],
    ignoredFiles: string[] = [],
    executableFiles: string[] = [],
    sourceAssets = new Map<string, Asset>(),
    cssFiles: { name: string; text: string }[] = [],
    htmlFiles: { name: string; text: string }[] = [];
  let system: DesignSystem = {
    id: `system_${createHash("sha256")
      .update(request.name ?? files.map((f) => f.name).join("|"))
      .digest("hex")
      .slice(0, 20)}`,
    name:
      request.name ??
      path.basename(request.files[0].name).replace(/\.[^.]+$/, ""),
    version: request.version ?? "1.0.0",
    tokens: {},
    fonts: [],
    components: [],
    guidelines: [],
    sources: [],
    assets: {},
    roles: {},
  };
  for (const file of files) {
    if (
      /(?:^|\/)(?:node_modules|\.git|\.env(?:\.[^/]*)?|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)(?:\/|$)/i.test(
        file.name,
      )
    ) {
      ignoredFiles.push(file.name);
      continue;
    }
    sourceFiles.push(file.name);
    if (
      /\.(?:css|html?|json|md|txt)$/i.test(file.name) &&
      file.data.length > 2 * 1024 * 1024
    )
      throw new Error("Text source files must be at most 2 MiB each.");
    if (/\.(?:woff2?|ttf|otf|png|jpe?g|webp|gif|svg)$/i.test(file.name)) {
      const asset = importAsset(file.data, path.basename(file.name), assetsDir);
      system.assets[asset.id] = asset;
      sourceAssets.set(file.name, asset);
      if (asset.mime.startsWith("font/")) {
        const face = inspectFontMetadata(file.data);
        system.fonts.push({
          family: face.family,
          assetId: asset.id,
          weight: face.weight,
          style: face.style,
        });
      }
    } else if (/\.css$/i.test(file.name))
      cssFiles.push({ name: file.name, text: text(file.data) });
    else if (/\.html?$/i.test(file.name)) {
      const html = text(file.data);
      htmlFiles.push({ name: file.name, text: html });
      const tree = parseHtml(html) as any;
      assertHtmlBounds(tree);
      const walk = (node: any) => {
        if (node.tagName === "style")
          cssFiles.push({
            name: file.name,
            text: (node.childNodes ?? [])
              .map((x: any) => x.value ?? "")
              .join(""),
          });
        for (const child of node.childNodes ?? []) walk(child);
      };
      walk(tree);
    } else if (/\.json$/i.test(file.name)) {
      const parsed = JSON.parse(text(file.data));
      if (parsed?.format === "mcp-visual-design-system") {
        if (files.length !== 1)
          warnings.push(
            "Portable design system imported as a complete package; other source files were not merged.",
          );
        const imported = portable(parsed, assetsDir);
        return {
          system: imported,
          digest: systemDigest(imported),
          warnings,
          report: {
            sourceFiles: [file.name],
            ignoredFiles: files.filter((f) => f !== file).map((f) => f.name),
            executableFiles: [],
            importKind: "portable",
          },
        };
      }
      assertSafeData(parsed);
      if (
        parsed?.id &&
        parsed?.version &&
        parsed?.tokens &&
        parsed?.components
      ) {
        const imported = BaseDesignSystemSchema.parse(parsed);
        if (files.length !== 1)
          warnings.push(
            "Native system definition takes precedence; attach its assets through a portable package.",
          );
        return {
          system: imported,
          digest: systemDigest(imported),
          warnings,
          report: {
            sourceFiles: [file.name],
            ignoredFiles: [],
            executableFiles: [],
            importKind: "native",
          },
        };
      }
      const before = Object.keys(system.tokens).length;
      dtcg(system, parsed, warnings);
      if (before === Object.keys(system.tokens).length)
        ignoredFiles.push(file.name);
    } else if (
      /\.(?:md|txt)$/i.test(file.name) &&
      /(?:guid|brand|design|readme|license|ofl)/i.test(file.name)
    )
      system.guidelines.push(`${file.name}\n${text(file.data).slice(0, 8000)}`);
    else if (/\.(?:[cm]?[jt]sx?|vue|svelte)$/i.test(file.name))
      executableFiles.push(file.name);
    else ignoredFiles.push(file.name);
  }
  const cssAliases = new Set<string>();
  const cssFontAssets = new Set<string>();
  for (const file of cssFiles) {
    const css = parseStylesheet(file.text);
    css.walkDecls((decl) => {
      if (decl.prop.startsWith("--")) {
        const token = cssValue(decl.value, decl.prop);
        if (token) {
          if (
            typeof token.value === "object" &&
            !Object.hasOwn(system.tokens, tokenPath(decl.prop))
          )
            cssAliases.add(tokenPath(decl.prop));
          addToken(system, decl.prop, token, warnings);
        } else
          warnings.push(
            `CSS variable ${decl.prop} requires review: unsupported expression.`,
          );
        if (
          /\b(?:rem|em)\b/.test(decl.value) ||
          /[\d.](?:rem|em)\b/.test(decl.value)
        )
          warnings.push(
            "CSS rem/em values use a 16px import base; review spacing and typography.",
          );
      }
    });
    css.walkAtRules("font-face", (rule) => {
      const props: Record<string, string> = {};
      rule.walkDecls((d) => {
        props[d.prop] = d.value;
      });
      let family = props["font-family"]?.replace(/^['"]|['"]$/g, "").trim(),
        src = /url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/.exec(props.src ?? "")?.[1];
      if (!family || !src) return;
      if (/^(?:https?:|\/\/|data:)/i.test(src)) {
        warnings.push(
          `External or embedded CSS font ${family} was not fetched; upload the font file.`,
        );
        return;
      }
      const asset = sourceAssets.get(
        path.posix.normalize(
          path.posix.join(path.posix.dirname(file.name), src.split(/[?#]/)[0]),
        ),
      );
      if (asset?.mime.startsWith("font/")) {
        if (!cssFontAssets.has(asset.id))
          system.fonts = system.fonts.filter((f) => f.assetId !== asset.id);
        cssFontAssets.add(asset.id);
        system.fonts.push({
          family,
          assetId: asset.id,
          weight: /^\d+$/.test(props["font-weight"] ?? "")
            ? Number(props["font-weight"])
            : 400,
          style: props["font-style"] === "italic" ? "italic" : "normal",
          ...(props["unicode-range"]
            ? { unicodeRange: props["unicode-range"] }
            : {}),
        });
      } else
        warnings.push(`Font ${family} references a missing font file: ${src}.`);
    });
  }
  // Only CSS aliases lack explicit types. Bound each walk and memoize resolved
  // types; cyclic/missing/overlong references remain editable invalid drafts.
  const inferred = new Map<string, DesignSystem["tokens"][string]["type"]>();
  const inferType = (
    name: string,
    visiting: Set<string>,
  ): DesignSystem["tokens"][string]["type"] | undefined => {
    const known = inferred.get(name);
    if (known) return known;
    const token = system.tokens[name];
    if (!token || visiting.has(name) || visiting.size >= MAX_ALIAS_DEPTH)
      return;
    if (!cssAliases.has(name) || typeof token.value !== "object") {
      inferred.set(name, token.type);
      return token.type;
    }
    visiting.add(name);
    const type = inferType(token.value.ref, visiting);
    visiting.delete(name);
    if (type) inferred.set(name, type);
    return type;
  };
  for (const name of cssAliases) {
    const type = inferType(name, new Set());
    if (type) system.tokens[name].type = type;
  }
  const allowedFonts = new Set([
    "Inter",
    "Lora",
    "monospace",
    "sans-serif",
    "serif",
    ...system.fonts.map((f) => f.family),
  ]);
  for (const [name, token] of Object.entries(system.tokens))
    if (
      token.type === "fontFamily" &&
      typeof token.value === "string" &&
      !allowedFonts.has(token.value)
    )
      warnings.push(
        `Missing font ${token.value} (${name}): upload its font file or explicitly choose a bundled replacement before saving.`,
      );
  system.components = extractHtmlComponents(
    htmlFiles,
    cssFiles,
    system,
    sourceAssets,
    warnings,
  );
  if (executableFiles.length)
    warnings.push(
      `${executableFiles.length} code file(s) were not executed or converted to editable components. Ask your connected agent to translate the relevant components into Studio's native system format.`,
    );
  if (htmlFiles.length)
    warnings.push(
      "HTML components use the supported static layout/style subset. Review their specimen; scripts, interaction and responsive behavior are not imported.",
    );
  if (
    !Object.keys(system.tokens).length &&
    !system.components.length &&
    !system.fonts.length
  )
    throw new Error(
      "No supported design tokens, fonts or static HTML components found. Import token JSON, CSS, HTML, font files or a portable Studio design system.",
    );
  const choose = (type: string, patterns: RegExp[]) =>
    Object.entries(system.tokens).find(
      ([name, t]) => t.type === type && patterns.some((p) => p.test(name)),
    )?.[0];
  const roles = system.roles!;
  roles.primaryColor = choose("color", [/primary/i, /brand/i]);
  roles.accentColor = choose("color", [/accent/i]);
  roles.pageBackground = choose("color", [/background/i, /surface/i, /paper/i]);
  roles.headingFont = choose("fontFamily", [/heading|display/i]);
  roles.bodyFont = choose("fontFamily", [/body|sans|font-family/i]);
  for (const key of Object.keys(roles) as (keyof typeof roles)[])
    if (roles[key] === undefined) delete roles[key];
  system.sources = sourceFiles
    .slice(0, 100)
    .map((name) => ({ name: name.slice(0, 200) }));
  warnings.push(
    "Role assignments are suggestions. Review primary/accent colors, page background and heading/body fonts before saving.",
  );
  const reviewed = BaseDesignSystemSchema.parse(system);
  reviewed.fonts = reviewed.fonts.filter(
    (face, index, all) =>
      all.findIndex(
        (other) => JSON.stringify(other) === JSON.stringify(face),
      ) === index,
  );
  // The review may contain unresolved font names; validation/save exposes these rather than substituting silently.
  return {
    system: reviewed,
    digest: systemDigest(reviewed),
    warnings: [...new Set(warnings)],
    report: {
      sourceFiles,
      ignoredFiles,
      executableFiles,
      importKind: htmlFiles.length
        ? "html"
        : cssFiles.length
          ? "css"
          : "tokens",
    },
  };
}
