# Privacy and local boundaries

Studio has no telemetry, analytics SDK, document upload, cloud account or model provider integration. Documents, revisions, assets, brand kits and exports stay in the chosen local workspace. The connected agent host may send document content and rendered images to its model provider; that host's policies and settings apply.

The HTTP service binds only to `127.0.0.1`, checks Host and Origin, rejects cross-site requests, and requires a random local token for its API. The editor link carries that token in a URL fragment (not the HTTP request URL); the browser exchanges it for an HttpOnly SameSite=Strict workspace-specific session cookie and removes the fragment. Runtime files are created with restrictive permissions where the OS supports them. The token rotates when the service restarts. Local users who can read your workspace runtime files can operate that workspace; this is not a hostile multi-user server.

Documents cannot execute scripts or embed arbitrary network resources. Links are explicit http/https/mailto/tel destinations and are followed only on a user's action. Fonts are bundled; image data is local. Export Chromium runs with JavaScript disabled, network requests blocked and bounded time and size limits. SVG import uses a strict parsed allowlist and rejects script, external references, event handlers and foreignObject. Malformed images, oversized dimensions and unsupported formats fail import. Bundles have no archive paths and validate each asset's size/hash/content before writing it.

Filesystem writes are restricted to workspace document, asset, brand and export directories. Runtime credentials are never included in project bundles or generated HTML/PDF/PNG. Never include `.runtime`, private workspaces, screenshots of client documents, credentials or proprietary assets in an issue or public pull request.

To remove your data, stop Studio and remove your chosen workspace directory yourself. Uninstalling the npm package intentionally preserves projects. To back up, stop the service and copy the whole workspace. Portable bundles preserve editable design content and assets but do not include revision history.
