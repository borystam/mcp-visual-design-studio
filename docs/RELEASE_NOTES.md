# 0.2.0

Bring your own design system: import token JSON, CSS, static HTML, source ZIPs and portable Studio system files; review extracted tokens, assets, components, fonts and guidelines before saving an immutable version. Choose a workspace default, apply or upgrade systems with explicit mappings, bind native elements to semantic tokens, and insert editable component variants with text/image slots.

Custom WOFF2/WOFF/TTF/OTF fonts and Unicode subsets use the same renderer in the editor, PNG/PDF and standalone HTML. Portable project and system exports include required fonts and images. New checks report token usage, component provenance, font loading and missing glyphs. Source code is never executed; unsupported React behavior requires translation by the connected agent.

See DESIGN_SYSTEMS.md and CLAUDE_DESIGN_PORTING.md for exact import limits and evidence. A genuine Claude Design account migration is not claimed without a supplied real export or authenticated session. Stop older workspace services before upgrading. Existing legacy documents/history remain readable without a bulk rewrite; documents using the new fields require 0.2.0 or newer. npm registry publication remains unperformed.

# 0.1.1

Fix rapid consecutive inspector edits. Deliberate link/numeric reversions now save even before an earlier response reaches the browser. Compound changes to table cells, brands, crop axes, rich formatting, groups, page dimensions and ordering derive from the latest saved state when they execute, preserving earlier queued edits. Untouched fields still produce no mutation, and intervening changes from another actor still require review. Delayed-response regressions cover these cases and preservation of newer focused drafts.

The application format and features are unchanged. Stop any workspace service started by 0.1.0 before installing the 0.1.1 tarball, then reconnect; saved documents remain in the external workspace. Registry publication has not been performed.

# 0.1.0

Initial open-source release of MCP Visual Design Studio: a local, persistent visual document editor shared by a person and an MCP agent.

Includes original service-sheet, three-page brochure and visual-report templates; structured editable elements and page controls; native text/rich runs, images and layout; reusable local brand kits; comments and selection context; live updates; guarded operation history, snapshots and variations; PDF/PNG/HTML/editable-bundle exports; explicit export-browser provisioning; loopback authentication and bounded imports.

This is an early 0.x release. Structural undo intentionally refuses overlapping later changes. Only bundled Latin/Latin Extended fonts are supported. Comments require the host to read them; no idle-agent wakeup is provided. No cloud collaboration, model chat, advanced vectors, animation or office-file reconstruction is included.

Install the attached npm tarball. Registry publication has not been performed. See VALIDATION.md for verified tests and host/platform limits.
