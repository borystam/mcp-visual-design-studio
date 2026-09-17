# Troubleshooting and migration

Run `mcp-visual-design-studio doctor --workspace "your workspace"` first. It reports Node version, workspace access, service identity and Chromium launch health without downloading anything.

| Symptom | Resolution |
| --- | --- |
| PDF/PNG says browser missing | Run `mcp-visual-design-studio setup-export`; Linux may need `setup-export --with-deps`. Continue editing or export HTML/bundle meanwhile. |
| MCP command not found in GUI host | Use the full installed executable path and restart the host's MCP connection. Shell PATH and desktop PATH can differ. |
| Unauthorized editor | Re-run `editor` or use a fresh `workspace_open` link. Restart rotates tokens. |
| Different Studio version owns workspace | Stop the old service using its version's `stop` command, then start the upgraded package. Do not delete documents. |
| Workspace owned after a crash | Reconnect to recover a dead owner; live process IDs are never taken over. Inspect `.runtime/service.log` if startup still fails. |
| Revision conflict | Read current document again, compare the intended fields and submit a new targeted batch. Do not replay blindly. |
| Undo conflict | Later work overlaps that operation. Undo conflicting later operations first, or apply a targeted edit. Use a variation before snapshot restore. |
| Text conflict | The local draft remains visible. Choose Keep mine to explicitly save it, or Use saved to discard it. |
| Element or page deleted while editing | The retained-draft card keeps the unsaved text. Copy it, recover it as a new text element on a remaining page, or explicitly discard it. Keep the tab open until the draft is recovered or copied. |
| Formatting after a text edit | Unchanged text keeps its run formatting and links; newly typed text uses base typography. Select words and use B/I/U to format them. Very large replacements can reset formatting inside the replaced region. |
| Pending changes cancelled | A prior save failed, an agent changed the document while edits waited, or the selected design changed. Inspect the saved state and submit the intended edit again; Studio does not replay ambiguous writes automatically. |
| Text clipped in export | Inspect the returned overflow diagnostics. Increase bounds or reduce type size, render again, then export. |
| Missing glyphs | Fonts cover Latin/Latin Extended. Unsupported writing systems need fonts that this release does not yet import. |
| Service keeps running after host closes | This preserves browsers and other agents. Use `stop` when finished. |
| No automatic agent response to comments | Ask your host to read comments. An idle agent is not automatically awakened. |
| Corrupt revision/recovery identity error | Stop the service, preserve the workspace, and restore a known backup. Do not copy another document's revision files into the damaged directory. |

`migrate` supports version 0 of Studio's own structured format; [format documentation](FORMAT.md) describes the exact source shape. Migration preserves the source and creates a fresh document. Unknown schemas are rejected rather than guessed. For ordinary upgrades, retain the external workspace and install the new tarball; run `doctor`, then reconnect.

The service selects an available port, so no fixed port needs to be free. Workspaces with spaces and non-ASCII names are supported; always quote paths in shell commands. Use local disks with normal exclusive-directory and atomic-rename semantics; network filesystems and synchronized cloud folders are not a supported concurrent-storage backend.
