import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DomainError,
  validateDocument,
  type Document,
  type Element,
} from "../src/domain/model.js";
import {
  applyOperations,
  parseBatch,
  type Operation,
} from "../src/domain/operations.js";
import { WorkspaceStore, migrateDocument } from "../src/domain/store.js";

function element(id = "title"): Element {
  return {
    id,
    type: "text",
    name: "Heading",
    x: 20,
    y: 20,
    width: 500,
    height: 80,
    text: "Original title",
    style: { color: "#111111", fontFamily: "Inter", fontSize: 24 },
  };
}
function document(id = "document"): Document {
  return {
    schemaVersion: 1,
    rendererVersion: 1,
    id,
    name: "Example",
    revision: 0,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    pages: [
      {
        id: "page",
        name: "Page 1",
        width: 816,
        height: 1056,
        background: "#ffffff",
        elements: [element(), element("body")],
      },
    ],
    brand: {
      id: "brand",
      name: "Default",
      colors: { primary: "#111111" },
      fonts: { heading: "Inter", body: "Inter" },
      components: [],
    },
    assets: {},
    comments: [],
  };
}
function workspace(t: { after: (fn: () => void) => void }) {
  const root = mkdtempSync(join(tmpdir(), "studio space-é-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const store = new WorkspaceStore(root);
  store.create(document());
  return { root, store };
}
function change(
  store: WorkspaceStore,
  operations: Operation[],
  operationId = "op",
  expectedRevision = store.get("document").revision,
  actor = "agent",
) {
  return store.apply("document", {
    operationId,
    actor,
    expectedRevision,
    operations,
  });
}
function fails(code: string) {
  return (error: unknown) =>
    error instanceof DomainError && error.code === code;
}

test("strict validation rejects unknown properties, invalid CSS, links and duplicated IDs", () => {
  assert.throws(
    () => validateDocument({ ...document(), script: "alert(1)" }),
    fails("VALIDATION"),
  );
  const invalid = document();
  invalid.pages[0].elements[0].style.color = "url(https://tracker.invalid)";
  assert.throws(() => validateDocument(invalid), fails("VALIDATION"));
  const links = document();
  links.pages[0].elements[0].href = "javascript:alert(1)";
  assert.throws(() => validateDocument(links), fails("VALIDATION"));
  const duplicates = document();
  duplicates.pages[0].elements[0].id = "page";
  assert.throws(() => validateDocument(duplicates), fails("VALIDATION"));
  const exotic = document();
  (exotic.pages[0].elements[0].style as any).position = "fixed";
  assert.throws(() => validateDocument(exotic), fails("VALIDATION"));
});
test("safe colors and explicit links are accepted", () => {
  const doc = document();
  doc.pages[0].elements[0].href = "https://example.com/design?x=1&y=2";
  doc.pages[0].elements[0].style.color = "#abc";
  assert.equal(
    validateDocument(doc).pages[0].elements[0].href,
    doc.pages[0].elements[0].href,
  );
});
test("recursive input and unsafe object keys are bounded before schema parsing", () => {
  let obj: any = {};
  for (let i = 0; i < 60; i++) obj = { child: obj };
  assert.throws(() => validateDocument(obj), fails("LIMIT"));
  assert.throws(
    () => validateDocument(JSON.parse('{"__proto__":{}}')),
    fails("VALIDATION"),
  );
});
test("typed element properties and asset/comment references are validated", () => {
  const doc = document();
  doc.pages[0].elements[0].children = [];
  assert.throws(() => validateDocument(doc), fails("VALIDATION"));
  const ref = document();
  ref.comments.push({
    id: "comment",
    elementId: "unknown",
    text: "Hello",
    author: "Human",
    createdAt: ref.createdAt,
    resolved: false,
  });
  assert.throws(() => validateDocument(ref), fails("VALIDATION"));
  const image = document();
  image.pages[0].elements.push({
    ...element("image"),
    type: "image",
    text: undefined,
    assetId: "missing",
  });
  assert.throws(() => validateDocument(image), fails("VALIDATION"));
});
test("multi-operation failure is atomic and writes no partial revision", (t) => {
  const { store, root } = workspace(t);
  assert.throws(
    () =>
      change(store, [
        {
          type: "update_element",
          elementId: "title",
          patch: { text: "Changed" },
        },
        { type: "delete_element", elementId: "missing" },
      ]),
    fails("NOT_FOUND"),
  );
  assert.equal(
    store.get("document").pages[0].elements[0].text,
    "Original title",
  );
  assert.equal(store.get("document").revision, 0);
  assert.equal(
    readdirSync(join(root, "documents/document/revisions")).length,
    1,
  );
});
test("successful atomic batch merges individual style fields and increments once", (t) => {
  const { store } = workspace(t);
  const result = change(store, [
    { type: "update_element", elementId: "title", patch: { text: "New" } },
    {
      type: "update_element",
      elementId: "title",
      patch: { style: { fontSize: 30 } },
    },
  ]);
  assert.equal(result.revision, 1);
  assert.deepEqual(result.affectedElementIds, ["title"]);
  assert.equal(result.document.pages[0].elements[0].style.color, "#111111");
  assert.equal(result.document.pages[0].elements[0].style.fontSize, 30);
  assert.equal(store.history("document")[0].actor, "agent");
});
test("stale expected revision cannot overwrite an edit", (t) => {
  const { store } = workspace(t);
  change(store, [{ type: "set_document", patch: { name: "First" } }]);
  assert.throws(
    () =>
      change(
        store,
        [{ type: "set_document", patch: { name: "Second" } }],
        "next",
        0,
      ),
    fails("REVISION_CONFLICT"),
  );
  assert.equal(store.get("document").name, "First");
});
test("exact retries return original immutable result across restart even after later edits", (t) => {
  const { store, root } = workspace(t);
  const request = {
    operationId: "retry",
    actor: "Agent",
    expectedRevision: 0,
    operations: [
      { type: "set_document", patch: { name: "Saved" } },
    ] as Operation[],
  };
  const first = store.apply("document", request);
  change(store, [{ type: "set_document", patch: { name: "Later" } }], "later");
  const restarted = new WorkspaceStore(root);
  assert.deepEqual(restarted.apply("document", request), first);
  assert.equal(restarted.get("document").revision, 2);
  assert.equal(restarted.get("document").name, "Later");
  assert.throws(
    () => restarted.apply("document", { ...request, actor: "Different" }),
    fails("OPERATION_ID_REUSED"),
  );
});
test("input/output values cannot mutate stored state by reference", (t) => {
  const { store } = workspace(t);
  const result = change(store, [
    { type: "update_element", elementId: "title", patch: { text: "Saved" } },
  ]);
  result.document.name = "tampered";
  const read = store.get("document");
  read.pages[0].elements[0].text = "tampered";
  assert.equal(store.get("document").name, "Example");
  assert.equal(store.get("document").pages[0].elements[0].text, "Saved");
});
test("recovery rolls HEAD forward from durable records and ignores unfinished temporary files", (t) => {
  const { store, root } = workspace(t);
  const head = readFileSync(join(root, "documents/document/HEAD.json"));
  change(
    store,
    [{ type: "set_document", patch: { name: "Committed" } }],
    "saved",
  );
  writeFileSync(join(root, "documents/document/HEAD.json"), head);
  writeFileSync(
    join(root, "documents/document/revisions/000000000002.json.dead.tmp"),
    "{partial",
  );
  const restarted = new WorkspaceStore(root);
  assert.equal(restarted.get("document").name, "Committed");
  assert.equal(
    JSON.parse(readFileSync(join(root, "documents/document/HEAD.json"), "utf8"))
      .revision,
    1,
  );
  assert.equal(restarted.history("document").length, 1);
});
test("cross-document revision recovery refuses records copied from another document", (t) => {
  const { store, root } = workspace(t);
  store.create(document("other"));
  store.apply("other", {
    operationId: "otherOp",
    actor: "Agent",
    expectedRevision: 0,
    operations: [{ type: "set_document", patch: { name: "Other changed" } }],
  });
  copyFileSync(
    join(root, "documents/other/revisions/000000000001.json"),
    join(root, "documents/document/revisions/000000000001.json"),
  );
  assert.throws(
    () => new WorkspaceStore(root).get("document"),
    fails("CORRUPT"),
  );
  assert.equal(new WorkspaceStore(root).get("other").name, "Other changed");
});
test("cross-document HEAD identity and corrupt record checksums are rejected", (t) => {
  const { root } = workspace(t);
  const headPath = join(root, "documents/document/HEAD.json");
  const head = JSON.parse(readFileSync(headPath, "utf8"));
  writeFileSync(headPath, JSON.stringify({ ...head, documentId: "other" }));
  assert.throws(
    () => new WorkspaceStore(root).get("document"),
    fails("CORRUPT"),
  );
  writeFileSync(headPath, JSON.stringify(head));
  const recordPath = join(
    root,
    "documents/document/revisions/000000000000.json",
  );
  const envelope = JSON.parse(readFileSync(recordPath, "utf8"));
  envelope.record.document.name = "tampered";
  writeFileSync(recordPath, JSON.stringify(envelope));
  assert.throws(
    () => new WorkspaceStore(root).get("document"),
    fails("CORRUPT"),
  );
});
test("gaps in revision records are rejected rather than silently rolled back", (t) => {
  const { store, root } = workspace(t);
  change(store, [{ type: "set_document", patch: { name: "One" } }], "one");
  change(store, [{ type: "set_document", patch: { name: "Two" } }], "two");
  rmSync(join(root, "documents/document/revisions/000000000001.json"));
  assert.throws(
    () => new WorkspaceStore(root).get("document"),
    fails("CORRUPT"),
  );
});
test("field-level undo preserves other actors text and style edits; undo-of-undo is durable redo", (t) => {
  const { store, root } = workspace(t);
  change(
    store,
    [
      {
        type: "update_element",
        elementId: "title",
        patch: { style: { fontSize: 40 } },
      },
    ],
    "agent-size",
  );
  change(
    store,
    [
      {
        type: "update_element",
        elementId: "title",
        patch: { text: "Human character!", style: { color: "#ff0000" } },
      },
    ],
    "human",
    1,
    "human",
  );
  const undone = store.undo("document", {
    operationId: "undo-size",
    actor: "human",
    expectedRevision: 2,
    targetOperationId: "agent-size",
  });
  assert.equal(undone.document.pages[0].elements[0].style.fontSize, 24);
  assert.equal(undone.document.pages[0].elements[0].style.color, "#ff0000");
  assert.equal(undone.document.pages[0].elements[0].text, "Human character!");
  const restarted = new WorkspaceStore(root);
  const redone = restarted.undo("document", {
    operationId: "redo-size",
    actor: "human",
    expectedRevision: 3,
    targetOperationId: "undo-size",
  });
  assert.equal(redone.document.pages[0].elements[0].style.fontSize, 40);
  assert.equal(redone.document.pages[0].elements[0].text, "Human character!");
  assert.equal(restarted.history("document")[2].undoOf, "agent-size");
});
test("undo of newly introduced style property preserves another newly introduced property", (t) => {
  const { store } = workspace(t);
  change(
    store,
    [
      {
        type: "update_element",
        elementId: "title",
        patch: { style: { borderRadius: 12 } },
      },
    ],
    "round",
  );
  change(
    store,
    [
      {
        type: "update_element",
        elementId: "title",
        patch: { style: { opacity: 0.5 } },
      },
    ],
    "fade",
  );
  const result = store.undo("document", {
    operationId: "undo-round",
    actor: "human",
    expectedRevision: 2,
    targetOperationId: "round",
  });
  assert.equal(
    result.document.pages[0].elements[0].style.borderRadius,
    undefined,
  );
  assert.equal(result.document.pages[0].elements[0].style.opacity, 0.5);
});
test("undo conflicting field fails atomically and does not discard later work", (t) => {
  const { store } = workspace(t);
  change(
    store,
    [
      {
        type: "update_element",
        elementId: "title",
        patch: { text: "Agent", style: { fontSize: 40 } },
      },
    ],
    "agent",
  );
  change(
    store,
    [{ type: "update_element", elementId: "title", patch: { text: "Human" } }],
    "human",
  );
  assert.throws(
    () =>
      store.undo("document", {
        operationId: "undo",
        actor: "human",
        expectedRevision: 2,
        targetOperationId: "agent",
      }),
    fails("UNDO_CONFLICT"),
  );
  assert.equal(store.get("document").pages[0].elements[0].style.fontSize, 40);
  assert.equal(store.get("document").pages[0].elements[0].text, "Human");
  assert.equal(store.get("document").revision, 2);
});
test("field undo locates stable IDs after later reorder", (t) => {
  const { store } = workspace(t);
  change(
    store,
    [
      {
        type: "update_element",
        elementId: "title",
        patch: { text: "New title" },
      },
    ],
    "text",
  );
  change(
    store,
    [{ type: "move_element", elementId: "title", pageId: "page", index: 1 }],
    "reorder",
  );
  store.undo("document", {
    operationId: "undo",
    actor: "human",
    expectedRevision: 2,
    targetOperationId: "text",
  });
  const elements = store.get("document").pages[0].elements;
  assert.deepEqual(
    elements.map((e) => e.id),
    ["body", "title"],
  );
  assert.equal(elements[1].text, "Original title");
});
test("structural undo fails conservatively when a later edit touches its array", (t) => {
  const { store } = workspace(t);
  change(
    store,
    [{ type: "add_element", pageId: "page", element: element("added") }],
    "add",
  );
  change(
    store,
    [
      {
        type: "update_element",
        elementId: "added",
        patch: { text: "Human content" },
      },
    ],
    "edit",
  );
  assert.throws(
    () =>
      store.undo("document", {
        operationId: "undo",
        actor: "human",
        expectedRevision: 2,
        targetOperationId: "add",
      }),
    fails("UNDO_CONFLICT"),
  );
  assert.equal(
    store.get("document").pages[0].elements[2].text,
    "Human content",
  );
});
test("undo cannot remove an asset used by a later element", (t) => {
  const { store } = workspace(t);
  change(
    store,
    [
      {
        type: "register_asset",
        asset: {
          id: "asset",
          name: "Logo",
          mime: "image/png",
          bytes: 20,
          sha256: "a".repeat(64),
        },
      },
    ],
    "asset",
  );
  change(
    store,
    [
      {
        type: "add_element",
        pageId: "page",
        element: {
          id: "image",
          name: "Logo",
          type: "image",
          x: 0,
          y: 0,
          width: 20,
          height: 20,
          style: {},
          assetId: "asset",
        },
      },
    ],
    "image",
  );
  assert.throws(
    () =>
      store.undo("document", {
        operationId: "undo",
        actor: "human",
        expectedRevision: 2,
        targetOperationId: "asset",
      }),
    fails("UNDO_CONFLICT"),
  );
  assert.ok(store.get("document").assets.asset);
});
test("nested moves reject cycles, enforce page-parent match and update comment anchors", (t) => {
  const { store } = workspace(t);
  change(
    store,
    [
      {
        type: "add_element",
        pageId: "page",
        element: {
          id: "group",
          type: "group",
          name: "Group",
          x: 0,
          y: 0,
          width: 500,
          height: 500,
          style: {},
          children: [element("nested")],
        },
      },
      {
        type: "add_page",
        page: {
          id: "second",
          name: "Second",
          width: 800,
          height: 600,
          background: "#fff",
          elements: [],
        },
      },
      {
        type: "add_comment",
        comment: {
          id: "comment",
          elementId: "nested",
          pageId: "page",
          text: "Review",
          author: "Human",
          createdAt: document().createdAt,
          resolved: false,
        },
      },
    ],
    "setup",
  );
  assert.throws(
    () =>
      change(
        store,
        [
          {
            type: "move_element",
            elementId: "group",
            pageId: "page",
            parentId: "nested",
            index: 0,
          },
        ],
        "cycle",
      ),
    fails("VALIDATION"),
  );
  assert.throws(
    () =>
      change(
        store,
        [
          {
            type: "add_element",
            pageId: "second",
            parentId: "group",
            element: element("wrong"),
          },
        ],
        "wrong",
      ),
    fails("VALIDATION"),
  );
  change(
    store,
    [{ type: "move_element", elementId: "group", pageId: "second", index: 0 }],
    "move",
  );
  assert.equal(store.get("document").comments[0].pageId, "second");
});
test("page deletion and element deletion clean anchored comments; last page cannot be deleted", (t) => {
  const { store } = workspace(t);
  change(
    store,
    [
      {
        type: "add_comment",
        comment: {
          id: "comment",
          elementId: "title",
          text: "Review",
          author: "Human",
          createdAt: document().createdAt,
          resolved: false,
        },
      },
    ],
    "comment",
  );
  change(store, [{ type: "delete_element", elementId: "title" }], "delete");
  assert.equal(store.get("document").comments.length, 0);
  assert.throws(
    () => change(store, [{ type: "delete_page", pageId: "page" }], "page"),
    fails("VALIDATION"),
  );
});
test("snapshot restore is revision guarded, durable and individually undoable", (t) => {
  const { store, root } = workspace(t);
  const snapshot = store.snapshot("document", "Baseline");
  change(
    store,
    [
      { type: "set_document", patch: { name: "Changed" } },
      { type: "update_element", elementId: "title", patch: { text: "Later" } },
    ],
    "later",
  );
  assert.throws(
    () =>
      store.restore("document", {
        operationId: "restore",
        actor: "human",
        expectedRevision: 0,
        snapshotId: snapshot.id,
      }),
    fails("REVISION_CONFLICT"),
  );
  const restored = store.restore("document", {
    operationId: "restore",
    actor: "human",
    expectedRevision: 1,
    snapshotId: snapshot.id,
  });
  assert.equal(restored.document.pages[0].elements[0].text, "Original title");
  store.undo("document", {
    operationId: "undo-restore",
    actor: "human",
    expectedRevision: 2,
    targetOperationId: "restore",
  });
  assert.equal(store.get("document").pages[0].elements[0].text, "Later");
  assert.equal(
    new WorkspaceStore(root).snapshots("document")[0].name,
    "Baseline",
  );
});
test("snapshot records cannot reference a different document identity", (t) => {
  const { store, root } = workspace(t);
  const snapshot = store.snapshot("document", "Baseline");
  writeFileSync(
    join(root, `documents/document/snapshots/${snapshot.id}.json`),
    JSON.stringify({ ...snapshot, documentId: "other" }),
  );
  assert.throws(
    () => new WorkspaceStore(root).snapshots("document"),
    fails("CORRUPT"),
  );
});
test("variations receive fresh editable IDs and preserve remapped comment anchors", (t) => {
  const { store } = workspace(t);
  change(
    store,
    [
      {
        type: "add_comment",
        comment: {
          id: "comment",
          elementId: "title",
          pageId: "page",
          text: "Review",
          author: "Human",
          createdAt: document().createdAt,
          resolved: false,
        },
      },
    ],
    "comment",
  );
  const variation = store.duplicate("document", "Variation");
  assert.notEqual(variation.id, "document");
  assert.notEqual(variation.pages[0].id, "page");
  assert.notEqual(variation.pages[0].elements[0].id, "title");
  assert.equal(
    variation.comments[0].elementId,
    variation.pages[0].elements[0].id,
  );
  assert.equal(variation.comments[0].pageId, variation.pages[0].id);
  assert.equal(variation.revision, 0);
  assert.equal(store.list().length, 2);
});
test("saved revisions remain immutable and invalid revision reads fail", (t) => {
  const { store } = workspace(t);
  change(store, [{ type: "set_document", patch: { name: "Changed" } }]);
  assert.equal(store.get("document", 0).name, "Example");
  assert.throws(() => store.get("document", 99), fails("NOT_FOUND"));
  assert.throws(() => store.get("document", -1), fails("VALIDATION"));
  assert.throws(() => store.get("../outside"), fails("VALIDATION"));
});
test("workspace document and record symlinks are refused", (t) => {
  if (process.platform === "win32")
    return t.skip("Creating symlinks requires Windows developer mode");
  const { store, root } = workspace(t);
  const target = join(root, "elsewhere");
  writeFileSync(target, "{}");
  const path = join(root, "documents/document/HEAD.json");
  rmSync(path);
  symlinkSync(target, path);
  assert.throws(
    () => new WorkspaceStore(root).get("document"),
    fails("CORRUPT"),
  );
  assert.equal(store.get("document").revision, 0);
});
test("v0 migration is explicit, validates its result, and rejects unknown versions", () => {
  const v0: any = document();
  v0.schemaVersion = 0;
  delete v0.rendererVersion;
  delete v0.revision;
  delete v0.comments;
  const migrated = migrateDocument(v0);
  assert.equal(migrated.schemaVersion, 1);
  assert.equal(migrated.revision, 0);
  assert.deepEqual(migrated.comments, []);
  assert.equal(v0.schemaVersion, 0);
  assert.throws(
    () => migrateDocument({ ...v0, schemaVersion: 99 }),
    fails("UNSUPPORTED_SCHEMA"),
  );
});
test("batch schemas reject excess and unknown operations; pure layer does not mutate input", () => {
  assert.throws(
    () =>
      parseBatch({
        operationId: "x",
        actor: "Agent",
        expectedRevision: 0,
        operations: [],
        extra: true,
      }),
    fails("VALIDATION"),
  );
  const doc = document();
  const edited = applyOperations(doc, [
    {
      type: "update_element",
      elementId: "title",
      patch: { text: "Different" },
    },
  ]);
  assert.equal(doc.pages[0].elements[0].text, "Original title");
  assert.equal(edited.document.pages[0].elements[0].text, "Different");
});
test("href null clears the persisted hyperlink and remains safely undoable", (t) => {
  const { store } = workspace(t);
  change(
    store,
    [
      {
        type: "update_element",
        elementId: "title",
        patch: { href: "https://example.com" },
      },
    ],
    "link",
  );
  change(
    store,
    [{ type: "update_element", elementId: "title", patch: { href: null } }],
    "clear",
  );
  assert.equal(
    Object.hasOwn(store.get("document").pages[0].elements[0], "href"),
    false,
  );
  store.undo("document", {
    operationId: "undo-clear",
    actor: "human",
    expectedRevision: 2,
    targetOperationId: "clear",
  });
  assert.equal(
    store.get("document").pages[0].elements[0].href,
    "https://example.com",
  );
});
test("retry IDs reject changed payload even when normalization produces the same value", (t) => {
  const { store } = workspace(t);
  const request = {
    operationId: "same",
    actor: "Agent",
    expectedRevision: 0,
    operations: [
      { type: "set_document", patch: { name: "Trimmed" } },
    ] as Operation[],
  };
  store.apply("document", request);
  assert.throws(
    () => store.apply("document", { ...request, actor: " Agent " }),
    fails("OPERATION_ID_REUSED"),
  );
});
test("unfinished document creation stays invisible to workspace enumeration", (t) => {
  const { store, root } = workspace(t);
  mkdirSync(join(root, "documents/.creating-unfinished"));
  writeFileSync(
    join(root, "documents/.creating-unfinished/HEAD.json"),
    "{partial",
  );
  assert.equal(new WorkspaceStore(root).list().length, 1);
  assert.equal(store.list()[0].id, "document");
});
test("asset registration is idempotent only for identical metadata", (t) => {
  const { store } = workspace(t);
  const asset = {
    id: "asset",
    name: "Logo",
    mime: "image/png" as const,
    bytes: 20,
    sha256: "a".repeat(64),
  };
  change(store, [{ type: "register_asset", asset }], "first");
  change(store, [{ type: "register_asset", asset }], "second");
  assert.deepEqual(store.get("document").assets, { asset });
  assert.throws(
    () =>
      change(
        store,
        [
          {
            type: "register_asset",
            asset: { ...asset, name: "Different name" },
          },
        ],
        "changed",
      ),
    fails("CONFLICT"),
  );
  assert.equal(store.get("document").revision, 2);
});
