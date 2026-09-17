# Third-party notices

Original Studio code, UI, templates and generic example content are MIT licensed (see LICENSE). No customer material or externally sourced photography is included.

Runtime dependencies retain their own licenses, installed by npm:

- Official Model Context Protocol TypeScript SDK v2 and related packages — MIT, Anthropic / Model Context Protocol contributors.
- React and React DOM — MIT, Meta Platforms and contributors.
- Zod — MIT, Colin McDonnell and contributors.
- Playwright — Apache-2.0, Microsoft. Chromium and its dependencies have separate upstream notices and are downloaded only by the explicit setup command.
- pdf-lib — MIT, Andrew Dillon and contributors.
- @xmldom/xmldom — MIT, xmldom contributors.
- Fontkit 2.0.4 — MIT, Devon Govett and contributors; font container/metadata and glyph-coverage parsing. The published package declares MIT in its `package.json` and README; see [upstream package metadata](https://github.com/foliojs/fontkit/blob/v2.0.4/package.json).
- yauzl 3.4.0 — MIT, Josh Wolfe; bounded ZIP source reading.
- PostCSS 8.5.28 — MIT, Andrey Sitnik and contributors; static CSS parsing.
- parse5 8.0.1 — MIT, Ivan Nikulin and contributors; static HTML parsing.
- Culori 4.0.2 — MIT, Dan Burzo and contributors; imported color normalization.

These import/font dependencies run in the Node service and are installed as their original npm packages with their upstream license metadata/notices and transitive dependencies. They are not copied into Studio's browser bundle or vendored into `assets/licenses`. The current production browser module graph was checked after adding design systems: its package modules remain React, React DOM, Scheduler and Zod; generated build helpers are covered below.

Bundled font binaries are distributed under the SIL Open Font License 1.1. Full copyright and license text is preserved alongside the fonts:

- Inter — `assets/fonts/Inter-OFL.txt`, Rasmus Andersson and contributors.
- Lora — `assets/fonts/Lora-OFL.txt`, The Lora Project Authors.
- IBM Plex Mono — `assets/fonts/IBMPlexMono-OFL.txt`, IBM Corp.

The production browser bundle includes the following third-party code. Exact upstream copyright and license texts are shipped in the package, even when minification removes source comments:

| Bundled code                              | Upstream version used in this release | Preserved license                                                                                                                                  |
| ----------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| React, including JSX runtime              | 19.3.0                                | [React MIT license](assets/licenses/react-LICENSE.txt)                                                                                             |
| React DOM, including the client renderer  | 19.3.0                                | [React DOM MIT license](assets/licenses/react-dom-LICENSE.txt)                                                                                     |
| Scheduler, used by React DOM              | 0.28.0                                | [Scheduler MIT license](assets/licenses/scheduler-LICENSE.txt)                                                                                     |
| Zod browser validation                    | 4.6.5                                 | [Zod MIT license](assets/licenses/zod-LICENSE.txt)                                                                                                 |
| Vite module-preload runtime helper        | 8.3.0                                 | [Complete Vite upstream license and notices](assets/licenses/vite-LICENSE.md)                                                                      |
| Rolldown generated module/runtime helpers | 1.2.9                                 | [Rolldown MIT license](assets/licenses/rolldown-LICENSE.txt) and [upstream derived-code notices](assets/licenses/rolldown-THIRD-PARTY-LICENSE.txt) |

The complete Vite and Rolldown upstream notices are retained without modification; their inclusion does not mean the development tools themselves are shipped as runtime dependencies. The production build module graph was inspected to identify the bundled packages and virtual runtime modules.

The fonts were obtained through Fontsource. Fonts are unmodified except selecting original Latin and Latin Extended WOFF2 files. Font names are retained as required by their notices. Build tools and test-only dependencies are not included as application runtime code except the generated browser runtime helpers identified above; TypeScript is Apache-2.0 licensed. See package-lock.json for exact resolved dependency versions.

The small `tests/fixtures/custom-outline.otf` font is an original MIT-licensed test fixture made from simple triangle outlines. Its reproducible generator is alongside it; tests and that fixture are excluded from the npm package. User-imported fonts, logos and other design-system assets retain their original rights. A font face’s optional `license` field records user-supplied information and does not change the asset’s license. No Claude Design account export or customer design-system source is distributed with Studio.
