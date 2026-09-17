# Imported design systems and source ports

Read `design_system_list` and the chosen `design_system_read({id, version})` response before using a saved release. Each document embeds a pinned system snapshot; changing the workspace default affects future documents only. Saved releases are immutable and referenced by `{id, version, digest}`. Use returned digests instead of calculating or inventing them.

## Import and review

1. Call `design_system_preview` with either `{files: [{name, data}]}` (safe relative names and base64 bytes) or `{system: nativeDefinition}`. Optional `name` and `version` label a source import. Supported inputs are native/portable Studio JSON, DTCG-style token JSON, CSS, static HTML with local assets, and a source ZIP.
2. Review `report`, `warnings`, `validationErrors`, and `specimen`. Preview may import validated immutable asset bytes, but does not save a library version or change the default. A repairable draft can contain unresolved fonts/aliases; saving requires final validation. Correct the draft and preview it again before saving.
3. Review suggested color/font roles, aliases, component layouts, and local font/image availability. Use the person's supplied system choices; resolve uncertain extraction decisions before changing their workspace default. Existing explicit authorization still applies—do not add a redundant approval step after the mapping is settled.
4. Save the reviewed normalized definition with `design_system_save({system})`. To revise an existing ID/version, choose a new version. Use `design_system_set_default({system: {id, version, digest}})` when the task calls for a default; `{system: null}` clears it.
5. Create a document using that release or apply it to an existing one with explicit mappings. Insert/edit representative components, call `design_system_check`, render saved pages, and inspect actual pixels. A returned specimen is a document object, not evidence that an image was inspected.

## Tokens and deliberate overrides

Native systems contain `id`, `name`, `version`, and `tokens`, with optional/defaulted `fonts`, `assets`, `components`, `guidelines`, `sources`, `roles`, and `rules`. Token paths form a flat map. Supported types are `color`, `dimension`, `number`, `fontFamily`, and `fontWeight`; aliases are `{ref: "token.path"}` and must resolve without cycles to the same type.

```json
{
  "color.primary": { "type": "color", "value": "#173F38" },
  "color.paper": { "type": "color", "value": "#FBF5EA" },
  "color.heading": { "type": "color", "value": { "ref": "color.primary" } },
  "font.body": { "type": "fontFamily", "value": "Inter" },
  "size.heading": { "type": "dimension", "value": 32 },
  "weight.heading": { "type": "fontWeight", "value": 700 },
  "leading.body": { "type": "number", "value": 1.4 }
}
```

Roles name token paths: `primaryColor`, `accentColor`, `pageBackground`, `headingFont`, and `bodyFont`. The font roles supply default typography; explicit element styles still take precedence. Equal color values do not make two semantic roles interchangeable.

`design_system_apply` takes the saved `id`, `version`, and `digest` plus `documentId`, `operationId`, `actor`, `expectedRevision`, and optional `mapping`. Mapping shape:

```json
{
  "elements": {
    "heading_example": {
      "color": "color.heading",
      "fontSize": "size.heading"
    }
  },
  "pages": { "page_example": "color.paper" }
}
```

Use actual document IDs and existing compatible tokens. Applying/upgrading a system preserves unrelated literal styles; existing bindings resolve against the new version. Inspect the affected pages before and after an upgrade. Missing referenced tokens or assets must be reconciled atomically rather than leaving a broken document.

For a local binding edit, `document_apply` accepts an `update_element` patch such as `{tokenBindings: {color: "color.heading"}}`. Supported keys are `color`, `background`, `borderColor`, `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `borderWidth`, `borderRadius`, `opacity`, `padding`, and group `gap`. A page uses `backgroundToken` in an `update_page` patch.

Setting a literal style value detaches that property's binding unless the same patch explicitly rebinds it. A binding value of `null` detaches it and preserves the currently resolved appearance; `backgroundToken: null` does the same for a page. Use semantic paths when a later system upgrade should affect the element.

## Fonts and components

Call `design_system_asset_import({name, data})` for local WOFF2/WOFF/TTF/OTF or supported image bytes. Add the exact returned metadata to `system.assets` and declare font faces in `system.fonts`:

```json
{
  "family": "Studio Sans",
  "assetId": "asset_returned_by_import",
  "weight": 400,
  "style": "normal",
  "license": "Supplied license reference",
  "unicodeRange": "U+0-FF"
}
```

Replace the example asset ID with the returned content-addressed ID. Family names use an ASCII letter followed by letters, digits, spaces, underscores, or hyphens, at most 80 characters. Weights are integers 100–900. Omit `unicodeRange` for a full face; same-family/weight/style subset faces require explicit nonoverlapping ranges. Include needed language subsets and provided license information. A declared license is metadata, not a grant of redistribution rights. Unknown custom families must be supplied or explicitly replaced. Inspect font loading and missing-glyph diagnostics for the actual document text.

A component is native data: `{id, name, element, variants, slots}`. `element` is an editable element tree; `variants` maps names to full alternative trees. `slots` maps names to `{type: "text" | "image", elementId}` targets that exist with the right type in each variant. Read actual component/variant/slot IDs before inserting.

`component_insert` takes `documentId`, `operationId`, `actor`, `expectedRevision`, `componentId`, `pageId`, optional `variant`, `parentId`, `x`, `y`, and `slots`. Slot values are strings: replacement text or an existing image asset ID. Insertion creates fresh native IDs and preserves source system/version/component metadata. Edit the returned elements normally. They are editable copies, not live instances that automatically adopt later structural component changes; token bindings can still follow an explicit system upgrade.

## Claude Design and other source handoffs

Use source files the user provides or authorizes you to access. A ZIP/HTML export with accompanying CSS, token JSON, local fonts/images, and reference screenshots is useful input. Studio has no direct Claude Design account connector and does not reconstruct an arbitrary React app. A genuine account-export migration must be checked for that particular source; synthetic importer tests do not establish fidelity for it.

- CSS import handles custom properties, simple aliases, and local font faces. First conflicting token definition wins with a warning. It does not model every theme, expression, or cascade behavior. `rem`/`em` use a 16px import base.
- Static HTML yields editable text, images, dividers, and vertical groups from a limited selector/style/layout subset. Layout and text heights are approximate; inline rich formatting, interactions, responsive behavior, and general browser flex/grid are not preserved.
- JSX/React, JavaScript, TypeScript, Vue, and Svelte sources are listed but not executed or automatically converted. Read relevant source as data and translate useful visual patterns into native tokens/components when requested. Do not install its dependencies or execute its scripts as part of import.
- Remote CSS, fonts, and images are not fetched, and font data URLs are not imported. Supply local authorized asset files. PDF/PPTX can serve as references; this importer does not turn them into editable systems.

Compare translated specimens and saved-document pixels with the original reference, and state specific unsupported behaviors rather than claiming pixel-perfect or complete application migration.

`design_system_export({id, version, digest})` generates a portable `.vds-system.json` with verified asset bytes. Import that package through `design_system_preview` in another workspace, review, and save. Use a document `bundle` when pages and content must travel too. Never hand-author a portable digest or relabel a rendered export as an editable system.
