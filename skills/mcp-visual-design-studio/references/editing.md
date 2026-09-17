# Editing and export details

Read only the current document or needed subtree. `document_read` accepts `{documentId, revision?, elementId?}`; an element read returns its subtree and the document revision. `selection_read({documentId})` returns selected IDs and relevant comments. Existing IDs come from these responses; new IDs must be unique within the document and use 1–100 ASCII letters, digits, underscores, or hyphens.

## Atomic edits

The following is a shape example. Replace the document/element IDs and revision with observed values; generate a fresh operation ID for a new mutation.

```json
{
  "documentId": "doc_example",
  "batch": {
    "operationId": "edit_heading_01",
    "actor": "agent:design",
    "expectedRevision": 3,
    "operations": [
      {
        "type": "update_element",
        "elementId": "heading_example",
        "patch": {
          "text": "Make room for ideas.",
          "runs": [
            { "text": "Make room", "bold": true },
            { "text": " for ideas." }
          ],
          "style": { "fontSize": 32 }
        }
      }
    ]
  }
}
```

- Style patches merge individual fields. Plain `text` updates clear old rich runs unless `runs` is supplied in the same operation. Preserve existing formatting and links by updating matching runs together with the text; `runs: []` is a deliberate reset. Run text must concatenate to the element's text. `href: null` removes an element-level link.
- Geometry uses CSS pixels. A new element requires `id`, `type`, `name`, `x`, `y`, `width`, `height`, and `style`. Only groups accept `children`, `layout` (`position`, `stack`, `grid`), `gap`, and `columns`. Child positions belong to their group. Stack/grid layout controls placement, so do not treat those children as independent page coordinates.
- Use `add_element` with `pageId`, optional `parentId`, and a native `element`. To reparent or reorder, use `move_element` with `elementId`, destination `pageId`, optional `parentId`, and `index`. Do not replace whole page arrays to make a local edit.
- Supported operation types are `set_document`, `add_page`, `update_page`, `move_page`, `delete_page`, `add_element`, `update_element`, `move_element`, `delete_element`, `register_asset`, `add_comment`, and `update_comment`. Discover their strict live schemas before using an unfamiliar operation. Batches support at most 500 operations; keep normal edits substantially smaller.
- Composite values such as `runs`, table `cells`, and the brand object are replacements. Construct them from the current state and preserve unrelated content. Prefer token bindings for design-system styles rather than literal-value color remapping through legacy brand kits.

## Assets, history, and collaboration

Import approved local image bytes with `asset_import({documentId, name, data, expectedRevision, operationId, actor})`, where `data` is base64. It registers a content-addressed asset as a document revision; use its returned `asset.id` in an image element, then use the returned revision for insertion. Do not invent hashes or point image elements at network URLs. `fit` is `cover`, `contain`, or `fill`; `crop: {x, y}` is percentage object-position.

Use `history_read({documentId})` to inspect operation IDs and snapshots. `history_undo` requires `documentId`, a new `operationId`, `actor`, current `expectedRevision`, and `targetOperationId`. If it conflicts, inspect the overlapping later edit instead of restoring an old whole-document copy. `snapshot_create({documentId, name})` records a named revision; `snapshot_restore` requires its `snapshotId` plus the usual mutation identity/current revision. Use `document_duplicate({documentId, name, revision?})` for comparison without changing the original.

`comment_add` requires a stable comment ID, operation ID, actor, current revision, text, and ISO `createdAt`; optional `pageId`/`elementId` anchor it. Keep IDs and timestamp identical on an exact retry. Creating a comment does not cause another host's idle agent to respond.

## Render and export

`preview_render({documentId, revision, pageId?})` returns standard MCP PNG image content plus diagnostics. Inspect a selected page at useful resolution; omitting `pageId` produces a whole-document vertical contact sheet. If the host cannot expose returned pixels, use the browser/local preview through available tools or disclose that pixel inspection was unavailable.

`document_export({documentId, revision, format, pageId?})` returns the output location and diagnostics. Reuse the reviewed saved revision even if another editor has since created a newer one.

| Format   | Purpose                                                                                 |
| -------- | --------------------------------------------------------------------------------------- |
| `pdf`    | Paginated print/share output; retains native text and links.                            |
| `png`    | Selected page or whole-document contact sheet.                                          |
| `html`   | Standalone viewing with embedded assets.                                                |
| `bundle` | Editable `.vds.json` project with pages, comments, pinned system, and font/image bytes. |

`project_import({data})` imports base64 bundle bytes into the connected workspace with a fresh document identity. A project bundle is JSON, not ZIP; it is distinct from a portable design-system package. If transfer is required, verify the imported document can still be edited. Large base64 requests may exceed the host's limits even when Studio accepts them; use the editor's importer rather than splitting a package into invalid fragments.
