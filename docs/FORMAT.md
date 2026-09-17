# Document format, tools and operations

Schema version **1**, renderer version **1**. `.vds.json` is a UTF-8 JSON project bundle, not a ZIP archive. A bundle contains `{format:"mcp-visual-design-studio",version:1,document,assets:[{id,data}]}` with base64 asset bytes (images and custom fonts). Imports validate the complete data tree, limits, image formats and hashes, then assign a fresh document identity. Images are content-addressed and immutable. All bundle assets must match the document asset table exactly.

A document contains stable IDs, name, schema/renderer versions, revision, timestamps, pages, a brand kit, asset metadata and anchored comments. A page has width, height, background and ordered elements. Element types are `text`, `image`, `shape`, `divider`, `table`, `group`. Only groups may contain children and a `position`, `stack` or `grid` layout. An optional embedded `designSystem` snapshot pins its ID/version, typed tokens, font faces/assets, component definitions, guidelines and rules. Elements may carry `tokenBindings` and historical `componentSource`; pages may carry `backgroundToken`. Legacy v1 documents need no rewrite; older application releases cannot read these new optional fields. Only approved data properties are accepted; no HTML, arbitrary CSS, scripts or network image sources.

Text supports plain `text`, optional rich `runs` (text/bold/italic/underline/href), bullet/number lists and an explicit element hyperlink. An `update_element` patch may set `href:null` to remove an explicit hyperlink. A plain text update clears stale rich runs unless runs are supplied in the same operation. Typography supports bundled Inter, Lora and monospace plus declared custom font families, weights 100–900, italic, underline, size, line-height, tracking, alignment and color. Latin and Latin Extended fonts are bundled; custom fonts can cover additional scripts, with actual font-loading and missing-glyph diagnostics. Native operating-system IME and untested scripts still require visual review.

Changing a palette or applying a saved kit remaps existing style values that match the previous kit’s color/font values across pages. Unmatched custom colors/fonts stay unchanged. Brand assets are registered atomically when applying a saved kit. These are explicit, undoable operations rather than arbitrary CSS variables.

Images use `assetId`, `fit` (cover/contain/fill) and `crop:{x,y}` percentage object-position. Tables contain rectangular arrays of native text cells. Groups support gap, columns, padding and nested editable children.

## Atomic mutation example

Read `document_read` first to get IDs and current revision, then call `document_apply`:

```json
{
  "documentId": "doc_...",
  "batch": {
    "operationId": "unique-operation-id",
    "actor": "agent:design",
    "expectedRevision": 3,
    "operations": [
      {"type":"update_element","elementId":"el_...","patch":{"text":"A clearer message","style":{"fontSize":36}}}
    ]
  }
}
```

A successful batch increments the revision once and returns documentId, revision, operationId, affectedElementIds and the saved document. Style patches merge individual style fields. The whole batch fails without partial edits if any operation or the resulting document is invalid.

Operations: `set_document`, `add_page`, `update_page`, `move_page`, `delete_page`, `add_element`, `update_element`, `move_element`, `delete_element`, `register_asset`, `add_comment`, `update_comment`. Discover their full strict schemas through MCP `tools/list`, or see `src/domain/operations.ts` in the repository. IDs accept 1–100 ASCII letters, digits, underscores and hyphens. Page/element coordinates and font sizes are bounded. Maximum document: 100 pages, 5,000 elements, nesting depth 12 and 16 MiB structured data; batch: 500 operations; image: 20 MiB (SVG: 1 MiB); total export assets: 75 MiB; bundle: 100 MiB. Animated images are rejected. MCP hosts may impose lower message-size limits; inspect small subtrees and use the browser bundle importer for files the host cannot send.

## MCP tools

- `workspace_open`, `document_list`, `document_create`, `document_read`, `selection_read`
- `document_apply`, `asset_import`, `brand_save`, `brand_apply`
- `design_system_list`, `design_system_read`, `design_system_preview`, `design_system_save`, `design_system_asset_import`, `design_system_set_default`, `design_system_apply`, `design_system_check`, `design_system_export`, `component_insert`
- `comments_read`, `comment_add`
- `history_read`, `history_undo`, `snapshot_create`, `snapshot_restore`, `document_duplicate`
- `preview_render`, `document_export`, `project_import`

The `design_workflow` prompt explains the inspect → targeted edit → render → inspect pixels → fix → export loop. `preview_render` returns standard MCP image content and readable structured diagnostics, not only a filename. `document_export` requires an explicit saved revision. A selected PNG page is best for detailed inspection; a whole-document PNG is a vertical contact sheet. PDF retains each page's dimensions, native text and clickable links. Export does not block newer edits from creating later revisions.

## Migration

Version 0 is the same structured tree with `schemaVersion:0` and optional revision/timestamps/renderer/assets/comments. The migration fills missing metadata, validates strictly and creates a new document with revision 0. Unknown/future schemas are rejected. This command does not reconstruct office files or arbitrary JSON:

```sh
mcp-visual-design-studio migrate --workspace "/absolute/path/to/designs" --file "imports/legacy.json"
```

Copy the original JSON into the workspace `imports` directory first. The source is preserved. Use bundle import for a portable project with assets.

See [Design systems](DESIGN_SYSTEMS.md) for token references, literal overrides, immutable versioning, custom font faces, native component variants/slots and portable system files. A system upgrade is an atomic document revision; existing saved exports remain tied to their embedded snapshot.
