import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDocument } from "../src/domain/templates.js";
import {
  validateDocument,
  BaseDesignSystemSchema,
  UnicodeRangeSchema,
  type DesignSystem,
  type Element,
  type Asset,
} from "../src/domain/model.js";
import { applyOperations, parseBatch } from "../src/domain/operations.js";
import { WorkspaceStore } from "../src/domain/store.js";
import {
  validateDesignSystem,
  resolveToken,
  resolveDocument,
  resolveBrandTokens,
  designSystemOperations,
  instantiateComponent,
  checkDesignSystem,
  mapTemplateToSystem,
  parseUnicodeRanges,
} from "../src/domain/design-system.js";

function text(id = "title"): Element {
  return {
    id,
    type: "text",
    name: "Title",
    x: 10,
    y: 20,
    width: 200,
    height: 80,
    text: "Template title",
    style: { color: "#111111", fontFamily: "Inter", fontSize: 24 },
  };
}
function system(): DesignSystem {
  return validateDesignSystem({
    id: "acme",
    name: "Acme",
    version: "1.0.0",
    tokens: {
      "color.primary": { type: "color", value: "#112233" },
      "color.secondary": { type: "color", value: "#112233" },
      "color.text": { type: "color", value: { ref: "color.primary" } },
      "color.paper": { type: "color", value: "#fafafa" },
      "type.body": { type: "fontFamily", value: "Inter" },
      "type.heading": { type: "fontFamily", value: "Lora" },
      "size.heading": { type: "dimension", value: 32 },
      "space.section": { type: "dimension", value: 24 },
    },
    roles: {
      primaryColor: "color.primary",
      pageBackground: "color.paper",
      bodyFont: "type.body",
      headingFont: "type.heading",
    },
  });
}
function document() {
  const doc = createDocument("BYO", "blank");
  doc.pages[0].elements = [text(), text("subtitle")];
  return doc;
}
function apply(doc: ReturnType<typeof document>, s = system()) {
  return applyOperations(
    doc,
    designSystemOperations(doc, s, {
      elements: {
        title: { color: "color.primary", fontSize: "size.heading" },
        subtitle: { color: "color.secondary" },
      },
      pages: { [doc.pages[0].id]: "color.paper" },
    }),
  ).document;
}
function asset(id: string, mime: Asset["mime"]): Asset {
  return { id, name: id, mime, bytes: 42, sha256: "a".repeat(64) };
}

test("old v1 documents stay byte-equivalent through validation and have no invented system", () => {
  const doc = document();
  assert.deepEqual(validateDocument(doc), doc);
  assert.equal(doc.designSystem, undefined);
  assert.equal(checkDesignSystem(doc)[0].code, "NO_DESIGN_SYSTEM");
});
test("structural system drafts retain unresolved references for review but cannot be saved", () => {
  const draft = BaseDesignSystemSchema.parse({
    id: "review",
    name: "Needs review",
    version: "1.0.0",
    tokens: {
      body: { type: "fontFamily", value: "Unuploaded Font" },
      accent: { type: "color", value: { ref: "missing" } },
    },
  });
  assert.deepEqual(draft.fonts, []);
  assert.equal(draft.tokens.body.value, "Unuploaded Font");
  assert.throws(
    () => validateDesignSystem(draft),
    /Unknown font|Unknown token/,
  );
  assert.throws(() =>
    BaseDesignSystemSchema.parse({ ...draft, script: "alert(1)" }),
  );
});
test("font unicode ranges normalize safe intervals and suffix wildcards with explicit bounds", () => {
  assert.equal(
    UnicodeRangeSchema.parse(" u+0100-017F, U+00?? "),
    "U+0-FF, U+100-17F",
  );
  assert.deepEqual(parseUnicodeRanges("U+10????"), [
    { start: 0x100000, end: 0x10ffff },
  ]);
  assert.deepEqual(parseUnicodeRanges("U+41"), [{ start: 65, end: 65 }]);
  for (const value of [
    "",
    "U+1?2",
    "U+??12",
    "U+???????",
    "U+??????",
    "U+1?????",
    "U+110000",
    "U+FF-0",
    "U+0-7F,U+7F-FF",
    "U+0;src:url(https://bad.invalid)",
    "U+41,",
    Array(33).fill("U+41").join(","),
  ])
    assert.throws(() => UnicodeRangeSchema.parse(value), value);
});
test("Latin and Latin-ext font subsets share a face only with explicit disjoint coverage", () => {
  const s = system();
  s.assets.latin = asset("latin", "font/woff2");
  s.assets.extended = asset("extended", "font/woff2");
  s.fonts = [
    {
      family: "Inter",
      assetId: "latin",
      weight: 400,
      style: "normal",
      unicodeRange: "U+0-FF",
    },
    {
      family: "Inter",
      assetId: "extended",
      weight: 400,
      style: "normal",
      unicodeRange: "U+100-2FF",
    },
  ];
  assert.equal(validateDesignSystem(s).fonts.length, 2);
  const overlapping = structuredClone(s);
  overlapping.fonts[1].unicodeRange = "U+F0-2FF";
  assert.throws(() => validateDesignSystem(overlapping), /ranges overlap/);
  const full = structuredClone(s);
  delete full.fonts[0].unicodeRange;
  assert.throws(() => validateDesignSystem(full), /one full face/);
  const separateWeight = structuredClone(full);
  separateWeight.fonts[1].weight = 700;
  assert.doesNotThrow(() => validateDesignSystem(separateWeight));
  const differingCase = structuredClone(s);
  differingCase.fonts[1].family = "inter";
  assert.throws(
    () => validateDesignSystem(differingCase),
    /consistent font family spelling/,
  );
});
test("normalized systems resolve aliases while equal-valued semantic roles remain independent", () => {
  const original = document(),
    before = structuredClone(original),
    s = system();
  const doc = apply(original, s),
    resolved = resolveDocument(doc);
  assert.deepEqual(original, before);
  assert.equal(resolveToken(s, "color.text"), "#112233");
  assert.equal(doc.pages[0].elements[0].style.color, "#111111");
  assert.equal(resolved.pages[0].elements[0].style.color, "#112233");
  assert.equal(resolved.pages[0].background, "#fafafa");
  assert.equal(resolved.pages[0].elements[0].style.fontSize, 32);
  const next = structuredClone(s);
  next.version = "1.1.0";
  next.tokens["color.primary"] = { type: "color", value: "#aa0000" };
  const upgraded = applyOperations(
    doc,
    designSystemOperations(doc, next),
  ).document;
  assert.equal(
    resolveDocument(upgraded).pages[0].elements[0].style.color,
    "#aa0000",
  );
  assert.equal(
    resolveDocument(upgraded).pages[0].elements[1].style.color,
    "#112233",
  );
  assert.deepEqual(s.tokens["color.primary"], {
    type: "color",
    value: "#112233",
  });
});
test("missing/cyclic/mistyped aliases, unsafe values, missing fonts and excessive chains are rejected", () => {
  for (const bad of [
    {
      ...system(),
      tokens: { x: { type: "color", value: { ref: "missing" } } },
    },
    { ...system(), tokens: { x: { type: "color", value: { ref: "x" } } } },
    {
      ...system(),
      tokens: {
        x: { type: "color", value: { ref: "y" } },
        y: { type: "dimension", value: 12 },
      },
    },
    {
      ...system(),
      tokens: { x: { type: "color", value: "url(javascript:alert(1))" } },
    },
    {
      ...system(),
      tokens: { x: { type: "fontFamily", value: "Missing Font" } },
    },
    { ...system(), tokens: { x: { type: "dimension", value: Infinity } } },
    { ...system(), version: "latest" },
  ])
    assert.throws(() => validateDesignSystem(bad));
  const long = system();
  for (let i = 0; i < 65; i++)
    long.tokens[`chain${i}`] = {
      type: "color",
      value: i === 64 ? "#ffffff" : { ref: `chain${i + 1}` },
    };
  assert.throws(() => validateDesignSystem(long), /chain exceeds/);
});
test("bindings validate target type/range, group gap and system presence", () => {
  const doc = document();
  doc.pages[0].elements[0].tokenBindings = { color: "color.primary" };
  assert.throws(() => validateDocument(doc), /requires a design system/);
  const s = system();
  s.tokens.bad = { type: "dimension", value: -10 };
  for (const bindings of [
    { color: "size.heading" },
    { fontSize: "bad" },
    { color: "missing" },
    { gap: "space.section" },
  ]) {
    assert.throws(() =>
      applyOperations(
        document(),
        designSystemOperations(document(), s, {
          elements: { title: bindings },
        }),
      ),
    );
  }
  const groupDoc = document();
  groupDoc.pages[0].elements = [
    {
      id: "group",
      type: "group",
      name: "Group",
      x: 0,
      y: 0,
      width: 200,
      height: 200,
      style: {},
      gap: 4,
      children: [text()],
    },
  ];
  const bound = applyOperations(
    groupDoc,
    designSystemOperations(groupDoc, s, {
      elements: { group: { gap: "space.section" } },
    }),
  ).document;
  assert.equal(resolveDocument(bound).pages[0].elements[0].gap, 24);
});
test("literal edits detach one binding; explicit same-patch binding wins; detach freezes appearance", () => {
  let doc = apply(document());
  doc = applyOperations(doc, [
    {
      type: "update_element",
      elementId: "title",
      patch: { style: { color: "#ff0000" } },
    },
  ]).document;
  assert.deepEqual(doc.pages[0].elements[0].tokenBindings, {
    fontSize: "size.heading",
  });
  doc = applyOperations(doc, [
    {
      type: "update_element",
      elementId: "title",
      patch: {
        style: { color: "#00ff00" },
        tokenBindings: { color: "color.primary" },
      },
    },
  ]).document;
  assert.equal(
    resolveDocument(doc).pages[0].elements[0].style.color,
    "#112233",
  );
  doc = applyOperations(doc, [
    {
      type: "update_element",
      elementId: "title",
      patch: { tokenBindings: { color: null } },
    },
    {
      type: "update_page",
      pageId: doc.pages[0].id,
      patch: { backgroundToken: null },
    },
  ]).document;
  assert.equal(doc.pages[0].elements[0].style.color, "#112233");
  assert.equal(doc.pages[0].background, "#fafafa");
  assert.equal(doc.pages[0].backgroundToken, undefined);
  const pageDoc = apply(document());
  const page = applyOperations(pageDoc, [
    {
      type: "update_page",
      pageId: pageDoc.pages[0].id,
      patch: { background: "#010203" },
    },
  ]);
  assert.equal(page.document.pages[0].backgroundToken, undefined);
});
test("systems require verified metadata references and keep font assets separate from images", () => {
  const s = system(),
    font = asset("fontasset", "font/woff2");
  s.assets[font.id] = font;
  s.fonts = [
    {
      family: "Acme Sans",
      assetId: font.id,
      weight: 400,
      style: "normal",
      license: "Licensed for embedding",
    },
  ];
  s.tokens["type.body"] = { type: "fontFamily", value: "Acme Sans" };
  const doc = applyOperations(
    document(),
    designSystemOperations(document(), s),
  ).document;
  assert.equal(
    resolveBrandTokens(doc.brand, doc.designSystem).fonts.body,
    "Acme Sans",
  );
  const missing = structuredClone(doc);
  delete missing.assets[font.id];
  assert.throws(() => validateDocument(missing), /asset.*missing/);
  const image = structuredClone(doc);
  image.pages[0].elements.push({
    id: "image",
    name: "Image",
    type: "image",
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    style: {},
    assetId: font.id,
  });
  assert.throws(() => validateDocument(image), /image asset/);
  const logo = structuredClone(doc);
  logo.brand.logoAssetId = font.id;
  assert.throws(() => validateDocument(logo), /logo/);
  const bad = structuredClone(s);
  bad.fonts[0].family = "Inter";
  bad.tokens["type.body"] = { type: "fontFamily", value: "Inter" };
  assert.doesNotThrow(() => validateDesignSystem(bad));
  bad.fonts.push({ ...bad.fonts[0] });
  assert.throws(() => validateDesignSystem(bad), /Duplicate font face/);
  const invalid = structuredClone(s);
  invalid.assets.fontasset.mime = "image/png";
  assert.throws(() => validateDesignSystem(invalid), /font asset/);
});
function withComponent(): DesignSystem {
  const s = system();
  s.assets.hero = asset("hero", "image/png");
  const base: Element = {
    id: "card",
    type: "group",
    name: "Card",
    x: 0,
    y: 0,
    width: 320,
    height: 200,
    style: { background: "#ffffff" },
    children: [
      text("label"),
      {
        id: "picture",
        type: "image",
        name: "Picture",
        x: 0,
        y: 80,
        width: 100,
        height: 100,
        style: {},
        assetId: "hero",
      },
    ],
  };
  const variant = structuredClone(base);
  variant.style.background = "#dddddd";
  s.components = [
    {
      id: "card",
      name: "Card",
      element: base,
      variants: { muted: variant },
      slots: {
        heading: { type: "text", elementId: "label" },
        photo: { type: "image", elementId: "picture" },
      },
    },
  ];
  return validateDesignSystem(s);
}
test("component variants/slots create independent native editable copies with fresh IDs and source pin", () => {
  const s = withComponent(),
    before = structuredClone(s);
  let i = 0;
  const instance = instantiateComponent(s, "card", {
    variant: "muted",
    slots: { heading: "User title", photo: "hero" },
    idFactory: () => `instance${++i}`,
  });
  assert.deepEqual(s, before);
  assert.equal(instance.style.background, "#dddddd");
  assert.equal(instance.children![0].text, "User title");
  assert.deepEqual(instance.componentSource, {
    systemId: "acme",
    systemVersion: "1.0.0",
    componentId: "card",
    variant: "muted",
  });
  assert.deepEqual(
    [instance.id, ...instance.children!.map((e) => e.id)],
    ["instance1", "instance2", "instance3"],
  );
  let doc = applyOperations(
    document(),
    designSystemOperations(document(), s),
  ).document;
  doc = applyOperations(doc, [
    { type: "add_element", pageId: doc.pages[0].id, element: instance },
    {
      type: "update_element",
      elementId: "instance2",
      patch: { text: "Edited copy" },
    },
  ]).document;
  assert.equal(doc.pages[0].elements[2].children![0].text, "Edited copy");
  assert.equal(s.components[0].element.children![0].text, "Template title");
  const next = structuredClone(s);
  next.version = "2.0.0";
  const upgraded = applyOperations(
    doc,
    designSystemOperations(doc, next),
  ).document;
  assert.equal(
    upgraded.pages[0].elements[2].componentSource!.systemVersion,
    "1.0.0",
  );
  assert.ok(
    checkDesignSystem(upgraded).some(
      (d) => d.code === "OLDER_COMPONENT_SOURCE",
    ),
  );
});
test("component validation rejects invalid variants, slots, duplicate template IDs and ID factory collisions", () => {
  const s = withComponent();
  assert.throws(() => instantiateComponent(s, "missing"), /Unknown component/);
  assert.throws(
    () => instantiateComponent(s, "card", { variant: "missing" }),
    /variant/,
  );
  assert.throws(
    () => instantiateComponent(s, "card", { slots: { unknown: "x" } }),
    /slot/,
  );
  assert.throws(
    () => instantiateComponent(s, "card", { slots: { photo: "missing" } }),
    /image asset/,
  );
  assert.throws(
    () => instantiateComponent(s, "card", { idFactory: () => "same" }),
    /duplicate/,
  );
  const bad = structuredClone(s);
  bad.components[0].variants.muted.children![0].id = "gone";
  assert.throws(() => validateDesignSystem(bad), /Slot/);
  const duplicate = structuredClone(s);
  duplicate.components[0].element.children![0].id = "picture";
  assert.throws(() => validateDesignSystem(duplicate), /Duplicate template/);
});
test("system upgrades reject dangling old bindings atomically instead of guessing replacements", () => {
  const doc = apply(document()),
    before = structuredClone(doc),
    s = system();
  s.version = "2.0.0";
  delete s.tokens["color.secondary"];
  assert.throws(
    () => applyOperations(doc, designSystemOperations(doc, s)),
    /Unknown token/,
  );
  assert.deepEqual(doc, before);
  const fixed = applyOperations(
    doc,
    designSystemOperations(doc, s, { elements: { subtitle: { color: null } } }),
  ).document;
  assert.equal(fixed.pages[0].elements[1].style.color, "#112233");
  assert.equal(fixed.pages[0].elements[1].tokenBindings, undefined);
});
test("generic operations cannot mutate a pinned system version, including remove-and-readd in one batch", () => {
  const doc = apply(document());
  const changed = structuredClone(doc.designSystem!);
  changed.tokens["color.primary"] = { type: "color", value: "#abcdef" };
  const before = structuredClone(doc);
  for (const operations of [
    [{ type: "set_document" as const, patch: { designSystem: changed } }],
    [
      { type: "set_document" as const, patch: { designSystem: null } },
      { type: "set_document" as const, patch: { designSystem: changed } },
    ],
  ])
    assert.throws(() => applyOperations(doc, operations), /immutable/);
  assert.deepEqual(doc, before);
  const reordered = structuredClone(doc.designSystem!);
  reordered.tokens = Object.fromEntries(
    Object.entries(reordered.tokens).reverse(),
  );
  assert.doesNotThrow(() =>
    applyOperations(doc, [
      { type: "set_document", patch: { designSystem: reordered } },
    ]),
  );
  changed.version = "1.0.1";
  assert.equal(
    resolveDocument(
      applyOperations(doc, [
        { type: "set_document", patch: { designSystem: changed } },
      ]).document,
    ).pages[0].elements[0].style.color,
    "#abcdef",
  );
});
test("system bindings persist, exact retries are stable, and guarded undo preserves unrelated edits", (t) => {
  const root = mkdtempSync(join(tmpdir(), "vds-system-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  let store = new WorkspaceStore(root);
  const initial = document();
  store.create(initial);
  const batch = {
    operationId: "bind",
    actor: "human",
    expectedRevision: 0,
    operations: designSystemOperations(initial, system(), {
      elements: { title: { color: "color.primary" } },
    }),
  };
  const applied = store.apply(initial.id, batch);
  store = new WorkspaceStore(root);
  assert.deepEqual(store.apply(initial.id, batch), applied);
  store.apply(initial.id, {
    operationId: "other",
    actor: "agent",
    expectedRevision: 1,
    operations: [
      {
        type: "update_element",
        elementId: "title",
        patch: { text: "Another actor's text" },
      },
    ],
  });
  const undone = store.undo(initial.id, {
    operationId: "undo",
    actor: "human",
    expectedRevision: 2,
    targetOperationId: "bind",
  });
  assert.equal(undone.document.designSystem, undefined);
  assert.equal(
    undone.document.pages[0].elements[0].text,
    "Another actor's text",
  );
  assert.equal(undone.document.pages[0].elements[0].tokenBindings, undefined);
  const redo = store.undo(initial.id, {
    operationId: "redo",
    actor: "human",
    expectedRevision: 3,
    targetOperationId: "undo",
  });
  assert.equal(
    resolveDocument(redo.document).pages[0].elements[0].style.color,
    "#112233",
  );
  assert.equal(
    new WorkspaceStore(root).get(initial.id).designSystem!.version,
    "1.0.0",
  );
});
test("diagnostics explain literal overrides and minimum typography without rewriting content", () => {
  const s = system();
  s.rules = { requireTokenBindings: true, minimumFontSize: 40 };
  const doc = apply(document(), s),
    before = structuredClone(doc),
    diagnostics = checkDesignSystem(doc);
  assert.ok(
    diagnostics.some((d) => d.code === "SMALL_TEXT" && d.elementId === "title"),
  );
  assert.ok(diagnostics.some((d) => d.code === "LITERAL_STYLE"));
  assert.deepEqual(doc, before);
});
test("explicit template mapping binds semantic roles and operation schemas expose strict new fields", () => {
  const doc = createDocument("Template", "service-sheet"),
    s = system();
  const mapping = mapTemplateToSystem(doc, s);
  assert.ok(Object.keys(mapping.elements!).length);
  assert.equal(mapping.pages![doc.pages[0].id], "color.paper");
  const operations = designSystemOperations(doc, s, mapping);
  assert.doesNotThrow(() =>
    parseBatch({
      operationId: "system",
      actor: "test",
      expectedRevision: 0,
      operations,
    }),
  );
  assert.throws(() =>
    parseBatch({
      operationId: "bad",
      actor: "test",
      expectedRevision: 0,
      operations: [
        {
          type: "update_element",
          elementId: "title",
          patch: { tokenBindings: { position: "color.primary" } },
        },
      ],
    }),
  );
});
