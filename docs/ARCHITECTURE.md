# Architecture

One repository and one npm package contain five layers:

1. **Document domain** (`src/domain`): a strict, browser-safe TypeScript/Zod format, data-only element tree, validated atomic operations and versioned templates.
2. **Workspace service** (`src/server`): one exclusive owner for a canonical directory; persistent revision store, authenticated loopback HTTP API and SSE broadcasts.
3. **MCP adapter** (`src/mcp.ts`): official TypeScript SDK v2.0.0 over stdio, including legacy protocol negotiation. It calls the same HTTP operation endpoints as the editor. MCP stdout contains protocol traffic only.
4. **Browser editor** (`src/ui`): React components, page/layer navigation, inspector, draft conflict handling, selection, history and variations. EventSource reconnects and refreshes current state after missed events.
5. **Renderer/export worker** (`src/render`, `src/export`): shared React DOM/CSS, bundled fonts, a bounded isolated Playwright Chromium context for PNG/PDF, native PDF pages combined with pdf-lib. HTML and bundles do not require a browser.

The service is a detached process; agent sessions are clients. It uses a random loopback port and a descriptor with workspace identity, instance identity, exact application version, runtime version and a random token. Clients verify identity and compatibility before reuse. An atomically published nonempty ownership directory prevents competing writers. Recovery removes only the dead owner’s exact nonce marker before removing its empty directory, so a competing process cannot erase a new owner’s lock. Live process IDs are never taken over. No daemon is installed at login and no external server is contacted by ordinary editing.

## Durability and concurrency

Each atomic edit requires an actor, operation ID and expected revision. Validation runs before any write. A revision record includes the complete resulting document, a hash chain, operation metadata, request hash and guarded inverse field changes. It is written to a temporary file, fsynced, renamed and followed by an atomic HEAD update. Directory fsync is used where supported. Recovery verifies document identity, sequential revision numbers and hashes, then rolls HEAD forward to durable records. Partial temporary files are ignored; corrupt records stop recovery rather than silently discarding edits.

Exact retries return the original result even after restart or newer revisions. Reusing an operation ID with different content fails. Revision conflicts require inspection and a new targeted operation. The service never automatically replays a failed mutation.

Undo reverses a particular operation's changed fields after comparing their current values to that operation's output. Stable ID selectors preserve unrelated edits and tolerate later reordering. Structural edits use conservative array guards: they may refuse an undo rather than erase subsequent work. Undoing an undo provides redo. Snapshot restore requires the explicit current revision and creates a new reversible revision; it is a deliberate whole-document restore, so use a variation to preserve newer work before restoring.

## Editing conflicts

Text drafts remain in the browser while SSE refreshes the saved document. An unrelated change does not replace the textarea, reset its selection or interrupt composition. A conflicting remote text edit retains the local draft and offers Keep mine / Use saved. Keep mine is an explicit targeted save against the current revision. If an edited element or its page is deleted, a persistent inspector card retains the full draft and offers Copy draft, Recover as new text, or Discard draft. Recovery creates a new element on the original page when it still exists, otherwise on a remaining page, without restoring deleted structure or overwriting other edits.

Plain text editing in the inspector remaps unchanged Unicode characters to their previous rich-text runs, preserving unaffected bold/italic/underline styling and explicit links. Newly inserted characters use the element’s base typography. A bounded deterministic diff keeps large pastes responsive; very large replacements may reset run formatting inside the replaced region while retaining unchanged leading and trailing content. The inspector submits the resulting text and runs together.

Browser mutations execute sequentially. A queued edit may advance past acknowledged earlier edits from the same browser, but an intervening external revision requires review. An ambiguous failure cancels pending writes without replay. Switching designs cancels queued edits for the old design. Unsaved drafts are session-local, not durable until saved; export always uses saved content.

No remote multiplayer, CRDT, arbitrary JavaScript tool or model API is implemented. Comments are passive document data, not a push notification into the host's agent loop.

## Rendering

Coordinates are CSS pixels at 96 dpi; PDF sizes use 72/96 points per pixel. Image contents and fonts are embedded in standalone output. Export reads an immutable saved revision and its hash-verified assets before asynchronous rendering. Fonts, image decoding, links, page size/count and element overflow are reported. Bundles keep the full native document and assets; they omit runtime credentials, history and local paths.
