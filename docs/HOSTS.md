# Host setup and compatibility

Studio uses the official MCP TypeScript server SDK **2.0.0** with `serveStdio`, including the SDK's legacy initialization compatibility. A working SDK test client is useful protocol evidence but is not a substitute for a real host test. See [validation](VALIDATION.md) for exactly what was exercised.

## Codex

Install the release tarball and configure the command as shown in the README. Alternatively:

```sh
codex mcp add visual_design_studio -- mcp-visual-design-studio mcp
```

Use `startup_timeout_sec = 30` and `tool_timeout_sec = 120` for large exports. A workspace may be supplied through `args` or `MCP_STUDIO_WORKSPACE`. The server never opens a browser on tool calls; `workspace_open` and `document_create` return the editor URL. `preview_render` returns PNG pixels as standard image content.

Primary reference: [Codex MCP configuration](https://developers.openai.com/codex/mcp/).

## Claude Code and other local stdio hosts

```sh
claude mcp add --transport stdio visual-design-studio -- mcp-visual-design-studio mcp
```

For hosts using a JSON `mcpServers` configuration, use the README example. A desktop host may require an absolute executable path. The host owns tool approval and model/image support; Studio does not bypass those policies. A remote-only host cannot reach a server on your local stdio without a supported local bridge, which is outside this release.

## Platforms

Node 24 LTS is recommended; Node 22.12+ is the compatibility baseline. Source and packed-package tests run in GitHub Actions across macOS, Ubuntu Linux and Windows. A CI pass verifies that job's environment and flow; it does not claim every OS release, desktop browser, processor architecture or enterprise sandbox works. Use a current Chromium-based browser for the editor; Firefox and Safari are not release-gate targets yet.

SDK source: [official TypeScript SDK v2](https://ts.sdk.modelcontextprotocol.io/v2/). Browser setup: [Playwright browsers](https://playwright.dev/docs/browsers).
