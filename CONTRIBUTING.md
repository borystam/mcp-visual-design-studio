# Contributing

Use Node 24 LTS and `npm ci`. Keep changes focused and include meaningful tests for operation semantics, durability, concurrency and user-visible behavior. Run `npm run check`, `npm run build`, `npm test`, `npm run test:e2e` and `npm run test:pack` after provisioning Chromium.

Keep domain data browser-safe and strictly validated. Browser and MCP mutations must use the shared operation service. Do not add arbitrary HTML, JavaScript execution, unrestricted shell tools, remote image loads, telemetry or model keys. Preserve stdout for MCP protocol traffic. New schema versions require explicit migration and recovery tests; never rewrite old immutable revision records in place.

Keep test data original and generic. Never commit private workspaces, credentials, client material or assets without redistribution rights. Add third-party license notices for bundled assets. Generated scratch work belongs in ignored `artifacts/` or `.local/`.

Pull requests should explain the user-visible behavior, relevant validation and any compatibility limits. Report bugs with versions, OS, minimal generic reproduction and sanitized diagnostics. Report security issues privately as described in SECURITY.md.

## Reproduce a release

1. Check out the release tag and run `npm ci` with its committed lockfile.
2. Run all checks and tests, including the installed tarball test.
3. Run `npm pack`; inspect `npm pack --dry-run --json` and the archive contents.
4. Scan tracked files and the package allowlist for secrets, personal data and machine paths.
5. Tag a reviewed commit, upload the tarball and SHA-256 checksum to a GitHub release.

No npm publication is automatic. Maintainers must separately authorize registry publication; check name availability and scope ownership at that time. The proposed unscoped name was unregistered when checked for this release; that does not reserve it.
