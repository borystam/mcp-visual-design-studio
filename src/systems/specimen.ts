import { randomUUID } from "node:crypto";
import { createDocument } from "../domain/templates.js";
import {
  validateDocument,
  type DesignSystem,
  type Element,
  type Page,
} from "../domain/model.js";
import {
  validateDesignSystem,
  resolveToken,
  instantiateComponent,
} from "../domain/design-system.js";
const id = () => randomUUID();
export function systemSpecimen(input: DesignSystem) {
  const system = validateDesignSystem(input),
    doc = createDocument(`${system.name} — review specimen`, "blank");
  doc.designSystem = system;
  doc.assets = structuredClone(system.assets);
  doc.pages = [];
  const page = (name: string): Page => ({
    id: id(),
    name,
    width: 794,
    height: 1123,
    background: "#ffffff",
    elements: [],
  });
  let p = page("Tokens and typography");
  doc.pages.push(p);
  let y = 48;
  const label = (
    text: string,
    x: number,
    top: number,
    width = 690,
    fontSize = 14,
  ): Element => ({
    id: id(),
    type: "text",
    name: text.slice(0, 100) || "Label",
    x,
    y: top,
    width,
    height: Math.max(24, fontSize * 1.5),
    style: { fontFamily: "Inter", fontSize, color: "#18201d" },
    text,
  });
  p.elements.push(label(system.name, 48, y, 690, 30));
  y += 60;
  for (const [name, token] of Object.entries(system.tokens).slice(0, 240)) {
    if (y > 970) {
      p = page("More tokens");
      doc.pages.push(p);
      y = 48;
    }
    const value = resolveToken(system, name);
    p.elements.push(label(name, 48, y, 440, 13));
    if (token.type === "color")
      p.elements.push({
        id: id(),
        type: "shape",
        name: `${name} swatch`,
        x: 530,
        y,
        width: 180,
        height: 32,
        style: {
          background: String(value),
          borderColor: "#dddddd",
          borderWidth: 1,
        },
        tokenBindings: { background: name },
      });
    else if (token.type === "fontFamily") {
      const sample = label("Aa Bb 012345", 475, y, 270, 22);
      sample.style.fontFamily = String(value);
      sample.tokenBindings = { fontFamily: name };
      p.elements.push(sample);
    } else p.elements.push(label(String(value), 540, y, 190, 14));
    y += 48;
  }
  for (const component of system.components.slice(0, 50)) {
    const element = instantiateComponent(system, component.id, {
      idFactory: id,
    });
    element.x = 48;
    element.y = 100;
    const componentPage = page(component.name);
    componentPage.width = Math.min(10000, Math.max(794, element.width + 96));
    componentPage.height = Math.min(
      10000,
      Math.max(1123, element.height + 148),
    );
    componentPage.elements.push(
      label(component.name, 48, 36, componentPage.width - 96, 24),
      element,
    );
    doc.pages.push(componentPage);
  }
  return validateDocument(doc);
}
