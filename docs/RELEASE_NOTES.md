# 0.1.1

Fix a timing-sensitive inspector edit: immediately clearing a just-saved link or restoring a just-changed numeric value now queues the deliberate edit even before the earlier save reaches the browser. Untouched fields still produce no mutation. Additional delayed-response tests cover link/numeric reversals and preservation of a newer focused draft.

The application format and features are unchanged. Stop any workspace service started by 0.1.0 before installing the 0.1.1 tarball, then reconnect; saved documents remain in the external workspace. Registry publication has not been performed.

# 0.1.0

Initial open-source release of MCP Visual Design Studio: a local, persistent visual document editor shared by a person and an MCP agent.

Includes original service-sheet, three-page brochure and visual-report templates; structured editable elements and page controls; native text/rich runs, images and layout; reusable local brand kits; comments and selection context; live updates; guarded operation history, snapshots and variations; PDF/PNG/HTML/editable-bundle exports; explicit export-browser provisioning; loopback authentication and bounded imports.

This is an early 0.x release. Structural undo intentionally refuses overlapping later changes. Only bundled Latin/Latin Extended fonts are supported. Comments require the host to read them; no idle-agent wakeup is provided. No cloud collaboration, model chat, advanced vectors, animation or office-file reconstruction is included.

Install the attached npm tarball. Registry publication has not been performed. See VALIDATION.md for verified tests and host/platform limits.
