import { test } from "node:test";
import assert from "node:assert/strict";
import { brandOperations } from "../src/domain/brand.js";
import { applyOperations } from "../src/domain/operations.js";
import { createDocument } from "../src/domain/templates.js";

test("brand mapping changes matching colors and type across pages, preserving custom styles", () => {
  const doc = createDocument("Brand sample", "service-sheet");
  const next = structuredClone(doc.brand);
  next.colors.primary = "#123456";
  next.fonts.heading = "Inter";
  next.fonts.body = "Lora";
  const operations = brandOperations(doc, next);
  const result = applyOperations(doc, operations);
  const output = "document" in result ? result.document : result;
  assert.equal(output.pages[0].elements[0].style.background, "#123456");
  assert.ok(
    output.pages[0].elements.some((e) => e.style.fontFamily === "Inter"),
  );
  const custom = doc.pages[0].elements.find(
    (e) => e.style.color === "#596b61",
  )!;
  assert.equal(
    output.pages[0].elements.find((e) => e.id === custom.id)!.style.color,
    "#596b61",
  );
  assert.equal(doc.brand.colors.primary, "#173d32");
  assert.deepEqual(output.brand, next);
});
