import { z } from "zod";
import {
  AssetSchema,
  BrandKitSchema,
  ColorSchema,
  CommentSchema,
  DomainError,
  ElementSchema,
  IdSchema,
  LIMITS,
  PageSchema,
  RunSchema,
  StyleSchema,
  DesignSystemSchema,
  TokenBindingPatchSchema,
  TokenPathSchema,
  ComponentSourceSchema,
  assertSafeData,
  locateElement,
  validateDocument,
  type Document,
  type Element,
} from "./model.js";
import {
  canonicalDesignSystem,
  resolveElementTokens,
  resolvePageTokens,
} from "./design-system.js";

const index = z.number().int().min(0).max(LIMITS.elements);
const coordinate = z.number().finite().min(-10000).max(10000);
const size = z.number().finite().min(0.1).max(10000);
const name = z.string().trim().min(1).max(200);
const href = z
  .string()
  .max(2048)
  .refine((s) => {
    try {
      return (
        ["http:", "https:", "mailto:", "tel:"].includes(new URL(s).protocol) &&
        !/[\x00-\x20]/.test(s)
      );
    } catch {
      return false;
    }
  }, "Invalid hyperlink");
const nonempty = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .strict()
    .refine((v) => Object.keys(v).length > 0, "Patch cannot be empty");
export const ElementPatchSchema = nonempty({
  name: name.optional(),
  x: coordinate.optional(),
  y: coordinate.optional(),
  width: size.optional(),
  height: size.optional(),
  style: StyleSchema.optional(),
  tokenBindings: TokenBindingPatchSchema.optional(),
  componentSource: ComponentSourceSchema.nullable().optional(),
  text: z.string().max(LIMITS.text).optional(),
  runs: z.array(RunSchema).max(1000).optional(),
  list: z.enum(["none", "bullet", "number"]).optional(),
  href: href.nullable().optional(),
  assetId: IdSchema.optional(),
  fit: z.enum(["cover", "contain", "fill"]).optional(),
  crop: z
    .object({ x: z.number().min(0).max(100), y: z.number().min(0).max(100) })
    .strict()
    .optional(),
  cells: z
    .array(z.array(z.string().max(10000)).max(100))
    .max(500)
    .optional(),
  layout: z.enum(["position", "stack", "grid"]).optional(),
  gap: z.number().min(0).max(1000).optional(),
  columns: z.number().int().min(1).max(100).optional(),
});
export const OperationSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("set_document"),
      patch: nonempty({
        name: name.optional(),
        brand: BrandKitSchema.optional(),
        designSystem: DesignSystemSchema.nullable().optional(),
      }),
    })
    .strict(),
  z
    .object({
      type: z.literal("add_page"),
      page: PageSchema,
      index: index.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_page"),
      pageId: IdSchema,
      patch: nonempty({
        name: name.optional(),
        width: size.optional(),
        height: size.optional(),
        background: ColorSchema.optional(),
        backgroundToken: TokenPathSchema.nullable().optional(),
      }),
    })
    .strict(),
  z.object({ type: z.literal("move_page"), pageId: IdSchema, index }).strict(),
  z.object({ type: z.literal("delete_page"), pageId: IdSchema }).strict(),
  z
    .object({
      type: z.literal("add_element"),
      pageId: IdSchema,
      parentId: IdSchema.optional(),
      element: ElementSchema,
      index: index.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("update_element"),
      elementId: IdSchema,
      patch: ElementPatchSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal("move_element"),
      elementId: IdSchema,
      pageId: IdSchema,
      parentId: IdSchema.optional(),
      index,
    })
    .strict(),
  z.object({ type: z.literal("delete_element"), elementId: IdSchema }).strict(),
  z.object({ type: z.literal("add_comment"), comment: CommentSchema }).strict(),
  z
    .object({
      type: z.literal("update_comment"),
      commentId: IdSchema,
      patch: nonempty({
        text: z.string().min(1).max(10000).optional(),
        resolved: z.boolean().optional(),
      }),
    })
    .strict(),
  z.object({ type: z.literal("register_asset"), asset: AssetSchema }).strict(),
]);
export type Operation = z.infer<typeof OperationSchema>;
export const BatchSchema = z
  .object({
    operationId: IdSchema,
    actor: name,
    expectedRevision: z.number().int().min(0),
    operations: z.array(OperationSchema).min(1).max(LIMITS.operations),
  })
  .strict();
export type Batch = z.infer<typeof BatchSchema>;
export const batchSchema = BatchSchema;

export function parseBatch(input: unknown): Batch {
  assertSafeData(input);
  const result = BatchSchema.safeParse(input);
  if (!result.success)
    throw new DomainError(
      "VALIDATION",
      result.error.issues
        .map((x) => `${x.path.join(".")}: ${x.message}`)
        .join("; "),
    );
  return result.data;
}
function required<T>(v: T | undefined, message: string): T {
  if (v === undefined) throw new DomainError("NOT_FOUND", message, 404);
  return v;
}
function insert<T>(array: T[], value: T, at: number = array.length): void {
  if (at > array.length)
    throw new DomainError(
      "VALIDATION",
      `Insertion index ${at} exceeds ${array.length}`,
    );
  array.splice(at, 0, value);
}
function treeIds(element: Element): string[] {
  return [element.id, ...(element.children ?? []).flatMap(treeIds)];
}
function destination(
  doc: Document,
  pageId: string,
  parentId?: string,
): Element[] {
  const page = required(
    doc.pages.find((p) => p.id === pageId),
    "Page not found",
  );
  if (!parentId) return page.elements;
  const parent = required(
    locateElement(doc, parentId),
    "Parent element not found",
  );
  if (parent.page.id !== pageId || parent.element.type !== "group")
    throw new DomainError(
      "VALIDATION",
      "Parent must be a group on the destination page",
    );
  return parent.element.children ?? (parent.element.children = []);
}
/** Pure atomic operation layer, shared by every transport. The input is never mutated. */
export function applyOperations(
  input: Document,
  operations: Operation[],
): { document: Document; affectedElementIds: string[] } {
  const doc = structuredClone(input);
  const affected = new Set<string>();
  const systemIdentities = new Map<string, string>();
  if (input.designSystem)
    systemIdentities.set(
      `${input.designSystem.id}@${input.designSystem.version}`,
      canonicalDesignSystem(input.designSystem),
    );
  for (const op of operations) {
    switch (op.type) {
      case "set_document":
        if (op.patch.designSystem) {
          const system = op.patch.designSystem;
          const identity = `${system.id}@${system.version}`;
          const content = canonicalDesignSystem(system);
          const existing = systemIdentities.get(identity);
          if (existing !== undefined && existing !== content)
            throw new DomainError(
              "CONFLICT",
              `Design system ${identity} is immutable; change its version before changing its content`,
              409,
            );
          systemIdentities.set(identity, content);
        }
        Object.assign(doc, structuredClone(op.patch));
        if (op.patch.designSystem === null) delete doc.designSystem;
        break;
      case "add_page":
        insert(doc.pages, structuredClone(op.page), op.index);
        op.page.elements.flatMap(treeIds).forEach((id) => affected.add(id));
        break;
      case "update_page": {
        const page = required(
          doc.pages.find((p) => p.id === op.pageId),
          "Page not found",
        );
        if (
          op.patch.backgroundToken === null &&
          page.backgroundToken &&
          op.patch.background === undefined
        )
          page.background = resolvePageTokens(
            page,
            doc.designSystem,
          ).background;
        Object.assign(page, op.patch);
        if (
          op.patch.backgroundToken === null ||
          (op.patch.background !== undefined &&
            op.patch.backgroundToken === undefined)
        )
          delete page.backgroundToken;
        break;
      }
      case "move_page": {
        const at = doc.pages.findIndex((p) => p.id === op.pageId);
        if (at < 0) throw new DomainError("NOT_FOUND", "Page not found", 404);
        const [page] = doc.pages.splice(at, 1);
        insert(doc.pages, page, op.index);
        break;
      }
      case "delete_page": {
        if (doc.pages.length === 1)
          throw new DomainError(
            "VALIDATION",
            "A document must retain at least one page",
          );
        const at = doc.pages.findIndex((p) => p.id === op.pageId);
        if (at < 0) throw new DomainError("NOT_FOUND", "Page not found", 404);
        const [page] = doc.pages.splice(at, 1);
        const ids = new Set(page.elements.flatMap(treeIds));
        ids.forEach((id) => affected.add(id));
        doc.comments = doc.comments.filter(
          (c) => c.pageId !== op.pageId && !ids.has(c.elementId ?? ""),
        );
        break;
      }
      case "add_element":
        insert(
          destination(doc, op.pageId, op.parentId),
          structuredClone(op.element),
          op.index,
        );
        treeIds(op.element).forEach((id) => affected.add(id));
        break;
      case "update_element": {
        const element = required(
          locateElement(doc, op.elementId),
          "Element not found",
        ).element;
        const patch = structuredClone(op.patch);
        const oldStyle = element.style;
        const bindings = { ...element.tokenBindings };
        const detached = Object.entries(patch.tokenBindings ?? {}).filter(
          ([, value]) => value === null,
        );
        if (detached.some(([key]) => Object.hasOwn(bindings, key))) {
          const resolved = resolveElementTokens(element, doc.designSystem);
          for (const [key] of detached) {
            if (!Object.hasOwn(bindings, key)) continue;
            if (key === "gap" && patch.gap === undefined)
              element.gap = resolved.gap;
            else if (key !== "gap" && !Object.hasOwn(patch.style ?? {}, key))
              Object.assign(oldStyle, {
                [key]: resolved.style[key as keyof typeof resolved.style],
              });
          }
        }
        Object.assign(element, patch);
        if (patch.style) element.style = { ...oldStyle, ...patch.style };
        for (const key of Object.keys(patch.style ?? {}))
          delete bindings[key as keyof typeof bindings];
        if (patch.gap !== undefined) delete bindings.gap;
        for (const [key, value] of Object.entries(patch.tokenBindings ?? {})) {
          if (value === null) delete bindings[key as keyof typeof bindings];
          else bindings[key as keyof typeof bindings] = value;
        }
        if (Object.keys(bindings).length) element.tokenBindings = bindings;
        else delete element.tokenBindings;
        if (patch.componentSource === null) delete element.componentSource;
        if (patch.text !== undefined && patch.runs === undefined)
          delete element.runs;
        if (patch.href === null) delete element.href;
        affected.add(element.id);
        break;
      }
      case "move_element": {
        const location = required(
          locateElement(doc, op.elementId),
          "Element not found",
        );
        const ids = new Set(treeIds(location.element));
        if (op.parentId && ids.has(op.parentId))
          throw new DomainError(
            "VALIDATION",
            "Cannot move an element into itself or a descendant",
          );
        const target = destination(doc, op.pageId, op.parentId);
        location.elements.splice(location.index, 1);
        insert(target, location.element, op.index);
        ids.forEach((id) => affected.add(id));
        for (const comment of doc.comments)
          if (comment.elementId && ids.has(comment.elementId) && comment.pageId)
            comment.pageId = op.pageId;
        break;
      }
      case "delete_element": {
        const location = required(
          locateElement(doc, op.elementId),
          "Element not found",
        );
        const ids = new Set(treeIds(location.element));
        location.elements.splice(location.index, 1);
        ids.forEach((id) => affected.add(id));
        doc.comments = doc.comments.filter((c) => !ids.has(c.elementId ?? ""));
        break;
      }
      case "add_comment":
        doc.comments.push(structuredClone(op.comment));
        if (op.comment.elementId) affected.add(op.comment.elementId);
        break;
      case "update_comment": {
        const comment = required(
          doc.comments.find((c) => c.id === op.commentId),
          "Comment not found",
        );
        Object.assign(comment, op.patch);
        if (comment.elementId) affected.add(comment.elementId);
        break;
      }
      case "register_asset": {
        const existing = doc.assets[op.asset.id];
        if (
          existing &&
          (["name", "mime", "bytes", "sha256"] as const).some(
            (key) => existing[key] !== op.asset[key],
          )
        )
          throw new DomainError(
            "CONFLICT",
            "Asset ID already exists with different metadata",
            409,
          );
        doc.assets[op.asset.id] = structuredClone(op.asset);
        break;
      }
    }
  }
  return { document: validateDocument(doc), affectedElementIds: [...affected] };
}
