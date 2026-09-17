import { z } from "zod";
export type {
  MutationResult,
  HistoryEntry,
  Snapshot,
  UndoRequest,
  RestoreRequest,
} from "./store.js";
export type { Operation, Batch } from "./operations.js";

/** The document format is deliberately data-only. No arbitrary CSS or markup. */
export const LIMITS = {
  pages: 100,
  elements: 5000,
  depth: 12,
  text: 100_000,
  documentBytes: 16 * 1024 * 1024,
  operations: 500,
  imageBytes: 20 * 1024 * 1024,
} as const;
export const IdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9_-]{1,100}$/,
    "IDs must contain 1–100 letters, numbers, underscores or hyphens",
  );
export const ColorSchema = z
  .string()
  .regex(/^(?:#[0-9a-fA-F]{3,4}|#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|transparent)$/);
export const FontSchema = z.enum([
  "Inter",
  "Lora",
  "monospace",
  "sans-serif",
  "serif",
]);
const n = (min: number, max: number) => z.number().finite().min(min).max(max);
const NameSchema = z.string().trim().min(1).max(200);
const UrlSchema = z
  .string()
  .max(2048)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        ["https:", "http:", "mailto:", "tel:"].includes(url.protocol) &&
        !/[\x00-\x20]/.test(value)
      );
    } catch {
      return false;
    }
  }, "Links must be explicit http, https, mailto or tel URLs");
const TimestampSchema = z.string().datetime();
export const StyleSchema = z
  .object({
    color: ColorSchema.optional(),
    background: ColorSchema.optional(),
    fontFamily: FontSchema.optional(),
    fontSize: n(1, 1000).optional(),
    fontWeight: z
      .union([z.literal(400), z.literal(500), z.literal(600), z.literal(700)])
      .optional(),
    fontStyle: z.enum(["normal", "italic"]).optional(),
    textDecoration: z.enum(["none", "underline", "line-through"]).optional(),
    lineHeight: n(0.5, 5).optional(),
    letterSpacing: n(-20, 100).optional(),
    textAlign: z.enum(["left", "center", "right", "justify"]).optional(),
    borderColor: ColorSchema.optional(),
    borderWidth: n(0, 100).optional(),
    borderRadius: n(0, 5000).optional(),
    opacity: n(0, 1).optional(),
    padding: n(0, 1000).optional(),
  })
  .strict();
export type Style = z.infer<typeof StyleSchema>;
export const RunSchema = z
  .object({
    text: z.string().max(LIMITS.text),
    bold: z.boolean().optional(),
    italic: z.boolean().optional(),
    underline: z.boolean().optional(),
    href: UrlSchema.optional(),
  })
  .strict();
export type TextRun = z.infer<typeof RunSchema>;
export interface Element {
  id: string;
  type: "text" | "image" | "shape" | "divider" | "table" | "group";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  style: Style;
  text?: string;
  runs?: TextRun[];
  list?: "none" | "bullet" | "number";
  href?: string;
  assetId?: string;
  fit?: "cover" | "contain" | "fill";
  crop?: { x: number; y: number };
  cells?: string[][];
  layout?: "position" | "stack" | "grid";
  gap?: number;
  columns?: number;
  children?: Element[];
}
// Explicit annotation prevents recursive inference from leaking server-only types into the editor.
export const ElementSchema: z.ZodType<Element> = z.lazy(() =>
  z
    .object({
      id: IdSchema,
      type: z.enum(["text", "image", "shape", "divider", "table", "group"]),
      name: NameSchema,
      x: n(-10000, 10000),
      y: n(-10000, 10000),
      width: n(0.1, 10000),
      height: n(0.1, 10000),
      style: StyleSchema,
      text: z.string().max(LIMITS.text).optional(),
      runs: z.array(RunSchema).max(1000).optional(),
      list: z.enum(["none", "bullet", "number"]).optional(),
      href: UrlSchema.optional(),
      assetId: IdSchema.optional(),
      fit: z.enum(["cover", "contain", "fill"]).optional(),
      crop: z
        .object({ x: n(0, 100), y: n(0, 100) })
        .strict()
        .optional(),
      cells: z
        .array(z.array(z.string().max(10_000)).max(100))
        .max(500)
        .optional(),
      layout: z.enum(["position", "stack", "grid"]).optional(),
      gap: n(0, 1000).optional(),
      columns: z.number().int().min(1).max(100).optional(),
      children: z.array(ElementSchema).max(LIMITS.elements).optional(),
    })
    .strict()
    .superRefine((element, ctx) => {
      if (
        element.type !== "group" &&
        (element.children !== undefined ||
          element.layout !== undefined ||
          element.gap !== undefined ||
          element.columns !== undefined)
      )
        ctx.addIssue({
          code: "custom",
          message: "Only groups can contain children or a layout",
        });
      if (
        element.type !== "text" &&
        (element.text !== undefined ||
          element.runs !== undefined ||
          element.list !== undefined)
      )
        ctx.addIssue({
          code: "custom",
          message: "Text and rich text require a text element",
        });
      if (
        element.type !== "image" &&
        (element.assetId !== undefined ||
          element.fit !== undefined ||
          element.crop !== undefined)
      )
        ctx.addIssue({
          code: "custom",
          message: "Image properties require an image element",
        });
      if (element.type !== "table" && element.cells !== undefined)
        ctx.addIssue({
          code: "custom",
          message: "Cells require a table element",
        });
      if (
        element.cells?.some((row) => row.length !== element.cells![0]?.length)
      )
        ctx.addIssue({
          code: "custom",
          message: "Table rows must have equal cell counts",
        });
    }),
);
export const PageSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    width: n(1, 10000),
    height: n(1, 10000),
    background: ColorSchema,
    elements: z.array(ElementSchema).max(LIMITS.elements),
  })
  .strict();
export type Page = z.infer<typeof PageSchema>;
export const AssetSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    mime: z.enum([
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/gif",
      "image/svg+xml",
    ]),
    bytes: z.number().int().min(1).max(LIMITS.imageBytes),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type Asset = z.infer<typeof AssetSchema>;
export const BrandKitSchema = z
  .object({
    id: IdSchema,
    name: NameSchema,
    colors: z
      .record(IdSchema, ColorSchema)
      .refine((v) => Object.keys(v).length <= 100),
    fonts: z.object({ heading: FontSchema, body: FontSchema }).strict(),
    logoAssetId: IdSchema.optional(),
    components: z.array(ElementSchema).max(200),
  })
  .strict();
export type BrandKit = z.infer<typeof BrandKitSchema>;
export const CommentSchema = z
  .object({
    id: IdSchema,
    elementId: IdSchema.optional(),
    pageId: IdSchema.optional(),
    text: z.string().min(1).max(10000),
    author: NameSchema,
    createdAt: TimestampSchema,
    resolved: z.boolean(),
  })
  .strict();
export type Comment = z.infer<typeof CommentSchema>;
export const BaseDocumentSchema = z
  .object({
    schemaVersion: z.literal(1),
    rendererVersion: z.literal(1),
    id: IdSchema,
    name: NameSchema,
    revision: z.number().int().min(0),
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
    pages: z.array(PageSchema).min(1).max(LIMITS.pages),
    brand: BrandKitSchema,
    assets: z
      .record(IdSchema, AssetSchema)
      .refine((v) => Object.keys(v).length <= 1000),
    comments: z.array(CommentSchema).max(10000),
  })
  .strict();
export type Document = z.infer<typeof BaseDocumentSchema>;
export const DocumentSchema = BaseDocumentSchema.superRefine((doc, ctx) => {
  const ids = new Set<string>();
  const elementPages = new Map<string, string>();
  let count = 0;
  const add = (id: string) => {
    if (ids.has(id))
      ctx.addIssue({ code: "custom", message: `Duplicate ID: ${id}` });
    ids.add(id);
  };
  add(doc.id);
  add(doc.brand.id);
  const visit = (elements: Element[], depth: number, pageId?: string) => {
    if (depth > LIMITS.depth) {
      ctx.addIssue({ code: "custom", message: "Group nesting exceeds limit" });
      return;
    }
    for (const e of elements) {
      add(e.id);
      count++;
      if (pageId) elementPages.set(e.id, pageId);
      if (e.assetId && !doc.assets[e.assetId])
        ctx.addIssue({ code: "custom", message: `Unknown asset ${e.assetId}` });
      if (e.children) visit(e.children, depth + 1, pageId);
    }
  };
  for (const page of doc.pages) {
    add(page.id);
    visit(page.elements, 0, page.id);
  }
  visit(doc.brand.components, 0);
  for (const [key, asset] of Object.entries(doc.assets)) {
    add(asset.id);
    if (key !== asset.id)
      ctx.addIssue({ code: "custom", message: "Asset key must match its ID" });
  }
  if (doc.brand.logoAssetId && !doc.assets[doc.brand.logoAssetId])
    ctx.addIssue({ code: "custom", message: "Brand logo asset is missing" });
  for (const comment of doc.comments) {
    add(comment.id);
    if (comment.pageId && !doc.pages.some((p) => p.id === comment.pageId))
      ctx.addIssue({
        code: "custom",
        message: `Unknown comment page ${comment.pageId}`,
      });
    if (comment.elementId && !elementPages.has(comment.elementId))
      ctx.addIssue({
        code: "custom",
        message: `Unknown comment element ${comment.elementId}`,
      });
    if (
      comment.elementId &&
      comment.pageId &&
      elementPages.get(comment.elementId) !== comment.pageId
    )
      ctx.addIssue({
        code: "custom",
        message: "Comment page and element do not match",
      });
  }
  if (count > LIMITS.elements)
    ctx.addIssue({ code: "custom", message: "Too many elements" });
});

export class DomainError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
/** Bound untrusted recursive input before invoking Zod's recursive schemas. */
export function validateDocument(input: unknown): Document {
  assertSafeData(input);
  const result = DocumentSchema.safeParse(input);
  if (!result.success)
    throw new DomainError(
      "VALIDATION",
      result.error.issues
        .map((x) => `${x.path.join(".")}: ${x.message}`)
        .join("; "),
    );
  return result.data;
}
export function assertSafeData(input: unknown): void {
  let nodes = 0;
  const walk = (v: unknown, depth: number) => {
    if (depth > 50 || ++nodes > 300000)
      throw new DomainError("LIMIT", "Input is too deeply nested or too large");
    if (v && typeof v === "object") {
      if (
        !Array.isArray(v) &&
        Object.getPrototypeOf(v) !== Object.prototype &&
        Object.getPrototypeOf(v) !== null
      )
        throw new DomainError(
          "VALIDATION",
          "Only plain data objects are allowed",
        );
      for (const [k, val] of Object.entries(v)) {
        if (["__proto__", "prototype", "constructor"].includes(k))
          throw new DomainError("VALIDATION", "Unsafe object key");
        walk(val, depth + 1);
      }
    }
  };
  walk(input, 0);
  if (
    new TextEncoder().encode(JSON.stringify(input)).byteLength >
    LIMITS.documentBytes
  )
    throw new DomainError("LIMIT", "Document input exceeds 16 MiB");
}
export function findElement(doc: Document, id: string): Element | undefined {
  return locateElement(doc, id)?.element;
}
export interface ElementLocation {
  element: Element;
  page: Page;
  parent?: Element;
  elements: Element[];
  index: number;
}
export function locateElement(
  doc: Document,
  id: string,
): ElementLocation | undefined {
  const walk = (
    elements: Element[],
    page: Page,
    parent?: Element,
  ): ElementLocation | undefined => {
    for (let index = 0; index < elements.length; index++) {
      const element = elements[index];
      if (element.id === id) return { element, page, parent, elements, index };
      if (element.children) {
        const found = walk(element.children, page, element);
        if (found) return found;
      }
    }
  };
  for (const page of doc.pages) {
    const found = walk(page.elements, page);
    if (found) return found;
  }
}
export const documentSchema = DocumentSchema;
export const elementSchema = ElementSchema;
export const brandKitSchema = BrandKitSchema;
