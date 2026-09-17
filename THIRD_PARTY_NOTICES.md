# Third-party notices

Original Studio code, UI, templates and generic example content are MIT licensed (see LICENSE). No customer material or externally sourced photography is included.

Runtime dependencies retain their own licenses, installed by npm:

- Official Model Context Protocol TypeScript SDK v2 and related packages — MIT, Anthropic / Model Context Protocol contributors.
- React and React DOM — MIT, Meta Platforms and contributors.
- Zod — MIT, Colin McDonnell and contributors.
- Playwright — Apache-2.0, Microsoft. Chromium and its dependencies have separate upstream notices and are downloaded only by the explicit setup command.
- pdf-lib — MIT, Andrew Dillon and contributors.
- @xmldom/xmldom — MIT, xmldom contributors.

Bundled font binaries are distributed under the SIL Open Font License 1.1. Full copyright and license text is preserved alongside the fonts:

- Inter — `assets/fonts/Inter-OFL.txt`, Rasmus Andersson and contributors.
- Lora — `assets/fonts/Lora-OFL.txt`, The Lora Project Authors.
- IBM Plex Mono — `assets/fonts/IBMPlexMono-OFL.txt`, IBM Corp.

The fonts were obtained through Fontsource. Fonts are unmodified except selecting original Latin and Latin Extended WOFF2 files. Font names are retained as required by their notices. Build tools and test-only dependencies are not included as application runtime code except Vite's built browser output; Vite is MIT licensed, and TypeScript is Apache-2.0 licensed. See package-lock.json for exact resolved dependency versions.
