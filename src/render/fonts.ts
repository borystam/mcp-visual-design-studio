import type { Asset, DesignSystem } from "../domain/model.js";

const formatByMime: Record<string, string> = {
  "font/woff2": "woff2",
  "font/woff": "woff",
  "font/ttf": "truetype",
  "font/otf": "opentype",
};
/** CSS strings are quoted and escaped even though model family names are validated. */
export function cssString(value: string): string {
  return (
    '"' +
    value.replace(
      /["\\\x00-\x1f\x7f<>]/g,
      (character) => `\\${character.charCodeAt(0).toString(16)} `,
    ) +
    '"'
  );
}
/** Face identities scope custom names across side-by-side saved variations. */
export function scopedFontFamily(
  family: string,
  system?: DesignSystem,
): string {
  const faces = system?.fonts.filter((face) => face.family === family);
  if (!faces?.length) return family;
  return `VDS_${family}_${faces
    .map(
      (face) =>
        `${face.assetId}_${face.weight}_${face.style}_${face.unicodeRange?.replace(/[^0-9A-F-]+/g, "_") ?? "all"}`,
    )
    .sort()
    .join("_")}`;
}
export function fontFamilyCss(
  value: string | undefined,
  system?: DesignSystem,
): string {
  const family = value ?? "Inter";
  if (system?.fonts.some((face) => face.family === family))
    return `${cssString(scopedFontFamily(family, system))}, sans-serif`;
  if (family === "Lora" || family === "serif") return "Lora, Georgia, serif";
  if (family === "monospace" || family === "IBM Plex Mono")
    return '"IBM Plex Mono", monospace';
  return "Inter, Arial, sans-serif";
}
export function customFontCss(
  system: DesignSystem | undefined,
  assets: Record<string, Asset> | undefined,
  assetUrl: ((id: string) => string) | undefined,
): string {
  if (!system?.fonts.length || !assetUrl) return "";
  return system.fonts
    .map((face) => {
      const asset = assets?.[face.assetId];
      const format = asset && formatByMime[asset.mime];
      if (!format)
        throw new Error(`Missing local font asset for ${face.family}`);
      const url = assetUrl(face.assetId);
      if (
        !/^\/api\/assets\/asset_[a-f0-9]{64}$/.test(url) &&
        !/^data:font\/(?:woff2?|ttf|otf);base64,[A-Za-z0-9+/]+={0,2}$/.test(url)
      )
        throw new Error(
          "Font source must be a local immutable asset or embedded font data",
        );
      return `@font-face{font-family:${cssString(scopedFontFamily(face.family, system))};font-weight:${face.weight};font-style:${face.style};font-display:block;src:url(${cssString(url)}) format(${cssString(format)});${face.unicodeRange ? `unicode-range:${face.unicodeRange};` : ""}}`;
    })
    .join("\n");
}
