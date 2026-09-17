import path from "node:path";
import { parse } from "parse5";
import postcss from "postcss";
import { cssColor, cssValue, tokenPath, parseStylesheet } from "./css.js";
import { resolveToken } from "../domain/design-system.js";
import type {
  Asset,
  DesignSystem,
  Element,
  Style,
  TokenBindingKey,
  TokenBindings,
} from "../domain/model.js";

type Node = any;
const attrs = (node: Node): Record<string, string> =>
  Object.fromEntries((node.attrs ?? []).map((a: any) => [a.name, a.value]));
const visibleText = (node: Node): string =>
  node.nodeName === "#text"
    ? (node.value ?? "")
    : ["script", "style", "noscript", "template", "svg"].includes(node.tagName)
      ? ""
      : (node.childNodes ?? [])
          .map(visibleText)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();
function simple(node: Node, selector: string): boolean {
  if (!node.tagName || /[>+~:\[\]*]/.test(selector)) return false;
  const a = attrs(node),
    id = /#([\w-]+)/.exec(selector)?.[1],
    classes = [...selector.matchAll(/\.([\w-]+)/g)].map((m) => m[1]),
    tag = /^[A-Za-z][\w-]*/.exec(selector)?.[0];
  return (
    (!tag || node.tagName === tag.toLowerCase()) &&
    (!id || a.id === id) &&
    classes.every((c) => (a.class ?? "").split(/\s+/).includes(c))
  );
}
function matches(node: Node, selector: string): boolean {
  const bits = selector.trim().split(/\s+/);
  if (!simple(node, bits.pop() ?? "")) return false;
  let ancestor = node.parentNode;
  while (bits.length) {
    const wanted = bits.pop()!;
    while (ancestor && !simple(ancestor, wanted))
      ancestor = ancestor.parentNode;
    if (!ancestor) return false;
    ancestor = ancestor.parentNode;
  }
  return true;
}
export function extractHtmlComponents(
  htmlFiles: { name: string; text: string }[],
  cssFiles: { name: string; text: string }[],
  system: DesignSystem,
  assets: Map<string, Asset>,
  warnings: string[],
): DesignSystem["components"] {
  const rules: {
    selector: string;
    properties: Record<string, string>;
    specificity: number;
    order: number;
  }[] = [];
  let order = 0;
  for (const file of cssFiles)
    parseStylesheet(file.text).walkRules((rule) => {
      if (rule.parent?.type === "atrule") return;
      const properties: Record<string, string> = {};
      rule.walkDecls((d) => {
        properties[d.prop] = d.value;
      });
      for (const selector of rule.selectors)
        rules.push({
          selector,
          properties,
          specificity:
            (selector.match(/#/g)?.length ?? 0) * 100 +
            (selector.match(/\./g)?.length ?? 0) * 10 +
            (selector.match(/(?:^|\s)[A-Za-z]/g)?.length ?? 0),
          order: order++,
        });
    });
  const components: DesignSystem["components"] = [];
  for (const file of htmlFiles) {
    const tree = parse(file.text) as any;
    assertHtmlBounds(tree);
    const candidates: Node[] = [];
    const scan = (node: Node) => {
      const a = attrs(node);
      if (
        node.tagName &&
        (["article", "section"].includes(node.tagName) ||
          a["data-component"] ||
          (a.class ?? "")
            .split(/\s+/)
            .some((c) => /^(?:card|callout|hero|panel|feature)$/.test(c)))
      ) {
        if (visibleText(node) || node.tagName === "img") candidates.push(node);
        return;
      }
      for (const child of node.childNodes ?? []) scan(child);
    };
    scan(tree);
    if (!candidates.length) {
      const body = tree.childNodes
        ?.find((x: any) => x.tagName === "html")
        ?.childNodes?.find((x: any) => x.tagName === "body");
      if (body && visibleText(body)) candidates.push(body);
    }
    for (const candidate of candidates.slice(0, 30)) {
      if (components.length >= 50) {
        warnings.push(
          "Only the first 50 static HTML components were imported.",
        );
        return components;
      }
      let serial = 0;
      const prefix = `html_${components.length + 1}`,
        slots: DesignSystem["components"][number]["slots"] = {};
      const computed = (node: Node): Record<string, string> => {
        const matched = rules
          .filter((r) => matches(node, r.selector))
          .sort((a, b) => a.specificity - b.specificity || a.order - b.order);
        const props = Object.assign({}, ...matched.map((r) => r.properties));
        const inline = attrs(node).style;
        if (inline)
          postcss.parse(`a{${inline}}`).walkDecls((d) => {
            props[d.prop] = d.value;
          });
        return props;
      };
      const make = (
        node: Node,
        width: number,
        inherited: Style = {},
        inheritedBindings: TokenBindings = {},
      ): Element | undefined => {
        const tag = node.tagName,
          a = attrs(node);
        if (
          !tag ||
          [
            "script",
            "style",
            "noscript",
            "template",
            "iframe",
            "object",
            "embed",
            "svg",
            "link",
            "meta",
          ].includes(tag)
        )
          return;
        const css = computed(node);
        if (css.display === "none" || a.hidden !== undefined) return;
        const heading = /^h[1-6]$/.test(tag),
          size = heading
            ? { h1: 36, h2: 28, h3: 22, h4: 20, h5: 18, h6: 16 }[tag as "h1"]
            : 16;
        const style: Style = { ...inherited };
        const tokenBindings: TokenBindings = { ...inheritedBindings };
        if (heading) {
          style.fontSize = size;
          style.fontWeight = 700;
          delete tokenBindings.fontSize;
          delete tokenBindings.fontWeight;
        }
        const mapping: Record<string, TokenBindingKey> = {
          color: "color",
          background: "background",
          "background-color": "background",
          "font-family": "fontFamily",
          "font-size": "fontSize",
          "font-weight": "fontWeight",
          "line-height": "lineHeight",
          "letter-spacing": "letterSpacing",
          "border-color": "borderColor",
          "border-width": "borderWidth",
          "border-radius": "borderRadius",
          padding: "padding",
          opacity: "opacity",
        };
        for (const [property, target] of Object.entries(mapping)) {
          const raw = css[property];
          if (!raw) continue;
          const alias = /^var\(\s*--([\w-]+)\s*\)$/.exec(raw);
          let value: string | number | undefined;
          if (alias && system.tokens[tokenPath(alias[1])]) {
            try {
              value = resolveToken(system, tokenPath(alias[1]));
              tokenBindings[target] = tokenPath(alias[1]);
            } catch {
              warnings.push(`Unresolved HTML style variable --${alias[1]}.`);
            }
          } else
            value = cssValue(raw, property)?.value as
              string | number | undefined;
          if (typeof value === "string" || typeof value === "number") {
            if (!alias) delete tokenBindings[target];
            if (target === "lineHeight" && /(?:px|rem|em)$/.test(raw))
              value = Number(value) / (style.fontSize ?? size);
            (style as any)[target] = value;
          }
        }
        if (["left", "center", "right", "justify"].includes(css["text-align"]))
          style.textAlign = css["text-align"] as Style["textAlign"];
        if (["normal", "italic"].includes(css["font-style"]))
          style.fontStyle = css["font-style"] as Style["fontStyle"];
        const explicitWidth = cssValue(css.width ?? "", "width")?.value;
        if (typeof explicitWidth === "number")
          width = Math.min(900, Math.max(40, explicitWidth));
        const e: Element = {
          id: `${prefix}_${++serial}`,
          type: "group",
          name: a["data-component"] ?? a["aria-label"] ?? tag,
          x: 0,
          y: 0,
          width,
          height: 20,
          style,
        };
        if (Object.keys(tokenBindings).length) e.tokenBindings = tokenBindings;
        if (tag === "img") {
          e.type = "image";
          const source = a.src ?? "";
          const asset = assets.get(
            path.posix.normalize(
              path.posix.join(
                path.posix.dirname(file.name),
                source.split(/[?#]/)[0],
              ),
            ),
          );
          if (!asset || !asset.mime.startsWith("image/")) {
            warnings.push(
              `HTML image ${source || "(missing src)"} was unavailable; replace the editable placeholder.`,
            );
          } else e.assetId = asset.id;
          e.name = a.alt ?? "Imported image";
          e.height = Math.max(40, Math.min(600, Number(a.height) || 180));
          e.fit = "contain";
          slots[`image_${serial}`] = { type: "image", elementId: e.id };
          return e;
        }
        if (tag === "hr") {
          e.type = "divider";
          e.height = 2;
          e.style.background ??= "#cccccc";
          return e;
        }
        const blockChildren = (node.childNodes ?? []).filter(
          (child: any) =>
            child.tagName &&
            ![
              "span",
              "a",
              "strong",
              "em",
              "b",
              "i",
              "u",
              "br",
              "small",
            ].includes(child.tagName),
        );
        if (
          [
            "h1",
            "h2",
            "h3",
            "h4",
            "h5",
            "h6",
            "p",
            "li",
            "a",
            "button",
            "label",
            "blockquote",
            "figcaption",
          ].includes(tag) ||
          !blockChildren.length
        ) {
          const value = visibleText(node);
          if (!value) return;
          e.type = "text";
          e.text = value;
          e.name = heading
            ? "Heading"
            : tag === "button"
              ? "Call to action"
              : "Body text";
          e.style.fontSize ??= size;
          e.style.lineHeight ??= 1.35;
          if (tag === "a" && /^https?:\/\/|^mailto:|^tel:/.test(a.href ?? ""))
            e.href = a.href;
          const chars = Math.max(
            12,
            Math.floor(
              (width - 2 * (style.padding ?? 0)) /
                ((style.fontSize ?? size) * 0.55),
            ),
          );
          e.height = Math.max(
            24,
            Math.ceil(value.length / chars) *
              (style.fontSize ?? size) *
              (style.lineHeight ?? 1.35) +
              2 * (style.padding ?? 0),
          );
          slots[`${heading ? "heading" : "text"}_${serial}`] = {
            type: "text",
            elementId: e.id,
          };
          return e;
        }
        e.layout = "stack";
        e.gap = Number(cssValue(css.gap ?? "12px", "gap")?.value) || 12;
        const gap = /^var\(\s*--([\w-]+)\s*\)$/.exec(css.gap ?? "");
        if (gap && system.tokens[tokenPath(gap[1])]) {
          e.tokenBindings = { ...e.tokenBindings, gap: tokenPath(gap[1]) };
          try {
            e.gap = Number(resolveToken(system, tokenPath(gap[1])));
          } catch {}
        }
        const childInherited: Style = {
          color: style.color,
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          fontStyle: style.fontStyle,
          lineHeight: style.lineHeight,
          letterSpacing: style.letterSpacing,
          textAlign: style.textAlign,
        };
        const childBindings: TokenBindings = {};
        for (const key of Object.keys(childInherited) as (keyof Style)[])
          if (childInherited[key] === undefined) delete childInherited[key];
          else if (tokenBindings[key as TokenBindingKey])
            childBindings[key as TokenBindingKey] =
              tokenBindings[key as TokenBindingKey];
        e.children = (node.childNodes ?? [])
          .map((child: any) =>
            make(
              child,
              Math.max(40, width - 2 * (style.padding ?? 0)),
              childInherited,
              childBindings,
            ),
          )
          .filter(Boolean);
        if (!e.children?.length) return;
        e.height =
          e.children.reduce((sum, child) => sum + child.height, 0) +
          Math.max(0, e.children.length - 1) * (e.gap ?? 0) +
          2 * (style.padding ?? 0);
        if (e.height > 9000) {
          warnings.push("An oversized HTML component was omitted.");
          return;
        }
        return e;
      };
      const element = make(candidate, 600);
      if (!element) continue;
      element.name =
        attrs(candidate)["data-component"] ??
        visibleText(candidate).slice(0, 60) ??
        `Imported component ${components.length + 1}`;
      components.push({
        id: `component_${components.length + 1}`,
        name: element.name,
        description: `Editable static content imported from ${file.name}. Review layout against the original.`,
        element,
        variants: {},
        slots,
      });
    }
  }
  return components;
}

export function assertHtmlBounds(root: any) {
  const pending: { node: any; depth: number }[] = [{ node: root, depth: 0 }];
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > 10000 || depth > 50)
      throw new Error(
        "HTML source is too deeply nested or contains too many nodes.",
      );
    for (const child of node.childNodes ?? [])
      pending.push({ node: child, depth: depth + 1 });
  }
}
