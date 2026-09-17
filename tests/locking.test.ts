import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  claimWorkspace,
  workspacePath,
  atomicJson,
} from "../src/server/runtime.js";

const runtimeUrl = new URL("../src/server/runtime.ts", import.meta.url).href;
function root(t: { after: (callback: () => void) => void }) {
  const value = workspacePath(
    fs.mkdtempSync(path.join(os.tmpdir(), "Studio owner ü ")),
  );
  t.after(() => fs.rmSync(value, { recursive: true, force: true }));
  return value;
}
function contender(workspace: string): {
  child: ChildProcess;
  result: Promise<string>;
} {
  const script = `import {claimWorkspace} from ${JSON.stringify(runtimeUrl)};try{const release=await claimWorkspace(process.argv[1]);console.log('acquired');process.stdin.resume();process.stdin.once('data',()=>{release();process.exit(0)});setTimeout(()=>process.exit(2),15000).unref();}catch(e){console.log('busy:'+e.message);process.exit(0)}`;
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "--eval", script, workspace],
    { stdio: ["pipe", "pipe", "pipe"] },
  );
  // A losing contender can exit between the cleanup liveness check and write.
  child.stdin!.on("error", (error: NodeJS.ErrnoException) => {
    if (!["EPIPE", "ERR_STREAM_DESTROYED"].includes(error.code ?? ""))
      throw error;
  });
  const result = new Promise<string>((resolve, reject) => {
    let output = "",
      stderr = "";
    const timer = setTimeout(
      () => reject(new Error(`Contender timeout: ${stderr}`)),
      12000,
    );
    child.stdout!.on("data", (data) => {
      output += data;
      if (output.includes("\n")) {
        clearTimeout(timer);
        resolve(output.split("\n")[0]);
      }
    });
    child.stderr!.on("data", (data) => (stderr += data));
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      if (!output) {
        clearTimeout(timer);
        reject(new Error(`Contender exited ${code}: ${stderr}`));
      }
    });
  });
  return { child, result };
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, "exit");
  child.stdin!.write("release\n");
  await exited;
}

test("atomic nonempty directory acquisition admits exactly one competing process", async (t) => {
  const workspace = root(t);
  const contenders = Array.from({ length: 8 }, () => contender(workspace));
  try {
    const results = await Promise.all(contenders.map((item) => item.result));
    assert.equal(results.filter((value) => value === "acquired").length, 1);
    assert.equal(
      results.filter((value) =>
        value.startsWith("busy:Workspace is already owned"),
      ).length,
      7,
    );
  } finally {
    await Promise.all(contenders.map((item) => stop(item.child)));
  }
});
test("simultaneous stale-owner recovery cannot remove the new owner", async (t) => {
  const workspace = root(t),
    lock = path.join(workspace, ".runtime/owner");
  fs.mkdirSync(lock);
  atomicJson(
    path.join(lock, "owner-00000000-0000-0000-0000-000000000001.json"),
    { pid: 2147483647, nonce: "00000000-0000-0000-0000-000000000001" },
  );
  const contenders = Array.from({ length: 8 }, () => contender(workspace));
  try {
    const results = await Promise.all(contenders.map((item) => item.result));
    assert.equal(results.filter((value) => value === "acquired").length, 1);
    assert.equal(fs.readdirSync(lock).length, 1);
    const owner = JSON.parse(
      fs.readFileSync(path.join(lock, fs.readdirSync(lock)[0]), "utf8"),
    );
    assert.ok(contenders.some((item) => item.child.pid === owner.pid));
  } finally {
    await Promise.all(contenders.map((item) => stop(item.child)));
  }
});
test("SIGKILL crash leaves a reclaimable lock with no recovery mutex", async (t) => {
  const workspace = root(t);
  const first = contender(workspace);
  assert.equal(await first.result, "acquired");
  const exited = once(first.child, "exit");
  first.child.kill("SIGKILL");
  await exited;
  const release = await claimWorkspace(workspace);
  release();
  assert.equal(fs.existsSync(path.join(workspace, ".runtime/owner")), false);
});
test("empty crash artifacts and obsolete recovery mutexes do not block startup", async (t) => {
  const workspace = root(t);
  fs.mkdirSync(path.join(workspace, ".runtime/owner"));
  fs.mkdirSync(path.join(workspace, ".runtime/recovery"));
  const release = await claimWorkspace(workspace);
  release();
  assert.equal(fs.existsSync(path.join(workspace, ".runtime/owner")), false);
});
test("live owners are never stolen because of old timestamps or suspension", async (t) => {
  const workspace = root(t),
    release = await claimWorkspace(workspace);
  const old = new Date(0);
  fs.utimesSync(path.join(workspace, ".runtime/owner"), old, old);
  try {
    await assert.rejects(claimWorkspace(workspace), /already owned/);
  } finally {
    release();
  }
});
test("old release function cannot erase a different owner and is idempotent", async (t) => {
  const workspace = root(t),
    first = await claimWorkspace(workspace),
    lock = path.join(workspace, ".runtime/owner");
  fs.renameSync(lock, path.join(workspace, ".runtime/displaced-owner"));
  const second = await claimWorkspace(workspace);
  first();
  first();
  assert.equal(fs.readdirSync(lock).length, 1);
  second();
  second();
  assert.equal(fs.existsSync(lock), false);
});
test("owner symlinks and unknown metadata fail closed", async (t) => {
  const workspace = root(t),
    lock = path.join(workspace, ".runtime/owner");
  fs.mkdirSync(lock);
  fs.writeFileSync(path.join(lock, "unrecognized"), "data");
  await assert.rejects(claimWorkspace(workspace), /damaged/);
  fs.rmSync(lock, { recursive: true });
  if (process.platform === "win32") return;
  const outside = path.join(workspace, "outside");
  fs.mkdirSync(outside);
  fs.symlinkSync(outside, lock);
  await assert.rejects(claimWorkspace(workspace), /real directory/);
  assert.equal(fs.existsSync(outside), true);
});
