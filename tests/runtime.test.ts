import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import {
  workspacePath,
  workspaceId,
  verifyService,
  makeDescriptor,
} from "../src/server/runtime.js";

test("workspace identity initializes atomically and survives fresh client reads", () => {
  const root = workspacePath(
    fs.mkdtempSync(path.join(os.tmpdir(), "studio-id-")),
  );
  try {
    fs.writeFileSync(
      path.join(root, "workspace.json.unfinished.tmp"),
      '{"id":',
    );
    const first = workspaceId(root);
    assert.equal(workspaceId(root), first);
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(root, "workspace.json"), "utf8")).id,
      first,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reconnect rejects incompatible runtime versions and unrelated service identities", async () => {
  const root = workspacePath(
    fs.mkdtempSync(path.join(os.tmpdir(), "studio-upgrade-")),
  );
  let identity: Record<string, unknown> = {};
  const server = http.createServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(identity));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as import("node:net").AddressInfo;
  const descriptor = makeDescriptor(root, address.port);
  try {
    identity = { ...descriptor, version: "0.0.0" };
    await assert.rejects(
      verifyService(descriptor, root),
      /different Studio version/,
    );
    identity = { ...descriptor, runtimeVersion: 999 };
    await assert.rejects(
      verifyService(descriptor, root),
      /different Studio version/,
    );
    identity = { ...descriptor, workspaceId: "unrelated" };
    assert.equal(await verifyService(descriptor, root), false);
    identity = { ...descriptor, instanceId: "unrelated" };
    assert.equal(await verifyService(descriptor, root), false);
    identity = { ...descriptor };
    assert.equal(await verifyService(descriptor, root), true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    fs.rmSync(root, { recursive: true, force: true });
  }
});
