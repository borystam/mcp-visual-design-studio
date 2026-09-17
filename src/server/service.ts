import fs from "node:fs";
import path from "node:path";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { WorkspaceStore, migrateDocument } from "../domain/store.js";
import {
  BrandKitSchema,
  assertSafeData,
  findElement,
  type BrandKit,
  type Asset,
  type Document,
  type MutationResult,
} from "../domain/model.js";
import { parseBatch } from "../domain/operations.js";
import { brandOperations } from "../domain/brand.js";
import { createDocument, templates } from "../domain/templates.js";
import {
  exportDocument,
  importAsset,
  importBundle,
  renderHtml,
  readVerifiedAsset,
} from "../export/index.js";
import {
  VERSION,
  PACKAGE_ROOT,
  atomicJson,
  claimWorkspace,
  makeDescriptor,
  workspacePath,
  serviceUrl,
  type Descriptor,
} from "./runtime.js";

const id = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const nonempty = z.string().trim().min(1).max(200);
const revision = z.number().int().nonnegative();
function fail(
  status: number,
  message: string,
  code = "INVALID_REQUEST",
): never {
  throw Object.assign(new Error(message), { status, code });
}
function json(res: ServerResponse, data: unknown, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}
function equal(a: string, b: string) {
  const x = Buffer.from(a),
    y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
async function body(
  req: IncomingMessage,
  max = 3 * 1024 * 1024,
): Promise<unknown> {
  if (!(req.headers["content-type"] || "").startsWith("application/json"))
    fail(415, "Send application/json.");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const part of req) {
    size += part.length;
    if (size > max) fail(413, "Request is too large.");
    chunks.push(part);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    fail(400, "Invalid JSON body.");
  }
}
function base64(value: string, max: number) {
  if (
    value.length > Math.ceil(max / 3) * 4 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  )
    fail(400, "Invalid or oversized base64 data.");
  return Buffer.from(value, "base64");
}
function safeFile(dir: string, name: string) {
  if (!/^[\w.-]+$/.test(name) || name.includes(".."))
    fail(400, "Invalid file name.");
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) fail(404, "File not found.");
  if (
    fs.lstatSync(p).isSymbolicLink() ||
    path.dirname(fs.realpathSync(p)) !== fs.realpathSync(dir)
  )
    fail(400, "Symbolic links are not allowed.");
  return p;
}
const mimeTypes: Record<string, string> = {
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".woff2": "font/woff2",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".json": "application/json",
};

export async function startService(
  input?: string,
  options: { port?: number } = {},
): Promise<{ descriptor: Descriptor; close: () => Promise<void> }> {
  const root = workspacePath(input),
    release = await claimWorkspace(root);
  let store: WorkspaceStore;
  try {
    store = new WorkspaceStore(root);
  } catch (e) {
    release();
    throw e;
  }
  const assetsDir = path.join(root, "assets"),
    exportsDir = path.join(root, "exports");
  const events = new Set<ServerResponse>();
  const selections = new Map<
    string,
    { elementIds: string[]; pageId?: string }
  >();
  let activeExports = 0,
    closing = false;
  let descriptor: Descriptor;
  const broadcast = (documentId: string, rev: number) => {
    for (const res of events)
      res.write(
        `event: change\ndata: ${JSON.stringify({ documentId, revision: rev })}\n\n`,
      );
  };
  const mutation = (result: MutationResult) => {
    broadcast(result.documentId, result.revision);
    return result;
  };
  const readBrand = (
    name: string,
  ): { brand: BrandKit; assets: Record<string, Asset> } => {
    const data = JSON.parse(
      fs.readFileSync(safeFile(path.join(root, "brands"), name), "utf8"),
    );
    assertSafeData(data);
    return {
      brand: BrandKitSchema.parse(data.brand || data),
      assets: data.assets || {},
    };
  };
  const listBrands = () =>
    fs
      .readdirSync(path.join(root, "brands"))
      .filter((n) => n.endsWith(".json"))
      .map((n) => readBrand(n).brand);
  const verifyAssets = (doc: Document) => {
    for (const asset of Object.values(doc.assets))
      readVerifiedAsset(asset, assetsDir);
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; form-action 'none'",
    );
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    try {
      const origin = serviceUrl(descriptor);
      if (req.headers.host !== `127.0.0.1:${descriptor.port}`)
        fail(403, "Invalid local host.", "HOST_REJECTED");
      if (req.headers.origin && req.headers.origin !== origin)
        fail(403, "Cross-origin requests are not allowed.", "ORIGIN_REJECTED");
      if (req.headers["sec-fetch-site"] === "cross-site")
        fail(403, "Cross-site requests are not allowed.");
      const url = new URL(req.url || "/", origin),
        route = url.pathname,
        method = req.method || "GET";
      if (method === "POST" && route === "/api/session") {
        const v = z
          .object({ token: z.string().max(100) })
          .strict()
          .parse(await body(req));
        if (!equal(v.token, descriptor.token))
          fail(
            401,
            "Invalid editor link. Run the editor command for a fresh link.",
          );
        res.setHeader(
          "Set-Cookie",
          `studio_${descriptor.workspaceId}=${descriptor.token}; HttpOnly; SameSite=Strict; Path=/`,
        );
        return json(res, { ok: true });
      }
      if (route.startsWith("/api/")) {
        const bearer = req.headers.authorization?.replace(/^Bearer /, "");
        const cookieName = `studio_${descriptor.workspaceId}=`;
        const cookie = (req.headers.cookie || "")
          .split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith(cookieName))
          ?.slice(cookieName.length);
        if (!equal(bearer || cookie || "", descriptor.token))
          fail(
            401,
            "Open the editor link from your agent or run the editor command to authenticate.",
            "AUTH_REQUIRED",
          );
        if (closing) fail(503, "Workspace is stopping.");
        if (route === "/api/identity" && method === "GET")
          return json(res, {
            workspaceId: descriptor.workspaceId,
            instanceId: descriptor.instanceId,
            version: VERSION,
            runtimeVersion: descriptor.runtimeVersion,
            pid: descriptor.pid,
            activeExports,
          });
        if (route === "/api/workspace" && method === "GET")
          return json(res, {
            workspaceId: descriptor.workspaceId,
            version: VERSION,
            documents: store.list(),
            templates,
            brands: listBrands(),
            capabilities: {
              schemaVersion: 1,
              rendererVersion: 1,
              formats: ["pdf", "png", "html", "bundle"],
              transport: "stdio",
              liveUpdates: "SSE",
              commentsWakeAgent: false,
            },
          });
        if (route === "/api/stop" && method === "POST") {
          if (activeExports)
            fail(
              409,
              "An export is active. Wait for it to finish before stopping.",
              "BUSY",
            );
          json(res, { stopped: true });
          setImmediate(() => void close());
          return;
        }
        if (route === "/api/events" && method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-store",
            Connection: "keep-alive",
          });
          res.write(
            `event: ready\ndata: ${JSON.stringify({ workspaceId: descriptor.workspaceId, revisions: store.list().map((d) => ({ documentId: d.id, revision: d.revision })) })}\n\n`,
          );
          events.add(res);
          req.on("close", () => events.delete(res));
          return;
        }
        if (route === "/api/documents" && method === "POST") {
          const v = z
            .object({ name: nonempty, template: z.string().optional() })
            .strict()
            .parse(await body(req));
          const doc = store.create(createDocument(v.name, v.template));
          broadcast(doc.id, doc.revision);
          return json(res, doc, 201);
        }
        if (route === "/api/import" && method === "POST") {
          const v = z
            .object({ data: z.string() })
            .strict()
            .parse(await body(req, 140 * 1024 * 1024));
          const doc = store.create(
            await importBundle(base64(v.data, 100 * 1024 * 1024), assetsDir),
          );
          broadcast(doc.id, doc.revision);
          return json(res, doc, 201);
        }
        if (route === "/api/migrate" && method === "POST") {
          const v = z
            .object({ document: z.unknown() })
            .strict()
            .parse(await body(req, 22 * 1024 * 1024));
          const migrated = migrateDocument(v.document);
          verifyAssets(migrated);
          const now = new Date().toISOString();
          const doc = store.create({
            ...migrated,
            id: randomUUID(),
            revision: 0,
            createdAt: now,
            updatedAt: now,
          });
          broadcast(doc.id, doc.revision);
          return json(res, doc, 201);
        }
        if (route === "/api/brands") {
          if (method === "GET") return json(res, listBrands());
          if (method === "POST") {
            const data = await body(req);
            assertSafeData(data);
            const brand = BrandKitSchema.parse(data);
            const referenced = new Set<string>();
            if (brand.logoAssetId) referenced.add(brand.logoAssetId);
            const visit = (items: BrandKit["components"]) => {
              for (const el of items) {
                if (el.assetId) referenced.add(el.assetId);
                if (el.children) visit(el.children);
              }
            };
            visit(brand.components);
            const available = Object.assign(
              {},
              ...store.list().map((d) => d.assets),
            ) as Record<string, Asset>;
            const assets: Record<string, Asset> = {};
            for (const assetId of referenced) {
              const asset = available[assetId];
              if (!asset)
                fail(
                  400,
                  "Brand refers to an asset not imported into this workspace.",
                );
              readVerifiedAsset(asset, assetsDir);
              assets[assetId] = asset;
            }
            atomicJson(
              path.join(root, "brands", `${id.parse(brand.id)}.json`),
              { version: 1, brand, assets },
            );
            return json(res, brand);
          }
        }
        const assetMatch = route.match(/^\/api\/assets\/([\w-]+)$/);
        if (assetMatch && method === "GET") {
          const assetId = id.parse(assetMatch[1]);
          const asset = store
            .list()
            .map((d) => d.assets[assetId])
            .find(Boolean);
          if (!asset) fail(404, "Asset not found.");
          res.writeHead(200, {
            "Content-Type": asset.mime,
            "Cache-Control": "private, max-age=3600",
          });
          res.end(readVerifiedAsset(asset, assetsDir));
          return;
        }
        const download = route.match(/^\/api\/downloads\/([\w.-]+)$/);
        if (download && method === "GET") {
          const p = safeFile(exportsDir, download[1]);
          res.writeHead(200, {
            "Content-Type":
              mimeTypes[path.extname(p)] || "application/octet-stream",
            "Content-Disposition": `attachment; filename="${download[1]}"`,
            "Cache-Control": "no-store",
          });
          fs.createReadStream(p).pipe(res);
          return;
        }
        const match = route.match(/^\/api\/documents\/([\w-]+)(?:\/(\w+))?$/);
        if (match) {
          const docId = id.parse(match[1]),
            action = match[2];
          const requestedRevision = url.searchParams.has("revision")
            ? revision.parse(Number(url.searchParams.get("revision")))
            : undefined;
          if (!action && method === "GET")
            return json(res, store.get(docId, requestedRevision));
          if (action === "operations" && method === "POST") {
            const data = await body(req);
            const batch = parseBatch(data);
            for (const op of batch.operations)
              if (op.type === "register_asset")
                readVerifiedAsset(op.asset, assetsDir);
            return json(res, mutation(store.apply(docId, data as never)));
          }
          if (action === "brand" && method === "POST") {
            const v = z
              .object({
                brandId: id,
                operationId: id,
                actor: nonempty,
                expectedRevision: revision,
              })
              .strict()
              .parse(await body(req));
            const saved = readBrand(`${v.brandId}.json`);
            for (const asset of Object.values(saved.assets))
              readVerifiedAsset(asset, assetsDir);
            // Derive a deterministic batch from the requested base revision so
            // an exact retry has the same payload even after later edits.
            const base = store.get(docId, v.expectedRevision);
            return json(
              res,
              mutation(
                store.apply(docId, {
                  operationId: v.operationId,
                  actor: v.actor,
                  expectedRevision: v.expectedRevision,
                  operations: [
                    ...Object.values(saved.assets).map((asset) => ({
                      type: "register_asset" as const,
                      asset,
                    })),
                    ...brandOperations(base, saved.brand),
                  ],
                }),
              ),
            );
          }
          if (action === "history" && method === "GET")
            return json(res, store.history(docId));
          if (action === "undo" && method === "POST")
            return json(
              res,
              mutation(store.undo(docId, (await body(req)) as never)),
            );
          if (action === "snapshots") {
            if (method === "GET") return json(res, store.snapshots(docId));
            if (method === "POST") {
              const v = z
                .object({ name: nonempty })
                .strict()
                .parse(await body(req));
              return json(res, store.snapshot(docId, v.name));
            }
          }
          if (action === "restore" && method === "POST")
            return json(
              res,
              mutation(store.restore(docId, (await body(req)) as never)),
            );
          if (action === "duplicate" && method === "POST") {
            const v = z
              .object({ name: nonempty, revision: revision.optional() })
              .strict()
              .parse(await body(req));
            const doc = store.duplicate(docId, v.name, v.revision);
            broadcast(doc.id, doc.revision);
            return json(res, doc, 201);
          }
          if (action === "selection") {
            const doc = store.get(docId);
            if (method === "POST") {
              const v = z
                .object({
                  elementIds: z.array(id).max(500),
                  pageId: id.optional(),
                })
                .strict()
                .parse(await body(req));
              if (
                v.elementIds.some((e) => !findElement(doc, e)) ||
                (v.pageId && !doc.pages.some((p) => p.id === v.pageId))
              )
                fail(400, "Selection contains an unknown element or page.");
              selections.set(docId, v);
            }
            const s = selections.get(docId) || { elementIds: [] };
            return json(res, {
              ...s,
              documentId: doc.id,
              revision: doc.revision,
              comments: doc.comments.filter(
                (c) => !c.elementId || s.elementIds.includes(c.elementId),
              ),
            });
          }
          if (action === "assets" && method === "POST") {
            const v = z
              .object({
                name: nonempty,
                data: z.string(),
                expectedRevision: revision,
                operationId: id,
                actor: nonempty,
              })
              .strict()
              .parse(await body(req, 29 * 1024 * 1024));
            const asset = importAsset(
              base64(v.data, 20 * 1024 * 1024),
              v.name,
              assetsDir,
            );
            const result = mutation(
              store.apply(docId, {
                operationId: v.operationId,
                actor: v.actor,
                expectedRevision: v.expectedRevision,
                operations: [{ type: "register_asset", asset }],
              }),
            );
            return json(res, { ...result, asset });
          }
          if (action === "preview" && method === "GET") {
            if (requestedRevision === undefined)
              fail(400, "Preview requires an explicit saved revision.");
            const doc = store.get(docId, requestedRevision);
            const html = renderHtml(doc, (assetId) => {
              const a = doc.assets[assetId];
              if (!a) fail(404, "Missing asset.");
              return `data:${a.mime};base64,${readVerifiedAsset(a, assetsDir).toString("base64")}`;
            });
            res.writeHead(200, {
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(html);
            return;
          }
          if (action === "export" && method === "POST") {
            const v = z
              .object({
                revision,
                format: z.enum(["pdf", "png", "html", "bundle"]),
                pageId: id.optional(),
              })
              .strict()
              .parse(await body(req));
            const doc = store.get(docId, v.revision); // Immutable read occurs before any await/export.
            if (activeExports >= 2)
              fail(
                429,
                "Two exports are already running. Try again after one completes.",
              );
            activeExports++;
            try {
              const out = await exportDocument(
                doc,
                v.format,
                assetsDir,
                exportsDir,
                { pageId: v.pageId, signal: abort.signal },
              );
              return json(res, {
                filename: out.filename,
                url: `/api/downloads/${encodeURIComponent(out.filename)}`,
                documentId: doc.id,
                revision: doc.revision,
                diagnostics: out.diagnostics,
              });
            } finally {
              activeExports--;
            }
          }
        }
        fail(404, "API route not found.");
      }
      if (method !== "GET") fail(405, "Method not allowed.");
      let file: string;
      if (route === "/") file = path.join(PACKAGE_ROOT, "dist/ui/index.html");
      else if (route.startsWith("/assets/fonts/"))
        file = safeFile(
          path.join(PACKAGE_ROOT, "assets/fonts"),
          route.slice("/assets/fonts/".length),
        );
      else if (route.startsWith("/assets/"))
        file = safeFile(
          path.join(PACKAGE_ROOT, "dist/ui/assets"),
          route.slice("/assets/".length),
        );
      else fail(404, "Page not found.");
      res.writeHead(200, {
        "Content-Type":
          mimeTypes[path.extname(file)] || "application/octet-stream",
        "Cache-Control": "no-cache",
      });
      fs.createReadStream(file)
        .on("error", () => res.destroy())
        .pipe(res);
    } catch (error) {
      if (res.headersSent) {
        res.end();
        return;
      }
      const e = error as Error & { status?: number; code?: string };
      json(
        res,
        { error: e.message, code: e.code || "INVALID_REQUEST" },
        e.status || (error instanceof z.ZodError ? 400 : 500),
      );
    }
  });
  server.requestTimeout = 150000;
  server.headersTimeout = 15000;
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(options.port || 0, "127.0.0.1", () => {
        server.off("error", reject);
        resolve();
      });
    });
  } catch (e) {
    release();
    throw e;
  }
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Invalid loopback address");
  try {
    descriptor = makeDescriptor(root, address.port);
    atomicJson(path.join(root, ".runtime/service.json"), descriptor);
  } catch (error) {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    release();
    throw error;
  }
  const heartbeat = setInterval(() => {
    for (const res of events) res.write(": heartbeat\n\n");
  }, 15000);
  heartbeat.unref();
  async function close() {
    if (closing) return;
    closing = true;
    clearInterval(heartbeat);
    for (const res of events) res.end();
    events.clear();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeIdleConnections();
    });
    try {
      const current = JSON.parse(
        fs.readFileSync(path.join(root, ".runtime/service.json"), "utf8"),
      );
      if (current.instanceId === descriptor.instanceId)
        fs.unlinkSync(path.join(root, ".runtime/service.json"));
    } catch {}
    release();
  }
  return { descriptor, close };
}
