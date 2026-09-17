import React, { type CSSProperties } from "react";
import type { Document, Page, Element, BrandKit } from "../domain/model.js";

type SelectHandler = (id: string, event: React.MouseEvent<HTMLElement>) => void;
type RenderOptions = {
  assetUrl?: (id: string) => string;
  onSelect?: SelectHandler;
  selectedIds?: string[];
};
const family = (value: string | undefined) =>
  value === "serif" || value === "Lora"
    ? "Lora, Georgia, serif"
    : value === "mono" || value === "monospace"
      ? "IBM Plex Mono, monospace"
      : "Inter, Arial, sans-serif";
function ElementView({
  element: e,
  brand,
  assetUrl,
  onSelect,
  selectedIds,
  flow = false,
}: RenderOptions & { element: Element; brand: BrandKit; flow?: boolean }) {
  const s = e.style;
  const style: CSSProperties = {
    position: flow ? "relative" : "absolute",
    left: flow ? undefined : e.x,
    top: flow ? undefined : e.y,
    width: e.width,
    height: e.height,
    color: s.color,
    background: s.background,
    fontFamily: family(s.fontFamily ?? brand.fonts.body),
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    fontStyle: s.fontStyle,
    textDecoration: s.textDecoration,
    lineHeight: s.lineHeight,
    letterSpacing: s.letterSpacing,
    textAlign: s.textAlign,
    borderColor: s.borderColor,
    borderWidth: s.borderWidth,
    borderStyle: s.borderWidth ? "solid" : undefined,
    borderRadius: s.borderRadius,
    opacity: s.opacity,
    padding: s.padding,
    flexShrink: 0,
  };
  const structured =
    e.type === "group" && (e.layout === "stack" || e.layout === "grid");
  if (e.type === "group")
    Object.assign(style, {
      display:
        e.layout === "grid"
          ? "grid"
          : e.layout === "stack"
            ? "flex"
            : undefined,
      flexDirection: e.layout === "stack" ? "column" : undefined,
      gap: e.gap ?? 0,
      gridTemplateColumns:
        e.layout === "grid"
          ? `repeat(${e.columns ?? 2},minmax(0,1fr))`
          : undefined,
      alignContent: "start",
    });
  const renderRuns = (runs: NonNullable<Element["runs"]>) =>
    runs.map((run, i) => {
      const v = (
        <span
          style={{
            fontWeight: run.bold ? 700 : undefined,
            fontStyle: run.italic ? "italic" : undefined,
            textDecoration: run.underline ? "underline" : undefined,
          }}
        >
          {run.text}
        </span>
      );
      return run.href ? (
        <a key={i} href={run.href} rel="noopener noreferrer">
          {v}
        </a>
      ) : (
        <React.Fragment key={i}>{v}</React.Fragment>
      );
    });
  const text = e.runs?.length ? renderRuns(e.runs) : (e.text ?? "");
  const listLines: NonNullable<Element["runs"]>[] = [[]];
  for (const run of e.runs?.length ? e.runs : [{ text: e.text ?? "" }]) {
    run.text.split("\n").forEach((value, index) => {
      if (index) listLines.push([]);
      listLines[listLines.length - 1].push({ ...run, text: value });
    });
  }
  let content: React.ReactNode;
  if (e.type === "text") {
    content =
      e.list && e.list !== "none"
        ? React.createElement(
            e.list === "number" ? "ol" : "ul",
            {},
            listLines.map((runs, i) => <li key={i}>{renderRuns(runs)}</li>),
          )
        : text;
    if (e.href)
      content = (
        <a href={e.href} rel="noopener noreferrer">
          {content}
        </a>
      );
  } else if (e.type === "image")
    content =
      e.assetId && assetUrl ? (
        <img
          src={assetUrl(e.assetId)}
          alt={e.name}
          draggable={false}
          style={{
            objectFit: e.fit ?? "cover",
            objectPosition: `${e.crop?.x ?? 50}% ${e.crop?.y ?? 50}%`,
          }}
        />
      ) : (
        <div className="vds-image-placeholder">{e.name || "Image"}</div>
      );
  else if (e.type === "table")
    content = (
      <table className="vds-table">
        <thead>
          <tr>
            {e.cells?.[0]?.map((v, i) => (
              <th key={i} scope="col">
                {v}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {e.cells?.slice(1).map((row, i) => (
            <tr key={i}>
              {row.map((v, j) => (
                <td key={j}>{v}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    );
  else if (e.type === "group")
    content = e.children?.map((child) => (
      <ElementView
        key={child.id}
        element={child}
        brand={brand}
        assetUrl={assetUrl}
        onSelect={onSelect}
        selectedIds={selectedIds}
        flow={structured}
      />
    ));
  if (e.href && e.type !== "text")
    content = (
      <>
        <a
          href={e.href}
          aria-label={e.name}
          rel="noopener noreferrer"
          style={{ position: "absolute", inset: 0, zIndex: 1 }}
        />
        {content}
      </>
    );
  return (
    <div
      className={`vds-element vds-${e.type}`}
      style={style}
      data-element-id={e.id}
      data-element-type={e.type}
      data-selectable={onSelect ? "true" : undefined}
      data-selected={selectedIds?.includes(e.id) ? "true" : undefined}
      onClick={
        onSelect
          ? (event) => {
              event.preventDefault();
              event.stopPropagation();
              onSelect(e.id, event);
            }
          : undefined
      }
    >
      {content}
    </div>
  );
}
export function PageView({
  page,
  brand,
  ...options
}: RenderOptions & { page: Page; brand: BrandKit }) {
  return (
    <section
      className="vds-page"
      data-page-id={page.id}
      aria-label={page.name}
      style={{
        width: page.width,
        height: page.height,
        background: page.background,
      }}
    >
      {page.elements.map((element) => (
        <ElementView
          key={element.id}
          element={element}
          brand={brand}
          {...options}
        />
      ))}
    </section>
  );
}
export function DocumentView({
  document,
  ...options
}: RenderOptions & { document: Document }) {
  return (
    <div
      className="vds-document"
      data-document-id={document.id}
      data-revision={document.revision}
    >
      {document.pages.map((page) => (
        <PageView
          key={page.id}
          page={page}
          brand={document.brand}
          {...options}
        />
      ))}
    </div>
  );
}
