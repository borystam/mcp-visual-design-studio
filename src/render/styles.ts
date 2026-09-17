/** Browser-safe shared stylesheet. Export replaces local font URLs with embedded data. */
export const fontFiles = [
  ["Inter", 400, "normal", "inter-latin-400-normal.woff2"],
  ["Inter", 400, "normal", "inter-latin-ext-400-normal.woff2"],
  ["Inter", 400, "italic", "inter-latin-400-italic.woff2"],
  ["Inter", 400, "italic", "inter-latin-ext-400-italic.woff2"],
  ["Inter", 500, "normal", "inter-latin-500-normal.woff2"],
  ["Inter", 500, "normal", "inter-latin-ext-500-normal.woff2"],
  ["Inter", 500, "italic", "inter-latin-500-italic.woff2"],
  ["Inter", 500, "italic", "inter-latin-ext-500-italic.woff2"],
  ["Inter", 600, "normal", "inter-latin-600-normal.woff2"],
  ["Inter", 600, "normal", "inter-latin-ext-600-normal.woff2"],
  ["Inter", 600, "italic", "inter-latin-600-italic.woff2"],
  ["Inter", 600, "italic", "inter-latin-ext-600-italic.woff2"],
  ["Inter", 700, "normal", "inter-latin-700-normal.woff2"],
  ["Inter", 700, "normal", "inter-latin-ext-700-normal.woff2"],
  ["Inter", 700, "italic", "inter-latin-700-italic.woff2"],
  ["Inter", 700, "italic", "inter-latin-ext-700-italic.woff2"],
  ["Lora", 400, "normal", "lora-latin-400-normal.woff2"],
  ["Lora", 400, "normal", "lora-latin-ext-400-normal.woff2"],
  ["Lora", 400, "italic", "lora-latin-400-italic.woff2"],
  ["Lora", 400, "italic", "lora-latin-ext-400-italic.woff2"],
  ["Lora", 500, "normal", "lora-latin-500-normal.woff2"],
  ["Lora", 500, "normal", "lora-latin-ext-500-normal.woff2"],
  ["Lora", 500, "italic", "lora-latin-500-italic.woff2"],
  ["Lora", 500, "italic", "lora-latin-ext-500-italic.woff2"],
  ["Lora", 600, "normal", "lora-latin-600-normal.woff2"],
  ["Lora", 600, "normal", "lora-latin-ext-600-normal.woff2"],
  ["Lora", 600, "italic", "lora-latin-600-italic.woff2"],
  ["Lora", 600, "italic", "lora-latin-ext-600-italic.woff2"],
  ["Lora", 700, "normal", "lora-latin-700-normal.woff2"],
  ["Lora", 700, "normal", "lora-latin-ext-700-normal.woff2"],
  ["Lora", 700, "italic", "lora-latin-700-italic.woff2"],
  ["Lora", 700, "italic", "lora-latin-ext-700-italic.woff2"],
  ["IBM Plex Mono", 400, "normal", "ibm-plex-mono-latin-400-normal.woff2"],
  ["IBM Plex Mono", 400, "normal", "ibm-plex-mono-latin-ext-400-normal.woff2"],
  ["IBM Plex Mono", 400, "italic", "ibm-plex-mono-latin-400-italic.woff2"],
  ["IBM Plex Mono", 400, "italic", "ibm-plex-mono-latin-ext-400-italic.woff2"],
  ["IBM Plex Mono", 500, "normal", "ibm-plex-mono-latin-500-normal.woff2"],
  ["IBM Plex Mono", 500, "normal", "ibm-plex-mono-latin-ext-500-normal.woff2"],
  ["IBM Plex Mono", 500, "italic", "ibm-plex-mono-latin-500-italic.woff2"],
  ["IBM Plex Mono", 500, "italic", "ibm-plex-mono-latin-ext-500-italic.woff2"],
  ["IBM Plex Mono", 600, "normal", "ibm-plex-mono-latin-600-normal.woff2"],
  ["IBM Plex Mono", 600, "normal", "ibm-plex-mono-latin-ext-600-normal.woff2"],
  ["IBM Plex Mono", 600, "italic", "ibm-plex-mono-latin-600-italic.woff2"],
  ["IBM Plex Mono", 600, "italic", "ibm-plex-mono-latin-ext-600-italic.woff2"],
  ["IBM Plex Mono", 700, "normal", "ibm-plex-mono-latin-700-normal.woff2"],
  ["IBM Plex Mono", 700, "normal", "ibm-plex-mono-latin-ext-700-normal.woff2"],
  ["IBM Plex Mono", 700, "italic", "ibm-plex-mono-latin-700-italic.woff2"],
  ["IBM Plex Mono", 700, "italic", "ibm-plex-mono-latin-ext-700-italic.woff2"],
] as const;
export const documentCss = `${fontFiles.map(([family, weight, style, file]) => `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:block;${file.includes("latin-ext") ? "unicode-range:U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF;" : ""}src:url('/assets/fonts/${file}') format('woff2');}`).join("\n")}
.vds-document,.vds-document *,.vds-page,.vds-page *{box-sizing:border-box}
.vds-document{width:max-content;display:flex;flex-direction:column;align-items:center;gap:24px;font-family:Inter,Arial,sans-serif}
.vds-page{position:relative;flex-shrink:0;overflow:hidden;color:#1d2f2b;font-family:Inter,Arial,sans-serif;isolation:isolate;print-color-adjust:exact;-webkit-print-color-adjust:exact}
.vds-element{box-sizing:border-box;min-width:0;min-height:0;font-size:16px;line-height:1.5}
.vds-text{white-space:pre-wrap;overflow-wrap:break-word}
.vds-text p{margin:0}.vds-text ul,.vds-text ol{margin:0;padding-left:1.5em}
.vds-element a{color:inherit;text-decoration:underline;text-underline-offset:3px}
.vds-image img{display:block;width:100%;height:100%;border-radius:inherit}
.vds-image-placeholder{height:100%;display:flex;align-items:center;justify-content:center;background:#f0eee9;color:#6e7770;font-size:13px;border:1px dashed #a0aaa5}
.vds-table{width:100%;border-collapse:collapse;table-layout:fixed;font-size:inherit;line-height:inherit}
.vds-table td,.vds-table th{padding:10px 12px;text-align:inherit;overflow-wrap:anywhere;border-bottom:1px solid currentColor;font-weight:inherit}
.vds-table th{font-weight:600;background:rgba(0,0,0,.035)}
.vds-element[data-selected='true']{outline:2px solid #3767ec;outline-offset:2px}
.vds-element[data-selectable='true']{cursor:pointer}
@media print{html,body{margin:0!important;padding:0!important;background:white!important}.vds-document{display:block}.vds-page{break-after:page;margin:0;box-shadow:none!important}.vds-page:last-child{break-after:auto}.vds-element[data-selected='true']{outline:none}}
`;
