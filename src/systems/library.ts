import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { z } from "zod";
import { validateDesignSystem } from "../domain/design-system.js";
import type { DesignSystem, Asset } from "../domain/model.js";
import {
  readVerifiedAsset,
  safeDirectory,
  MAX_BUNDLE_BYTES,
} from "../export/assets.js";
import { atomicJson } from "../server/runtime.js";

export const SystemRefSchema = z
  .object({
    id: z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
    version: z
      .string()
      .regex(/^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/)
      .max(64),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type SystemRef = z.infer<typeof SystemRefSchema>;
export type SystemSummary = SystemRef & {
  name: string;
  tokenCount: number;
  componentCount: number;
  fontCount: number;
};
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => JSON.stringify(k) + ":" + canonical(v))
      .join(",")}}`;
  return JSON.stringify(value);
}
export const systemDigest = (system: DesignSystem) =>
  createHash("sha256").update(canonical(system)).digest("hex");
const summary = (system: DesignSystem): SystemSummary => ({
  id: system.id,
  name: system.name,
  version: system.version,
  digest: systemDigest(system),
  tokenCount: Object.keys(system.tokens).length,
  componentCount: system.components.length,
  fontCount: system.fonts.length,
});
function error(message: string, status = 400): never {
  throw Object.assign(new Error(message), { status, code: "DESIGN_SYSTEM" });
}
export class DesignSystemLibrary {
  readonly directory: string;
  private previews = new Map<string, Asset>();
  constructor(
    readonly root: string,
    readonly assetsDirectory: string,
  ) {
    this.directory = path.join(root, "design-systems");
    safeDirectory(this.directory, true);
  }
  private file(id: string, version: string) {
    SystemRefSchema.parse({ id, version, digest: "0".repeat(64) });
    return path.join(this.directory, `${id}@${version}.json`);
  }
  private readFile(file: string) {
    safeDirectory(this.directory);
    let stat: fs.Stats;
    try {
      stat = fs.lstatSync(file);
    } catch {
      return error("Design system version not found.", 404);
    }
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 16 * 1024 * 1024)
      error("Invalid design system library file.");
    const fd = fs.openSync(
      file,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    try {
      const current = fs.fstatSync(fd);
      if (current.ino !== stat.ino || current.dev !== stat.dev)
        error("Design system file changed during read.");
      return JSON.parse(fs.readFileSync(fd, "utf8"));
    } finally {
      fs.closeSync(fd);
    }
  }
  read(id: string, version: string, digest?: string) {
    const stored = this.readFile(this.file(id, version));
    const system = validateDesignSystem(stored.system);
    const actual = systemDigest(system);
    if (
      system.id !== id ||
      system.version !== version ||
      stored.digest !== actual
    )
      error("Design system identity or digest mismatch.");
    if (digest && digest !== actual)
      error("Design system digest does not match the selected version.", 409);
    for (const asset of Object.values(system.assets))
      readVerifiedAsset(asset, this.assetsDirectory);
    return { system, digest: actual };
  }
  list(): SystemSummary[] {
    safeDirectory(this.directory);
    return fs
      .readdirSync(this.directory)
      .filter((n) => n.endsWith(".json") && n !== "default.json")
      .map((n) => {
        const m =
          /^([A-Za-z0-9_-]+)@(\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?)\.json$/.exec(
            n,
          );
        if (!m) error("Unexpected design system library file.");
        return summary(this.read(m[1], m[2]).system);
      })
      .sort(
        (a, b) =>
          a.name.localeCompare(b.name) ||
          b.version.localeCompare(a.version, undefined, { numeric: true }),
      );
  }
  rememberAssets(assets: Record<string, Asset>) {
    for (const asset of Object.values(assets)) {
      readVerifiedAsset(asset, this.assetsDirectory);
      this.previews.set(asset.id, asset);
    }
    // Preview references are bounded and live only in this process; saved libraries remain durable.
    while (this.previews.size > 2000)
      this.previews.delete(this.previews.keys().next().value!);
  }
  asset(id: string): Asset | undefined {
    const pending = this.previews.get(id);
    if (pending) return pending;
    for (const item of this.list()) {
      const asset = this.read(item.id, item.version).system.assets[id];
      if (asset) return asset;
    }
  }
  verifyKnown(system: DesignSystem) {
    safeDirectory(this.directory);
    const file = this.file(system.id, system.version);
    if (fs.existsSync(file))
      this.read(system.id, system.version, systemDigest(system));
    this.rememberAssets(system.assets);
  }
  save(input: unknown) {
    safeDirectory(this.directory);
    const system = validateDesignSystem(input);
    this.rememberAssets(system.assets);
    const digest = systemDigest(system),
      file = this.file(system.id, system.version);
    if (fs.existsSync(file)) {
      const existing = this.read(system.id, system.version);
      if (existing.digest !== digest)
        error(
          "This version is immutable. Choose a new version to save changes.",
          409,
        );
      return { ...existing, summary: summary(system) };
    }
    const storedBytes = Buffer.byteLength(
      JSON.stringify(
        {
          format: "mcp-visual-design-system-release",
          version: 1,
          digest,
          system,
        },
        null,
        2,
      ),
    );
    if (storedBytes > 16 * 1024 * 1024)
      error("Stored design system exceeds 16 MiB.");
    safeDirectory(this.directory);
    // This library has the same exclusive workspace owner as documents. Save is sync/atomic.
    atomicJson(file, {
      format: "mcp-visual-design-system-release",
      version: 1,
      digest,
      system,
    });
    return { system, digest, summary: summary(system) };
  }
  getDefault(): SystemRef | null {
    safeDirectory(this.directory);
    const file = path.join(this.directory, "default.json");
    if (!fs.existsSync(file)) return null;
    const data = this.readFile(file);
    if (data.system === null) return null;
    const ref = SystemRefSchema.parse(data.system);
    this.read(ref.id, ref.version, ref.digest);
    return ref;
  }
  setDefault(ref: SystemRef | null) {
    safeDirectory(this.directory);
    if (ref) this.read(ref.id, ref.version, ref.digest);
    atomicJson(path.join(this.directory, "default.json"), { system: ref });
    return { defaultSystem: ref };
  }
  export(ref: SystemRef): Buffer {
    const { system, digest } = this.read(ref.id, ref.version, ref.digest);
    const data = Buffer.from(
      JSON.stringify(
        {
          format: "mcp-visual-design-system",
          version: 1,
          system,
          digest,
          assets: Object.values(system.assets).map((asset) => ({
            id: asset.id,
            data: readVerifiedAsset(asset, this.assetsDirectory).toString(
              "base64",
            ),
          })),
        },
        null,
        2,
      ),
    );
    if (data.length > MAX_BUNDLE_BYTES)
      error("Portable design system exceeds 100 MiB.");
    return data;
  }
}
