import React, { useEffect, useState } from "react";
import type {
  Asset,
  Document,
  Element,
  TokenBindingKey,
  TokenBindingPatch,
} from "../domain/model.js";
import { checkDesignSystem, resolveToken } from "../domain/design-system.js";
import {
  SystemButton as Button,
  SystemMessage,
} from "./DesignSystemPrimitives.js";
import { bindingTokenTypes, systemElements } from "./SystemApplyPreview.js";

export function TokenBindingControls({
  document,
  element,
  pageId,
  onBind,
  onPageBind,
}: {
  document: Document;
  element?: Element;
  pageId?: string;
  onBind: (id: string, binding: TokenBindingPatch) => void;
  onPageBind: (id: string, path: string | null) => void;
}) {
  const system = document.designSystem;
  if (!system) return null;
  const keys: TokenBindingKey[] = element
    ? element.type === "text" || element.type === "table"
      ? [
          "color",
          "fontFamily",
          "fontSize",
          "fontWeight",
          "lineHeight",
          "letterSpacing",
          "background",
          "borderColor",
          "borderWidth",
          "borderRadius",
          "opacity",
          "padding",
        ]
      : [
          "background",
          "borderColor",
          "borderWidth",
          "borderRadius",
          "opacity",
          "padding",
          ...(element.type === "group" ? ["gap" as const] : []),
        ]
    : [];
  const options = (type: string) =>
    Object.entries(system.tokens)
      .filter(([, token]) => token.type === type)
      .map(([path]) => (
        <option key={path} value={path}>
          {path}
        </option>
      ));
  const page = document.pages.find((page) => page.id === pageId);
  return (
    <section className="inspector-section ds-bindings">
      <div className="section-label">
        TOKEN BINDINGS <span>v{system.version}</span>
      </div>
      <p className="help">
        Bind a property to a system token. Direct style edits become literal
        overrides; detaching a token keeps its rendered value.
      </p>
      {element ? (
        <details open>
          <summary>
            {element.name} · {Object.keys(element.tokenBindings ?? {}).length}{" "}
            bindings
          </summary>
          {keys.map((property) => (
            <label className="field" key={property}>
              <span>{property}</span>
              <select
                aria-label={`${property} token`}
                value={element.tokenBindings?.[property] ?? ""}
                onChange={(event) =>
                  onBind(element.id, { [property]: event.target.value || null })
                }
              >
                <option value="">Literal override</option>
                {options(bindingTokenTypes[property])}
              </select>
              {element.tokenBindings?.[property] && (
                <small className="ds-caption">
                  {String(
                    resolveToken(system, element.tokenBindings[property]!),
                  )}
                </small>
              )}
            </label>
          ))}
        </details>
      ) : (
        page && (
          <label className="field">
            <span>Page background</span>
            <select
              aria-label="Page background token"
              value={page.backgroundToken ?? ""}
              onChange={(event) =>
                onPageBind(page.id, event.target.value || null)
              }
            >
              <option value="">Literal override</option>
              {options("color")}
            </select>
          </label>
        )
      )}
    </section>
  );
}

export function DocumentSystemControls({
  document,
  pageId,
  onLibrary,
  onInsert,
  onInsertImage,
  onUpload,
  onSelect,
}: {
  document: Document;
  pageId?: string;
  onLibrary: () => void;
  onInsert: (
    componentId: string,
    variant: string | undefined,
    slots: Record<string, string>,
    pageId: string,
  ) => Promise<void>;
  onInsertImage: (assetId: string, pageId: string) => Promise<void>;
  onUpload: (file: File) => Promise<Asset | undefined>;
  onSelect: (id: string, pageId: string) => void;
}) {
  const system = document.designSystem;
  const [imageId, setImageId] = useState("");
  const [componentId, setComponentId] = useState("");
  const [variant, setVariant] = useState("");
  const [slots, setSlots] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [showChecks, setShowChecks] = useState(false);
  useEffect(() => {
    setComponentId("");
    setImageId("");
    setVariant("");
    setSlots({});
    setShowChecks(false);
  }, [document.id, system?.id, system?.version]);
  const component = system?.components.find(
    (component) => component.id === componentId,
  );
  const images = Object.values(document.assets).filter((asset) =>
    asset.mime.startsWith("image/"),
  );
  const diagnostics = showChecks ? checkDesignSystem(document) : [];
  return (
    <>
      <section className="inspector-section ds-document-system">
        <div className="section-label">DESIGN SYSTEM</div>
        {system ? (
          <>
            <h3>{system.name}</h3>
            <span className="ds-badge">v{system.version} · PINNED VERSION</span>
            <p className="help">
              This design includes its own immutable system snapshot, fonts and
              assets.
            </p>
          </>
        ) : (
          <>
            <h3>A shared design language.</h3>
            <p className="help">
              Bring a system into this design to use tokens, custom fonts and
              reusable components.
            </p>
          </>
        )}
        <Button className="full" onClick={onLibrary}>
          Open Design Systems
        </Button>
        {system && (
          <Button
            className="full"
            onClick={() => setShowChecks((value) => !value)}
          >
            {showChecks ? "Hide system checks" : "Run system checks"}
          </Button>
        )}
        {showChecks && (
          <div
            className="ds-check-results"
            aria-label="System check results"
            role="status"
          >
            {diagnostics.length ? (
              <>
                <strong>
                  {diagnostics.length}{" "}
                  {diagnostics.length === 1 ? "finding" : "findings"}
                </strong>
                {diagnostics.map((diagnostic, index) => (
                  <div key={index} className={diagnostic.severity}>
                    <span>{diagnostic.message}</span>
                    {diagnostic.elementId && (
                      <button
                        onClick={() => {
                          const found = systemElements(document).find(
                            ({ element }) =>
                              element.id === diagnostic.elementId,
                          );
                          if (found) onSelect(found.element.id, found.pageId);
                        }}
                      >
                        Select element
                      </button>
                    )}
                  </div>
                ))}
              </>
            ) : (
              <strong>No system issues found.</strong>
            )}
          </div>
        )}
      </section>
      {system && images.length > 0 && (
        <section className="inspector-section">
          <div className="section-label">SYSTEM IMAGES & LOGOS</div>
          <label className="field">
            <span>Image asset</span>
            <select
              aria-label="System image asset"
              value={imageId}
              onChange={(event) => setImageId(event.target.value)}
            >
              <option value="">Choose an image…</option>
              {images.map((asset) => (
                <option key={asset.id} value={asset.id}>
                  {asset.name}
                </option>
              ))}
            </select>
          </label>
          <Button
            className="full"
            disabled={!imageId || !pageId || busy}
            onClick={async () => {
              if (!pageId) return;
              setBusy(true);
              setError("");
              try {
                await onInsertImage(imageId, pageId);
              } catch (error) {
                setError(
                  error instanceof Error ? error.message : String(error),
                );
              } finally {
                setBusy(false);
              }
            }}
          >
            Insert system image
          </Button>
          {error && <SystemMessage error>{error}</SystemMessage>}
        </section>
      )}
      {system && (
        <section className="inspector-section ds-component-insertion">
          <div className="section-label">
            SYSTEM COMPONENTS <span>{system.components.length}</span>
          </div>
          {system.components.length ? (
            <>
              <label className="field">
                <span>Component</span>
                <select
                  aria-label="Design system component"
                  value={componentId}
                  onChange={(event) => {
                    setComponentId(event.target.value);
                    setVariant("");
                    setSlots({});
                    setError("");
                  }}
                >
                  <option value="">Choose a component…</option>
                  {system.components.map((component) => (
                    <option key={component.id} value={component.id}>
                      {component.name}
                    </option>
                  ))}
                </select>
              </label>
              {component && (
                <>
                  <p className="help">
                    {component.description ||
                      "Insert an editable copy. Its source version stays attached as provenance."}
                  </p>
                  <label className="field">
                    <span>Variant</span>
                    <select
                      aria-label="Component variant"
                      value={variant}
                      onChange={(event) => setVariant(event.target.value)}
                    >
                      <option value="">Default</option>
                      {Object.keys(component.variants).map((variant) => (
                        <option key={variant}>{variant}</option>
                      ))}
                    </select>
                  </label>
                  {Object.entries(component.slots).map(([id, slot]) =>
                    slot.type === "text" ? (
                      <label key={id} className="field">
                        <span>{id}</span>
                        <textarea
                          rows={2}
                          aria-label={`Text slot ${id}`}
                          placeholder="Keep the component’s default wording"
                          value={slots[id] ?? ""}
                          onChange={(event) => {
                            const text = event.target.value;
                            setSlots((old) => ({ ...old, [id]: text }));
                          }}
                        />
                      </label>
                    ) : (
                      <div key={id}>
                        <label className="field">
                          <span>{id}</span>
                          <select
                            aria-label={`Image slot ${id}`}
                            value={slots[id] ?? ""}
                            onChange={(event) => {
                              const value = event.target.value;
                              setSlots((old) => {
                                const next = { ...old };
                                if (value) next[id] = value;
                                else delete next[id];
                                return next;
                              });
                            }}
                          >
                            <option value="">Keep component image</option>
                            {images.map((asset) => (
                              <option key={asset.id} value={asset.id}>
                                {asset.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="ds-slot-upload">
                          Upload image for {id}
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp,image/svg+xml"
                            aria-label={`Upload image slot ${id}`}
                            disabled={busy}
                            onChange={async (event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (!file) return;
                              setBusy(true);
                              try {
                                const asset = await onUpload(file);
                                if (asset)
                                  setSlots((old) => ({
                                    ...old,
                                    [id]: asset.id,
                                  }));
                              } catch (error) {
                                setError(
                                  error instanceof Error
                                    ? error.message
                                    : String(error),
                                );
                              } finally {
                                setBusy(false);
                              }
                            }}
                          />
                        </label>
                      </div>
                    ),
                  )}
                  <Button
                    primary
                    className="full"
                    disabled={busy || !pageId}
                    onClick={async () => {
                      if (!pageId) return;
                      setBusy(true);
                      setError("");
                      try {
                        await onInsert(
                          component.id,
                          variant || undefined,
                          { ...slots },
                          pageId,
                        );
                      } catch (error) {
                        setError(
                          error instanceof Error
                            ? error.message
                            : String(error),
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Insert component
                  </Button>
                </>
              )}
              {error && <SystemMessage error>{error}</SystemMessage>}
            </>
          ) : (
            <p className="help">
              This version has no components. Add declarative component
              definitions in a new system version.
            </p>
          )}
        </section>
      )}
    </>
  );
}
