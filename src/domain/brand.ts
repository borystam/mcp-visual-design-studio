import type { BrandKit, Document, Element, Style } from "./model.js";
import type { Operation } from "./operations.js";

/** Reapply matching palette/font values while preserving explicit custom styles.
 * Produces ordinary guarded operations so UI, MCP, history and undo stay aligned.
 */
export function brandOperations(doc: Document, input: BrandKit): Operation[] {
  const brand = structuredClone(input);
  const colors = new Map<string, string>();
  for (const [key, value] of Object.entries(doc.brand.colors)) {
    const replacement = brand.colors[key];
    if (
      replacement &&
      replacement !== value &&
      !colors.has(value.toLowerCase())
    )
      colors.set(value.toLowerCase(), replacement);
  }
  const remapStyle = (style: Style): Style => {
    const patch: Style = {};
    for (const property of ["color", "background", "borderColor"] as const) {
      const value = style[property],
        next = value && colors.get(value.toLowerCase());
      if (next && next !== value) patch[property] = next;
    }
    if (
      style.fontFamily === doc.brand.fonts.heading &&
      brand.fonts.heading !== style.fontFamily
    )
      patch.fontFamily = brand.fonts.heading;
    else if (
      style.fontFamily === doc.brand.fonts.body &&
      brand.fonts.body !== style.fontFamily
    )
      patch.fontFamily = brand.fonts.body;
    return patch;
  };
  if (brand.id === doc.brand.id) {
    const remapComponents = (items: Element[]) => {
      for (const item of items) {
        item.style = { ...item.style, ...remapStyle(item.style) };
        if (item.children) remapComponents(item.children);
      }
    };
    remapComponents(brand.components);
  }
  const operations: Operation[] = [];
  const visit = (items: Element[]) => {
    for (const element of items) {
      const style = remapStyle(element.style);
      if (Object.keys(style).length)
        operations.push({
          type: "update_element",
          elementId: element.id,
          patch: { style },
        });
      if (element.children) visit(element.children);
    }
  };
  for (const page of doc.pages) {
    const background = colors.get(page.background.toLowerCase());
    if (background)
      operations.push({
        type: "update_page",
        pageId: page.id,
        patch: { background },
      });
    visit(page.elements);
  }
  operations.push({ type: "set_document", patch: { brand } });
  return operations;
}
