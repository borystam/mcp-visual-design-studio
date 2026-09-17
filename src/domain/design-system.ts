import {
  BUILTIN_FONTS,
  DesignSystemSchema,
  DesignSystemMappingSchema,
  DomainError,
  ElementSchema,
  IdSchema,
  LIMITS,
  StyleSchema,
  TOKEN_BINDING_KEYS,
  assertSafeData,
  locateElement,
  validateDocument,
  type Asset,
  type BrandKit,
  type DesignSystem,
  type DesignSystemMapping,
  type Document,
  type Element,
  type Page,
  type TokenBindingKey,
  type TokenBindings,
} from "./model.js";
import type { Operation } from "./operations.js";

export { BaseDesignSystemSchema, DesignSystemSchema } from "./model.js";
export type {
  DesignSystem,
  DesignComponent,
  FontFace,
  DesignSystemMapping,
} from "./model.js";

const bindingTypes: Record<TokenBindingKey, string> = {
  color: "color",
  background: "color",
  borderColor: "color",
  fontFamily: "fontFamily",
  fontSize: "dimension",
  fontWeight: "fontWeight",
  lineHeight: "number",
  letterSpacing: "dimension",
  borderWidth: "dimension",
  borderRadius: "dimension",
  opacity: "number",
  padding: "dimension",
  gap: "dimension",
};
function fail(message: string): never {
  throw new DomainError("VALIDATION", message);
}

export interface UnicodeRange {
  start: number;
  end: number;
}
/** Parse the restricted, data-only CSS unicode-range grammar without evaluating CSS. */
export function parseUnicodeRanges(value: string): UnicodeRange[] {
  if (typeof value !== "string" || !value.length || value.length > 1024)
    fail("Font unicode-range must contain 1–1024 characters");
  const parts = value.split(",");
  if (parts.length > 32) fail("Font unicode-range is limited to 32 ranges");
  const ranges = parts
    .map((part) => {
      const text = part.trim();
      const interval = /^U\+([0-9A-F]{1,6})(?:-([0-9A-F]{1,6}))?$/i.exec(text);
      const wildcard = /^U\+([0-9A-F]*)(\?+)$/i.exec(text);
      let start: number, end: number;
      if (interval) {
        start = Number.parseInt(interval[1], 16);
        end = Number.parseInt(interval[2] ?? interval[1], 16);
      } else if (wildcard && wildcard[1].length + wildcard[2].length <= 6) {
        start = Number.parseInt(
          wildcard[1] + "0".repeat(wildcard[2].length),
          16,
        );
        end = Number.parseInt(wildcard[1] + "F".repeat(wildcard[2].length), 16);
      } else fail(`Invalid font unicode-range ${text || "(empty)"}`);
      if (start > end || start < 0 || end > 0x10ffff)
        fail(`Font unicode-range ${text} must be ordered within U+0–10FFFF`);
      return { start, end };
    })
    .sort((a, b) => a.start - b.start || a.end - b.end);
  for (let index = 1; index < ranges.length; index++)
    if (ranges[index].start <= ranges[index - 1].end)
      fail("Font unicode-range contains overlapping ranges");
  return ranges;
}
export function normalizeUnicodeRange(value: string): string {
  return parseUnicodeRanges(value)
    .map(
      ({ start, end }) =>
        `U+${start.toString(16).toUpperCase()}${start === end ? "" : `-${end.toString(16).toUpperCase()}`}`,
    )
    .join(", ");
}
const sameAsset = (a: Asset | undefined, b: Asset) =>
  a !== undefined &&
  (["id", "name", "mime", "bytes", "sha256"] as const).every(
    (key) => a[key] === b[key],
  );
function familyKnown(
  system: DesignSystem | undefined,
  family: string,
): boolean {
  return (
    (BUILTIN_FONTS as readonly string[]).includes(family) ||
    !!system?.fonts.some((font) => font.family === family)
  );
}

/** Alias types are explicit: aliases cannot silently coerce a color into a dimension. */
export function resolveToken(
  system: DesignSystem,
  path: string,
): string | number {
  const visited = new Set<string>();
  let current = path,
    expected: string | undefined;
  while (true) {
    if (visited.has(current)) fail(`Token alias cycle at ${current}`);
    if (visited.size >= 64)
      fail(`Token alias chain exceeds 64 entries at ${path}`);
    visited.add(current);
    const token = Object.hasOwn(system.tokens, current)
      ? system.tokens[current]
      : undefined;
    if (!token) fail(`Unknown token ${current}`);
    if (expected && token.type !== expected)
      fail(`Token alias type mismatch at ${current}: expected ${expected}`);
    expected = token.type;
    if (typeof token.value !== "object") return token.value;
    current = token.value.ref;
  }
}
function bindingValue(
  system: DesignSystem | undefined,
  key: TokenBindingKey,
  path: string,
): string | number {
  if (!system) fail(`Token binding ${path} requires a design system`);
  const token = Object.hasOwn(system.tokens, path)
    ? system.tokens[path]
    : undefined;
  if (!token) fail(`Unknown token ${path}`);
  if (token.type !== bindingTypes[key])
    fail(`Token ${path} must have type ${bindingTypes[key]} for ${key}`);
  const value = resolveToken(system, path);
  if (key === "gap") {
    if (typeof value !== "number" || value < 0 || value > 1000)
      fail(`Token ${path} is outside gap bounds`);
  } else if (!StyleSchema.safeParse({ [key]: value }).success)
    fail(`Token ${path} is outside ${key} bounds`);
  if (key === "fontFamily" && !familyKnown(system, String(value)))
    fail(`Font ${value} is not bundled or declared in this system`);
  return value;
}
function tree(
  items: Element[],
  visit: (element: Element) => void,
  depth = 0,
): void {
  if (depth > LIMITS.depth) fail("Group nesting exceeds limit");
  for (const element of items) {
    visit(element);
    if (element.children) tree(element.children, visit, depth + 1);
  }
}
function elementIssues(
  element: Element,
  system: DesignSystem | undefined,
): string[] {
  const issues: string[] = [];
  if (
    element.style.fontFamily &&
    !familyKnown(system, element.style.fontFamily)
  )
    issues.push(
      `Unknown font family ${element.style.fontFamily} on ${element.id}`,
    );
  for (const [key, path] of Object.entries(element.tokenBindings ?? {})) {
    try {
      if (key === "gap" && element.type !== "group")
        fail("Only groups may bind a gap token");
      bindingValue(system, key as TokenBindingKey, path);
    } catch (error) {
      issues.push(`${element.id}: ${(error as Error).message}`);
    }
  }
  return issues;
}
/** Called by the model schema after shape validation; never mutates its input. */
export function designSystemIssues(system: DesignSystem): string[] {
  const issues: string[] = [];
  const capture = (run: () => void) => {
    try {
      run();
    } catch (error) {
      issues.push((error as Error).message);
    }
  };
  for (const path of Object.keys(system.tokens))
    capture(() => {
      const value = resolveToken(system, path);
      if (
        system.tokens[path].type === "fontFamily" &&
        !familyKnown(system, String(value))
      )
        fail(`Unknown font family ${value} in token ${path}`);
    });
  for (const [key, asset] of Object.entries(system.assets))
    if (key !== asset.id) issues.push(`Asset key ${key} does not match its ID`);
  const faces = new Map<string, { family: string; ranges: UnicodeRange[] }[]>();
  for (const font of system.fonts) {
    const face = `${font.family.toLowerCase()}:${font.weight}:${font.style}`;
    capture(() => {
      const ranges =
        font.unicodeRange === undefined
          ? [{ start: 0, end: 0x10ffff }]
          : parseUnicodeRanges(font.unicodeRange);
      const previous = faces.get(face) ?? [];
      for (const other of previous) {
        if (other.family !== font.family)
          issues.push(
            `Use consistent font family spelling for ${font.family} subsets`,
          );
        if (
          ranges.some((range) =>
            other.ranges.some(
              (existing) =>
                range.start <= existing.end && existing.start <= range.end,
            ),
          )
        )
          issues.push(
            `Duplicate font face ${face}: unicode ranges overlap; use explicit disjoint subsets or one full face`,
          );
      }
      faces.set(face, [...previous, { family: font.family, ranges }]);
    });
    if (!system.assets[font.assetId]?.mime.startsWith("font/"))
      issues.push(`Font ${font.family} needs a font asset ${font.assetId}`);
  }
  const componentIds = new Set<string>();
  let elementCount = 0;
  for (const component of system.components) {
    if (componentIds.has(component.id))
      issues.push(`Duplicate component ID ${component.id}`);
    componentIds.add(component.id);
    for (const [variant, root] of [
      ["default", component.element],
      ...Object.entries(component.variants),
    ] as [string, Element][]) {
      const ids = new Map<string, Element>();
      capture(() =>
        tree([root], (element) => {
          if (++elementCount > LIMITS.elements)
            fail("Design system has too many component elements");
          if (ids.has(element.id))
            issues.push(
              `Duplicate template element ID ${element.id} in ${component.id}/${variant}`,
            );
          ids.set(element.id, element);
          issues.push(...elementIssues(element, system));
          if (
            element.assetId &&
            !system.assets[element.assetId]?.mime.startsWith("image/")
          )
            issues.push(
              `Unknown image asset ${element.assetId} in component ${component.id}`,
            );
        }),
      );
      for (const [name, slot] of Object.entries(component.slots)) {
        const element = ids.get(slot.elementId);
        if (!element || element.type !== slot.type)
          issues.push(
            `Slot ${component.id}/${name} must target a ${slot.type} element in variant ${variant}`,
          );
      }
    }
  }
  for (const [role, path] of Object.entries(system.roles ?? {}))
    capture(() => {
      bindingValue(
        system,
        role.endsWith("Font") ? "fontFamily" : "color",
        path,
      );
    });
  return issues;
}
export function documentDesignSystemIssues(doc: Document): string[] {
  const issues: string[] = [];
  const system = doc.designSystem;
  if (system)
    for (const asset of Object.values(system.assets))
      if (!sameAsset(doc.assets[asset.id], asset))
        issues.push(
          `Design system asset ${asset.id} is missing or differs from document metadata`,
        );
  const visit = (element: Element) => {
    issues.push(...elementIssues(element, system));
    const source = element.componentSource;
    // Provenance from an older system release stays attached to editable copies.
    if (
      source &&
      system &&
      source.systemId === system.id &&
      source.systemVersion === system.version
    ) {
      const component = system.components.find(
        (c) => c.id === source.componentId,
      );
      if (
        !component ||
        (source.variant !== undefined &&
          !Object.hasOwn(component.variants, source.variant))
      )
        issues.push(
          `Unknown component source ${source.componentId}/${source.variant ?? "default"}`,
        );
    }
  };
  try {
    for (const page of doc.pages) {
      if (page.backgroundToken)
        try {
          bindingValue(system, "background", page.backgroundToken);
        } catch (error) {
          issues.push(`${page.id}: ${(error as Error).message}`);
        }
      tree(page.elements, visit);
    }
    tree(doc.brand.components, visit);
  } catch (error) {
    issues.push((error as Error).message);
  }
  for (const family of Object.values(doc.brand.fonts))
    if (!familyKnown(system, family))
      issues.push(`Unknown brand font family ${family}`);
  return issues;
}
export function validateDesignSystem(input: unknown): DesignSystem {
  assertSafeData(input);
  const parsed = DesignSystemSchema.safeParse(input);
  if (!parsed.success)
    throw new DomainError(
      "VALIDATION",
      parsed.error.issues
        .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
        .join("; "),
    );
  return parsed.data;
}

/** Stable content identity: object key order is immaterial, array order is semantic. */
export function canonicalDesignSystem(system: DesignSystem): string {
  const sort = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(sort);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value)
          .filter(([, item]) => item !== undefined)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, sort(item)]),
      );
    return value;
  };
  return JSON.stringify(sort(validateDesignSystem(system)));
}

/** Resolve semantic references into a copy; persisted literals remain useful fallbacks. */
export function resolveElementTokens(
  element: Element,
  system?: DesignSystem,
): Element {
  const result = structuredClone(element);
  const visit = (item: Element) => {
    for (const [key, path] of Object.entries(item.tokenBindings ?? {})) {
      const value = bindingValue(system, key as TokenBindingKey, path);
      if (key === "gap") item.gap = value as number;
      else Object.assign(item.style, { [key]: value });
    }
  };
  tree([result], visit);
  return result;
}
export function resolvePageTokens(page: Page, system?: DesignSystem): Page {
  return {
    ...structuredClone(page),
    background: page.backgroundToken
      ? (bindingValue(system, "background", page.backgroundToken) as string)
      : page.background,
    elements: page.elements.map((element) =>
      resolveElementTokens(element, system),
    ),
  };
}
export function resolveDocument(doc: Document): Document {
  const result = structuredClone(doc);
  result.pages = doc.pages.map((page) =>
    resolvePageTokens(page, doc.designSystem),
  );
  result.brand = resolveBrandTokens(doc.brand, doc.designSystem);
  return result;
}
export function resolveBrandTokens(
  brand: BrandKit,
  system?: DesignSystem,
): BrandKit {
  const result = structuredClone(brand);
  if (system?.roles?.headingFont)
    result.fonts.heading = String(
      bindingValue(system, "fontFamily", system.roles.headingFont),
    );
  if (system?.roles?.bodyFont)
    result.fonts.body = String(
      bindingValue(system, "fontFamily", system.roles.bodyFont),
    );
  return result;
}

export function designSystemOperations(
  doc: Document,
  input: DesignSystem,
  mapping: DesignSystemMapping = {},
): Operation[] {
  const system = validateDesignSystem(input);
  assertSafeData(mapping);
  const parsed = DesignSystemMappingSchema.safeParse(mapping);
  if (!parsed.success) fail(parsed.error.message);
  const operations: Operation[] = [
    ...Object.values(system.assets).map((asset) => ({
      type: "register_asset" as const,
      asset,
    })),
  ];
  for (const [elementId, tokenBindings] of Object.entries(
    parsed.data.elements ?? {},
  )) {
    if (!locateElement(doc, elementId))
      fail(`Unknown mapping element ${elementId}`);
    operations.push({
      type: "update_element",
      elementId,
      patch: { tokenBindings },
    });
  }
  for (const [pageId, backgroundToken] of Object.entries(
    parsed.data.pages ?? {},
  )) {
    if (!doc.pages.some((page) => page.id === pageId))
      fail(`Unknown mapping page ${pageId}`);
    operations.push({
      type: "update_page",
      pageId,
      patch: { backgroundToken },
    });
  }
  operations.push({ type: "set_document", patch: { designSystem: system } });
  if (operations.length > LIMITS.operations)
    fail(
      `Applying this system exceeds the ${LIMITS.operations}-operation batch limit`,
    );
  return operations;
}

export interface ComponentOptions {
  variant?: string;
  slots?: Record<string, string>;
  assets?: Record<string, Asset>;
  idFactory?: () => string;
}
export function instantiateComponent(
  input: DesignSystem,
  componentId: string,
  options: ComponentOptions = {},
): Element {
  const system = validateDesignSystem(input),
    component = system.components.find((c) => c.id === componentId);
  if (!component) fail(`Unknown component ${componentId}`);
  if (
    options.variant !== undefined &&
    !Object.hasOwn(component.variants, options.variant)
  )
    fail(`Unknown component variant ${options.variant}`);
  const element = structuredClone(
    options.variant === undefined
      ? component.element
      : component.variants[options.variant],
  );
  const byId = new Map<string, Element>();
  tree([element], (item) => byId.set(item.id, item));
  assertSafeData(options.slots ?? {});
  for (const [name, value] of Object.entries(options.slots ?? {})) {
    if (!Object.hasOwn(component.slots, name))
      fail(`Unknown component slot ${name}`);
    const slot = component.slots[name],
      target = byId.get(slot.elementId)!;
    if (typeof value !== "string") fail(`Slot ${name} must be a string`);
    if (slot.type === "text") {
      if (value.length > LIMITS.text) fail(`Slot ${name} exceeds text limit`);
      target.text = value;
      delete target.runs;
    } else {
      const asset = options.assets?.[value] ?? system.assets[value];
      if (!asset?.mime.startsWith("image/"))
        fail(`Slot ${name} needs an existing image asset`);
      target.assetId = value;
    }
  }
  const ids = new Set<string>(),
    idFactory = options.idFactory ?? (() => crypto.randomUUID());
  tree([element], (item) => {
    const id = IdSchema.parse(idFactory());
    if (ids.has(id)) fail(`Component ID factory returned duplicate ${id}`);
    ids.add(id);
    item.id = id;
  });
  element.componentSource = {
    systemId: system.id,
    systemVersion: system.version,
    componentId: component.id,
    ...(options.variant === undefined ? {} : { variant: options.variant }),
  };
  return ElementSchema.parse(element);
}

/** Explicit creation-time mapping for our own generic templates, never automatic on existing artwork. */
export function mapTemplateToSystem(
  doc: Document,
  input: DesignSystem,
): DesignSystemMapping {
  const system = validateDesignSystem(input),
    mapping: DesignSystemMapping = { elements: {}, pages: {} };
  for (const page of doc.pages) {
    if (system.roles?.pageBackground)
      mapping.pages![page.id] = system.roles.pageBackground;
    tree(page.elements, (element) => {
      const bindings: TokenBindings = {};
      for (const key of ["color", "background", "borderColor"] as const) {
        const value = element.style[key]?.toLowerCase();
        if (
          value &&
          value === doc.brand.colors.primary?.toLowerCase() &&
          system.roles?.primaryColor
        )
          bindings[key] = system.roles.primaryColor;
        else if (
          value &&
          value === doc.brand.colors.accent?.toLowerCase() &&
          system.roles?.accentColor
        )
          bindings[key] = system.roles.accentColor;
        else if (
          value &&
          value === doc.brand.colors.paper?.toLowerCase() &&
          system.roles?.pageBackground
        )
          bindings[key] = system.roles.pageBackground;
      }
      if (
        element.style.fontFamily === doc.brand.fonts.heading &&
        system.roles?.headingFont
      )
        bindings.fontFamily = system.roles.headingFont;
      else if (
        element.style.fontFamily === doc.brand.fonts.body &&
        system.roles?.bodyFont
      )
        bindings.fontFamily = system.roles.bodyFont;
      if (Object.keys(bindings).length)
        mapping.elements![element.id] = bindings;
    });
  }
  return mapping;
}

export interface DesignSystemDiagnostic {
  severity: "warning" | "error";
  code: string;
  message: string;
  elementId?: string;
  pageId?: string;
  tokenPath?: string;
}
export function checkDesignSystem(doc: Document): DesignSystemDiagnostic[] {
  const diagnostics: DesignSystemDiagnostic[] = [];
  try {
    validateDocument(doc);
  } catch (error) {
    return [
      {
        severity: "error",
        code: "INVALID_DOCUMENT",
        message: (error as Error).message,
      },
    ];
  }
  if (!doc.designSystem)
    return [
      {
        severity: "warning",
        code: "NO_DESIGN_SYSTEM",
        message: "This document has no design system.",
      },
    ];
  const resolved = resolveDocument(doc),
    rules = doc.designSystem.rules;
  for (const page of resolved.pages) {
    if (rules?.requireTokenBindings && !page.backgroundToken)
      diagnostics.push({
        severity: "warning",
        code: "LITERAL_BACKGROUND",
        message: "Page background has no semantic token binding.",
        pageId: page.id,
      });
    tree(page.elements, (element) => {
      if (
        rules?.minimumFontSize &&
        ["text", "table"].includes(element.type) &&
        (element.style.fontSize ?? 16) < rules.minimumFontSize
      )
        diagnostics.push({
          severity: "warning",
          code: "SMALL_TEXT",
          message: `Text size is below ${rules.minimumFontSize}px.`,
          pageId: page.id,
          elementId: element.id,
        });
      if (rules?.requireTokenBindings)
        for (const key of TOKEN_BINDING_KEYS) {
          const value = key === "gap" ? element.gap : element.style[key];
          if (value !== undefined && !element.tokenBindings?.[key])
            diagnostics.push({
              severity: "warning",
              code: "LITERAL_STYLE",
              message: `${key} has no semantic token binding.`,
              pageId: page.id,
              elementId: element.id,
            });
        }
      const source = element.componentSource;
      if (
        source &&
        (source.systemId !== doc.designSystem!.id ||
          source.systemVersion !== doc.designSystem!.version)
      )
        diagnostics.push({
          severity: "warning",
          code: "OLDER_COMPONENT_SOURCE",
          message: `Editable component originated in ${source.systemId}@${source.systemVersion}.`,
          pageId: page.id,
          elementId: element.id,
        });
    });
  }
  return diagnostics;
}
