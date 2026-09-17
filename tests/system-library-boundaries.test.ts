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

test("library versions and defaults survive restart, key ordering does not create a new release", (t) => {
  const { root, assets, library, system } = fixture(t);
  const saved = library.save(system);
  const ref = { id: system.id, version: system.version, digest: saved.digest };
  library.setDefault(ref);
  const file = path.join(library.directory, "boundary@1.0.0.json");
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
