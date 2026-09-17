import { createHash, randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import {
  DomainError,
  IdSchema,
  assertSafeData,
  validateDocument,
  type Document,
  type Element,
} from "./model.js";
import { applyOperations, parseBatch, type Batch } from "./operations.js";

export interface MutationResult {
  documentId: string;
  revision: number;
  operationId: string;
  affectedElementIds: string[];
  document: Document;
}
export interface HistoryEntry {
  operationId: string;
  actor: string;
  revision: number;
  createdAt: string;
  summary: string;
  undoOf?: string;
}
export interface Snapshot {
  id: string;
  documentId: string;
  name: string;
  revision: number;
  createdAt: string;
}
export interface UndoRequest {
  operationId: string;
  actor: string;
  expectedRevision: number;
  targetOperationId: string;
}
export interface RestoreRequest {
  operationId: string;
  actor: string;
  expectedRevision: number;
  snapshotId: string;
}
type Segment = string | { id: string };
interface Change {
  path: Segment[];
  beforeExists: boolean;
  afterExists: boolean;
  before?: unknown;
  after?: unknown;
}
interface RevisionRecord {
  formatVersion: 1;
  documentId: string;
  revision: number;
  previousHash: string | null;
  document: Document;
  entry?: HistoryEntry;
  requestHash?: string;
  affectedElementIds: string[];
  changes: Change[];
}
interface Envelope {
  sha256: string;
  record: RevisionRecord;
}
interface Loaded {
  records: RevisionRecord[];
  hashes: string[];
}

const undoSchema = z
  .object({
    operationId: IdSchema,
    actor: z.string().trim().min(1).max(200),
    expectedRevision: z.number().int().min(0),
    targetOperationId: IdSchema,
  })
  .strict();
const restoreSchema = z
  .object({
    operationId: IdSchema,
    actor: z.string().trim().min(1).max(200),
    expectedRevision: z.number().int().min(0),
    snapshotId: IdSchema,
  })
  .strict();
const snapshotSchema = z
  .object({
    id: IdSchema,
    documentId: IdSchema,
    name: z.string().trim().min(1).max(200),
    revision: z.number().int().min(0),
    createdAt: z.string().datetime(),
  })
  .strict();
function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  assertSafeData(input);
  const result = schema.safeParse(input);
  if (!result.success)
    throw new DomainError("VALIDATION", result.error.message);
  return result.data;
}
function canonical(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map(
      (key) =>
        `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
    )
    .join(",")}}`;
}
const hash = (value: unknown) =>
  createHash("sha256").update(canonical(value)).digest("hex");
const equal = (a: unknown, b: unknown) => canonical(a) === canonical(b);
const own = (value: object, key: string) =>
  Object.prototype.hasOwnProperty.call(value, key);
const plain = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const idArray = (
  value: unknown[],
): value is Array<{ id: string } & Record<string, unknown>> =>
  value.every((item) => plain(item) && typeof item.id === "string");
const cleanClone = <T>(value: T): T => structuredClone(value);

/** Stable entity selectors avoid undoing a field on the wrong element after reordering. */
function diff(before: unknown, after: unknown, path: Segment[] = []): Change[] {
  if (equal(before, after)) return [];
  if (
    Array.isArray(before) &&
    Array.isArray(after) &&
    idArray(before) &&
    idArray(after) &&
    equal(
      before.map((x) => x.id),
      after.map((x) => x.id),
    )
  )
    return before.flatMap((item, i) =>
      diff(item, after[i], [...path, { id: item.id }]),
    );
  if (plain(before) && plain(after)) {
    const changes: Change[] = [];
    for (const key of new Set([
      ...Object.keys(before),
      ...Object.keys(after),
    ])) {
      if (path.length === 0 && ["revision", "updatedAt"].includes(key))
        continue;
      if (own(before, key) && own(after, key))
        changes.push(...diff(before[key], after[key], [...path, key]));
      else
        changes.push({
          path: [...path, key],
          beforeExists: own(before, key),
          afterExists: own(after, key),
          ...(own(before, key) ? { before: before[key] } : {}),
          ...(own(after, key) ? { after: after[key] } : {}),
        });
    }
    return changes;
  }
  return [{ path, beforeExists: true, afterExists: true, before, after }];
}
function pathSlot(
  doc: Document,
  path: Segment[],
): {
  parent: Record<string, unknown> | unknown[];
  key: string | number;
  exists: boolean;
  value: unknown;
} {
  let parent: unknown = doc;
  for (const segment of path.slice(0, -1)) {
    if (typeof segment === "string") {
      if (!plain(parent) || !own(parent, segment))
        throw new DomainError(
          "UNDO_CONFLICT",
          "The edited structure has since changed",
          409,
        );
      parent = parent[segment];
    } else {
      if (!Array.isArray(parent))
        throw new DomainError(
          "UNDO_CONFLICT",
          "The edited structure has since changed",
          409,
        );
      parent = parent.find((item) => plain(item) && item.id === segment.id);
      if (!parent)
        throw new DomainError(
          "UNDO_CONFLICT",
          "The edited element no longer exists",
          409,
        );
    }
  }
  const last = path.at(-1);
  if (!last) throw new DomainError("CORRUPT", "Invalid history path", 500);
  if (typeof last === "string") {
    if (!plain(parent))
      throw new DomainError(
        "UNDO_CONFLICT",
        "The edited structure has since changed",
        409,
      );
    return {
      parent,
      key: last,
      exists: own(parent, last),
      value: parent[last],
    };
  }
  if (!Array.isArray(parent))
    throw new DomainError(
      "UNDO_CONFLICT",
      "The edited structure has since changed",
      409,
    );
  const key = parent.findIndex((item) => plain(item) && item.id === last.id);
  return { parent, key, exists: key >= 0, value: parent[key] };
}
function reverseChanges(doc: Document, changes: Change[]): Document {
  const candidate = cleanClone(doc);
  // Check all guards before mutating, including complete arrays for structural edits.
  for (const change of changes) {
    const slot = pathSlot(candidate, change.path);
    if (
      slot.exists !== change.afterExists ||
      (slot.exists && !equal(slot.value, change.after))
    )
      throw new DomainError(
        "UNDO_CONFLICT",
        "This operation overlaps later edits. Undo the conflicting later operation first, or make a targeted edit.",
        409,
      );
  }
  for (const change of [...changes].reverse()) {
    const { parent, key } = pathSlot(candidate, change.path);
    if (change.beforeExists)
      (parent as Record<string | number, unknown>)[key] = cleanClone(
        change.before,
      );
    else if (Array.isArray(parent)) parent.splice(Number(key), 1);
    else delete parent[key as string];
  }
  try {
    return validateDocument(candidate);
  } catch (error) {
    if (error instanceof DomainError)
      throw new DomainError(
        "UNDO_CONFLICT",
        `Undo would break later document references: ${error.message}`,
        409,
      );
    throw error;
  }
}

function syncDirectory(path: string): void {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    fsyncSync(fd);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (
      !["EINVAL", "ENOTSUP", "EISDIR", "EPERM", "EBADF", "EACCES"].includes(
        code ?? "",
      )
    )
      throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
function safeDirectory(path: string): void {
  if (existsSync(path)) {
    const stat = lstatSync(path);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new DomainError(
        "UNSAFE_PATH",
        "Workspace directory must not be a symbolic link",
        400,
      );
  } else {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    syncDirectory(path);
  }
}
/** Temp-file fsync + atomic rename + parent-directory fsync. Unfinished temps are ignored. */
function atomicJson(path: string, value: unknown, immutable = false): void {
  if (immutable && existsSync(path))
    throw new DomainError(
      "CONFLICT",
      "Revision or snapshot already exists",
      409,
    );
  const temp = `${path}.${randomUUID()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temp, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(value));
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temp, path);
    syncDirectory(resolve(path, ".."));
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try {
      unlinkSync(temp);
    } catch {}
    throw error;
  }
}
function readJson(path: string, maxBytes = 128 * 1024 * 1024): unknown {
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes)
      throw new DomainError("CORRUPT", "Invalid workspace record", 500);
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(
      "CORRUPT",
      `Cannot read workspace record ${path.split(/[\\/]/).at(-1)}`,
      500,
    );
  }
}
const revisionFilename = (revision: number) =>
  `${String(revision).padStart(12, "0")}.json`;

/** One instance is owned by the exclusively locked workspace service. No hidden process lock. */
export class WorkspaceStore {
  readonly root: string;
  private readonly documentsDir: string;
  private readonly cache = new Map<string, Loaded>();
  constructor(root: string) {
    this.root = resolve(root);
    safeDirectory(this.root);
    this.documentsDir = join(this.root, "documents");
    safeDirectory(this.documentsDir);
  }
  private directory(id: string): string {
    parse(IdSchema, id);
    return join(this.documentsDir, id);
  }
  private head(id: string, loaded: Loaded): void {
    atomicJson(join(this.directory(id), "HEAD.json"), {
      documentId: id,
      revision: loaded.records.length - 1,
      sha256: loaded.hashes.at(-1),
    });
  }
  private load(id: string): Loaded {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const dir = this.directory(id);
    if (!existsSync(dir))
      throw new DomainError("NOT_FOUND", "Document not found", 404);
    safeDirectory(dir);
    const revDir = join(dir, "revisions");
    if (!existsSync(revDir))
      throw new DomainError("CORRUPT", "Document has no revisions", 500);
    safeDirectory(revDir);
    const files = readdirSync(revDir)
      .filter((file) => /^\d{12}\.json$/.test(file))
      .sort();
    const loaded: Loaded = { records: [], hashes: [] };
    const operationIds = new Set<string>();
    for (let i = 0; i < files.length; i++) {
      if (files[i] !== revisionFilename(i))
        throw new DomainError(
          "CORRUPT",
          "Revision sequence contains a gap",
          500,
        );
      const envelope = readJson(join(revDir, files[i])) as Envelope;
      const record = envelope?.record;
      if (
        !record ||
        record.formatVersion !== 1 ||
        record.documentId !== id ||
        record.document?.id !== id ||
        record.revision !== i ||
        record.document.revision !== i ||
        record.previousHash !== (i === 0 ? null : loaded.hashes[i - 1]) ||
        hash(record) !== envelope.sha256
      )
        throw new DomainError(
          "CORRUPT",
          "Revision identity, sequence or checksum failed verification",
          500,
        );
      validateDocument(record.document);
      if (
        !Array.isArray(record.changes) ||
        !Array.isArray(record.affectedElementIds) ||
        record.affectedElementIds.some((x) => !IdSchema.safeParse(x).success)
      )
        throw new DomainError("CORRUPT", "Invalid revision history", 500);
      if (
        i === 0 &&
        (record.entry || record.requestHash || record.changes.length)
      )
        throw new DomainError(
          "CORRUPT",
          "Initial revision contains invalid history",
          500,
        );
      if (i > 0) {
        if (
          !record.entry ||
          record.entry.revision !== i ||
          !IdSchema.safeParse(record.entry.operationId).success ||
          typeof record.entry.actor !== "string" ||
          typeof record.entry.summary !== "string" ||
          !record.requestHash ||
          operationIds.has(record.entry.operationId) ||
          !equal(
            diff(loaded.records[i - 1].document, record.document),
            record.changes,
          )
        )
          throw new DomainError(
            "CORRUPT",
            "Revision history does not match its document",
            500,
          );
        operationIds.add(record.entry.operationId);
      }
      loaded.records.push(record);
      loaded.hashes.push(envelope.sha256);
    }
    if (!loaded.records.length)
      throw new DomainError(
        "CORRUPT",
        "Document has no committed revisions",
        500,
      );
    const headPath = join(dir, "HEAD.json");
    if (existsSync(headPath)) {
      const head = readJson(headPath) as {
        documentId?: string;
        revision?: number;
        sha256?: string;
      };
      if (
        head.documentId !== id ||
        !Number.isSafeInteger(head.revision) ||
        head.revision! < 0 ||
        head.revision! >= loaded.records.length ||
        head.sha256 !== loaded.hashes[head.revision!]
      )
        throw new DomainError(
          "CORRUPT",
          "Document head identity or checksum failed verification",
          500,
        );
      if (head.revision !== loaded.records.length - 1) this.head(id, loaded);
    } else this.head(id, loaded);
    this.cache.set(id, loaded);
    return loaded;
  }
  list(): Document[] {
    return readdirSync(this.documentsDir, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isDirectory() && IdSchema.safeParse(entry.name).success,
      )
      .map((entry) => this.get(entry.name))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  create(input: Document): Document {
    const doc = validateDocument(input);
    if (doc.revision !== 0)
      throw new DomainError(
        "VALIDATION",
        "New documents must begin at revision 0",
      );
    const dir = this.directory(doc.id);
    if (existsSync(dir))
      throw new DomainError("CONFLICT", "Document ID already exists", 409);
    // Publish a complete document directory atomically: a creation crash cannot
    // expose an empty document that breaks enumeration of the whole workspace.
    const staging = join(
      this.documentsDir,
      `.creating-${doc.id}-${randomUUID()}`,
    );
    try {
      safeDirectory(staging);
      safeDirectory(join(staging, "revisions"));
      safeDirectory(join(staging, "snapshots"));
      const record: RevisionRecord = {
        formatVersion: 1,
        documentId: doc.id,
        revision: 0,
        previousHash: null,
        document: doc,
        changes: [],
        affectedElementIds: [],
      };
      const sha256 = hash(record);
      atomicJson(
        join(staging, "revisions", revisionFilename(0)),
        { sha256, record },
        true,
      );
      atomicJson(join(staging, "HEAD.json"), {
        documentId: doc.id,
        revision: 0,
        sha256,
      });
      renameSync(staging, dir);
      syncDirectory(this.documentsDir);
      this.cache.set(doc.id, { records: [record], hashes: [sha256] });
      return cleanClone(doc);
    } finally {
      rmSync(staging, { recursive: true, force: true });
    }
  }
  get(id: string, revision?: number): Document {
    const loaded = this.load(id);
    if (
      revision !== undefined &&
      (!Number.isSafeInteger(revision) || revision < 0)
    )
      throw new DomainError("VALIDATION", "Invalid revision");
    const record = loaded.records[revision ?? loaded.records.length - 1];
    if (!record)
      throw new DomainError("NOT_FOUND", "Saved revision not found", 404);
    return cleanClone(record.document);
  }
  private retry(
    loaded: Loaded,
    operationId: string,
    requestHash: string,
  ): MutationResult | undefined {
    const record = loaded.records.find(
      (r) => r.entry?.operationId === operationId,
    );
    if (!record) return;
    if (record.requestHash !== requestHash)
      throw new DomainError(
        "OPERATION_ID_REUSED",
        "Operation ID was already used with a different request",
        409,
      );
    return this.result(record);
  }
  private expected(loaded: Loaded, revision: number): void {
    if (revision !== loaded.records.length - 1)
      throw new DomainError(
        "REVISION_CONFLICT",
        `Expected revision ${revision}; current revision is ${loaded.records.length - 1}. Read the current document before retrying.`,
        409,
      );
  }
  private result(record: RevisionRecord): MutationResult {
    return {
      documentId: record.documentId,
      revision: record.revision,
      operationId: record.entry!.operationId,
      affectedElementIds: cleanClone(record.affectedElementIds),
      document: cleanClone(record.document),
    };
  }
  private commit(
    loaded: Loaded,
    document: Document,
    requestHash: string,
    entry: Omit<HistoryEntry, "revision" | "createdAt">,
    affectedElementIds: string[],
  ): MutationResult {
    const previous = loaded.records.at(-1)!;
    const now = new Date().toISOString();
    document.revision = previous.revision + 1;
    document.updatedAt = now;
    const validated = validateDocument(document);
    const record: RevisionRecord = {
      formatVersion: 1,
      documentId: document.id,
      revision: document.revision,
      previousHash: loaded.hashes.at(-1)!,
      document: validated,
      entry: { ...entry, revision: document.revision, createdAt: now },
      requestHash,
      affectedElementIds: [...new Set(affectedElementIds)],
      changes: diff(previous.document, validated),
    };
    const sha256 = hash(record);
    const dir = this.directory(document.id);
    try {
      atomicJson(
        join(dir, "revisions", revisionFilename(record.revision)),
        { sha256, record },
        true,
      );
      // A durable record is a committed mutation even if HEAD publication is interrupted.
      loaded.records.push(record);
      loaded.hashes.push(sha256);
      this.head(document.id, loaded);
      return this.result(record);
    } catch (error) {
      this.cache.delete(document.id);
      throw error;
    }
  }
  apply(id: string, input: Batch): MutationResult {
    const batch = parseBatch(input);
    const loaded = this.load(id);
    const requestHash = hash({ kind: "apply", request: input });
    const retry = this.retry(loaded, batch.operationId, requestHash);
    if (retry) return retry;
    this.expected(loaded, batch.expectedRevision);
    const { document, affectedElementIds } = applyOperations(
      loaded.records.at(-1)!.document,
      batch.operations,
    );
    return this.commit(
      loaded,
      document,
      requestHash,
      {
        operationId: batch.operationId,
        actor: batch.actor,
        summary: batch.operations.map((op) => op.type).join(", "),
      },
      affectedElementIds,
    );
  }
  history(id: string): HistoryEntry[] {
    return this.load(id).records.flatMap((record) =>
      record.entry ? [cleanClone(record.entry)] : [],
    );
  }
  undo(id: string, input: UndoRequest): MutationResult {
    const request = parse(undoSchema, input);
    const loaded = this.load(id);
    const requestHash = hash({ kind: "undo", request: input });
    const retry = this.retry(loaded, request.operationId, requestHash);
    if (retry) return retry;
    this.expected(loaded, request.expectedRevision);
    const target = loaded.records.find(
      (record) => record.entry?.operationId === request.targetOperationId,
    );
    if (!target)
      throw new DomainError("NOT_FOUND", "Target operation not found", 404);
    const document = reverseChanges(
      loaded.records.at(-1)!.document,
      target.changes,
    );
    return this.commit(
      loaded,
      document,
      requestHash,
      {
        operationId: request.operationId,
        actor: request.actor,
        summary: `Undo ${request.targetOperationId}`,
        undoOf: request.targetOperationId,
      },
      target.affectedElementIds,
    );
  }
  snapshot(id: string, name: string): Snapshot {
    const doc = this.get(id);
    const snapshot = parse(snapshotSchema, {
      id: `snapshot_${randomUUID()}`,
      documentId: id,
      name,
      revision: doc.revision,
      createdAt: new Date().toISOString(),
    });
    const dir = join(this.directory(id), "snapshots");
    safeDirectory(dir);
    atomicJson(join(dir, `${snapshot.id}.json`), snapshot, true);
    return cleanClone(snapshot);
  }
  snapshots(id: string): Snapshot[] {
    this.load(id);
    const dir = join(this.directory(id), "snapshots");
    safeDirectory(dir);
    return readdirSync(dir)
      .filter(
        (file) =>
          file.endsWith(".json") &&
          IdSchema.safeParse(file.slice(0, -5)).success,
      )
      .map((file) => {
        const snapshot = parse(snapshotSchema, readJson(join(dir, file)));
        if (snapshot.documentId !== id || `${snapshot.id}.json` !== file)
          throw new DomainError("CORRUPT", "Snapshot identity mismatch", 500);
        this.get(id, snapshot.revision);
        return snapshot;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  restore(id: string, input: RestoreRequest): MutationResult {
    const request = parse(restoreSchema, input);
    const loaded = this.load(id);
    const requestHash = hash({ kind: "restore", request: input });
    const retry = this.retry(loaded, request.operationId, requestHash);
    if (retry) return retry;
    this.expected(loaded, request.expectedRevision);
    const snapshot = this.snapshots(id).find(
      (item) => item.id === request.snapshotId,
    );
    if (!snapshot)
      throw new DomainError("NOT_FOUND", "Snapshot not found", 404);
    const document = this.get(id, snapshot.revision);
    const current = loaded.records.at(-1)!.document;
    return this.commit(
      loaded,
      document,
      requestHash,
      {
        operationId: request.operationId,
        actor: request.actor,
        summary: `Restore snapshot: ${snapshot.name}`,
      },
      [...allElementIds(current), ...allElementIds(document)],
    );
  }
  duplicate(id: string, name: string, revision?: number): Document {
    const source = this.get(id, revision);
    const mapping = new Map<string, string>();
    const fresh = (old: string, prefix: string) => {
      let value = mapping.get(old);
      if (!value) {
        value = `${prefix}_${randomUUID()}`;
        mapping.set(old, value);
      }
      return value;
    };
    // Asset identities remain content references, while editable entity identities are fresh.
    source.id = fresh(source.id, "doc");
    source.brand.id = fresh(source.brand.id, "brand");
    const walk = (items: Element[]) => {
      for (const item of items) {
        item.id = fresh(item.id, "element");
        if (item.children) walk(item.children);
      }
    };
    for (const page of source.pages) {
      page.id = fresh(page.id, "page");
      walk(page.elements);
    }
    walk(source.brand.components);
    for (const comment of source.comments) {
      comment.id = fresh(comment.id, "comment");
      if (comment.elementId)
        comment.elementId = mapping.get(comment.elementId)!;
      if (comment.pageId) comment.pageId = mapping.get(comment.pageId)!;
    }
    source.name = name;
    source.revision = 0;
    source.createdAt = source.updatedAt = new Date().toISOString();
    return this.create(source);
  }
}
function allElementIds(doc: Document): string[] {
  const walk = (items: Element[]): string[] =>
    items.flatMap((element) => [element.id, ...walk(element.children ?? [])]);
  return doc.pages.flatMap((page) => walk(page.elements));
}

/** Supported v0 is the same structured format before explicit version/revision metadata. */
export function migrateDocument(input: unknown): Document {
  assertSafeData(input);
  if (!plain(input))
    throw new DomainError("VALIDATION", "Expected a document object");
  if (input.schemaVersion === 1) return validateDocument(input);
  if (input.schemaVersion !== 0)
    throw new DomainError(
      "UNSUPPORTED_SCHEMA",
      "Only project schemas 0 and 1 are supported",
    );
  const now = new Date().toISOString();
  return validateDocument({
    ...input,
    schemaVersion: 1,
    rendererVersion: 1,
    revision: typeof input.revision === "number" ? input.revision : 0,
    createdAt: typeof input.createdAt === "string" ? input.createdAt : now,
    updatedAt: typeof input.updatedAt === "string" ? input.updatedAt : now,
    assets: input.assets ?? {},
    comments: input.comments ?? [],
  });
}
