import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { deflateRawSync } from "node:zlib";
import { previewImport, unpackSources } from "../src/systems/import.js";
import {
  validateDesignSystem,
  resolveToken,
  resolveElementTokens,
} from "../src/domain/design-system.js";
import { DesignSystemLibrary } from "../src/systems/library.js";
import { systemSpecimen } from "../src/systems/specimen.js";
const file = (name: string, data: string | Buffer) => ({
  name,
  data: Buffer.from(data).toString("base64"),
});
const temporary = () =>
  fs.mkdtempSync(path.join(os.tmpdir(), "system import 日本語 "));
function crc(data: Buffer) {
  let c = 0xffffffff;
  for (const b of data) {
    c ^= b;
    for (let i = 0; i < 8; i++) c = (c >>> 1) ^ (c & 1 ? 0xedb88320 : 0);
  }
  return (c ^ 0xffffffff) >>> 0;
}
export function zipFiles(
  files: {
    name: string;
    data: Buffer;
    attributes?: number;
    declaredSize?: number;
  }[],
) {
  const local: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name),
      data = deflateRawSync(f.data),
      header = Buffer.alloc(30),
      record = Buffer.alloc(46),
      sum = crc(f.data);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(sum, 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(f.declaredSize ?? f.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(0x031e, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(sum, 16);
    record.writeUInt32LE(data.length, 20);
    record.writeUInt32LE(f.declaredSize ?? f.data.length, 24);
    record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(f.attributes ?? 0, 38);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, data);
    central.push(record, name);
    offset += header.length + name.length + data.length;
  }
  const end = Buffer.alloc(22),
    directory = Buffer.concat(central);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}
const tokens = {
  color: {
    $type: "color",
    brand: {
      $value: { colorSpace: "srgb", components: [0.1, 0.2, 0.3], alpha: 1 },
    },
    primary: { $value: "{color.brand}" },
    accent: { $value: "#c66a46" },
  },
  space: { $type: "dimension", section: { $value: { value: 2, unit: "rem" } } },
  font: { $type: "fontFamily", body: { $value: ["Inter", "sans-serif"] } },
  type: {
    $type: "typography",
    heading: {
      $value: {
        fontFamily: "Lora",
        fontSize: { value: 32, unit: "px" },
        fontWeight: 700,
        lineHeight: 1.2,
        letterSpacing: { value: 0, unit: "px" },
      },
    },
  },
};
test("HTML inherited token bindings survive upgrades while local styles and heading defaults override them", async () => {
  const root = temporary();
  try {
    const draft = await previewImport(
      {
        files: [
          file(
            "brand.css",
            `:root { --primary: #112233; --accent: #778899; --body-font: Inter;
              --body-size: 18px; --body-weight: 500; --leading: 1.5; }
            section { color: var(--primary); font-family: var(--body-font);
              font-size: var(--body-size); font-weight: var(--body-weight); line-height: var(--leading); }
            .literal { color: #445566; font-family: serif; font-size: 20px; font-weight: 400; line-height: 1.4; }
            .alias { color: var(--accent); }
            h3 { font-size: var(--body-size); font-weight: var(--body-weight); }`,
          ),
          file(
            "card.html",
            '<section><h2>Default heading</h2><h3>Bound heading</h3><div><p>Inherited text</p><p class="literal">Literal text</p><p class="alias">Rebound text</p></div></section>',
          ),
        ],
      },
      root,
    );
    const system = validateDesignSystem(draft.system);
    system.version = "1.1.0";
    system.tokens.primary.value = "#aabbcc";
    system.tokens.accent.value = "#ddeeff";
    system.tokens["body-font"].value = "Lora";
    system.tokens["body-size"].value = 24;
    system.tokens["body-weight"].value = 600;
    system.tokens.leading.value = 1.8;
    const resolved = resolveElementTokens(system.components[0].element, system);
    const heading = resolved.children![0],
      reboundHeading = resolved.children![1],
      [inherited, literal, rebound] = resolved.children![2].children!;
    assert.equal(inherited.style.color, "#aabbcc");
    assert.equal(inherited.style.fontFamily, "Lora");
    assert.equal(inherited.style.fontSize, 24);
    assert.equal(inherited.style.fontWeight, 600);
    assert.equal(inherited.style.lineHeight, 1.8);
    assert.equal(inherited.tokenBindings?.color, "primary");
    assert.equal(literal.style.color, "#445566");
    assert.equal(literal.style.fontFamily, "serif");
    assert.equal(literal.style.fontSize, 20);
    assert.equal(literal.style.fontWeight, 400);
    assert.equal(literal.style.lineHeight, 1.4);
    assert.equal(literal.tokenBindings, undefined);
    assert.equal(rebound.style.color, "#ddeeff");
    assert.equal(rebound.tokenBindings?.color, "accent");
    assert.equal(heading.style.fontSize, 28);
    assert.equal(heading.style.fontWeight, 700);
    assert.equal(heading.tokenBindings?.fontSize, undefined);
    assert.equal(heading.tokenBindings?.fontWeight, undefined);
    assert.equal(heading.style.fontFamily, "Lora");
    assert.equal(reboundHeading.style.fontSize, 24);
    assert.equal(reboundHeading.style.fontWeight, 600);
    assert.equal(reboundHeading.tokenBindings?.fontSize, "body-size");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("HTML text exports the same default line height used to estimate its native bounds", async () => {
  const root = temporary();
  try {
    const draft = await previewImport(
      {
        files: [
          file(
            "card.html",
            "<section><h1>Short title</h1><p>Body copy.</p></section>",
          ),
        ],
      },
      root,
    );
    const [heading, body] = draft.system.components[0].element.children!;
    assert.equal(heading.style.lineHeight, 1.35);
    assert.equal(body.style.lineHeight, 1.35);
    assert.equal(
      heading.height,
      heading.style.fontSize! * heading.style.lineHeight!,
    );
    assert.equal(
      body.height,
      Math.max(24, body.style.fontSize! * body.style.lineHeight!),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("DTCG import retains aliases, scalar types, typography and explicit rem conversion", async () => {
  const root = temporary();
  try {
    const result = await previewImport(
      {
        name: "Original token fixture",
        files: [file("tokens.json", JSON.stringify(tokens))],
      },
      root,
    );
    const s = validateDesignSystem(result.system);
    assert.deepEqual(s.tokens["color.primary"].value, { ref: "color.brand" });
    assert.equal(resolveToken(s, "space.section"), 32);
    assert.equal(resolveToken(s, "type.heading.fontSize"), 32);
    assert.equal(resolveToken(s, "font.body"), "Inter");
    assert.equal(systemSpecimen(s).designSystem?.name, s.name);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("CSS alias inference never rewrites explicit DTCG alias types", async () => {
  const root = temporary();
  try {
    const result = await previewImport(
      {
        files: [
          file(
            "tokens.json",
            JSON.stringify({
              spacing: { $type: "dimension", $value: { value: 8, unit: "px" } },
              wrong: { $type: "color", $value: "{spacing}" },
            }),
          ),
          file(
            "variables.css",
            ":root{--primary:#123456;--linked:var(--primary);--_space:8px;--space-copy:var(--_space)}",
          ),
        ],
      },
      root,
    );
    assert.equal(result.system.tokens.wrong.type, "color");
    assert.equal(result.system.tokens["space-copy"].type, "dimension");
    assert.deepEqual(result.system.tokens["space-copy"].value, {
      ref: "token__space",
    });
    assert.throws(() => validateDesignSystem(result.system), /type|color/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("source token limits apply during insertion across files before alias inference", async () => {
  const root = temporary();
  try {
    const chain = (start: number, count: number) =>
      `:root{${Array.from({ length: count }, (_, offset) => {
        const i = start + offset;
        return `--t${i}:var(--t${i + 1});`;
      }).join("")}}`;
    await assert.rejects(
      previewImport(
        {
          files: [
            file("first.css", chain(0, 1000)),
            file("second.css", chain(1000, 1001)),
          ],
        },
        root,
      ),
      /at most 2,000 tokens/,
    );
    await assert.rejects(
      previewImport(
        {
          files: [
            file(
              "tokens.json",
              JSON.stringify(
                Object.fromEntries(
                  Array.from({ length: 2001 }, (_, i) => [
                    `t${i}`,
                    { $type: "number", $value: i },
                  ]),
                ),
              ),
            ),
          ],
        },
        root,
      ),
      /at most 2,000 tokens/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("bounded CSS inference keeps valid alias chains and repairable cyclic or missing drafts", async () => {
  const root = temporary();
  try {
    const chain = Array.from(
      { length: 64 },
      (_, i) => `--t${i}:${i === 63 ? "12px" : `var(--t${i + 1})`};`,
    ).join("");
    const valid = await previewImport(
      { files: [file("valid.css", `:root{${chain}}`)] },
      root,
    );
    assert.equal(resolveToken(validateDesignSystem(valid.system), "t0"), 12);
    assert.equal(valid.system.tokens.t0.type, "dimension");
    const invalid = await previewImport(
      {
        files: [
          file(
            "review.css",
            `:root{${chain}--too-long:var(--t0);--missing:var(--absent);--cycle-a:var(--cycle-b);--cycle-b:var(--cycle-a)}`,
          ),
        ],
      },
      root,
    );
    assert.deepEqual(invalid.system.tokens["missing"].value, { ref: "absent" });
    assert.deepEqual(invalid.system.tokens["cycle-a"].value, {
      ref: "cycle-b",
    });
    assert.throws(() => resolveToken(invalid.system, "too-long"), /64/);
    assert.throws(
      () => resolveToken(invalid.system, "missing"),
      /Unknown token/,
    );
    assert.throws(() => resolveToken(invalid.system, "cycle-a"), /cycle/);
    assert.throws(
      () => validateDesignSystem(invalid.system),
      /64|cycle|Unknown token/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("source ZIP ports CSS tokens, local fonts, guidelines and native HTML component slots", async () => {
  const root = temporary();
  try {
    const font = fs.readFileSync(
      path.resolve("assets/fonts/inter-latin-400-normal.woff2"),
    );
    const archive = zipFiles([
      {
        name: "project/tokens.css",
        data: Buffer.from(
          '@font-face{font-family:"Ported Sans";src:url("fonts/body.woff2");font-weight:400}:root{--primary:#173d36;--accent:#d67a51;--body-font:"Ported Sans";--space:16px}.card{padding:var(--space);background:#f9f5eb}.card h2{color:var(--primary);font-family:var(--body-font)}',
        ),
      },
      { name: "project/fonts/body.woff2", data: font },
      {
        name: "project/index.html",
        data: Buffer.from(
          '<!doctype html><html><body><section class="card" data-component="Service card"><h2>Make room for ideas.</h2><p>Original generic migration fixture.</p></section><script>throw new Error("Never execute")</script></body></html>',
        ),
      },
      {
        name: "project/brand-guide.md",
        data: Buffer.from(
          "Use generous whitespace. Original generic test brand.",
        ),
      },
      {
        name: "project/src/App.tsx",
        data: Buffer.from(
          'export default function App(){throw new Error("Never execute")};',
        ),
      },
      { name: "project/.env", data: Buffer.from("TEST_ONLY_IGNORED=example") },
    ]);
    const result = await previewImport(
        {
          name: "Ported reference",
          files: [file("source-export.zip", archive)],
        },
        root,
      ),
      s = validateDesignSystem(result.system);
    assert.equal(s.fonts[0].family, "Ported Sans");
    assert.equal(s.components.length, 1);
    assert.equal(
      s.components[0].element.children?.[0].text,
      "Make room for ideas.",
    );
    assert.equal(
      s.components[0].element.children?.[0].tokenBindings?.color,
      "primary",
    );
    assert.ok(
      Object.values(s.components[0].slots).some((slot) => slot.type === "text"),
    );
    assert.equal(result.report.executableFiles.length, 1);
    assert.ok(result.report.ignoredFiles.includes("project/.env"));
    assert.ok(result.warnings.some((w) => w.includes("not executed")));
    assert.ok(systemSpecimen(s).pages.length >= 2);
    const library = new DesignSystemLibrary(path.join(root, "workspace"), root);
    const saved = library.save(s);
    const ref = { id: s.id, version: s.version, digest: saved.digest };
    const data = library.export(ref),
      fresh = temporary();
    try {
      const roundtrip = await previewImport(
        { files: [file("brand.vds-system.json", data)] },
        fresh,
      );
      assert.equal(roundtrip.digest, saved.digest);
      assert.deepEqual(roundtrip.system, s);
      const tampered = JSON.parse(data.toString());
      tampered.system.name = "Changed";
      await assert.rejects(
        previewImport(
          {
            files: [file("tampered.vds-system.json", JSON.stringify(tampered))],
          },
          fresh,
        ),
        /digest mismatch/,
      );
    } finally {
      fs.rmSync(fresh, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test("source ZIP rejects traversal, symlinks, duplicate paths and decompression bounds", async () => {
  const bad = [
    zipFiles([{ name: "../escape.css", data: Buffer.from("x") }]),
    zipFiles([
      {
        name: "link.css",
        data: Buffer.from("x"),
        attributes: (0o120777 << 16) >>> 0,
      },
    ]),
    zipFiles([
      { name: "A.css", data: Buffer.from("x") },
      { name: "a.css", data: Buffer.from("x") },
    ]),
    zipFiles([
      {
        name: "bomb.css",
        data: Buffer.from("x"),
        declaredSize: 21 * 1024 * 1024,
      },
    ]),
  ];
  for (const data of bad)
    await assert.rejects(unpackSources([{ name: "source.zip", data }]));
});
test("external font and stylesheet references are not fetched", async () => {
  const root = temporary();
  try {
    const result = await previewImport(
      {
        files: [
          file(
            "source.css",
            '@import url("https://example.invalid/private.css");@font-face{font-family:"Unprovided";src:url("https://example.invalid/font.woff2")}:root{--primary:oklch(60% .15 150);--body-font:"Unprovided"}',
          ),
        ],
      },
      root,
    );
    assert.ok(result.warnings.some((w) => w.includes("not fetched")));
    assert.ok(result.warnings.some((w) => w.includes("Missing font")));
    assert.throws(() => validateDesignSystem(result.system), /font/i);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source parsing rejects excessive markup/style nesting before walking trees", async () => {
  const root = temporary();
  try {
    await assert.rejects(
      previewImport(
        {
          files: [
            file(
              "deep.html",
              "<div>".repeat(60) + "<p>Example</p>" + "</div>".repeat(60),
            ),
          ],
        },
        root,
      ),
      /deeply nested/,
    );
    await assert.rejects(
      previewImport(
        {
          files: [
            file(
              "deep.css",
              "@media all{".repeat(60) +
                ":root{--primary:#123456}" +
                "}".repeat(60),
            ),
          ],
        },
        root,
      ),
      /deeply nested/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("reviewed font subsets retain the exact normalized digest when saved", async () => {
  const root = temporary();
  try {
    const result = await previewImport(
      {
        files: [
          file(
            "font.woff2",
            fs.readFileSync(
              path.resolve("assets/fonts/inter-latin-400-normal.woff2"),
            ),
          ),
          file(
            "fonts.css",
            "@font-face{font-family:Inter;src:url(font.woff2);font-weight:400;unicode-range:U+0000-00FF}:root{--body-font:Inter;--primary:#123456}",
          ),
        ],
      },
      root,
    );
    assert.equal(result.system.fonts[0].unicodeRange, "U+0-FF");
    const library = new DesignSystemLibrary(path.join(root, "workspace"), root),
      saved = library.save(result.system);
    assert.equal(result.digest, saved.digest);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("CSS typography numbers are never misread as bare hexadecimal colors", async () => {
  const root = temporary();
  try {
    const result = await previewImport(
      {
        files: [
          file(
            "styles.css",
            ":root{--font-weight:400;--primary:#173d36} h2{font-weight:400;font-size:28px} p{font-weight:bold;line-height:1.4}",
          ),
          file(
            "index.html",
            "<section><h2>Editable title</h2><p>Editable body</p></section>",
          ),
        ],
      },
      root,
    );
    const checked = validateDesignSystem(result.system);
    assert.equal(checked.tokens["font-weight"].type, "fontWeight");
    assert.equal(
      checked.components[0].element.children?.[0].style.fontWeight,
      400,
    );
    assert.equal(
      checked.components[0].element.children?.[1].style.fontWeight,
      700,
    );
    assert.equal(
      checked.components[0].element.children?.[1].style.lineHeight,
      1.4,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
