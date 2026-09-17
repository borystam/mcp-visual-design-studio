import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { once } from "node:events";
import {
  Client,
  LATEST_PROTOCOL_VERSION,
  type CallToolResult,
} from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { chromium } from "playwright";
import {
  readDescriptor,
  requestService,
  processAlive,
  type Descriptor,
} from "../src/server/runtime.js";
import type { Document, MutationResult, Page } from "../src/domain/model.js";

const cli = path.resolve("dist/cli.js");
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function eventually<T>(
  read: () => Promise<T>,
  accept: (value: T) => boolean,
  message: string,
  timeout = 10000,
) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await read();
    if (accept(value)) return value;
    await delay(25);
  }
  assert.fail(message);
}
function parsed<T>(result: CallToolResult): T {
  assert.notEqual(result.isError, true, JSON.stringify(result.content));
  if (result.structuredContent !== undefined)
    return result.structuredContent as T;
  const content = result.content.find((item) => item.type === "text");
  assert.ok(content && content.type === "text");
  return JSON.parse(content.text) as T;
}
function workspace(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "Studio lifecycle ü "));
  t.after(async () => {
    const d = readDescriptor(root);
    if (d) await requestService(d, "/api/stop", {}).catch(() => {});
    await eventually(
      async () => fs.existsSync(path.join(root, ".runtime/owner")),
      (exists) => !exists,
      "Service did not release workspace ownership",
    ).catch(() => {});
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}
async function client(t: TestContext, root: string, name: string) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [cli, "mcp", "--workspace", root],
    stderr: "pipe",
  });
  const value = new Client({ name, version: "1.0.0" });
  let stderr = "";
  transport.stderr?.on("data", (part) => (stderr += part.toString()));
  await value.connect(transport);
  t.after(async () => {
    await value.close();
    assert.doesNotMatch(stderr, /Unhandled|uncaughtException/);
  });
  return { client: value, transport };
}
function rawClient(t: TestContext, root: string) {
  const child = spawn(process.execPath, [cli, "mcp", "--workspace", root], {
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;
  let buffer = "",
    nextId = 0;
  const pending = new Map<
    number,
    {
      resolve: (value: any) => void;
      reject: (error: Error) => void;
      timer: NodeJS.Timeout;
    }
  >();
  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString();
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, end);
      buffer = buffer.slice(end + 1);
      if (!line.trim()) continue;
      let response: any;
      try {
        response = JSON.parse(line);
      } catch {
        for (const waiter of pending.values())
          waiter.reject(new Error("MCP stdout contained non-protocol output"));
        continue;
      }
      const waiter = pending.get(response.id);
      if (waiter) {
        clearTimeout(waiter.timer);
        pending.delete(response.id);
        if (response.error) waiter.reject(new Error(response.error.message));
        else waiter.resolve(response.result);
      }
    }
  });
  child.on("error", (error) => {
    for (const waiter of pending.values()) waiter.reject(error);
  });
  const send = (method: string, params: unknown, notification = false) => {
    const id = ++nextId;
    if (notification) {
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n",
      );
      return Promise.resolve(undefined);
    }
    return new Promise<any>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`MCP ${method} timed out`));
      }, 12000);
      pending.set(id, { resolve, reject, timer });
      child.stdin.write(
        JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n",
      );
    });
  };
  t.after(() => {
    for (const waiter of pending.values()) clearTimeout(waiter.timer);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGKILL");
  });
  return { child, send };
}

test("one actual MCP stdin EOF exits its connection while a second connection keeps editing", async (t) => {
  const root = workspace(t),
    first = rawClient(t, root);
  await first.send("initialize", {
    protocolVersion: LATEST_PROTOCOL_VERSION,
    capabilities: {},
    clientInfo: { name: "eof-test-client", version: "1.0.0" },
  });
  await first.send("notifications/initialized", {}, true);
  const opened = await first.send("tools/call", {
    name: "workspace_open",
    arguments: {},
  });
  assert.notEqual(opened.isError, true);
  const second = await client(t, root, "second-surviving-client");
  const d = readDescriptor(root)!;
  assert.ok(d);
  const created = parsed<{ documentId: string; document: Document }>(
    await second.client.callTool({
      name: "document_create",
      arguments: { name: "Shared through two sessions", template: "blank" },
    }),
  );
  const exit = once(first.child, "exit");
  first.child.stdin.end();
  const code = await Promise.race([
    exit,
    delay(5000).then(() => {
      throw new Error("MCP process did not exit after stdin EOF");
    }),
  ]);
  assert.equal(code[0], 0);
  assert.equal(processAlive(d.pid), true);
  assert.equal(readDescriptor(root)?.instanceId, d.instanceId);
  const changed = parsed<MutationResult>(
    await second.client.callTool({
      name: "document_apply",
      arguments: {
        documentId: created.documentId,
        batch: {
          operationId: "after-eof",
          actor: "second-client",
          expectedRevision: 0,
          operations: [
            {
              type: "set_document",
              patch: { name: "Second client remains connected" },
            },
          ],
        },
      },
    }),
  );
  assert.equal(changed.revision, 1);
  assert.equal(changed.document.name, "Second client remains connected");
  assert.equal(
    (await requestService<Document>(d, `/api/documents/${created.documentId}`))
      .revision,
    1,
  );
});

test(
  "MCP cancellation aborts an observed in-flight browser preview without stopping the shared service",
  { skip: !fs.existsSync(chromium.executablePath()), timeout: 30000 },
  async (t) => {
    const root = workspace(t),
      connected = await client(t, root, "cancellation-test-client"),
      d = readDescriptor(root)!;
    const created = parsed<{ documentId: string; document: Document }>(
      await connected.client.callTool({
        name: "document_create",
        arguments: { name: "Cancelled preview", template: "blank" },
      }),
    );
    const pages: Page[] = Array.from({ length: 18 }, (_, pageIndex) => ({
      id: `cancel_page_${pageIndex}`,
      name: `Page ${pageIndex + 2}`,
      width: 900,
      height: 1300,
      background: "#ffffff",
      elements: Array.from({ length: 60 }, (_, elementIndex) => ({
        id: `cancel_text_${pageIndex}_${elementIndex}`,
        type: "text" as const,
        name: "Native text",
        x: 20 + (elementIndex % 3) * 280,
        y: 20 + Math.floor(elementIndex / 3) * 60,
        width: 260,
        height: 50,
        style: { fontFamily: "Inter" as const, fontSize: 18 },
        text: `Preview content ${pageIndex + 1} / ${elementIndex + 1}`,
      })),
    }));
    const saved = await requestService<MutationResult>(
      d,
      `/api/documents/${created.documentId}/operations`,
      {
        operationId: "many-pages",
        actor: "test-client",
        expectedRevision: 0,
        operations: pages.map((page) => ({ type: "add_page", page })),
      },
    );
    const controller = new AbortController();
    const preview = connected.client
      .callTool(
        {
          name: "preview_render",
          arguments: {
            documentId: created.documentId,
            revision: saved.revision,
          },
        },
        { signal: controller.signal },
      )
      .then(
        (result) => ({ result, error: undefined }),
        (error) => ({ result: undefined, error }),
      );
    try {
      await eventually(
        () => requestService<{ activeExports: number }>(d, "/api/identity"),
        (identity) => identity.activeExports === 1,
        "Preview never became an active browser export",
      );
      controller.abort(new Error("Intentional preview cancellation"));
      const outcome = await preview;
      assert.ok(
        outcome.error,
        "Client cancellation must reject the pending tool call",
      );
      assert.match(String(outcome.error), /cancel|abort/i);
      await eventually(
        () => requestService<{ activeExports: number }>(d, "/api/identity"),
        (identity) => identity.activeExports === 0,
        "Cancelled preview did not release its export slot",
      );
      assert.deepEqual(fs.readdirSync(path.join(root, "exports")), []);
      assert.equal(readDescriptor(root)?.instanceId, d.instanceId);
      const current = parsed<Document>(
        await connected.client.callTool({
          name: "document_read",
          arguments: { documentId: created.documentId },
        }),
      );
      assert.equal(current.revision, saved.revision);
      const out = parsed<{ revision: number; filename: string }>(
        await connected.client.callTool({
          name: "document_export",
          arguments: {
            documentId: created.documentId,
            revision: saved.revision,
            format: "html",
          },
        }),
      );
      assert.equal(out.revision, saved.revision);
      assert.ok(fs.existsSync(path.join(root, "exports", out.filename)));
    } finally {
      controller.abort();
      await preview;
    }
  },
);
