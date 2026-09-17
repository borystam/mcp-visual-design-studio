import type { Asset, DesignSystem, Document } from "../domain/model.js";

export type SystemReference = { id: string; version: string; digest: string };
export type SystemSummary = SystemReference & {
  name: string;
  tokenCount: number;
  componentCount: number;
  fontCount: number;
};
export type SystemLibrary = {
  systems: SystemSummary[];
  defaultSystem: SystemReference | null;
};
export type SystemPreview = {
  system: DesignSystem;
  digest: string;
  warnings: string[];
  validationErrors?: string[];
  report: unknown;
  specimen: Document;
};
export async function systemRequest<T>(
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const value = await response.json();
  if (!response.ok)
    throw new Error(
      value.error?.message ??
        value.message ??
        value.error ??
        `Request failed (${response.status})`,
    );
  return value;
}
export async function systemFile(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32768)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return { name: file.name, data: btoa(binary) };
}
export async function uploadSystemAsset(file: File) {
  return systemRequest<Asset>(
    "/api/design-systems/assets",
    await systemFile(file),
  );
}
export const systemReference = (
  system: DesignSystem,
  digest: string,
): SystemReference => ({ id: system.id, version: system.version, digest });
export const systemKey = (system: { id: string; version: string }) =>
  `${system.id}@${system.version}`;
