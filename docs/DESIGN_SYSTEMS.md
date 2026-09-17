# Bring your own design system

Studio stores reusable tokens, font files, native components and guidelines in a local Design Systems library. Every saved version is immutable. Documents embed the selected system and its assets, so opening a project does not depend on a remote design service or a later library update.

Studio does not require a model API key. Your connected MCP host supplies the agent and its existing model session; Studio provides import, review, editing, preview and export tools. For a Claude Design source, see [Porting from Claude Design](CLAUDE_DESIGN_PORTING.md).

## Import, review and use

1. Open **Design Systems** from the workspace or **Open Design Systems** in a document's inspector. Choose **Import system** and select a supported file or source ZIP.
2. Review the draft's tokens, font faces, components and guidelines. Inspect the specimen and **Import & validation notes**. A source import may write validated immutable assets to the local workspace, but it does not save a library version or change the default.
3. Correct suggested primary/accent colors, page background and heading/body font roles. Upload missing local fonts or images in **Assets**. Resolve unknown font names, token aliases and component errors. Unsupported source code is listed for agent translation.
4. Choose **Review & preview** after changes, then **Save immutable version**. To change an already saved definition, choose **Create new version** and save a new version number.
5. Choose **Use as workspace default** if future documents should use that exact version. Existing documents retain their embedded system. Clearing the default affects future creation only.
6. To change an existing document, choose the saved system and inspect its application preview. Explicitly map element properties and page backgrounds to tokens, then choose **Apply this mapping**. Existing token bindings resolve against the selected version; existing literal styles are retained unless explicitly mapped. Heading/body font roles also supply the document's default fonts.
7. Insert a component from the document's pinned system, choose its variant and fill text/image slots. The inserted result consists of editable native elements. Run system checks, inspect actual preview pixels and correct overflow before exporting a saved revision.

## Supported sources

| Input                                      | Imported data                                                                                                       | Review boundaries                                                                                                                                                                   |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native Studio system JSON                  | The schema below                                                                                                    | Asset metadata alone does not carry bytes. Import assets first, or use the portable format.                                                                                         |
| Portable `.vds-system.json`                | Complete system plus embedded font/image bytes and digest                                                           | Exact metadata, content hashes and references are checked.                                                                                                                          |
| DTCG-style token JSON                      | `color`, `dimension`, `number`, `fontFamily`, `fontWeight`; nested groups and token aliases                         | This is a subset, not full DTCG conformance. Typography composites are flattened into individual property tokens. Other token types and unsupported values produce review warnings. |
| CSS                                        | Custom properties, simple `var(--token)` aliases and local `@font-face` declarations                                | First conflicting token definition wins with a warning. Theme scopes, computed expressions such as `calc()`, and the complete CSS cascade are not modeled.                          |
| Static HTML plus CSS/assets                | Selected sections, cards and other static content translated into native text, images, dividers and vertical groups | Layout and text heights are approximated. Scripts, events, responsive behavior and general flex/grid layouts are not converted.                                                     |
| Source ZIP                                 | Supported files above, local fonts/images and relevant guideline/license text                                       | Source is read as data. JavaScript, TypeScript, JSX, Vue and Svelte files are listed but never executed or automatically converted to components.                                   |
| WOFF2, WOFF, TTF, OTF and supported images | Immutable local assets                                                                                              | Font family, weight, style, Unicode subsets and license information need review.                                                                                                    |

DTCG dimensions accept numeric pixels, supported CSS dimension strings, or `{ "value": 16, "unit": "px" }`. Supported units are `px`, `rem`, `em` and `pt`; `rem`/`em` use a fixed 16px import base, and points use 96/72 CSS pixels. Color input includes supported CSS colors and DTCG sRGB component objects; normalized colors are hex or `transparent`. Font-family lists use their first entry. Aliases become `{ "ref": "token.path" }` and must resolve to a compatible token type without cycles.

Static HTML extraction recognizes simple tag, class, ID and descendant selectors, inline styles, selected text/box properties, and local images. It prefers `article`, `section`, `data-component` and common card-like classes; at most 30 candidates per HTML file and 50 components per source import are extracted. Inline rich formatting and full browser layout semantics are not preserved by this importer. A normalized native component can express richer runs, tables, absolute layouts, stacks and grids directly.

No remote CSS, fonts, images or source URLs are fetched. CSS font data URLs are also not imported: provide the actual font files. ZIP files must use safe relative paths and cannot contain encrypted entries or symbolic links. Limits are 100 MiB per archive/portable package, 1,000 extracted files, 20 MiB per file, 75 MiB combined extracted assets/source files, and 2 MiB per text source file. A source archive is unpacked once; nested archives are not recursively imported.

## Native system schema

The authoritative validators are [`src/domain/model.ts`](../src/domain/model.ts) and [`src/domain/design-system.ts`](../src/domain/design-system.ts). A minimal useful system is:

```json
{
  "id": "example_studio",
  "name": "Example Studio",
  "version": "1.0.0",
  "tokens": {
    "color.primary": { "type": "color", "value": "#173F38" },
    "color.paper": { "type": "color", "value": "#FBF5EA" },
    "color.heading": { "type": "color", "value": { "ref": "color.primary" } },
    "font.body": { "type": "fontFamily", "value": "Inter" },
    "size.heading": { "type": "dimension", "value": 32 },
    "weight.heading": { "type": "fontWeight", "value": 700 },
    "leading.body": { "type": "number", "value": 1.4 }
  },
  "fonts": [],
  "assets": {},
  "components": [
    {
      "id": "heading",
      "name": "Section heading",
      "element": {
        "id": "heading_text",
        "type": "text",
        "name": "Heading",
        "x": 0,
        "y": 0,
        "width": 500,
        "height": 90,
        "style": { "fontFamily": "Inter", "fontSize": 32, "fontWeight": 700 },
        "text": "Your heading",
        "tokenBindings": {
          "fontFamily": "font.body",
          "fontSize": "size.heading",
          "fontWeight": "weight.heading",
          "color": "color.heading"
        }
      },
      "variants": {},
      "slots": { "heading": { "type": "text", "elementId": "heading_text" } }
    }
  ],
  "guidelines": ["Use short headings and generous space around each section."],
  "sources": [],
  "roles": {
    "primaryColor": "color.primary",
    "pageBackground": "color.paper",
    "headingFont": "font.body",
    "bodyFont": "font.body"
  },
  "rules": { "minimumFontSize": 12 }
}
```

`id` is a stable identifier; `version` is a three-part version with an optional prerelease suffix. A saved reference is `{ "id": "…", "version": "…", "digest": "…" }`, where the server computes the SHA-256 digest of canonical system data. Reusing an ID/version with changed data is rejected.

`tokens` is a flat path-to-token map, with at most 2,000 tokens. Components have an `element` tree, optional description, a variant-ID-to-element-tree map, and named text/image slots targeting element IDs. A system supports at most 200 components, 200 font faces and 1,000 assets. Guidelines are design data, not executable instructions.

Native element `tokenBindings` support `color`, `background`, `borderColor`, `fontFamily`, `fontSize`, `fontWeight`, `lineHeight`, `letterSpacing`, `borderWidth`, `borderRadius`, `opacity`, `padding` and group `gap`. Page `backgroundToken` names a color token. Bindings retain semantic token paths and literal style fallbacks; all shared renderers resolve the same saved snapshot. Rules can request token bindings and a minimum font size. System checks identify these issues and component provenance; they do not replace visual review.

## Custom fonts

Import font bytes through Assets or `design_system_asset_import`. Add the returned asset metadata to `system.assets`, then declare a face:

```json
{
  "family": "Studio Sans",
  "assetId": "asset_<sha256 returned by import>",
  "weight": 400,
  "style": "normal",
  "license": "License name or permission reference",
  "unicodeRange": "U+0-FF"
}
```

The example asset ID is a placeholder; use the exact returned ID. Family names start with an ASCII letter and contain up to 80 letters, digits, spaces, underscores or hyphens. Weight is an integer from 100 to 900; style is `normal` or `italic`. `license` and `unicodeRange` are optional. License metadata records your supplied reference; importing a font does not grant redistribution rights.

Omit `unicodeRange` for a full face. Multiple files with the same family, weight and style require explicit, disjoint Unicode ranges. Ranges accept comma-separated `U+hex`, `U+start-end` or trailing `?` wildcards and are normalized to explicit ranges; at most 32 ranges and 1,024 characters are accepted. Upload the needed language subsets. A variable font is declared at a chosen weight; arbitrary variation-axis controls and CSS weight ranges are not exposed.

Fonts are validated by magic bytes, table bounds and bounded decompression, then parsed for metadata. Collections and fonts with embedded SVG/bitmap glyph tables are rejected. Assets are immutable and hash checked; MIME relabeling is rejected. Imported faces are scoped to their asset identities, so two saved systems can safely use the same family name.

Editor, specimen, PNG, PDF and HTML use the same faces. Browser export diagnostics report faces actually used by text, failed font loads and custom-font characters that fall back because the font or declared Unicode ranges lack them. PDFs retain native text and Unicode mappings; the browser may represent CFF outlines as Type 3 fonts. Font binaries and image bytes travel with portable systems and editable project bundles.

## Portable files and MCP workflow

**Export system** creates this versioned envelope:

```json
{
  "format": "mcp-visual-design-system",
  "version": 1,
  "system": { "...": "validated native system" },
  "digest": "sha256 of canonical system data",
  "assets": [{ "id": "asset_<sha256>", "data": "base64 file bytes" }]
}
```

This is an explanatory shape, not a ready-to-import package. Let **Export system** or `design_system_export` generate the digest and bytes. Import the resulting `.vds-system.json` in another workspace, review and save it there. A system package differs from an editable `.vds.json` document bundle: the latter also carries pages, editable content, comments and the document's pinned system snapshot. HTML embeds assets for standalone viewing; PNG and PDF are rendered outputs.

An agent should call `design_system_list`/`design_system_read`, then `design_system_preview` with either `{ "files": [{ "name": "source.zip", "data": "<base64>" }] }` or `{ "system": <native-system> }`. It should inspect warnings, validation errors and the specimen with the person before `design_system_save` and any default change. Use `design_system_set_default` with the exact saved reference, or `null` to clear it.

`design_system_apply` takes that reference, a document ID, actor, expected revision, unique operation ID and optional explicit mappings. `component_insert` inserts native components with variant and slot overrides. Finish with `design_system_check`, `preview_render` and inspection of the returned image before `document_export`. Conflicts require reading the current revision again. Studio uses the connected host's model for source interpretation; it does not execute uploaded code or contact a model provider itself.
