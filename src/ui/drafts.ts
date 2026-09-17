import type { TextRun } from "../domain/model.js";

/** Keep formatting on unchanged Unicode characters. Insertions are plain text.
 * Myers' deterministic edit path handles multiple edits; explicit work/distance
 * bounds keep a very large paste from blocking the editor. The bounded fallback
 * still preserves the common prefix/suffix around the replaced text.
 */
export function preserveTextRuns(
  oldText: string,
  newText: string,
  runs: TextRun[] | undefined,
): TextRun[] {
  if (!runs?.length) return [];
  if (runs.map((run) => run.text).join("") !== oldText) return [];
  if (oldText === newText) return runs.map((run) => ({ ...run }));
  const oldChars = Array.from(oldText),
    newChars = Array.from(newText);
  const source = new Int32Array(newChars.length).fill(-1);
  let prefix = 0,
    suffix = 0;
  const unchangedAt = oldText.length ? newText.indexOf(oldText) : -1;
  if (unchangedAt >= 0) {
    const start = Array.from(newText.slice(0, unchangedAt)).length;
    for (let i = 0; i < oldChars.length; i++) source[start + i] = i;
    prefix = oldChars.length;
  } else {
    while (
      prefix < oldChars.length &&
      prefix < newChars.length &&
      oldChars[prefix] === newChars[prefix]
    ) {
      source[prefix] = prefix;
      prefix++;
    }
    while (
      suffix < oldChars.length - prefix &&
      suffix < newChars.length - prefix &&
      oldChars[oldChars.length - 1 - suffix] ===
        newChars[newChars.length - 1 - suffix]
    ) {
      source[newChars.length - 1 - suffix] = oldChars.length - 1 - suffix;
      suffix++;
    }
  }
  const a = oldChars.slice(prefix, oldChars.length - suffix),
    b = newChars.slice(prefix, newChars.length - suffix);
  if (a.length && b.length) {
    const v = new Map<number, number>([[1, 0]]),
      trace: Map<number, number>[] = [];
    let found = false,
      work = 0;
    search: for (let d = 0; d <= Math.min(256, a.length + b.length); d++) {
      trace.push(new Map(v));
      for (let k = -d; k <= d; k += 2) {
        if (++work > 2_000_000) break search;
        let x =
          k === -d ||
          (k !== d && (v.get(k - 1) ?? -Infinity) < (v.get(k + 1) ?? -Infinity))
            ? (v.get(k + 1) ?? 0)
            : (v.get(k - 1) ?? 0) + 1;
        let y = x - k;
        while (x < a.length && y < b.length && a[x] === b[y]) {
          x++;
          y++;
          if (++work > 2_000_000) break search;
        }
        v.set(k, x);
        if (x >= a.length && y >= b.length) {
          found = true;
          break search;
        }
      }
    }
    if (found) {
      let x = a.length,
        y = b.length;
      for (let d = trace.length - 1; d >= 0; d--) {
        const prior = trace[d],
          k = x - y;
        const previousK =
          k === -d ||
          (k !== d &&
            (prior.get(k - 1) ?? -Infinity) < (prior.get(k + 1) ?? -Infinity))
            ? k + 1
            : k - 1;
        const previousX = prior.get(previousK) ?? 0,
          previousY = previousX - previousK;
        while (x > previousX && y > previousY) {
          x--;
          y--;
          source[prefix + y] = prefix + x;
        }
        if (d === 0) break;
        x = previousX;
        y = previousY;
      }
    }
  }
  type Attributes = Omit<TextRun, "text">;
  const attributes: Attributes[] = [];
  let runIndex = 0,
    runEnd = runs[0].text.length,
    offset = 0;
  for (const character of oldChars) {
    while (offset >= runEnd && runIndex < runs.length - 1) {
      runIndex++;
      runEnd += runs[runIndex].text.length;
    }
    const { text: _, ...format } = runs[runIndex];
    attributes.push(format);
    offset += character.length;
  }
  const result: TextRun[] = [];
  let previousKey = "";
  for (let i = 0; i < newChars.length; i++) {
    const format = source[i] >= 0 ? attributes[source[i]] : {};
    const key = JSON.stringify([
      format.bold,
      format.italic,
      format.underline,
      format.href,
    ]);
    if (result.length && key === previousKey)
      result[result.length - 1].text += newChars[i];
    else {
      result.push({ text: newChars[i], ...format });
      previousKey = key;
    }
  }
  return result;
}
