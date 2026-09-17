import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

export const VERSION = "0.1.0";
export const RUNTIME_VERSION = 1;
export const PACKAGE_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const CLI_PATH = fileURLToPath(new URL("../cli.js", import.meta.url));
export interface Descriptor {
  workspaceId: string;
  instanceId: string;
  version: string;
  runtimeVersion: number;
  pid: number;
  port: number;
  token: string;
  root: string;
}
export function workspacePath(input?: string): string {
  const target = path.resolve(
    input ||
      process.env.MCP_STUDIO_WORKSPACE ||
      path.join(os.homedir(), "MCP Visual Design Studio"),
  );
  fs.mkdirSync(target, { recursive: true, mode: 0o700 });
  const root = fs.realpathSync(target);
  for (const name of [
    "documents",
    "assets",
    "exports",
    "imports",
    "brands",
    ".runtime",
  ]) {
    const sub = path.join(root, name);
    fs.mkdirSync(sub, { recursive: true, mode: 0o700 });
    if (fs.lstatSync(sub).isSymbolicLink() || fs.realpathSync(sub) !== sub)
      throw new Error(
        `Workspace directory ${name} must not be a symbolic link.`,
      );
  }
  return root;
}
export function atomicJson(file: string, value: unknown): void {
  const tmp = `${file}.${randomUUID()}.tmp`;
  const fd = fs.openSync(tmp, "wx", 0o600);
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
  try {
    const dir = fs.openSync(path.dirname(file), "r");
    try {
      fs.fsyncSync(dir);
    } finally {
      fs.closeSync(dir);
    }
  } catch {
    /* Windows does not fsync directories. */
  }
}
export function workspaceId(root: string): string {
  const file = path.join(root, "workspace.json");
  if (!fs.existsSync(file)) {
    // The service owns the workspace before first initialization. Publish the
    // identity atomically too, so a crash cannot leave a half-written identity.
    atomicJson(file, { id: randomUUID(), schemaVersion: 1 });
  }
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (
    typeof data.id !== "string" ||
    !/^[\w-]{1,100}$/.test(data.id) ||
    data.schemaVersion !== 1
  )
    throw new Error(
      "Unsupported or damaged workspace identity; restore workspace.json from backup.",
    );
  return data.id;
}
export function processAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid < 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}
export function readDescriptor(root: string): Descriptor | null {
  try {
    return JSON.parse(
      fs.readFileSync(path.join(root, ".runtime/service.json"), "utf8"),
    );
  } catch {
    return null;
  }
}
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Local PID ownership, published as a nonempty directory in one atomic rename.
 * A contender can remove only a dead owner's exact nonce marker. rmdir never
 * removes a newly published (nonempty) owner's directory. No recovery mutex or
 * elapsed-time lease can become orphaned or steal from a suspended live process.
 */
export async function claimWorkspace(root: string): Promise<() => void> {
  const runtime = path.join(fs.realpathSync(root), ".runtime");
  if (fs.lstatSync(runtime).isSymbolicLink())
    throw new Error("Workspace runtime must not be a symbolic link.");
  const lock = path.join(runtime, "owner"),
    nonce = randomUUID();
  const marker = `owner-${nonce}.json`,
    candidate = path.join(runtime, `candidate-${nonce}`);
  fs.mkdirSync(candidate, { mode: 0o700 });
  try {
    atomicJson(path.join(candidate, marker), {
      pid: process.pid,
      nonce,
      createdAt: Date.now(),
    });
    for (let attempt = 0; attempt < 80; attempt++) {
      try {
        fs.renameSync(candidate, lock);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          // Never recursively delete a shared path: it may now belong to someone else.
          try {
            fs.unlinkSync(path.join(lock, marker));
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
            throw e;
          }
          try {
            fs.rmdirSync(lock);
          } catch (e) {
            if (
              !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
                (e as NodeJS.ErrnoException).code ?? "",
              )
            )
              throw e;
          }
        };
      } catch (e) {
        if (
          !["EEXIST", "ENOTEMPTY", "ENOTDIR", "EPERM", "EACCES"].includes(
            (e as NodeJS.ErrnoException).code ?? "",
          )
        )
          throw e;
      }
      try {
        const stat = fs.lstatSync(lock);
        if (!stat.isDirectory() || stat.isSymbolicLink())
          throw new Error("Workspace owner lock must be a real directory.");
        const files = fs.readdirSync(lock);
        if (files.length === 0) {
          // Crash after removing an old marker. A fresh acquisition is always nonempty.
          try {
            fs.rmdirSync(lock);
          } catch (e) {
            if (
              !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
                (e as NodeJS.ErrnoException).code ?? "",
              )
            )
              throw e;
          }
          continue;
        }
        if (
          files.length !== 1 ||
          !/^(?:owner-[a-f0-9-]{36}|owner)\.json$/.test(files[0])
        )
          throw new Error(
            "Workspace ownership metadata is damaged. Inspect .runtime/owner before restarting; do not remove a live owner.",
          );
        const oldMarker = path.join(lock, files[0]),
          info = fs.lstatSync(oldMarker);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 4096)
          throw new Error("Workspace ownership metadata is invalid.");
        const owner = JSON.parse(fs.readFileSync(oldMarker, "utf8")) as {
          pid: number;
          nonce: string;
        };
        if (
          !Number.isSafeInteger(owner.pid) ||
          owner.pid < 1 ||
          typeof owner.nonce !== "string" ||
          (files[0] !== "owner.json" &&
            files[0] !== `owner-${owner.nonce}.json`)
        )
          throw new Error("Workspace ownership metadata is invalid.");
        if (processAlive(owner.pid))
          throw new Error(
            "Workspace is already owned by a running service. Use editor or mcp to reconnect.",
          );
        // Another reclaimer may publish a new owner between read and unlink. Its
        // nonce has a different filename, so this cannot remove the new marker.
        try {
          fs.unlinkSync(oldMarker);
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw e;
        }
        try {
          fs.rmdirSync(lock);
        } catch (e) {
          if (
            !["ENOENT", "ENOTEMPTY", "EEXIST"].includes(
              (e as NodeJS.ErrnoException).code ?? "",
            )
          )
            throw e;
        }
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await delay(10);
    }
    throw new Error(
      "Workspace ownership changed repeatedly. Retry the connection.",
    );
  } finally {
    fs.rmSync(candidate, { recursive: true, force: true });
  }
}
export function makeDescriptor(root: string, port: number): Descriptor {
  return {
    root,
    port,
    pid: process.pid,
    workspaceId: workspaceId(root),
    instanceId: randomUUID(),
    version: VERSION,
    runtimeVersion: RUNTIME_VERSION,
    token: randomBytes(32).toString("hex"),
  };
}
export function serviceUrl(d: Descriptor): string {
  return `http://127.0.0.1:${d.port}`;
}
export function editorUrl(d: Descriptor, documentId?: string): string {
  return `${serviceUrl(d)}/${documentId ? `?document=${encodeURIComponent(documentId)}` : ""}#token=${d.token}`;
}
export async function verifyService(
  d: Descriptor,
  root: string,
): Promise<boolean> {
  if (
    d.root !== root ||
    !Number.isInteger(d.port) ||
    d.port < 1 ||
    d.port > 65535 ||
    typeof d.token !== "string" ||
    !/^[a-f0-9]{64}$/.test(d.token)
  )
    return false;
  try {
    const res = await fetch(`${serviceUrl(d)}/api/identity`, {
      headers: { Authorization: `Bearer ${d.token}` },
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) return false;
    const v = (await res.json()) as Descriptor;
    if (v.workspaceId !== workspaceId(root) || v.instanceId !== d.instanceId)
      return false;
    if (v.version !== VERSION || v.runtimeVersion !== RUNTIME_VERSION)
      throw new Error(
        "A different Studio version owns this workspace. Stop it with its stop command, then reconnect. Your documents are preserved.",
      );
    return true;
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("A different")) throw e;
    return false;
  }
}
export async function ensureService(input?: string): Promise<Descriptor> {
  const root = workspacePath(input);
  const old = readDescriptor(root);
  if (old && (await verifyService(old, root))) return old;
  const log = fs.openSync(path.join(root, ".runtime/service.log"), "a", 0o600);
  let spawnError: Error | undefined;
  const child = spawn(
    process.execPath,
    [CLI_PATH, "service", "--workspace", root],
    { detached: true, stdio: ["ignore", log, log], windowsHide: true },
  );
  child.on("error", (e) => {
    spawnError = e;
  });
  child.unref();
  fs.closeSync(log);
  for (let i = 0; i < 100; i++) {
    if (spawnError) throw spawnError;
    await delay(100);
    const d = readDescriptor(root);
    if (d && (await verifyService(d, root))) return d;
  }
  throw new Error(
    "Workspace service did not become ready. Run doctor and inspect the workspace .runtime/service.log.",
  );
}
export async function requestService<T = unknown>(
  d: Descriptor,
  route: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(`${serviceUrl(d)}${route}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${d.token}`,
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(120000)])
      : AbortSignal.timeout(120000),
  });
  const data = (await res.json()) as T & { error?: string; code?: string };
  if (!res.ok)
    throw Object.assign(
      new Error(data.error || `Request failed (${res.status})`),
      { code: data.code, status: res.status },
    );
  return data;
}
