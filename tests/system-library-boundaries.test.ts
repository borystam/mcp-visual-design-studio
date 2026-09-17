import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { validateDesignSystem } from "../src/domain/design-system.js";
import { DesignSystemLibrary } from "../src/systems/library.js";
import { importAsset } from "../src/export/assets.js";

function fixture(t: TestContext) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "Studio library 日本語 "));
  const assets = path.join(root, "assets");
  fs.mkdirSync(assets);
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const library = new DesignSystemLibrary(root, assets);
  const system = validateDesignSystem({
    id: "boundary",
    name: "Boundary",
    version: "1.0.0",
    tokens: {
      primary: { type: "color", value: "#123456" },
      body: { type: "fontFamily", value: "Inter" },
    },
  });
  return { root, assets, library, system };
}
function onWindows<T>(run: () => T): T {
  const original = Object.getOwnPropertyDescriptor(process, "platform")!;
  Object.defineProperty(process, "platform", { ...original, value: "win32" });
  try {
    return run();
  } finally {
    Object.defineProperty(process, "platform", original);
  }
}
function withStats<T extends fs.Stats | fs.BigIntStats>(
  stats: T,
  changed: Partial<T>,
): T {
  return Object.assign(
    Object.create(Object.getPrototypeOf(stats)),
    stats,
    changed,
  );
}

test("library versions and defaults survive restart, key ordering does not create a new release", (t) => {
  const { root, assets, library, system } = fixture(t);
  const saved = library.save(system);
  const ref = { id: system.id, version: system.version, digest: saved.digest };
  const file = path.join(library.directory, "boundary@1.0.0.json");
  if (process.platform === "win32") {
    const before = fs.lstatSync(file, { bigint: true }),
      descriptor = fs.openSync(file, fs.constants.O_RDONLY);
    try {
      const handle = fs.fstatSync(descriptor, { bigint: true }),
        after = fs.lstatSync(file, { bigint: true });
      t.diagnostic(
        JSON.stringify({
          windowsLibraryIdentity: Object.fromEntries(
            Object.entries({ before, handle, after }).map(([name, stat]) => [
              name,
              { ino: String(stat.ino), dev: String(stat.dev) },
            ]),
          ),
        }),
      );
    } finally {
      fs.closeSync(descriptor);
    }
  }
  library.setDefault(ref);
  const bytes = fs.readFileSync(file);
  const reordered = structuredClone(system);
  reordered.tokens = Object.fromEntries(
    Object.entries(reordered.tokens).reverse(),
  );
  assert.equal(library.save(reordered).digest, saved.digest);
  assert.deepEqual(fs.readFileSync(file), bytes);
  const restarted = new DesignSystemLibrary(root, assets);
  assert.deepEqual(restarted.getDefault(), ref);
  assert.deepEqual(
    restarted.read(ref.id, ref.version, ref.digest).system,
    system,
  );
  const changed = structuredClone(system);
  changed.tokens.primary = { type: "color", value: "#abcdef" };
  assert.throws(() => restarted.save(changed), /immutable/);
  assert.throws(() => restarted.verifyKnown(changed), /digest/);
  assert.deepEqual(fs.readFileSync(file), bytes);
  changed.version = "1.0.1";
  assert.doesNotThrow(() => restarted.verifyKnown(changed));
  restarted.save(changed);
  assert.deepEqual(restarted.getDefault(), ref);
  restarted.setDefault(null);
  assert.equal(new DesignSystemLibrary(root, assets).getDefault(), null);
});

test("Windows library reads retain exact inode checks with zero or wider path device IDs", (t) => {
  const { library, system } = fixture(t);
  library.save(system);
  const file = path.join(library.directory, "boundary@1.0.0.json"),
    lstat = fs.lstatSync,
    fstat = fs.fstatSync;
  let pathDevice = 0n;
  const inode = 9007199254740993n;
  t.mock.method(fs, "lstatSync", (...args: any[]) => {
    const stat = (lstat as any)(...args);
    if (args[0] !== file) return stat;
    assert.equal(args[1]?.bigint, true);
    return withStats(stat, { dev: pathDevice, ino: inode });
  });
  t.mock.method(fs, "fstatSync", (...args: any[]) => {
    assert.equal(args[1]?.bigint, true);
    return withStats((fstat as any)(...args), { dev: 0x1234n, ino: inode });
  });
  for (const device of [0n, 0xabcd00001234n]) {
    pathDevice = device;
    assert.deepEqual(
      onWindows(() => library.read(system.id, system.version).system),
      system,
    );
  }
});

test("Windows guard handles reject another volume even when inode and content match", (t) => {
  const { library, system } = fixture(t);
  library.save(system);
  const file = path.join(library.directory, "boundary@1.0.0.json"),
    lstat = fs.lstatSync,
    fstat = fs.fstatSync,
    open = fs.openSync,
    close = fs.closeSync;
  const handles = new Set<number>();
  let checked = 0;
  t.mock.method(fs, "lstatSync", (...args: any[]) => {
    const stat = (lstat as any)(...args);
    return args[0] === file ? withStats(stat, { dev: 0n }) : stat;
  });
  t.mock.method(fs, "openSync", (...args: any[]) => {
    const fd = (open as any)(...args);
    handles.add(fd);
    return fd;
  });
  t.mock.method(fs, "closeSync", (fd: number) => {
    handles.delete(fd);
    return close(fd);
  });
  t.mock.method(fs, "fstatSync", (...args: any[]) =>
    withStats((fstat as any)(...args), { dev: ++checked === 1 ? 123n : 456n }),
  );
  assert.throws(
    () => onWindows(() => library.read(system.id, system.version)),
    /changed during read/,
  );
  assert.equal(checked, 2);
  assert.equal(handles.size, 0);
});

test("library rejects inode changes that Number stats would round to the same value", (t) => {
  const { library, system } = fixture(t);
  library.save(system);
  const file = path.join(library.directory, "boundary@1.0.0.json"),
    lstat = fs.lstatSync,
    fstat = fs.fstatSync;
  const originalInode = 9007199254740992n,
    replacementInode = originalInode + 1n;
  assert.equal(Number(originalInode), Number(replacementInode));
  t.mock.method(fs, "lstatSync", (...args: any[]) => {
    const stat = (lstat as any)(...args);
    return args[0] === file ? withStats(stat, { ino: originalInode }) : stat;
  });
  t.mock.method(fs, "fstatSync", (...args: any[]) =>
    withStats((fstat as any)(...args), { ino: replacementInode }),
  );
  assert.throws(
    () => library.read(system.id, system.version),
    /changed during read/,
  );
});

test("library rejects path replacement after opening even with identical JSON", (t) => {
  const { library, system } = fixture(t);
  library.save(system);
  const file = path.join(library.directory, "boundary@1.0.0.json"),
    bytes = fs.readFileSync(file),
    open = fs.openSync;
  let replaced = false;
  t.mock.method(fs, "openSync", (...args: any[]) => {
    const fd = (open as any)(...args);
    if (args[0] === file && !replaced) {
      replaced = true;
      fs.renameSync(file, `${file}.old`);
      fs.writeFileSync(file, bytes);
    }
    return fd;
  });
  assert.throws(
    () => onWindows(() => library.read(system.id, system.version)),
    /changed during read/,
  );
});

test("library rejects a symlink observed after opening its original file", (t) => {
  const { library, system } = fixture(t);
  library.save(system);
  const file = path.join(library.directory, "boundary@1.0.0.json"),
    lstat = fs.lstatSync;
  let reads = 0;
  t.mock.method(fs, "lstatSync", (...args: any[]) => {
    const stat = (lstat as any)(...args);
    return args[0] === file && ++reads > 1
      ? withStats(stat, { isSymbolicLink: () => true })
      : stat;
  });
  assert.throws(
    () => onWindows(() => library.read(system.id, system.version)),
    /changed during read/,
  );
});

test("library bounds reads and rejects a file that grows after descriptor validation", (t) => {
  const { library, system } = fixture(t);
  library.save(system);
  const file = path.join(library.directory, "boundary@1.0.0.json"),
    initialSize = fs.statSync(file).size,
    read = fs.readSync;
  let grown = false,
    totalRead = 0;
  t.mock.method(fs, "readSync", (...args: any[]) => {
    if (!grown) {
      grown = true;
      fs.appendFileSync(file, " ".repeat(4096));
    }
    const count = (read as any)(...args);
    totalRead += count;
    return count;
  });
  assert.throws(
    () => library.read(system.id, system.version),
    /changed during read/,
  );
  assert.equal(totalRead, initialSize + 1);
});

test("library refuses traversal, changed release contents, forged digests and identity swaps", (t) => {
  const { library, system } = fixture(t),
    saved = library.save(system);
  assert.throws(() => library.read("../outside", "1.0.0"));
  assert.throws(() => library.read(system.id, "../../outside"));
  assert.throws(
    () =>
      library.setDefault({
        id: system.id,
        version: system.version,
        digest: "0".repeat(64),
      }),
    /digest/,
  );
  const file = path.join(library.directory, "boundary@1.0.0.json");
  const stored = JSON.parse(fs.readFileSync(file, "utf8"));
  stored.system.name = "Tampered";
  fs.writeFileSync(file, JSON.stringify(stored));
  assert.throws(
    () => library.read(system.id, system.version, saved.digest),
    /digest/,
  );
});

test("library rechecks its directory before save and clearing defaults", (t) => {
  const { root, library, system } = fixture(t);
  const elsewhere = fs.mkdtempSync(
    path.join(os.tmpdir(), "Studio outside library "),
  );
  t.after(() => fs.rmSync(elsewhere, { recursive: true, force: true }));
  fs.renameSync(library.directory, path.join(root, "library-backup"));
  fs.symlinkSync(
    elsewhere,
    library.directory,
    process.platform === "win32" ? "junction" : "dir",
  );
  assert.throws(() => library.save(system), /symbolic link|unsafe|Invalid/i);
  assert.throws(
    () => library.setDefault(null),
    /symbolic link|unsafe|Invalid/i,
  );
  assert.deepEqual(fs.readdirSync(elsewhere), []);
});

test("library verifies MIME against bytes before saving a declared font asset", (t) => {
  const { assets, library, system } = fixture(t);
  const picture = importAsset(
    Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="#123456"/></svg>',
    ),
    "picture.svg",
    assets,
  );
  const forged = { ...picture, mime: "font/woff2" as const };
  system.assets[forged.id] = forged;
  system.fonts = [
    { family: "Forged Font", assetId: forged.id, weight: 400, style: "normal" },
  ];
  assert.throws(() => library.save(system), /MIME/);
  assert.deepEqual(library.list(), []);
});
