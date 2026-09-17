import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { readDescriptor, requestService } from "../src/server/runtime.js";

test("actual stdio process lists tools, creates and edits; EOF preserves shared service", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "Studio MCP ü "));
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [path.resolve("dist/cli.js"), "mcp", "--workspace", root],
    stderr: "pipe",
  });
  const client = new Client({
    name: "studio-integration-test",
    version: "1.0.0",
  });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => (stderr += chunk.toString()));
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some((t) => t.name === "document_apply"));
    assert.ok(listed.tools.some((t) => t.name === "preview_render"));
    const opened = await client.callTool({
      name: "workspace_open",
      arguments: {},
    });
    assert.equal(opened.isError, undefined);
    const created = await client.callTool({
      name: "document_create",
      arguments: { name: "MCP test", template: "brochure" },
    });
    assert.notEqual(created.isError, true, JSON.stringify(created));
    const parsed = JSON.parse(
      (created.content as Array<{ text: string }>)[0].text,
    );
    assert.equal(parsed.document.pages.length, 3);
    const el = parsed.document.pages[0].elements.find(
      (e: { type: string }) => e.type === "text",
    );
    const changed = await client.callTool({
      name: "document_apply",
      arguments: {
        documentId: parsed.documentId,
        batch: {
          expectedRevision: 0,
          operationId: "mcp-op-1",
          actor: "agent:test",
          operations: [
            {
              type: "update_element",
              elementId: el.id,
              patch: { text: "Native editable text" },
            },
          ],
        },
      },
    });
    assert.notEqual(changed.isError, true, JSON.stringify(changed));
    await client.close();
    const d = readDescriptor(root)!;
    assert.ok(d);
    const after = await requestService<{ revision: number }>(
      d,
      `/api/documents/${parsed.documentId}`,
    );
    assert.equal(after.revision, 1);
    assert.doesNotMatch(stderr, /Error|Unhandled/);
  } finally {
    await client.close().catch(() => {});
    const d = readDescriptor(root);
    if (d) await requestService(d, "/api/stop", {}).catch(() => {});
    await new Promise((r) => setTimeout(r, 200));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
