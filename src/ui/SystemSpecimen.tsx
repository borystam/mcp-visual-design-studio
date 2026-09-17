import React, { useState } from "react";
import type { Document } from "../domain/model.js";
import { PageView } from "../render/DocumentView.js";

export function SystemSpecimen({ document }: { document: Document }) {
  const [index, setIndex] = useState(0);
  const page = document.pages[Math.min(index, document.pages.length - 1)];
  if (!page) return null;
  const scale = Math.min(1, 292 / page.width);
  return (
    <div className="ds-specimen">
      <div className="ds-section-heading">
        <span>LIVE SPECIMEN</span>
        <span>
          {Math.min(index + 1, document.pages.length)} / {document.pages.length}
        </span>
      </div>
      {document.pages.length > 1 && (
        <select
          aria-label="Specimen page"
          value={Math.min(index, document.pages.length - 1)}
          onChange={(e) => setIndex(Number(e.target.value))}
        >
          {document.pages.map((page, i) => (
            <option key={page.id} value={i}>
              {page.name}
            </option>
          ))}
        </select>
      )}
      <div
        className="ds-specimen-paper"
        style={{ width: page.width * scale, height: page.height * scale }}
      >
        <div
          style={{
            width: page.width,
            height: page.height,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <PageView
            page={page}
            brand={document.brand}
            designSystem={document.designSystem}
            assets={document.assets}
            assetUrl={(id) => `/api/assets/${encodeURIComponent(id)}`}
          />
        </div>
      </div>
      <p className="ds-caption">
        The same renderer powers the editor and exported documents.
      </p>
    </div>
  );
}
