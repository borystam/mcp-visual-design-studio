# Release validation

Observed on 2026-09-17. Source tests, installed-package tests, browser interactions, real MCP hosts and visual inspection are separate evidence. Historical 0.1.1 evidence is preserved in [VALIDATION_0.1.1.md](VALIDATION_0.1.1.md).

## 0.2.0 local checks

Strict TypeScript checking and the production build pass. The candidate passed 119 unit/integration tests with no local skips, all 24 browser tests, and the installed-package smoke gate. Platform results are recorded separately below.

New domain and service tests cover typed token aliases, missing/circular references, font declarations and Unicode subsets, immutable versions/digests, explicit application mappings, historical component provenance, editable slots, guarded undo, default pins and restart persistence. Existing operation/concurrency, delayed-response editing, caret, crash-recovery and export regressions continue to run.

Source-import tests cover supported DTCG values, static CSS/HTML, original ZIP fixtures, local fonts and license notes, portable system round trips, malformed/tampered assets, ZIP traversal/symlinks/duplicate paths/decompression limits, bounded source trees and alias inference, preserved inherited token bindings, consistent imported text line heights, and repairable missing-font drafts. Imported application code is not executed; external assets are not fetched.

The three new browser workflows cover the complete import/review/save/default/create/insert/edit/export lifecycle, explicit mappings with an active text draft, and token/ZIP imports with missing-font validation. They also verify live workspace-default updates, version pins, imported font choices, direct image insertion and modal keyboard focus. The previous 21 editing and synchronization regressions pass alongside them.

## Installed package and portability

`npm run test:pack` builds and scans an actual tarball, installs its dependencies into a fresh directory containing spaces and Japanese characters, and drives the installed stdio MCP server and HTTP editor service. It retains all prior release checks and discovers the ten additional design-system/component tools.

The new packed workflow imports original HTML/CSS and licensed local WOFF2 subsets, verifies exact preview/save digests, rejects mutable version replacements, pins workspace defaults, creates documents, inserts and edits native component slots, retries the original insert after a later edit, and runs system checks. It exports real PNG/PDF and standalone HTML with custom-font diagnostics, transfers a portable system into a fresh workspace, then transfers a self-contained editable project bundle and edits it again.

Custom-font tests exercise WOFF2, WOFF, TTF and OTF validation, bounded container decoding, immutable asset verification and safe paths. Real Chromium renders verify font selection, missing glyphs, subset coverage and identical PNG pixels after a fresh-workspace bundle round trip. PDF tests verify selectable text and embedded fonts, including the original tiny MIT-licensed CFF/OTF fixture. Original font-generation source is included with the tests.

An actual installed 0.1.1 → 0.2.0 upgrade was exercised: the new CLI rejected reuse of the older running service; after stopping it, workspace identity, saved text, revisions and exact-operation deduplication survived. A subsequent edit and actual PNG preview succeeded. Older documents need no bulk rewrite; documents using new optional design-system fields require 0.2.0 or newer.

## Visual inspection

The design-system library, token editor/specimen, explicit application preview, missing-font repair state and document component/asset controls were inspected at 1440 × 1080. The screenshots use original generic fixtures. No clipping or broken alignment remained. The original template/export visual evidence remains in the historical report.

## Claude Design migration boundary

**A genuine Claude Design account export has not been tested end to end.** The available browser session was signed out, and no real export was supplied. Original synthetic source ZIP/HTML fixtures establish the supported importer/editor/export behavior; they do not establish compatibility with every Claude Design export version or project.

The [porting guide](CLAUDE_DESIGN_PORTING.md) documents the official ZIP/standalone-HTML handoff and the supported static subset. React/JSX and other executable source require translation by the user's connected agent. Full application behavior, responsive logic, PDF/PPTX reconstruction and automatic account connection are outside the importer.

## Real MCP hosts

Both hosts ran against a clean installed 0.2.0 candidate using original generic HTML/CSS and the tiny original OTF fixture. Temporary invocation settings preserved the user’s normal host configuration. Each host imported the source ZIP, saved a system and workspace default, created a document using that default, inserted a native component with a heading slot override, separately edited its body text, checked and rendered the document, added/read an anchored comment, and exported the portable system.

| Actual host | Version / environment              | Observed result                                                                                         |
| ----------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Claude Code | 2.1.263; macOS arm64 / Node 26.5.0 | Exit 0; 13 tool calls; native edit, actual preview pixels, anchored comment and portable export passed. |
| Codex CLI   | 0.154.0; macOS arm64 / Node 26.5.0 | Exit 0; 15 tool calls; discovered the documented update operation and completed the same workflow.      |

Both described the cream page, green card, cream serif/sans text and three peach upright triangle glyphs from the custom OTF. Both reported loaded Lora 700, Inter 400 and Studio Outline 400 faces, with no overflow, font warnings or system-check findings. Receiving an image envelope alone was not counted as image inspection.

Independent checks afterward verified each revision-3 saved document, revision-2 preview, pinned snapshot/default identity, four native elements, edited body text, anchored comment, exact font bytes and portable-system reimport in a fresh asset directory. Both workspace services were stopped. The tested host candidate tarball’s SHA-256 was `1623db0a43d6d26dea05d3fcbf636b7e1c667e95cceb20430a1c7a6468a33d0a`; final source subsequently tightened oversized CSS token/alias bounds and library file-identity checks, covered by the complete local and installed-package gates above.

The initial host run exposed inherited/default line-height disagreement and a flattened tool-schema description that left Codex without a clear operation example. The importer now explicitly records its estimated line height, and the tool description includes a valid edit example; both real hosts were repeated successfully with the original source fixture and prompt. Previous 0.1.1 checks remain historical evidence in the linked report. Host auth/session logs stay in ignored private artifacts and are not distributed. Claude Code host success does not establish a genuine Claude Design account migration.

## Platform matrix

[The 0.2.0 implementation passed all six matrix jobs and the package job](https://github.com/borystam/mcp-visual-design-studio/actions/runs/35224629804) at commit `5b1ce10`. Release preparation afterward changes only this validation report.

| Clean GitHub-hosted environment | Architecture | Observed Node versions | Result                                                                                                                |
| ------------------------------- | ------------ | ---------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Ubuntu                          | x64          | 22.12.0 and 24.20.0    | Both passed: 119 unit/integration tests, 24 browser tests and installed-package smoke.                                |
| macOS                           | arm64        | 22.12.0 and 24.20.0    | Both passed: 119 unit/integration tests, 24 browser tests and installed-package smoke.                                |
| Windows Server 2025             | x64          | 22.12.0 and 24.20.0    | Both passed: 118 unit/integration tests plus one explicit symlink skip, 24 browser tests and installed-package smoke. |

The release uses the existing clean GitHub-hosted Ubuntu/macOS/Windows matrix with Node 22.12.0 and 24. Each job runs checking, build, unit/integration tests, all browser tests and the installed-package gate. PDF/PNG coverage cannot silently skip when the export browser is missing. Windows omits privileged file-symlink cases while directory-junction asset boundary checks still run. The first 0.2.0 matrix exposed a Windows/Node 22 mismatch between path and descriptor identity metadata. Library reads now retain precise BigInt identities, compare Windows volume/file IDs between handles, recheck the path, and bound reads to the verified size. Six additional regressions cover replacement, symlink, volume, precision and growth cases. The successful rerun recorded Windows/Node 22 path `dev=0` and a nonzero descriptor device ID with identical precise inodes; Node 24 reported matching device IDs. Both Windows versions passed the full corrected workflow.

Local development runs on macOS arm64 / Node 26.5.0. Firefox, Safari, native operating-system IME candidate windows, unsupported writing systems, remote-only hosts, network filesystems and other processor/OS combinations remain unverified. Chromium composition lifecycle events are automated; unsaved drafts are not persisted after closing the tab.
