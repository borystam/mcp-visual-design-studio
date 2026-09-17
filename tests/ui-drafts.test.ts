import { test } from "node:test";
import assert from "node:assert/strict";
import { preserveTextRuns } from "../src/ui/drafts.js";

test("plain text edits preserve unaffected rich runs and links through disjoint edits", () => {
  const runs = [
    { text: "Hello ", bold: true },
    { text: "linked words", href: "https://example.com", underline: true },
    { text: " and an ending", italic: true },
  ];
  const old = runs.map((r) => r.text).join(""),
    edited = "Hi Hello linked words and an ending!";
  const result = preserveTextRuns(old, edited, runs);
  assert.equal(result.map((r) => r.text).join(""), edited);
  assert.ok(result.some((r) => r.text === "Hello " && r.bold));
  assert.ok(
    result.some(
      (r) =>
        r.text === "linked words" &&
        r.href === "https://example.com" &&
        r.underline,
    ),
  );
  assert.ok(result.some((r) => r.text === " and an ending" && r.italic));
  assert.deepEqual(result[0], { text: "Hi " });
  assert.deepEqual(result.at(-1), { text: "!" });
});
test("middle replacements and Unicode characters retain unaffected attributes without splitting surrogates", () => {
  const runs = [
    { text: "A😀 link ", href: "https://example.com" },
    { text: "green center", bold: true },
    { text: " tail", italic: true },
  ];
  const old = runs.map((r) => r.text).join("");
  const result = preserveTextRuns(old, "A😀 link blue center tail!", runs);
  assert.equal(
    result.map((r) => r.text).join(""),
    "A😀 link blue center tail!",
  );
  assert.ok(result.some((r) => r.text === "A😀 link " && r.href));
  assert.ok(result.some((r) => r.text.includes(" center") && r.bold));
  assert.ok(result.some((r) => r.text === " tail" && r.italic));
  for (const r of result)
    assert.ok(!/[\uD800-\uDBFF]$|^[\uDC00-\uDFFF]/.test(r.text));
});
test("large replacement has bounded fallback retaining prefix and suffix formatting", () => {
  const old = "prefix " + "a".repeat(5000) + " suffix";
  const edited = "prefix " + "b".repeat(5000) + " suffix";
  const runs = [
    { text: "prefix ", bold: true },
    { text: "a".repeat(5000) },
    { text: " suffix", href: "https://example.com" },
  ];
  const result = preserveTextRuns(old, edited, runs);
  assert.equal(result.map((r) => r.text).join(""), edited);
  assert.equal(result[0].bold, true);
  assert.equal(result.at(-1)!.href, "https://example.com");
});
