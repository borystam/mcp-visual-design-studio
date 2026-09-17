import React, { useEffect, useMemo, useRef, useState } from "react";
import type {
  DesignSystem,
  DesignSystemMapping,
  Document,
  Element,
  TokenBindingKey,
} from "../domain/model.js";
import { applyOperations } from "../domain/operations.js";
import {
  checkDesignSystem,
  designSystemOperations,
} from "../domain/design-system.js";
import { SystemSpecimen } from "./SystemSpecimen.js";
import {
  SystemButton as Button,
  SystemMessage,
} from "./DesignSystemPrimitives.js";
import type { SystemReference } from "./design-system-api.js";

export const bindingTokenTypes: Record<TokenBindingKey, string> = {
  color: "color",
  background: "color",
  borderColor: "color",
  fontFamily: "fontFamily",
  fontSize: "dimension",
  fontWeight: "fontWeight",
  lineHeight: "number",
  letterSpacing: "dimension",
  borderWidth: "dimension",
  borderRadius: "dimension",
  opacity: "number",
  padding: "dimension",
  gap: "dimension",
};
export function systemElements(document: Document) {
  const result: { element: Element; pageId: string }[] = [];
  const visit = (elements: Element[], pageId: string) => {
    for (const element of elements) {
      result.push({ element, pageId });
      if (element.children) visit(element.children, pageId);
    }
  };
  for (const page of document.pages) visit(page.elements, page.id);
  return result;
}
export function SystemApplyPreview({
  document,
  system,
  reference,
  selectedIds,
  onClose,
  onApply,
}: {
  document: Document;
  system: DesignSystem;
  reference: SystemReference;
  selectedIds: string[];
  onClose: () => void;
  onApply: (mapping: DesignSystemMapping) => Promise<void>;
}) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = window.document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => previous?.focus();
  }, []);
  const [mapping, setMapping] = useState<DesignSystemMapping>({
    elements: {},
    pages: {},
  });
  const [elementId, setElementId] = useState(
    selectedIds[0] ?? systemElements(document)[0]?.element.id ?? "",
  );
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const elements = systemElements(document),
    selected = elements.find(
      ({ element }) => element.id === elementId,
    )?.element;
  const preview = useMemo(() => {
    try {
      const result = applyOperations(
        document,
        designSystemOperations(document, system, mapping),
      ).document;
      return { document: result, diagnostics: checkDesignSystem(result) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }, [document, system, mapping]);
  const tokenOptions = (type: string) =>
    Object.entries(system.tokens)
      .filter(([, token]) => token.type === type)
      .map(([path]) => (
        <option key={path} value={path}>
          {path}
        </option>
      ));
  return (
    <div className="ds-apply-overlay">
      <section
        className="ds-apply-dialog"
        ref={panel}
        role="region"
        aria-label="Preview design system application"
      >
        <header>
          <div>
            <span className="eyebrow">EXPLICIT MAPPING</span>
            <h2>
              Apply {system.name} <small>v{reference.version}</small>
            </h2>
            <p>
              Preview against “{document.name}” · revision {document.revision}
            </p>
          </div>
          <Button onClick={onClose} aria-label="Close application preview">
            ×
          </Button>
        </header>
        <div className="ds-apply-body">
          <div className="ds-mapping">
            <SystemMessage>
              Literal styles are preserved. Choose the properties to bind below;
              matching color values alone never create bindings.
            </SystemMessage>
            <div className="ds-section-heading">PAGE BACKGROUNDS</div>
            {document.pages.map((page) => (
              <label className="field" key={page.id}>
                <span>{page.name}</span>
                <select
                  aria-label={`Background token for ${page.name}`}
                  value={mapping.pages?.[page.id] ?? ""}
                  onChange={(event) => {
                    const path = event.target.value;
                    setMapping((old) => {
                      const pages = { ...old.pages };
                      if (path) pages[page.id] = path;
                      else delete pages[page.id];
                      return { ...old, pages };
                    });
                  }}
                >
                  <option value="">Keep current background</option>
                  {tokenOptions("color")}
                </select>
              </label>
            ))}
            <div className="ds-section-heading">ELEMENT PROPERTIES</div>
            <label className="field">
              <span>Element to map</span>
              <select
                aria-label="Element to map"
                value={elementId}
                onChange={(event) => setElementId(event.target.value)}
              >
                {elements.map(({ element }) => (
                  <option key={element.id} value={element.id}>
                    {element.name} · {element.type}
                  </option>
                ))}
              </select>
            </label>
            {selected && (
              <div className="ds-role-grid">
                {(
                  [
                    "color",
                    "background",
                    "fontFamily",
                    "fontSize",
                    "borderColor",
                    "borderRadius",
                  ] as const
                )
                  .filter(
                    (key) =>
                      !["fontFamily", "fontSize", "color"].includes(key) ||
                      ["text", "table"].includes(selected.type),
                  )
                  .map((property) => (
                    <label className="field" key={property}>
                      <span>{property}</span>
                      <select
                        aria-label={`Map ${property} for ${selected.name}`}
                        value={
                          mapping.elements?.[selected.id]?.[property] ?? ""
                        }
                        onChange={(event) => {
                          const path = event.target.value,
                            id = selected.id;
                          setMapping((old) => {
                            const binding = { ...old.elements?.[id] };
                            if (path) binding[property] = path;
                            else delete binding[property];
                            return {
                              ...old,
                              elements: { ...old.elements, [id]: binding },
                            };
                          });
                        }}
                      >
                        <option value="">Keep current value / binding</option>
                        {tokenOptions(bindingTokenTypes[property])}
                      </select>
                    </label>
                  ))}
              </div>
            )}
            <p className="ds-help">
              Existing token bindings keep their paths. If this version is
              missing one, map that property to a valid token before applying.
            </p>
            {preview.error && (
              <SystemMessage error>{preview.error}</SystemMessage>
            )}
            {preview.diagnostics && (
              <div className="ds-check-results">
                <strong>
                  System checks · {preview.diagnostics.length} notes
                </strong>
                {preview.diagnostics.slice(0, 15).map((diagnostic, i) => (
                  <p key={i}>
                    {diagnostic.severity === "error" ? "!" : "·"}{" "}
                    {diagnostic.message}
                  </p>
                ))}
              </div>
            )}
            {error && <SystemMessage error>{error}</SystemMessage>}
          </div>
          <aside>
            {preview.document && <SystemSpecimen document={preview.document} />}
          </aside>
        </div>
        <footer>
          <Button onClick={onClose}>Cancel</Button>
          <Button
            primary
            disabled={busy || !preview.document}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await onApply(mapping);
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Apply this mapping
          </Button>
        </footer>
      </section>
    </div>
  );
}
