import postcss from "postcss";
import { parse as parseColor, formatHex8, converter } from "culori";
import type { DesignToken } from "../domain/model.js";
export const tokenPath = (value: string) =>
  value
    .replace(/^--/, "")
    .replace(/[^A-Za-z0-9_.-]/g, "_")
    .replace(/^[^A-Za-z]/, "token_$&")
    .slice(0, 180);
export function cssColor(value: string): string | undefined {
  if (value.trim() === "transparent") return "transparent";
  try {
    const color = parseColor(value.trim());
    if (color) {
      const out = formatHex8(converter("rgb")(color));
      if (out) return out.endsWith("ff") ? out.slice(0, 7) : out;
    }
  } catch {}
}
export function cssValue(
  value: string,
  property?: string,
): DesignToken | undefined {
  value = value.trim();
  const alias =
    /^var\(\s*--([A-Za-z0-9_-]+)\s*\)$/.exec(value) ||
    /^\{([A-Za-z0-9_.-]+)\}$/.exec(value);
  if (alias)
    return {
      type: property?.includes("font") ? "fontFamily" : "color",
      value: { ref: tokenPath(alias[1]) },
    };
  if (property?.includes("weight")) {
    const weights: Record<string, number> = {
      normal: 400,
      regular: 400,
      bold: 700,
      medium: 500,
      semibold: 600,
      light: 300,
      thin: 100,
      black: 900,
    };
    if (Object.hasOwn(weights, value.toLowerCase()))
      return { type: "fontWeight", value: weights[value.toLowerCase()] };
  }
  const dim = /^(-?\d+(?:\.\d+)?)(px|rem|em|pt)$/.exec(value);
  if (dim)
    return {
      type: "dimension",
      value: Number(dim[1]) * { px: 1, rem: 16, em: 16, pt: 96 / 72 }[dim[2]]!,
    };
  if (/^-?\d+(?:\.\d+)?$/.test(value))
    return {
      type: property?.includes("weight") ? "fontWeight" : "number",
      value: Number(value),
    };
  if (
    property?.includes("font") &&
    !property.includes("size") &&
    !property.includes("weight")
  ) {
    const family = value
      .split(",")[0]
      .trim()
      .replace(/^['"]|['"]$/g, "");
    if (/^[A-Za-z][A-Za-z0-9 _-]{0,79}$/.test(family))
      return { type: "fontFamily", value: family };
  }
  const color = cssColor(value);
  if (color) return { type: "color", value: color };
}

export function parseStylesheet(source: string) {
  const root = postcss.parse(source, { from: undefined });
  const pending: { node: any; depth: number }[] = [{ node: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > 10000 || depth > 50)
      throw new Error(
        "CSS source is too deeply nested or contains too many rules.",
      );
    for (const child of node.nodes ?? [])
      pending.push({ node: child, depth: depth + 1 });
  }
  return root;
}
