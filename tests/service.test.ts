import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { startService } from "../src/server/service.js";
import {
  claimWorkspace,
  workspacePath,
  requestService,
  serviceUrl,
  verifyService,
  atomicJson,
} from "../src/server/runtime.js";
import type { Document, MutationResult } from "../src/domain/model.js";

test("local boundary, one writer, SSE, revision conflicts, restart and auth rotation", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "Studio ü spaces "));
  let service = await startService(root);
  const d = service.descriptor;
  const call = <T = unknown>(p: string, b?: unknown) =>
    requestService<T>(service.descriptor, p, b);
  let streamAbort: AbortController | undefined;
  try {
    assert.equal(await verifyService(d, fs.realpathSync(root)), true);
    await assert.rejects(startService(root), /already owned/);
    assert.equal((await fetch(`${serviceUrl(d)}/api/workspace`)).status, 401);
    assert.equal(
      (
        await fetch(`${serviceUrl(d)}/api/workspace`, {
          headers: {
            Origin: "https://example.org",
            Authorization: `Bearer ${d.token}`,
          },
        })
      ).status,
      403,
    );
    const badHost = await new Promise<number | undefined>((resolve, reject) => {
      const r = http.get(
        `${serviceUrl(d)}/api/workspace`,
        {
          headers: { Host: "evil.example", Authorization: `Bearer ${d.token}` },
        },
        (response) => {
          response.resume();
          resolve(response.statusCode);
        },
      );
      r.on("error", reject);
    });
    assert.equal(badHost, 403);
    const session = await fetch(`${serviceUrl(d)}/api/session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: d.token }),
    });
    assert.match(
      session.headers.get("set-cookie")!,
      /HttpOnly; SameSite=Strict/,
    );
    const doc = await call<Document>("/api/documents", {
      name: "Test sheet",
      template: "service-sheet",
    });
    const text = doc.pages[0].elements.find((e) => e.type === "text")!;
    streamAbort = new AbortController();
    const stream = await fetch(`${serviceUrl(d)}/api/events`, {
      headers: { Authorization: `Bearer ${d.token}` },
      signal: streamAbort.signal,
    });
    const reader = stream.body!.getReader();
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /event: ready/,
    );
    const batch = {
      operationId: "human-1",
      actor: "human",
      expectedRevision: 0,
      operations: [
        {
          type: "update_element",
          elementId: text.id,
          patch: { text: "One character!" },
        },
      ],
    };
    const changed = await call<MutationResult>(
      `/api/documents/${doc.id}/operations`,
      batch,
    );
    assert.equal(changed.revision, 1);
    assert.match(
      new TextDecoder().decode((await reader.read()).value),
      /event: change/,
    );
    assert.equal(
      (await call<MutationResult>(`/api/documents/${doc.id}/operations`, batch))
        .revision,
      1,
    );
    await assert.rejects(
      call(`/api/documents/${doc.id}/operations`, {
        ...batch,
        operationId: "stale",
      }),
      /revision/i,
    );
    const agent = await call<MutationResult>(
      `/api/documents/${doc.id}/operations`,
      {
        operationId: "agent-1",
        actor: "agent",
        expectedRevision: 1,
        operations: [
          {
            type: "update_element",
            elementId: text.id,
            patch: { style: { color: "#123456" } },
          },
        ],
      },
    );
    assert.equal(agent.revision, 2);
    const undone = await call<MutationResult>(`/api/documents/${doc.id}/undo`, {
      operationId: "undo-agent",
      actor: "human",
      expectedRevision: 2,
      targetOperationId: "agent-1",
    });
    assert.equal(
      undone.document.pages[0].elements.find((e) => e.id === text.id)!.text,
      "One character!",
    );
    await call(`/api/documents/${doc.id}/selection`, {
      elementIds: [text.id],
      pageId: doc.pages[0].id,
    });
    const sel = await call<{ elementIds: string[] }>(
      `/api/documents/${doc.id}/selection`,
    );
    assert.deepEqual(sel.elementIds, [text.id]);
    assert.equal(
      (
        await fetch(`${serviceUrl(d)}/api/downloads/..%2fworkspace.json`, {
          headers: { Authorization: `Bearer ${d.token}` },
        })
      ).status,
      404,
    );
    streamAbort.abort();
    await reader.cancel().catch(() => {});
    await service.close();
    service = await startService(root);
    assert.notEqual(service.descriptor.token, d.token);
    const after = await call<Document>(`/api/documents/${doc.id}`);
    assert.equal(after.revision, 3);
    assert.equal(
      after.pages[0].elements.find((e) => e.id === text.id)!.text,
      "One character!",
    );
    assert.equal(
      (await call<MutationResult>(`/api/documents/${doc.id}/operations`, batch))
        .revision,
      1,
    );
  } finally {
    streamAbort?.abort();
    await service.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("stale lock recovery has a single winner; canonical paths share ownership", async () => {
  const root = workspacePath(
    fs.mkdtempSync(path.join(os.tmpdir(), "studio-lock-")),
  );
  fs.mkdirSync(path.join(root, ".runtime/owner"));
  atomicJson(path.join(root, ".runtime/owner/owner.json"), {
    pid: 2147483647,
    nonce: "dead",
  });
  const attempts = await Promise.allSettled([
    claimWorkspace(root),
    claimWorkspace(root),
    claimWorkspace(root),
  ]);
  try {
    assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
  } finally {
    for (const a of attempts) if (a.status === "fulfilled") a.value();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("ephemeral loopback port works while other ports are occupied", async () => {
  const occupied = http.createServer();
  await new Promise<void>((r) => occupied.listen(0, "127.0.0.1", r));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "studio-port-"));
  const service = await startService(root);
  try {
    assert.notEqual(
      service.descriptor.port,
      (occupied.address() as import("node:net").AddressInfo).port,
    );
    assert.equal((await fetch(serviceUrl(service.descriptor))).status, 200);
  } finally {
    await service.close();
    await new Promise<void>((r) => occupied.close(() => r()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
