#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import {
  VERSION,
  ensureService,
  requestService,
  workspacePath,
  readDescriptor,
  verifyService,
  editorUrl,
} from "./server/runtime.js";

function option(name: string) {
  const i = process.argv.indexOf(name);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  if (!v || v.startsWith("--")) throw new Error(`${name} requires a value.`);
  return v;
}
async function main() {
  const command = process.argv[2] || "mcp",
    workspace = option("--workspace");
  if (command === "--version" || command === "version") {
    console.log(VERSION);
    return;
  }
  if (command === "--help" || command === "help") {
    console.log(
      `MCP Visual Design Studio ${VERSION}\n\nUsage: mcp-visual-design-studio <command> [--workspace PATH]\n\n  mcp            Connect an agent over stdio (default; stdout is protocol only)\n  editor         Start/reuse workspace and open editor (--no-open prints URL)\n  doctor         Check Node, workspace and export-browser installation\n  setup-export   Explicitly install Playwright Chromium (--with-deps on Linux)\n  stop           Stop the workspace service (refuses during active exports)\n  migrate        Import supported older JSON (--file imports/name.json)\n  version        Print package version\n\nDefault workspace: ~/MCP Visual Design Studio (or MCP_STUDIO_WORKSPACE).\nDocuments survive package upgrades. No model API key or telemetry.`,
    );
    return;
  }
  if (command === "mcp") {
    const { startMcp } = await import("./mcp.js");
    await startMcp(workspace);
    return;
  }
  if (command === "service") {
    const { startService } = await import("./server/service.js");
    const service = await startService(workspace);
    const shutdown = () => {
      void service.close();
    };
    process.once("SIGTERM", shutdown);
    process.once("SIGINT", shutdown);
    return;
  }
  if (command === "setup-export") {
    const require = createRequire(import.meta.url);
    const cli = require.resolve("playwright/cli");
    const args = [
      cli,
      "install",
      ...(process.argv.includes("--with-deps") ? ["--with-deps"] : []),
      "chromium",
    ];
    const code = await new Promise<number>((resolve, reject) => {
      const child = spawn(process.execPath, args, {
        stdio: "inherit",
        windowsHide: true,
      });
      child.once("error", reject);
      child.once("exit", (code) => resolve(code ?? 1));
    });
    process.exitCode = code;
    return;
  }
  if (command === "doctor") {
    const { browserHealth } = await import("./export/index.js");
    const root = workspacePath(workspace);
    const d = readDescriptor(root);
    console.log(
      JSON.stringify(
        {
          version: VERSION,
          node: process.version,
          supportedNode: Number(process.versions.node.split(".")[0]) >= 22,
          workspace: root,
          service: d ? await verifyService(d, root) : false,
          exportBrowser: await browserHealth(),
        },
        null,
        2,
      ),
    );
    return;
  }
  if (command === "stop") {
    const root = workspacePath(workspace),
      d = readDescriptor(root);
    if (d && (await verifyService(d, root))) {
      await requestService(d, "/api/stop", {});
      console.log("Workspace stopped. Documents are saved.");
    } else console.log("No compatible workspace service is running.");
    return;
  }
  if (command === "editor") {
    const d = await ensureService(workspace),
      url = editorUrl(d);
    console.log(url);
    if (!process.argv.includes("--no-open")) {
      const [bin, args] =
        process.platform === "darwin"
          ? ["open", [url]]
          : process.platform === "win32"
            ? ["rundll32", ["url.dll,FileProtocolHandler", url]]
            : ["xdg-open", [url]];
      const child = spawn(bin, args, {
        stdio: "ignore",
        detached: true,
        windowsHide: true,
      });
      child.on("error", () =>
        process.stderr.write(
          "Could not open browser automatically. Use the URL above.\n",
        ),
      );
      child.unref();
    }
    return;
  }
  if (command === "migrate") {
    const root = workspacePath(workspace),
      file = option("--file");
    if (!file)
      throw new Error(
        "migrate requires --file imports/name.json. Copy the legacy project into workspace/imports first.",
      );
    const input = fs.realpathSync(path.resolve(root, file));
    if (
      !input.startsWith(fs.realpathSync(path.join(root, "imports")) + path.sep)
    )
      throw new Error("Migration source must be inside workspace/imports.");
    if (fs.statSync(input).size > 20 * 1024 * 1024)
      throw new Error("Migration source exceeds 20 MB.");
    const d = await ensureService(root);
    const out = await requestService(d, "/api/migrate", {
      document: JSON.parse(fs.readFileSync(input, "utf8")),
    });
    console.log(JSON.stringify(out, null, 2));
    return;
  }
  throw new Error(`Unknown command: ${command}. Run --help.`);
}
main().catch((e) => {
  process.stderr.write(`Studio: ${(e as Error).message}\n`);
  process.exitCode = 1;
});
