# Release validation

Observed on 2026-09-17. Source tests, a genuine installed npm tarball, browser interaction, real agent hosts and visual inspection are distinct evidence below.

## 0.1.1 validation

The inspector acknowledgement fix and execution-time operation builders add five delayed-response browser regressions to the original release gates. The test holds both HTTP acknowledgements and document refreshes, reverses text and numeric edits, and preserves further focused typing and caret position; it was confirmed to fail before the fix and pass after it. Additional compound-edit tests cover independent table cells/row/column additions, crop axes, brand fields and components with an uploaded logo, rich formatting followed by text saves, layer/page order, grouping and page orientation. All four compound regressions were confirmed to fail against the prior UI and pass with execution-time builders. The patch candidate passed all six clean platform/Node combinations, including all 21 browser regressions and the installed-package smoke flow. The matrix below records this 0.1.1 implementation run.

## Local checks

- Final local candidate: **69/69 unit/integration tests**, **21/21 browser tests**, and the installed-package smoke test passed. The unit count includes three focused rich-text diff tests; no local tests were skipped.
- Strict TypeScript checking and production build pass.
- Unit/integration tests cover strict schemas, atomic batch failure, exact retries after restart, duplicate-operation payload conflicts, immutable revisions, crash recovery, document-identity isolation, guarded undo/redo, snapshots, variations, migration, safe imports and executable-content rejection.
- Actual child processes cover competing writers, concurrent stale-owner recovery, SIGKILL recovery, live-PID protection and stale-release safety.
- Service tests cover authentication, Host/Origin rejection, SSE, optimistic conflicts, selection, restart, occupied ports, atomic workspace identity initialization, identity/token rotation and rejection of incompatible service versions.
- Real Chromium exports verify PNG pixels, PDF native text/fonts, clickable links, page count, mixed dimensions, saved-revision consistency, overflow, cancellation and image decoding.
- Playwright browser tests exercise manual text edits, caret/focus preservation during unrelated updates, synthetic composition events, same-field conflicts, image upload, drag, keyboard movement, comments, agent edits, safe undo, snapshots, variations, bundle export, reload/reconnect, rich-text selection, grouping and keyboard dialogs. Deterministic delayed-response tests cover serialized browser writes, committed-but-aborted responses without automatic replay, switching documents while writes are pending and intervening agent changes.
- Further browser regressions preserve new typing during delayed text/format saves, retain newer remote conflicts, isolate drafts across documents with identical element IDs, retain rich formatting through plain edits and recover drafts after element/page deletion.
- A held-response regression queues multiple drags, resizes and nudges before earlier saves are acknowledged, then verifies every relative change accumulates. It was confirmed to fail against the earlier stale-coordinate implementation and pass with geometry derived from the latest saved state.

Native operating-system IME candidate windows are not automated; composition lifecycle events are tested in Chromium. Unsaved browser drafts are retained across incoming updates but are not persisted across closing the tab.

## Installed release package

`npm run test:pack` creates and scans an actual tarball, installs it with dependencies into a clean directory with spaces and Japanese characters, and launches the installed CLI/MCP server. It verifies human/agent HTTP+SSE changes, comments and selection, safe undo preserving human text, image import, snapshots, EOF, restart/recovery, variations, PDF/PNG/HTML/bundle exports, real MCP image bytes, a bundle round trip into a second workspace and another edit there. A separate missing-browser environment verifies actionable diagnostics and ordinary editing/HTML export without automatic provisioning. The package allowlist and contents are scanned for private/runtime files, credentials and machine paths.

The CI packed-package gate requires a working export browser; it cannot silently pass with PDF/PNG coverage skipped. Windows omits file-symlink creation tests that require developer-mode privileges and the owner-lock symlink subcase; directory-junction asset boundary checks still run.

An actual installed-package upgrade from 0.1.0 to 0.1.1 was also exercised: the new CLI rejected reuse of the still-running older service; after stopping it with the old CLI, the new service retained workspace identity, document IDs, saved text and revision history. Retrying the original operation deduplicated correctly, and a new edit plus PNG preview succeeded after the upgrade.

## Real MCP hosts

| Host | Version | Environment | Observed result |
| --- | --- | --- | --- |
| Codex CLI | 0.154.0 | macOS arm64; Node 26.5.0 | Workspace, template creation, read, atomic text edit, selection/comments read and actual PNG image inspection passed. Two invalid edit payloads were rejected; the corrected targeted batch succeeded. |
| Claude Code | 2.1.263 | macOS arm64; Node 26.5.0 | Brochure creation, atomic heading edit, actual PNG image inspection, anchored comment creation and comment read passed. |
| Official SDK client | 2.0.0 | Source and installed-package tests | Real stdio process and protocol discovery/calls passed; this is separate from real-host evidence. |

Codex described the edited cream serif heading, evergreen upper page, cream lower page, sage ring and peach shapes. Claude Code described the updated heading and terracotta courtyard illustration. Both reported visible image pixels and clear rendered content; neither was credited solely for receiving an image envelope.

Both real-host sessions were repeated against the CLI from a clean installation of the 0.1.1 candidate tarball at commit `932e08e`. Saved headings, histories and comment anchors were independently verified afterward: Codex revision 2 with one anchored comment; Claude revision 3 with an anchored heading comment added in a narrow host follow-up after its initial comment was document-level. The original comment was retained. Actual 794 × 1123 preview PNGs were also verified. Both host processes and the follow-up exited successfully, and both test workspace services were stopped.

No claim is made for other hosts or the Codex desktop app UI specifically. Host auth/session logs are private ignored artifacts and are not distributed.

## Visual inspection

All six pages across Fieldwork (one), Gather (three), and Signal (two) were inspected as rendered PNG and rasterized PDF. No clipping, broken alignment, missing bundled fonts or reported overflow remained. The localhost editor was inspected at desktop size; its original generic screenshot and short video are included as `demo.png` and `demo.webm`.

## Platform matrix

[The release implementation passed all six matrix jobs and the package job](https://github.com/borystam/mcp-visual-design-studio/actions/runs/35215370197) at commit `932e08e`. Subsequent release preparation changes only this validation report.

| Clean GitHub-hosted environment | Architecture | Observed Node versions | Result |
| --- | --- | --- | --- |
| Ubuntu 24.04.5 LTS | x64 | 22.12.0 and 24.20.0 | Both passed: 69 unit/integration tests, 21 browser tests and installed-package smoke. |
| macOS 26.6.2 (25G83) | arm64 | 22.12.0 and 24.20.0 | Both passed: 69 unit/integration tests, 21 browser tests and installed-package smoke. |
| Windows Server 2025 Datacenter (10.0.26100) | x64 | 22.12.0 and 24.20.0 | Both passed: 68 unit/integration tests plus one explicit symlink skip, 21 browser tests and installed-package smoke. |

Each installed-package run rendered PDF/PNG and real preview pixels, exported HTML and a portable bundle, imported into another workspace and continued editing. The package job produced an npm tarball and SHA-256 checksum only after every matrix job passed.

Local development and real-host tests additionally ran on macOS arm64 / Node 26.5.0. Firefox, Safari, native IME candidate windows, unsupported writing systems, remote-only hosts, network filesystems and other processor/OS combinations are unverified.
