import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { PageView } from "../render/DocumentView.js";
import { documentCss } from "../render/styles.js";
import {
  createDocument,
  templates as templateDefinitions,
} from "../domain/templates.js";
import "./style.css";
import { brandOperations } from "../domain/brand.js";
import { preserveTextRuns } from "./drafts.js";

import type {
  Document as Doc,
  Page,
  Element as Item,
  BrandKit as Brand,
  Style,
  TextRun,
} from "../domain/model.js";
type Workspace = {
  workspaceId: string;
  version: string;
  documents: Doc[];
  templates: { id: string; name: string; description: string }[];
  brands: Brand[];
};
type History = {
  operationId: string;
  actor: string;
  revision: number;
  createdAt: string;
  summary: string;
  undoOf?: string;
};
type Snapshot = {
  id: string;
  name: string;
  revision: number;
  createdAt: string;
};
type Draft = {
  base: string;
  text: string;
  remote?: string;
  documentId: string;
  elementId: string;
  pageId: string;
  source: Item;
  deleted?: boolean;
  editVersion: number;
};
const draftKey = (documentId: string, elementId: string) =>
  `${documentId}:${elementId}`;
function createDraft(
  item: Item,
  documentId: string,
  pageId: string,
  editVersion = 0,
): Draft {
  return {
    base: textOf(item),
    text: textOf(item),
    editVersion,
    documentId,
    elementId: item.id,
    pageId,
    source: structuredClone(item),
  };
}
function draftRuns(item: Item, draft: Draft): TextRun[] {
  const source = textOf(item) === draft.base ? item : draft.source;
  return preserveTextRuns(textOf(source), draft.text, source.runs);
}
const uid = () => crypto.randomUUID();
const fresh = (item: Item): Item => ({
  ...structuredClone(item),
  id: uid(),
  children: item.children?.map(fresh),
});
const textOf = (item?: Item) =>
  item?.text ?? item?.runs?.map((r) => r.text).join("") ?? "";
const flatten = (
  items: Item[],
  depth = 0,
): { item: Item; depth: number; parentId?: string }[] =>
  items.flatMap((item) => [
    { item, depth },
    ...(item.children
      ? flatten(item.children, depth + 1).map((e) => ({
          ...e,
          parentId: e.parentId ?? item.id,
        }))
      : []),
  ]);
const locate = (doc: Doc | undefined, id?: string) =>
  doc?.pages
    .flatMap((p) => flatten(p.elements).map((e) => ({ ...e, page: p })))
    .find((e) => e.item.id === id);
const replaceItem = (items: Item[], id: string, patch: Partial<Item>): Item[] =>
  items.map((e) =>
    e.id === id
      ? { ...e, ...patch }
      : e.children
        ? { ...e, children: replaceItem(e.children, id, patch) }
        : e,
  );
async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers:
      body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new Error(
      data.error?.message ??
        data.message ??
        (typeof data.error === "string"
          ? data.error
          : `Request failed (${response.status})`),
    );
  return data;
}
const icons: Record<string, React.ReactNode> = {
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="m9 5 7 7-7 7" />,
  back: <path d="m15 5-7 7 7 7" />,
  text: (
    <>
      <path d="M5 5h14M12 5v14M8 19h8M5 5v3M19 5v3" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8" cy="8" r="1" />
      <path d="m3 17 6-6 4 4 3-3 5 5" />
    </>
  ),
  shape: <rect x="4" y="4" width="16" height="16" rx="3" />,
  line: <path d="M4 12h16" />,
  table: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M3 10h18M10 4v16" />
    </>
  ),
  group: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" strokeDasharray="3 3" />
      <rect x="7" y="7" width="10" height="4" />
      <rect x="7" y="14" width="10" height="3" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M15 8V4H4v11h4" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 10v7M14 10v7" />
    </>
  ),
  undo: (
    <>
      <path d="m8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12" />
    </>
  ),
  redo: (
    <>
      <path d="m16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 15v6h16v-6" />
    </>
  ),
  check: <path d="m5 12 4 4L19 6" />,
  comment: (
    <>
      <path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0Z" />
      <path d="M7 9h9M7 13h6" />
    </>
  ),
  layers: (
    <>
      <path d="m3 8 9-5 9 5-9 5-9-5Zm0 5 9 5 9-5M3 18l9 5 9-5" />
    </>
  ),
  close: <path d="m6 6 12 12M18 6 6 18" />,
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 6v6l4 2" />
    </>
  ),
  palette: (
    <>
      <path d="M21 11a9 9 0 1 0-9 10c4 0 1-4 3-5s6 0 6-5Z" />
      <path d="M7 8h.01M11 5h.01M16 7h.01M5 13h.01" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7M21 3l-9 9M10 3H3v18h18v-7" />
    </>
  ),
  spark: (
    <>
      <path d="m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z" />
    </>
  ),
  grid: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </>
  ),
  align: (
    <>
      <path d="M3 3v18M7 6h14M7 12h9M7 18h14" />
    </>
  ),
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {icons[name] ?? icons.shape}
    </svg>
  );
}
function Button({
  children,
  icon,
  onClick,
  title,
  active,
  disabled,
  testId,
  className = "",
}: {
  children?: React.ReactNode;
  icon?: string;
  onClick?: () => void;
  title?: string;
  active?: boolean;
  disabled?: boolean;
  testId?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      className={`button ${active ? "active" : ""} ${className}`}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
      data-testid={testId}
    >
      {icon && <Icon name={icon} />} {children}
    </button>
  );
}
function Field({
  label,
  value,
  onChange,
  min,
  max,
  step = 1,
}: {
  label: string;
  value: string | number;
  onChange: (value: any) => void;
  min?: number;
  max?: number;
  step?: number;
}) {
  const [draft, setDraft] = useState(String(value));
  const focused = useRef(false);
  const changed = useRef(false);
  useEffect(() => {
    if (!focused.current || !changed.current) setDraft(String(value));
  }, [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        aria-label={label}
        type={typeof value === "number" ? "number" : "text"}
        value={draft}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(event) => {
          changed.current = true;
          setDraft(event.target.value);
        }}
        min={min}
        max={max}
        step={step}
        onBlur={(e) => {
          focused.current = false;
          const didChange = changed.current;
          changed.current = false;
          const next =
            typeof value === "number" ? Number(e.target.value) : e.target.value;
          if (didChange && next !== value) onChange(next);
          else setDraft(String(value));
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
      />
    </label>
  );
}
function Color({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="color-field">
      <input
        aria-label={label}
        type="color"
        value={/^#[\da-f]{6}$/i.test(value) ? value : "#ffffff"}
        onChange={(e) => onChange(e.target.value)}
      />
      <span>{label}</span>
      <code>{value}</code>
    </label>
  );
}
function App() {
  const [workspace, setWorkspace] = useState<Workspace>();
  const [doc, setDoc] = useState<Doc>();
  const docRef = useRef<Doc | undefined>(undefined);
  const [pageId, setPageId] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [tab, setTab] = useState<"design" | "brand" | "comments" | "history">(
    "design",
  );
  const [library, setLibrary] = useState<"pages" | "elements">("pages");
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const announcedDeletedDrafts = useRef(new Set<string>());
  const pendingDraftWrites = useRef(
    new Map<string, { token: string; text: string; version: number }[]>(),
  );
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const textRef = useRef<HTMLTextAreaElement>(null);
  const composing = useRef(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean }>();
  const [busy, setBusy] = useState(false);
  const mutationTail = useRef<Promise<unknown>>(Promise.resolve());
  const mutationGeneration = useRef(0);
  const pendingMutations = useRef(0);
  const localRevisions = useRef(new Map<string, Set<number>>());
  const [connected, setConnected] = useState(false);
  const [modal, setModal] = useState<"new" | "export" | "compare" | null>(null);
  const [newName, setNewName] = useState("Untitled design");
  const [template, setTemplate] = useState("blank");
  const [zoom, setZoom] = useState(0.68);
  const [history, setHistory] = useState<History[]>([]);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotName, setSnapshotName] = useState("");
  const [comment, setComment] = useState("");
  const [compare, setCompare] = useState<Doc>();
  const [exportFormat, setExportFormat] = useState("pdf");
  const [exportResult, setExportResult] = useState<any>();
  const [showResolved, setShowResolved] = useState(false);
  const [drag, setDrag] = useState<{
    id: string;
    mode: "move" | "resize";
    sx: number;
    sy: number;
    dx: number;
    dy: number;
    item: Item;
  }>();
  const dragRef = useRef(drag);
  dragRef.current = drag;
  const assetInput = useRef<HTMLInputElement>(null);
  const bundleInput = useRef<HTMLInputElement>(null);
  const uploadMode = useRef<"new" | "replace" | "logo">("new");
  const actor = useMemo(() => {
    let id = sessionStorage.getItem("studio-actor");
    if (!id) {
      id = `browser:${uid()}`;
      sessionStorage.setItem("studio-actor", id);
    }
    return id;
  }, []);
  const page = doc?.pages.find((p) => p.id === pageId) ?? doc?.pages[0];
  const info = locate(doc, selected[0]);
  const item = info?.item;
  const activeDraftKey = doc && item ? draftKey(doc.id, item.id) : undefined;
  const draft = activeDraftKey ? drafts[activeDraftKey] : undefined;
  const dirty = !!draft && draft.text !== draft.base;
  const error = useCallback((e: unknown) => {
    setNotice({
      text: e instanceof Error ? e.message : String(e),
      error: true,
    });
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const panel = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not([type="hidden"]),select,textarea,[tabindex="0"]',
        ) ?? [],
      );
    if (!panel?.contains(document.activeElement)) focusable()[0]?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setModal(null);
      }
      if (event.key === "Tab") {
        const all = focusable(),
          first = all[0],
          last = all[all.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", keys);
    return () => {
      window.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [modal]);
  const accept = useCallback((next: Doc) => {
    if (
      !docRef.current ||
      (docRef.current.id === next.id &&
        next.revision >= docRef.current.revision)
    )
      docRef.current = next;
    setDoc((old) =>
      !old || (old.id === next.id && next.revision >= old.revision)
        ? next
        : old,
    );
    setWorkspace((w) =>
      w
        ? {
            ...w,
            documents: w.documents.some((d) => d.id === next.id)
              ? w.documents.map((d) =>
                  d.id === next.id && next.revision >= d.revision ? next : d,
                )
              : [...w.documents, next],
          }
        : w,
    );
  }, []);
  function acceptMutation(next: Doc) {
    let revisions = localRevisions.current.get(next.id);
    if (!revisions) {
      revisions = new Set<number>();
      localRevisions.current.set(next.id, revisions);
    }
    revisions.add(next.revision);
    accept(next);
  }
  const refresh = useCallback(
    async (id?: string) => {
      const current = id ?? docRef.current?.id;
      if (current) accept(await api<Doc>(`/api/documents/${current}`));
    },
    [accept],
  );
  const openDoc = useCallback(
    (next: Doc) => {
      docRef.current = next;
      setDoc(next);
      accept(next);
      setPageId(next.pages[0]?.id ?? "");
      setSelected([]);
      setExportResult(undefined);
      localStorage.setItem("studio-document", next.id);
    },
    [accept],
  );
  useEffect(() => {
    (async () => {
      const token = new URLSearchParams(location.hash.slice(1)).get("token");
      if (token) {
        await api("/api/session", { token });
        window.history.replaceState(
          {},
          "",
          location.pathname + location.search,
        );
      }
      const w = await api<Workspace>("/api/workspace");
      setWorkspace(w);
      const requested =
        new URLSearchParams(location.search).get("document") ??
        new URLSearchParams(location.search).get("documentId") ??
        localStorage.getItem("studio-document");
      const current =
        w.documents.find((d) => d.id === requested) ?? w.documents[0];
      if (current) openDoc(current);
      else setModal("new");
    })().catch(error);
  }, [error, openDoc]);
  useEffect(() => {
    if (!workspace) return;
    let events: EventSource | undefined;
    const connect = () => {
      events?.close();
      events = new EventSource("/api/events");
      events.addEventListener("ready", () => {
        setConnected(true);
        void refresh().catch(error);
        void api<Workspace>("/api/workspace").then(setWorkspace).catch(error);
      });
      events.addEventListener("change", (e) => {
        const change = JSON.parse((e as MessageEvent).data);
        if (change.documentId === docRef.current?.id)
          void refresh(change.documentId).catch(error);
        else
          void api<Workspace>("/api/workspace").then(setWorkspace).catch(error);
      });
      events.onerror = () => setConnected(false);
    };
    const offline = () => {
      events?.close();
      setConnected(false);
    };
    window.addEventListener("online", connect);
    window.addEventListener("offline", offline);
    connect();
    return () => {
      events?.close();
      window.removeEventListener("online", connect);
      window.removeEventListener("offline", offline);
    };
  }, [workspace?.workspaceId, refresh, error]);
  useEffect(() => {
    if (!doc) return;
    setDrafts((old) => {
      const next = { ...old };
      let changed = false;
      for (const [id, draft] of Object.entries(old)) {
        if (draft.documentId !== doc.id) continue;
        const location = locate(doc, draft.elementId),
          current = location?.item;
        if (!current) {
          if (draft.text === draft.base) {
            delete next[id];
            changed = true;
          } else if (!draft.deleted) {
            next[id] = { ...draft, deleted: true };
            changed = true;
          }
          continue;
        }
        const remote = textOf(current);
        const pending = pendingDraftWrites.current.get(id) ?? [];
        const newerTyping = pending.some(
          (write) => draft.editVersion > write.version,
        );
        const ownSaved = pending.find((write) => write.text === remote);
        if (ownSaved && draft.editVersion > ownSaved.version) {
          next[id] = {
            ...createDraft(
              current,
              doc.id,
              location!.page.id,
              draft.editVersion,
            ),
            text: draft.text,
          };
          changed = true;
        } else if (
          (draft.text === draft.base && !newerTyping) ||
          draft.text === remote
        ) {
          next[id] = createDraft(
            current,
            doc.id,
            location!.page.id,
            draft.editVersion,
          );
          changed = true;
        } else if (remote !== draft.base) {
          next[id] = { ...draft, remote, deleted: false };
          changed = true;
        } else {
          next[id] = {
            ...draft,
            source: structuredClone(current),
            pageId: location!.page.id,
            remote: undefined,
            deleted: false,
          };
          changed = true;
        }
      }
      return changed ? next : old;
    });
    setSelected((ids) => ids.filter((id) => !!locate(doc, id)));
    if (!doc.pages.some((p) => p.id === pageId))
      setPageId(doc.pages[0]?.id ?? "");
  }, [doc]);
  useEffect(() => {
    if (
      item?.type === "text" &&
      doc &&
      info &&
      !draftsRef.current[draftKey(doc.id, item.id)]
    )
      setDrafts((ds) => ({
        ...ds,
        [draftKey(doc.id, item.id)]: createDraft(item, doc.id, info.page.id),
      }));
  }, [item?.id, item?.type, doc?.id]);
  useEffect(() => {
    const removed = Object.entries(drafts).filter(
      ([, draft]) =>
        draft.documentId === doc?.id &&
        draft.deleted &&
        draft.text !== draft.base,
    );
    if (removed.some(([id]) => !announcedDeletedDrafts.current.has(id))) {
      setNotice({
        text: "An edited element was deleted. Your unsaved draft is retained in the inspector.",
        error: true,
      });
      document
        .querySelector(".draft-recovery")
        ?.scrollIntoView({ block: "start" });
    }
    announcedDeletedDrafts.current = new Set(removed.map(([id]) => id));
  }, [drafts, doc?.id]);
  const loadHistory = useCallback(async () => {
    if (!docRef.current) return;
    const id = docRef.current.id;
    const [h, s] = await Promise.all([
      api<History[]>(`/api/documents/${id}/history`),
      api<Snapshot[]>(`/api/documents/${id}/snapshots`),
    ]);
    setHistory(h);
    setSnapshots(s);
  }, []);
  useEffect(() => {
    if (tab === "history") void loadHistory().catch(error);
  }, [tab, doc?.revision, loadHistory, error]);
  // A browser may receive a server event before the previous HTTP save reply.
  // Serialize locally initiated writes and choose the revision only when each
  // write starts. A failed/ambiguous write cancels pending writes; none is replayed.
  function enqueueMutation<T>(
    documentId: string,
    action: (current: Doc) => Promise<T>,
  ): Promise<T | undefined> {
    const baseline =
      doc?.id === documentId ? doc.revision : docRef.current?.revision;
    const generation = mutationGeneration.current;
    pendingMutations.current++;
    setBusy(true);
    const task = mutationTail.current.then(async () => {
      if (generation !== mutationGeneration.current) {
        error(
          new Error(
            "A prior save failed. Pending changes were cancelled; inspect the saved document before trying again.",
          ),
        );
        return undefined;
      }
      const current = docRef.current;
      if (!current || current.id !== documentId) {
        error(
          new Error(
            "The document changed before this edit could be saved. Return to the original design and try again.",
          ),
        );
        return undefined;
      }
      if (baseline !== undefined && current.revision > baseline) {
        const acknowledged = localRevisions.current.get(documentId);
        for (
          let revision = baseline + 1;
          revision <= current.revision;
          revision++
        ) {
          if (!acknowledged?.has(revision)) {
            mutationGeneration.current++;
            error(
              new Error(
                "The document changed elsewhere while this edit was waiting. Pending changes were cancelled; review the saved state before trying again.",
              ),
            );
            return undefined;
          }
        }
      }
      try {
        return await action(current);
      } catch (e) {
        mutationGeneration.current++;
        error(e);
        await refresh(documentId).catch(error);
        return undefined;
      }
    });
    mutationTail.current = task.then(
      () => undefined,
      () => undefined,
    );
    return task.finally(() => {
      pendingMutations.current--;
      setBusy(pendingMutations.current > 0);
    });
  }
  async function writeOperations(
    current: Doc,
    operations: unknown[],
    label = "Changes saved",
  ): Promise<Doc> {
    const result = await api(`/api/documents/${current.id}/operations`, {
      operationId: uid(),
      actor,
      expectedRevision: current.revision,
      operations,
    });
    acceptMutation(result.document);
    setNotice({ text: label });
    return result.document;
  }
  function apply(operations: unknown[], label = "Changes saved") {
    const current = docRef.current;
    if (!current) return Promise.resolve(undefined);
    return enqueueMutation(current.id, (current) =>
      writeOperations(current, operations, label),
    );
  }
  const patch = (patch: Partial<Item>, id = item?.id) =>
    id
      ? apply([{ type: "update_element", elementId: id, patch }])
      : Promise.resolve(undefined);
  const style = (values: Style) => patch({ style: values });
  function select(ids: string[], p = page?.id) {
    setSelected(ids);
    if (p) setPageId(p);
    if (doc)
      void api(`/api/documents/${doc.id}/selection`, {
        elementIds: ids,
        pageId: p,
      }).catch(error);
  }
  function beginDraftWrite(key: string, text: string, version: number) {
    const token = uid();
    pendingDraftWrites.current.set(key, [
      ...(pendingDraftWrites.current.get(key) ?? []),
      { token, text, version },
    ]);
    return () => {
      const remaining = (pendingDraftWrites.current.get(key) ?? []).filter(
        (write) => write.token !== token,
      );
      if (remaining.length) pendingDraftWrites.current.set(key, remaining);
      else pendingDraftWrites.current.delete(key);
    };
  }
  function acknowledgeDraft(
    saved: Doc,
    elementId: string,
    submittedText: string,
    submittedVersion: number,
  ) {
    const location = locate(saved, elementId);
    if (!location) return;
    const key = draftKey(saved.id, elementId);
    const live =
      docRef.current?.id === saved.id
        ? locate(docRef.current, elementId)
        : undefined;
    setDrafts((ds) => {
      const local = ds[key];
      if (!local) return ds;
      if (local.deleted && local.text === submittedText) return ds;
      if (local.editVersion <= submittedVersion)
        return {
          ...ds,
          [key]: createDraft(
            live?.item ?? location.item,
            saved.id,
            live?.page.id ?? location.page.id,
            local.editVersion,
          ),
        };
      const remote = live ? textOf(live.item) : undefined;
      return {
        ...ds,
        [key]: {
          ...createDraft(
            location.item,
            saved.id,
            location.page.id,
            local.editVersion,
          ),
          text: local.text,
          deleted: local.deleted,
          remote:
            remote !== undefined &&
            remote !== submittedText &&
            remote !== local.text
              ? remote
              : undefined,
        },
      };
    });
  }
  async function saveText(force = false) {
    if (!item || !draft) return;
    if (draft.remote !== undefined && !force) {
      setNotice({
        text: "This text changed elsewhere. Choose Keep mine or Use saved below.",
        error: true,
      });
      return;
    }
    if (composing.current) return;
    const endWrite = beginDraftWrite(
      draftKey(draft.documentId, item.id),
      draft.text,
      draft.editVersion,
    );
    const saved = await patch({
      text: draft.text,
      runs: draftRuns(item, draft),
    });
    if (saved) acknowledgeDraft(saved, item.id, draft.text, draft.editVersion);
    endWrite();
  }
  function discardDraft(id: string) {
    setDrafts((ds) => {
      const next = { ...ds };
      delete next[id];
      return next;
    });
  }
  async function copyDraft(draft: Draft) {
    try {
      await navigator.clipboard.writeText(draft.text);
      setNotice({ text: "Retained draft copied" });
    } catch {
      error(
        new Error(
          "Clipboard access was unavailable. Select the retained text and copy it with your keyboard.",
        ),
      );
    }
  }
  async function recoverDraft(id: string, draft: Draft) {
    const saved = await enqueueMutation(draft.documentId, async (current) => {
      const target =
        current.pages.find((p) => p.id === draft.pageId) ??
        current.pages.find((p) => p.id === pageId) ??
        current.pages[0];
      const width = Math.min(draft.source.width, target.width),
        height = Math.min(draft.source.height, target.height);
      const element: Item = {
        ...structuredClone(draft.source),
        id: uid(),
        name: `${draft.source.name.slice(0, 180)} · Recovered`,
        text: draft.text,
        runs: draftRuns(draft.source, draft),
        width,
        height,
        x: Math.max(0, Math.min(draft.source.x, target.width - width)),
        y: Math.max(0, Math.min(draft.source.y, target.height - height)),
      };
      const result = await writeOperations(
        current,
        [{ type: "add_element", pageId: target.id, element }],
        "Draft recovered as a new text element",
      );
      discardDraft(id);
      select([element.id], target.id);
      setTab("design");
      return result;
    });
    return saved;
  }
  async function formatText(kind: "bold" | "italic" | "underline") {
    if (!item || item.type !== "text" || composing.current) return;
    const priorFocus = document.activeElement;
    const start = textRef.current?.selectionStart ?? 0;
    const end = textRef.current?.selectionEnd ?? 0;
    if (start === end) {
      if (kind === "bold")
        await style({
          fontWeight: Number(item.style.fontWeight ?? 400) >= 600 ? 400 : 700,
        });
      else if (kind === "italic")
        await style({
          fontStyle: item.style.fontStyle === "italic" ? "normal" : "italic",
        });
      else
        await style({
          textDecoration:
            item.style.textDecoration === "underline" ? "none" : "underline",
        });
      return;
    }
    if (draft?.remote !== undefined) {
      error(
        new Error(
          "Resolve the text conflict before applying rich text formatting.",
        ),
      );
      return;
    }
    const text = draft?.text ?? textOf(item);
    const preserved = draft ? draftRuns(item, draft) : item.runs;
    const source: TextRun[] = preserved?.length ? preserved : [{ text }];
    let offset = 0;
    const runs: TextRun[] = [];
    for (const run of source) {
      const stop = offset + run.text.length;
      const cuts = [
        offset,
        ...[start, end].filter((n) => n > offset && n < stop),
        stop,
      ];
      for (let i = 0; i < cuts.length - 1; i++)
        runs.push({
          ...run,
          text: run.text.slice(cuts[i] - offset, cuts[i + 1] - offset),
        });
      offset = stop;
    }
    offset = 0;
    const selectedRuns = runs.filter((run) => {
      const overlaps = offset < end && offset + run.text.length > start;
      offset += run.text.length;
      return overlaps;
    });
    const enable = !selectedRuns.every((run) => run[kind]);
    offset = 0;
    const formatted = runs.map((run) => {
      const overlaps = offset < end && offset + run.text.length > start;
      offset += run.text.length;
      return overlaps ? { ...run, [kind]: enable } : run;
    });
    const version = draft?.editVersion ?? 0;
    const endWrite = beginDraftWrite(draftKey(doc!.id, item.id), text, version);
    const saved = await patch({ text, runs: formatted });
    if (saved) {
      const unchanged =
        draftsRef.current[draftKey(saved.id, item.id)]?.text === text;
      acknowledgeDraft(saved, item.id, text, version);
      requestAnimationFrame(() => {
        if (!unchanged || textRef.current?.value !== text) return;
        if (
          document.activeElement !== priorFocus &&
          document.activeElement !== textRef.current
        )
          return;
        textRef.current?.focus();
        textRef.current?.setSelectionRange(start, end);
      });
    }
    endWrite();
  }
  async function loadBrand(brand: Brand) {
    const documentId = docRef.current?.id;
    if (!documentId) return;
    await enqueueMutation(documentId, async (current) => {
      const result = await api(`/api/documents/${current.id}/brand`, {
        brandId: brand.id,
        operationId: uid(),
        actor,
        expectedRevision: current.revision,
      });
      acceptMutation(result.document);
      setNotice({ text: "Brand kit loaded" });
      return result.document;
    });
  }
  function add(type: Item["type"]) {
    if (!page) return;
    const defaults: Item = {
      id: uid(),
      type,
      name: {
        text: "Text block",
        image: "Image",
        shape: "Rectangle",
        divider: "Divider",
        table: "Table",
        group: "Section",
      }[type],
      x: 64,
      y: 80,
      width: Math.min(page.width - 128, 360),
      height: type === "divider" ? 2 : type === "text" ? 100 : 180,
      style: {},
    };
    if (type === "text") {
      defaults.text = "Make something worth sharing.";
      defaults.style = {
        fontFamily: doc?.brand.fonts.body ?? "Inter",
        fontSize: 24,
        color: "#25282b",
        lineHeight: 1.35,
      };
    }
    if (type === "shape")
      defaults.style = { background: "#e4e9e0", borderRadius: 8 };
    if (type === "divider") defaults.style = { background: "#26322b" };
    if (type === "table") {
      defaults.cells = [
        ["Column one", "Column two"],
        ["Add a detail", "Add a detail"],
        ["Another detail", "Another detail"],
      ];
      defaults.style = {
        fontSize: 14,
        padding: 12,
        borderColor: "#d8ddd7",
        borderWidth: 1,
        color: "#25282b",
      };
    }
    if (type === "group") {
      defaults.layout = "stack";
      defaults.gap = 12;
      defaults.children = [
        {
          id: uid(),
          type: "text",
          name: "Section heading",
          x: 0,
          y: 0,
          width: 300,
          height: 50,
          text: "A thoughtful section",
          style: { fontSize: 24, fontFamily: "Lora" },
        },
      ];
      defaults.style = { background: "#f0f2ed", padding: 24 };
    }
    void apply(
      [{ type: "add_element", pageId: page.id, element: defaults }],
      "Element added",
    ).then((next) => {
      if (next) select([defaults.id]);
    });
  }
  async function remove() {
    if (
      selected.length &&
      (await apply(
        selected.map((elementId) => ({ type: "delete_element", elementId })),
        "Elements deleted",
      ))
    )
      select([]);
  }
  async function duplicate() {
    if (!page) return;
    const clones = selected
      .map((id) => locate(doc, id))
      .filter(Boolean)
      .map((loc) => ({
        ...fresh(loc!.item),
        x: loc!.item.x + 20,
        y: loc!.item.y + 20,
      }));
    if (
      await apply(
        clones.map((element) => ({
          type: "add_element",
          pageId: page.id,
          element,
        })),
        "Elements duplicated",
      )
    )
      select(clones.map((e) => e.id));
  }
  async function reorder(delta: number) {
    if (!info || !item) return;
    const siblings = info.parentId
      ? (locate(doc, info.parentId)?.item.children ?? [])
      : info.page.elements;
    await apply([
      {
        type: "move_element",
        elementId: item.id,
        pageId: info.page.id,
        ...(info.parentId ? { parentId: info.parentId } : {}),
        index: Math.max(
          0,
          Math.min(
            siblings.length - 1,
            siblings.findIndex((e) => e.id === item.id) + delta,
          ),
        ),
      },
    ]);
  }
  async function group() {
    if (!page || selected.length < 2) return;
    const elements = page.elements.filter((e) => selected.includes(e.id));
    if (elements.length !== selected.length) {
      error(new Error("Select top-level elements on this page to group them."));
      return;
    }
    const x = Math.min(...elements.map((e) => e.x)),
      y = Math.min(...elements.map((e) => e.y));
    const section: Item = {
      id: uid(),
      type: "group",
      name: "Grouped section",
      x,
      y,
      width: Math.max(...elements.map((e) => e.x + e.width)) - x,
      height: Math.max(...elements.map((e) => e.y + e.height)) - y,
      style: {},
      layout: "position",
      children: [],
    };
    if (
      await apply([
        { type: "add_element", pageId: page.id, element: section },
        ...elements.flatMap((e, index) => [
          {
            type: "move_element",
            elementId: e.id,
            pageId: page.id,
            parentId: section.id,
            index,
          },
          {
            type: "update_element",
            elementId: e.id,
            patch: { x: e.x - x, y: e.y - y },
          },
        ]),
      ])
    )
      select([section.id]);
  }
  async function ungroup() {
    if (!page || item?.type !== "group") return;
    const children =
      item.children?.map((e) => ({ ...e, x: e.x + item.x, y: e.y + item.y })) ??
      [];
    if (
      await apply([
        ...children.flatMap((element, index) => [
          {
            type: "move_element",
            elementId: element.id,
            pageId: page.id,
            index: page.elements.length + index,
          },
          {
            type: "update_element",
            elementId: element.id,
            patch: { x: element.x, y: element.y },
          },
        ]),
        { type: "delete_element", elementId: item.id },
      ])
    )
      select(children.map((e) => e.id));
  }
  async function upload(file: File) {
    const documentId = docRef.current?.id;
    if (!documentId || !page) return;
    const targetPage = page,
      mode = uploadMode.current,
      targetItem = item;
    await enqueueMutation(documentId, async (current) => {
      const data = await base64(file);
      const result = await api(`/api/documents/${current.id}/assets`, {
        name: file.name,
        data,
        expectedRevision: current.revision,
        operationId: uid(),
        actor,
      });
      acceptMutation(result.document);
      if (mode === "logo")
        return writeOperations(result.document, [
          {
            type: "set_document",
            patch: {
              brand: { ...result.document.brand, logoAssetId: result.asset.id },
            },
          },
        ]);
      if (mode === "replace" && targetItem?.type === "image")
        return writeOperations(result.document, [
          {
            type: "update_element",
            elementId: targetItem.id,
            patch: { assetId: result.asset.id },
          },
        ]);
      const image: Item = {
        id: uid(),
        type: "image",
        name: file.name,
        x: 64,
        y: 80,
        width: Math.min(360, targetPage.width - 128),
        height: 240,
        style: { borderRadius: 4 },
        assetId: result.asset.id,
        fit: "cover",
        crop: { x: 50, y: 50 },
      };
      const saved = await writeOperations(result.document, [
        { type: "add_element", pageId: targetPage.id, element: image },
      ]);
      if (docRef.current?.id === documentId) select([image.id], targetPage.id);
      return saved;
    });
  }
  async function create() {
    setBusy(true);
    try {
      openDoc(
        await api("/api/documents", {
          name: newName.trim() || "Untitled design",
          template,
        }),
      );
      setModal(null);
      setNotice({ text: "Your new design is ready" });
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function undo(entry: History) {
    const documentId = docRef.current?.id;
    if (!documentId) return;
    await enqueueMutation(documentId, async (current) => {
      const result = await api(`/api/documents/${current.id}/undo`, {
        operationId: uid(),
        actor,
        expectedRevision: current.revision,
        targetOperationId: entry.operationId,
      });
      acceptMutation(result.document);
      setNotice({
        text: entry.undoOf
          ? "Change redone"
          : "Change undone; other edits preserved",
      });
      return result.document;
    });
  }
  async function historyAction(action: "undo" | "redo") {
    try {
      if (!doc) return;
      const h = await api<History[]>(`/api/documents/${doc.id}/history`);
      const reversed = [...h].reverse();
      const undone = new Set(h.map((e) => e.undoOf).filter(Boolean));
      const entries = new Map(h.map((entry) => [entry.operationId, entry]));
      const depth = (entry: History): number =>
        entry.undoOf && entries.has(entry.undoOf)
          ? 1 + depth(entries.get(entry.undoOf)!)
          : 0;
      const entry = reversed.find(
        (e) =>
          !undone.has(e.operationId) &&
          depth(e) % 2 === (action === "redo" ? 1 : 0),
      );
      if (entry) await undo(entry);
      else setNotice({ text: `No changes available to ${action}` });
    } catch (e) {
      error(e);
    }
  }
  async function variation() {
    if (!doc) return;
    try {
      const variation = await api<Doc>(`/api/documents/${doc.id}/duplicate`, {
        name: `${doc.name} · Variation`,
      });
      setWorkspace((w) =>
        w ? { ...w, documents: [...w.documents, variation] } : w,
      );
      setCompare(variation);
      setModal("compare");
    } catch (e) {
      error(e);
    }
  }
  async function exportDoc() {
    if (!doc) return;
    setBusy(true);
    setExportResult(undefined);
    try {
      setExportResult(
        await api(`/api/documents/${doc.id}/export`, {
          revision: doc.revision,
          format: exportFormat,
        }),
      );
      setNotice({ text: `Export created from saved revision ${doc.revision}` });
    } catch (e) {
      error(e);
    } finally {
      setBusy(false);
    }
  }
  async function snapshot() {
    const documentId = docRef.current?.id;
    if (!documentId) return;
    await enqueueMutation(documentId, async (current) => {
      await api(`/api/documents/${current.id}/snapshots`, {
        name: snapshotName.trim() || `Checkpoint ${snapshots.length + 1}`,
      });
      setSnapshotName("");
      await loadHistory();
      setNotice({ text: "Snapshot saved" });
      return current;
    });
  }
  async function restore(s: Snapshot) {
    const documentId = docRef.current?.id;
    if (!documentId) return;
    await enqueueMutation(documentId, async (current) => {
      const result = await api(`/api/documents/${current.id}/restore`, {
        snapshotId: s.id,
        operationId: uid(),
        actor,
        expectedRevision: current.revision,
      });
      acceptMutation(result.document);
      setNotice({ text: `Restored ${s.name} as a new revision` });
      return result.document;
    });
  }
  function pointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !page) return;
    const target = (e.target as HTMLElement).closest<HTMLElement>(
      "[data-element-id]",
    );
    if (!target) {
      select([]);
      return;
    }
    e.preventDefault();
    e.currentTarget.focus({ preventScroll: true });
    const id = target.dataset.elementId!;
    if (e.shiftKey) {
      select(
        selected.includes(id)
          ? selected.filter((s) => s !== id)
          : [...selected, id],
      );
      return;
    }
    select([id]);
    const hit = locate(doc, id);
    if (
      hit &&
      (!hit.parentId || locate(doc, hit.parentId)?.item.layout === "position")
    ) {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrag({
        id,
        mode: "move",
        sx: e.clientX,
        sy: e.clientY,
        dx: 0,
        dy: 0,
        item: hit.item,
      });
    }
  }
  function finishDrag() {
    const d = dragRef.current;
    if (!d) return;
    setDrag(undefined);
    if (Math.abs(d.dx) < 1 && Math.abs(d.dy) < 1) return;
    void patch(
      d.mode === "move"
        ? { x: Math.round(d.item.x + d.dx), y: Math.round(d.item.y + d.dy) }
        : {
            width: Math.max(10, Math.round(d.item.width + d.dx)),
            height: Math.max(4, Math.round(d.item.height + d.dy)),
          },
      d.id,
    );
  }
  const draftPage =
    page && item?.type === "text" && dirty
      ? {
          ...page,
          elements: replaceItem(page.elements, item.id, {
            text: draft!.text,
            runs: draftRuns(item, draft!),
          }),
        }
      : page;
  const shownPage =
    draftPage && drag
      ? {
          ...draftPage,
          elements: replaceItem(
            draftPage.elements,
            drag.id,
            drag.mode === "move"
              ? { x: drag.item.x + drag.dx, y: drag.item.y + drag.dy }
              : {
                  width: Math.max(10, drag.item.width + drag.dx),
                  height: Math.max(4, drag.item.height + drag.dy),
                },
          ),
        }
      : draftPage;
  const canvasItem =
    shownPage &&
    flatten(shownPage.elements).find((e) => e.item.id === item?.id)?.item;
  const assets = (id: string) => `/api/assets/${encodeURIComponent(id)}`;
  const pageView = (p: Page, d: Doc) => (
    <PageView
      page={p}
      brand={d.brand}
      assetUrl={assets}
      selectedIds={selected}
    />
  );
  const palette = (property: "color" | "background") => (
    <div className="palette-swatches" aria-label="Brand palette">
      {Object.entries(doc?.brand.colors ?? {}).map(([name, color]) => (
        <button
          type="button"
          key={name}
          style={{ backgroundColor: color }}
          title={`Apply ${name} to ${property === "color" ? "text" : "fill"}`}
          aria-label={`Apply ${name} to ${property === "color" ? "text" : "fill"}`}
          onClick={() => void style({ [property]: color })}
        />
      ))}
    </div>
  );
  const fonts = ["Inter", "Lora", "monospace"];
  const templatePreviews = useMemo(
    () =>
      Object.fromEntries(
        templateDefinitions.map((t) => [t.id, createDocument(t.name, t.id)]),
      ),
    [],
  );
  return (
    <div className="studio">
      <style>{documentCss}</style>
      <input
        ref={assetInput}
        type="file"
        hidden
        accept="image/png,image/jpeg,image/webp,image/svg+xml"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          e.target.value = "";
        }}
      />
      <input
        ref={bundleInput}
        type="file"
        hidden
        accept=".json,.mcpdesign,.mcpstudio"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f)
            void base64(f)
              .then((data) => api<Doc>("/api/import", { data }))
              .then((next) => {
                openDoc(next);
                setModal(null);
              })
              .catch(error);
          e.target.value = "";
        }}
      />
      <header className="topbar">
        <a
          className="wordmark"
          href="#"
          onClick={(e) => e.preventDefault()}
          aria-label="MCP Visual Design Studio"
        >
          <span className="brand-symbol">
            <span />
            <span />
            <span />
          </span>
          <span>
            MCP <span className="wordmark-light">Visual</span>
            <small>DESIGN STUDIO</small>
          </span>
        </a>
        <div className="document-heading">
          {doc && (
            <>
              <select
                aria-label="Document"
                data-testid="document-select"
                value={doc.id}
                onChange={(e) => {
                  const next = workspace?.documents.find(
                    (d) => d.id === e.target.value,
                  );
                  if (next) openDoc(next);
                }}
              >
                {workspace?.documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
              <span className="local-label">
                <span className={`status-dot ${connected ? "online" : ""}`} />
                {busy
                  ? "Saving…"
                  : connected
                    ? "Saved locally"
                    : "Reconnecting…"}
              </span>
            </>
          )}
        </div>
        <div className="top-actions">
          <Button
            icon="plus"
            onClick={() => {
              setNewName("Untitled design");
              setModal("new");
            }}
          >
            New design
          </Button>
          <Button icon="copy" onClick={variation} disabled={!doc}>
            Variation
          </Button>
          <Button
            icon="download"
            className="primary"
            onClick={() => {
              setExportResult(undefined);
              setModal("export");
            }}
            disabled={!doc}
            testId="export-button"
          >
            Export design
          </Button>
          <div className="avatar" title="Local workspace">
            Y
          </div>
        </div>
      </header>
      <nav className="workspace-bar">
        <div className="workspace-crumb">
          <span className="workspace-square">
            <Icon name="grid" size={14} />
          </span>
          Personal workspace <Icon name="arrow" size={12} />
          <span>Designs</span>
        </div>
        <div className="mode-tabs">
          {(["design", "brand", "comments", "history"] as const).map((t) => (
            <button
              key={t}
              className={tab === t ? "current" : ""}
              onClick={() => setTab(t)}
            >
              <Icon
                name={
                  {
                    design: "layers",
                    brand: "palette",
                    comments: "comment",
                    history: "clock",
                  }[t]
                }
                size={15}
              />
              {t[0].toUpperCase() + t.slice(1)}
              {t === "comments" &&
                !!doc?.comments.filter((c) => !c.resolved).length && (
                  <span className="count">
                    {doc.comments.filter((c) => !c.resolved).length}
                  </span>
                )}
            </button>
          ))}
        </div>
        <div className="agent-status">
          <span className="agent-spark">
            <Icon name="spark" size={13} />
          </span>
          Agent-ready <span className="faint">·</span>{" "}
          <span className="faint">Local & private</span>
        </div>
      </nav>
      <main className="workspace">
        <aside className="left-panel">
          <div className="panel-segment">
            <button
              className={library === "pages" ? "selected" : ""}
              onClick={() => setLibrary("pages")}
            >
              Pages
            </button>
            <button
              className={library === "elements" ? "selected" : ""}
              onClick={() => setLibrary("elements")}
            >
              Insert
            </button>
          </div>
          {library === "pages" ? (
            <>
              <div className="panel-heading">
                <span>DOCUMENT PAGES</span>
                <Button
                  icon="plus"
                  title="Add page"
                  onClick={() => {
                    if (page) {
                      const p: Page = {
                        id: uid(),
                        name: `Page ${(doc?.pages.length ?? 0) + 1}`,
                        width: page.width,
                        height: page.height,
                        background: "#ffffff",
                        elements: [],
                      };
                      void apply([{ type: "add_page", page: p }]).then(
                        (next) => {
                          if (next) {
                            setPageId(p.id);
                            select([], p.id);
                          }
                        },
                      );
                    }
                  }}
                />
              </div>
              <div className="page-list">
                {doc?.pages.map((p, i) => (
                  <div
                    key={p.id}
                    className={`page-entry ${p.id === page?.id ? "selected" : ""}`}
                  >
                    <button
                      className="page-select"
                      aria-label={`Select ${p.name}`}
                      onClick={() => {
                        setPageId(p.id);
                        select([], p.id);
                      }}
                    >
                      <div className="page-thumb">
                        <div
                          style={{
                            width: p.width,
                            height: p.height,
                            transform: `scale(${Math.min(150 / p.width, 144 / p.height)})`,
                          }}
                        >
                          {pageView(p, doc)}
                        </div>
                        <span className="page-number">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                      </div>
                      <div className="page-caption">
                        {p.name}
                        <span>
                          {p.width} × {p.height}
                        </span>
                      </div>
                    </button>
                    {p.id === page?.id && (
                      <div className="page-actions">
                        <Button
                          title="Move page earlier"
                          icon="back"
                          disabled={i === 0}
                          onClick={() =>
                            void apply([
                              { type: "move_page", pageId: p.id, index: i - 1 },
                            ])
                          }
                        />
                        <Button
                          title="Move page later"
                          icon="arrow"
                          disabled={i === doc.pages.length - 1}
                          onClick={() =>
                            void apply([
                              { type: "move_page", pageId: p.id, index: i + 1 },
                            ])
                          }
                        />
                        <Button
                          title="Duplicate page"
                          icon="copy"
                          onClick={() =>
                            void apply([
                              {
                                type: "add_page",
                                page: {
                                  ...p,
                                  id: uid(),
                                  name: `${p.name} copy`,
                                  elements: p.elements.map(fresh),
                                },
                                index: i + 1,
                              },
                            ])
                          }
                        />
                        <Button
                          title="Delete page"
                          icon="trash"
                          disabled={doc.pages.length === 1}
                          onClick={() =>
                            void apply([{ type: "delete_page", pageId: p.id }])
                          }
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <div className="panel-heading layers-heading">
                <span>
                  LAYERS{" "}
                  <span className="faint">
                    {page ? flatten(page.elements).length : 0}
                  </span>
                </span>
                <Icon name="layers" size={14} />
              </div>
              <div className="layers-list">
                {page &&
                  flatten(page.elements).map(({ item: e, depth }) => (
                    <button
                      key={e.id}
                      className={`layer ${selected.includes(e.id) ? "selected" : ""}`}
                      style={{ paddingLeft: 16 + depth * 14 }}
                      onClick={(event) =>
                        select(
                          event.shiftKey
                            ? [...new Set([...selected, e.id])]
                            : [e.id],
                        )
                      }
                    >
                      <Icon
                        name={e.type === "divider" ? "line" : e.type}
                        size={14}
                      />
                      <span>{e.name}</span>
                    </button>
                  ))}
              </div>
            </>
          ) : (
            <div className="insert-library">
              <p>
                Start with the essentials.
                <br />
                <span>Everything stays editable.</span>
              </p>
              <div className="insert-grid">
                {(
                  [
                    "text",
                    "image",
                    "shape",
                    "divider",
                    "table",
                    "group",
                  ] as const
                ).map((type) => (
                  <button
                    key={type}
                    onClick={() => {
                      if (type === "image") {
                        uploadMode.current = "new";
                        assetInput.current?.click();
                      } else add(type);
                    }}
                  >
                    <Icon name={type === "divider" ? "line" : type} size={25} />
                    <span>
                      {
                        {
                          text: "Text",
                          image: "Image",
                          shape: "Shape",
                          divider: "Divider",
                          table: "Table",
                          group: "Section",
                        }[type]
                      }
                    </span>
                  </button>
                ))}
              </div>
              <div className="panel-heading">
                <span>BRAND COMPONENTS</span>
              </div>
              {doc?.brand.components.length ? (
                doc.brand.components.map((c) => (
                  <button
                    className="component-button"
                    key={c.id}
                    onClick={() =>
                      page &&
                      void apply([
                        {
                          type: "add_element",
                          pageId: page.id,
                          element: fresh(c),
                        },
                      ])
                    }
                  >
                    <Icon name={c.type} />
                    {c.name}
                    <Icon name="plus" size={14} />
                  </button>
                ))
              ) : (
                <p className="empty-note">
                  Save an element as a reusable component in the Brand panel.
                </p>
              )}
              <button
                className="import-link"
                onClick={() => bundleInput.current?.click()}
              >
                <Icon name="download" size={15} />
                Import project bundle
              </button>
            </div>
          )}
          <div className="left-footer">
            <span className="small-spark">
              <Icon name="spark" size={16} />
            </span>
            <div>
              Made for you + your agent.
              <small>Your ideas. One shared canvas.</small>
            </div>
          </div>
        </aside>
        <section className="canvas-region">
          <div className="canvas-toolbar">
            <div className="tool-group">
              <Button
                icon="undo"
                title="Undo latest change"
                onClick={() => void historyAction("undo")}
                disabled={!doc || busy}
              />
              <Button
                icon="redo"
                title="Redo last undo"
                onClick={() => void historyAction("redo")}
                disabled={!doc || busy}
              />
              <span className="toolbar-divider" />
              {(["text", "image", "shape", "divider", "table"] as const).map(
                (type) => (
                  <Button
                    key={type}
                    icon={type === "divider" ? "line" : type}
                    title={`Add ${type}`}
                    onClick={() => {
                      if (type === "image") {
                        uploadMode.current = "new";
                        assetInput.current?.click();
                      } else add(type);
                    }}
                    disabled={!doc}
                  />
                ),
              )}
            </div>
            <div className="tool-group">
              <span className="selection-hint">
                {selected.length
                  ? `${selected.length} selected`
                  : "Select an element to edit"}
              </span>
              <Button
                icon="copy"
                title="Duplicate selected"
                onClick={() => void duplicate()}
                disabled={!selected.length}
              />
              <Button
                icon="trash"
                title="Delete selected"
                onClick={() => void remove()}
                disabled={!selected.length}
              />
            </div>
          </div>
          <div className="canvas-scroll">
            <div className="canvas-caption">
              <span>{page?.name ?? "YOUR NEXT GREAT DESIGN"}</span>
              <span>{page ? `${page.width} × ${page.height} px` : ""}</span>
            </div>
            {shownPage && doc ? (
              <div
                className="page-space"
                style={{
                  width: shownPage.width * zoom,
                  height: shownPage.height * zoom,
                }}
              >
                <div
                  className="canvas-page"
                  data-testid="canvas"
                  tabIndex={0}
                  role="region"
                  aria-label="Design canvas"
                  style={{
                    width: shownPage.width,
                    height: shownPage.height,
                    transform: `scale(${zoom})`,
                  }}
                  onPointerDown={pointerDown}
                  onPointerMove={(e) => {
                    if (dragRef.current)
                      setDrag((d) =>
                        d
                          ? {
                              ...d,
                              dx: (e.clientX - d.sx) / zoom,
                              dy: (e.clientY - d.sy) / zoom,
                            }
                          : d,
                      );
                  }}
                  onPointerUp={finishDrag}
                  onPointerCancel={() => setDrag(undefined)}
                  onDoubleClick={(e) => {
                    const target = (
                      e.target as HTMLElement
                    ).closest<HTMLElement>("[data-element-id]");
                    if (
                      target &&
                      locate(doc, target.dataset.elementId)?.item.type ===
                        "text"
                    ) {
                      setTab("design");
                      textRef.current?.focus();
                    }
                  }}
                  onKeyDown={(e) => {
                    if (!selected.length) return;
                    const amount = e.shiftKey ? 10 : 1;
                    if (
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(e.key)
                    ) {
                      e.preventDefault();
                      void apply(
                        selected.map((id) => {
                          const current = locate(doc, id)!.item;
                          return {
                            type: "update_element",
                            elementId: id,
                            patch: {
                              x:
                                current.x +
                                (e.key === "ArrowLeft"
                                  ? -amount
                                  : e.key === "ArrowRight"
                                    ? amount
                                    : 0),
                              y:
                                current.y +
                                (e.key === "ArrowUp"
                                  ? -amount
                                  : e.key === "ArrowDown"
                                    ? amount
                                    : 0),
                            },
                          };
                        }),
                      );
                    }
                    if (e.key === "Delete" || e.key === "Backspace") {
                      e.preventDefault();
                      void remove();
                    }
                  }}
                >
                  {pageView(shownPage, doc)}
                  {canvasItem && !info?.parentId && (
                    <div
                      className="selection-box"
                      style={{
                        left: canvasItem.x,
                        top: canvasItem.y,
                        width: canvasItem.width,
                        height: canvasItem.height,
                      }}
                    >
                      <span className="selection-tag">{canvasItem.name}</span>
                      <button
                        className="resize-handle"
                        aria-label="Resize selected element"
                        onPointerDown={(e) => {
                          e.stopPropagation();
                          e.preventDefault();
                          e.currentTarget.parentElement!.parentElement!.setPointerCapture(
                            e.pointerId,
                          );
                          setDrag({
                            id: canvasItem.id,
                            mode: "resize",
                            sx: e.clientX,
                            sy: e.clientY,
                            dx: 0,
                            dy: 0,
                            item: canvasItem,
                          });
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="canvas-empty">
                <Icon name="spark" size={42} />
                <h1>A little space for big ideas.</h1>
                <p>Create a design, then make it your own.</p>
                <Button
                  className="primary"
                  icon="plus"
                  onClick={() => setModal("new")}
                >
                  Create your first design
                </Button>
              </div>
            )}
            <div className="canvas-bottom-space" />
          </div>
          <footer className="canvas-footer">
            <span>
              {doc
                ? `Page ${doc.pages.findIndex((p) => p.id === page?.id) + 1} of ${doc.pages.length}`
                : "Ready when you are"}
              <span className="footer-divider">/</span>
              {doc ? `Revision ${doc.revision}` : "Local workspace"}
            </span>
            <div>
              <Button
                title="Zoom out"
                icon="line"
                onClick={() =>
                  setZoom((z) => Math.max(0.2, +(z - 0.1).toFixed(2)))
                }
              />
              <select
                aria-label="Canvas zoom"
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
              >
                {[...new Set([0.25, 0.4, 0.5, 0.68, 0.75, 1, 1.25, zoom])]
                  .sort((a, b) => a - b)
                  .map((z) => (
                    <option key={z} value={z}>
                      {Math.round(z * 100)}%
                    </option>
                  ))}
              </select>
              <Button
                title="Zoom in"
                icon="plus"
                onClick={() =>
                  setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))
                }
              />
            </div>
          </footer>
        </section>
        <aside className="right-panel">
          {Object.entries(drafts)
            .filter(
              ([, draft]) =>
                draft.documentId === doc?.id &&
                draft.deleted &&
                draft.text !== draft.base,
            )
            .map(([id, retained]) => (
              <section
                className="draft-recovery"
                role="alert"
                key={id}
                data-testid="deleted-draft"
              >
                <strong>Element deleted · draft retained</strong>
                <p>
                  “{retained.source.name}” was removed while you were editing.
                  Your unsaved text is safe here.
                </p>
                <textarea
                  readOnly
                  aria-label={`Retained draft from ${retained.source.name}`}
                  value={retained.text}
                />
                <div className="row-actions">
                  <Button onClick={() => void copyDraft(retained)}>
                    Copy draft
                  </Button>
                  <Button onClick={() => discardDraft(id)}>
                    Discard draft
                  </Button>
                </div>
                <Button
                  className="subtle-primary full"
                  disabled={busy}
                  onClick={() => void recoverDraft(id, retained)}
                >
                  Recover as new text
                </Button>
                <small>
                  Recovery creates a new element on the original page, or the
                  current page if it was removed.
                </small>
              </section>
            ))}
          {tab === "design" ? (
            <>
              <div className="inspector-title">
                <div>
                  <span className="eyebrow">DESIGN INSPECTOR</span>
                  <h2>
                    {item
                      ? item.type === "text"
                        ? "Text properties"
                        : `${item.type[0].toUpperCase() + item.type.slice(1)} properties`
                      : "Page settings"}
                  </h2>
                </div>
                <Icon name={item?.type ?? "shape"} size={20} />
              </div>
              {item ? (
                <>
                  <section className="inspector-section">
                    <Field
                      label="Element name"
                      value={item.name}
                      onChange={(name) => void patch({ name })}
                    />
                    <div className="field-grid">
                      <Field
                        label="X"
                        value={Math.round(item.x)}
                        onChange={(x) => void patch({ x })}
                      />
                      <Field
                        label="Y"
                        value={Math.round(item.y)}
                        onChange={(y) => void patch({ y })}
                      />
                      <Field
                        label="Width"
                        value={Math.round(item.width)}
                        min={1}
                        onChange={(width) => void patch({ width })}
                      />
                      <Field
                        label="Height"
                        value={Math.round(item.height)}
                        min={1}
                        onChange={(height) => void patch({ height })}
                      />
                    </div>
                    <div className="row-actions">
                      <Button
                        title="Align left"
                        icon="align"
                        onClick={() => void patch({ x: 0 })}
                      />
                      <Button
                        title="Center horizontally"
                        onClick={() =>
                          page &&
                          void patch({ x: (page.width - item.width) / 2 })
                        }
                      >
                        Center
                      </Button>
                      <Button
                        title="Align right"
                        onClick={() =>
                          page && void patch({ x: page.width - item.width })
                        }
                      >
                        Right
                      </Button>
                      <Button
                        title="Bring forward"
                        onClick={() => void reorder(1)}
                      >
                        ↑
                      </Button>
                      <Button
                        title="Send backward"
                        onClick={() => void reorder(-1)}
                      >
                        ↓
                      </Button>
                    </div>
                  </section>
                  {item.type === "text" && (
                    <section className="inspector-section">
                      <div className="section-label">
                        CONTENT <span>{dirty ? "Unsaved draft" : "Saved"}</span>
                      </div>
                      <textarea
                        ref={textRef}
                        data-testid="text-editor"
                        aria-label="Text content"
                        className="text-editor"
                        value={draft?.text ?? textOf(item)}
                        onChange={(e) =>
                          setDrafts((ds) => ({
                            ...ds,
                            [draftKey(doc!.id, item.id)]: {
                              ...(ds[draftKey(doc!.id, item.id)] ??
                                createDraft(item, doc!.id, info!.page.id)),
                              text: e.target.value,
                              editVersion:
                                (ds[draftKey(doc!.id, item.id)]?.editVersion ??
                                  0) + 1,
                            },
                          }))
                        }
                        onCompositionStart={() => {
                          composing.current = true;
                        }}
                        onCompositionEnd={() => {
                          composing.current = false;
                        }}
                        onKeyDown={(e) => {
                          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                            e.preventDefault();
                            void saveText();
                          }
                        }}
                      />
                      {draft?.remote !== undefined ? (
                        <div className="conflict" role="alert">
                          <strong>Text changed elsewhere</strong>
                          <p>
                            Your draft is preserved. Saved text: “
                            {draft.remote.slice(0, 120)}”
                          </p>
                          <div>
                            <Button
                              testId="conflict-keep-mine"
                              onClick={() => void saveText(true)}
                            >
                              Keep mine
                            </Button>
                            <Button
                              testId="conflict-use-saved"
                              onClick={() =>
                                setDrafts((ds) => ({
                                  ...ds,
                                  [draftKey(doc!.id, item.id)]: createDraft(
                                    item,
                                    doc!.id,
                                    info!.page.id,
                                    draft.editVersion + 1,
                                  ),
                                }))
                              }
                            >
                              Use saved
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <Button
                          className="subtle-primary full"
                          icon="check"
                          testId="save-text"
                          onClick={() => void saveText()}
                          disabled={!dirty || busy}
                        >
                          Save text <span className="keyboard">⌘ ↵</span>
                        </Button>
                      )}
                      <div className="section-label spaced">TYPOGRAPHY</div>
                      <select
                        aria-label="Font family"
                        value={
                          item.style.fontFamily ??
                          doc?.brand.fonts.body ??
                          "Inter"
                        }
                        onChange={(e) =>
                          void style({
                            fontFamily: e.target.value as Style["fontFamily"],
                          })
                        }
                      >
                        {fonts.map((f) => (
                          <option key={f}>{f}</option>
                        ))}
                      </select>
                      <div className="field-grid">
                        <Field
                          label="Font size"
                          value={Number(item.style.fontSize ?? 16)}
                          min={4}
                          onChange={(fontSize) => void style({ fontSize })}
                        />
                        <Field
                          label="Line height"
                          value={Number(item.style.lineHeight ?? 1.4)}
                          min={0.5}
                          step={0.05}
                          onChange={(lineHeight) => void style({ lineHeight })}
                        />
                      </div>
                      <div className="row-actions">
                        <Button
                          title="Bold"
                          active={Number(item.style.fontWeight ?? 400) >= 600}
                          onClick={() => void formatText("bold")}
                        >
                          <b>B</b>
                        </Button>
                        <Button
                          title="Italic"
                          active={item.style.fontStyle === "italic"}
                          onClick={() => void formatText("italic")}
                        >
                          <i>I</i>
                        </Button>
                        <Button
                          title="Underline"
                          active={item.style.textDecoration === "underline"}
                          onClick={() => void formatText("underline")}
                        >
                          <u>U</u>
                        </Button>
                        <select
                          aria-label="Text alignment"
                          value={item.style.textAlign ?? "left"}
                          onChange={(e) =>
                            void style({
                              textAlign: e.target.value as Style["textAlign"],
                            })
                          }
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                          <option value="justify">Justify</option>
                        </select>
                      </div>
                      <div className="field-grid">
                        <label className="field">
                          <span>List</span>
                          <select
                            aria-label="List style"
                            value={item.list ?? "none"}
                            onChange={(e) =>
                              void patch({
                                list: e.target.value as Item["list"],
                              })
                            }
                          >
                            <option value="none">None</option>
                            <option value="bullet">Bullets</option>
                            <option value="number">Numbered</option>
                          </select>
                        </label>
                        <Field
                          label="Tracking"
                          value={Number(item.style.letterSpacing ?? 0)}
                          step={0.1}
                          onChange={(letterSpacing) =>
                            void style({ letterSpacing })
                          }
                        />
                      </div>
                      <Field
                        label="Link URL"
                        value={item.href ?? ""}
                        onChange={(href) =>
                          void apply([
                            {
                              type: "update_element",
                              elementId: item.id,
                              patch: { href: href || null },
                            },
                          ])
                        }
                      />
                      <Color
                        label="Text color"
                        value={String(item.style.color ?? "#25282b")}
                        onChange={(color) => void style({ color })}
                      />
                      {palette("color")}
                    </section>
                  )}
                  {item.type === "image" && (
                    <section className="inspector-section">
                      <Button
                        className="subtle-primary full"
                        icon="image"
                        onClick={() => {
                          uploadMode.current = "replace";
                          assetInput.current?.click();
                        }}
                      >
                        Replace image
                      </Button>
                      <label className="field">
                        <span>Image fit</span>
                        <select
                          aria-label="Image fit"
                          value={item.fit ?? "cover"}
                          onChange={(e) =>
                            void patch({ fit: e.target.value as Item["fit"] })
                          }
                        >
                          <option value="cover">Crop to fill</option>
                          <option value="contain">Fit inside</option>
                          <option value="fill">Stretch</option>
                        </select>
                      </label>
                      <div className="section-label spaced">CROP POSITION</div>
                      <div className="field-grid">
                        <Field
                          label="Crop X %"
                          value={item.crop?.x ?? 50}
                          min={0}
                          max={100}
                          onChange={(x) =>
                            void patch({ crop: { x, y: item.crop?.y ?? 50 } })
                          }
                        />
                        <Field
                          label="Crop Y %"
                          value={item.crop?.y ?? 50}
                          min={0}
                          max={100}
                          onChange={(y) =>
                            void patch({ crop: { x: item.crop?.x ?? 50, y } })
                          }
                        />
                      </div>
                    </section>
                  )}
                  {item.type === "table" && (
                    <section className="inspector-section">
                      <div className="section-label">TABLE CELLS</div>
                      <p className="help">
                        Edit cells below. Each row stays structured.
                      </p>
                      <div className="cell-editor">
                        {item.cells?.map((row, r) => (
                          <div key={r}>
                            {row.map((cell, c) => (
                              <input
                                key={`${item.id}-${r}-${c}-${cell}`}
                                aria-label={`Row ${r + 1} column ${c + 1}`}
                                defaultValue={cell}
                                onBlur={(e) => {
                                  if (e.target.value !== cell)
                                    void patch({
                                      cells: item.cells?.map((rr, ri) =>
                                        ri === r
                                          ? rr.map((cc, ci) =>
                                              ci === c ? e.target.value : cc,
                                            )
                                          : rr,
                                      ),
                                    });
                                }}
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                      <div className="row-actions">
                        <Button
                          onClick={() =>
                            void patch({
                              cells: [
                                ...(item.cells ?? []),
                                Array(item.cells?.[0]?.length ?? 2).fill(
                                  "New cell",
                                ),
                              ],
                            })
                          }
                        >
                          + Row
                        </Button>
                        <Button
                          onClick={() =>
                            void patch({
                              cells: item.cells?.map((r) => [...r, "New cell"]),
                            })
                          }
                        >
                          + Column
                        </Button>
                      </div>
                    </section>
                  )}
                  {item.type === "group" && (
                    <section className="inspector-section">
                      <div className="section-label">SECTION LAYOUT</div>
                      <select
                        aria-label="Section layout"
                        value={item.layout ?? "position"}
                        onChange={(e) =>
                          void patch({
                            layout: e.target.value as Item["layout"],
                          })
                        }
                      >
                        <option value="position">Positioned</option>
                        <option value="stack">Vertical stack</option>
                        <option value="grid">Grid</option>
                      </select>
                      <div className="field-grid">
                        <Field
                          label="Gap"
                          value={item.gap ?? 12}
                          min={0}
                          onChange={(gap) => void patch({ gap })}
                        />
                        <Field
                          label="Columns"
                          value={item.columns ?? 2}
                          min={1}
                          max={12}
                          onChange={(columns) => void patch({ columns })}
                        />
                      </div>
                      <Button onClick={() => void ungroup()}>
                        Ungroup section
                      </Button>
                    </section>
                  )}
                  <section className="inspector-section">
                    <div className="section-label">APPEARANCE</div>
                    <Color
                      label="Fill"
                      value={String(item.style.background ?? "#ffffff")}
                      onChange={(background) => void style({ background })}
                    />
                    {palette("background")}
                    <Color
                      label="Border"
                      value={String(item.style.borderColor ?? "#d8ddd7")}
                      onChange={(borderColor) => void style({ borderColor })}
                    />
                    <div className="field-grid">
                      <Field
                        label="Border width"
                        value={Number(item.style.borderWidth ?? 0)}
                        min={0}
                        onChange={(borderWidth) => void style({ borderWidth })}
                      />
                      <Field
                        label="Radius"
                        value={Number(item.style.borderRadius ?? 0)}
                        min={0}
                        onChange={(borderRadius) =>
                          void style({ borderRadius })
                        }
                      />
                      <Field
                        label="Opacity"
                        value={Number(item.style.opacity ?? 1)}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(opacity) => void style({ opacity })}
                      />
                      <Field
                        label="Padding"
                        value={Number(item.style.padding ?? 0)}
                        min={0}
                        onChange={(padding) => void style({ padding })}
                      />
                    </div>
                  </section>
                  {selected.length > 1 && (
                    <section className="inspector-section">
                      <Button icon="group" onClick={() => void group()}>
                        Group {selected.length} elements
                      </Button>
                    </section>
                  )}
                  <section className="inspector-section">
                    <Button
                      className="full"
                      icon="comment"
                      onClick={() => setTab("comments")}
                    >
                      Comment on this element
                    </Button>
                  </section>
                </>
              ) : page && doc ? (
                <>
                  <section className="inspector-section">
                    <Field
                      label="Document name"
                      value={doc.name}
                      onChange={(name) =>
                        void apply([{ type: "set_document", patch: { name } }])
                      }
                    />
                    <Field
                      label="Page name"
                      value={page.name}
                      onChange={(name) =>
                        void apply([
                          {
                            type: "update_page",
                            pageId: page.id,
                            patch: { name },
                          },
                        ])
                      }
                    />
                    <div className="section-label spaced">PAGE SIZE</div>
                    <div className="field-grid">
                      <Field
                        label="Page width"
                        value={page.width}
                        min={100}
                        onChange={(width) =>
                          void apply([
                            {
                              type: "update_page",
                              pageId: page.id,
                              patch: { width },
                            },
                          ])
                        }
                      />
                      <Field
                        label="Page height"
                        value={page.height}
                        min={100}
                        onChange={(height) =>
                          void apply([
                            {
                              type: "update_page",
                              pageId: page.id,
                              patch: { height },
                            },
                          ])
                        }
                      />
                    </div>
                    <div className="row-actions">
                      <Button
                        active={page.width <= page.height}
                        onClick={() =>
                          void apply([
                            {
                              type: "update_page",
                              pageId: page.id,
                              patch: {
                                width: Math.min(page.width, page.height),
                                height: Math.max(page.width, page.height),
                              },
                            },
                          ])
                        }
                      >
                        Portrait
                      </Button>
                      <Button
                        active={page.width > page.height}
                        onClick={() =>
                          void apply([
                            {
                              type: "update_page",
                              pageId: page.id,
                              patch: {
                                width: Math.max(page.width, page.height),
                                height: Math.min(page.width, page.height),
                              },
                            },
                          ])
                        }
                      >
                        Landscape
                      </Button>
                    </div>
                    <select
                      aria-label="Page size preset"
                      value="custom"
                      onChange={(e) => {
                        const [width, height] = e.target.value
                          .split("x")
                          .map(Number);
                        if (width)
                          void apply([
                            {
                              type: "update_page",
                              pageId: page.id,
                              patch: { width, height },
                            },
                          ]);
                      }}
                    >
                      <option value="custom">Custom dimensions</option>
                      <option value="794x1123">A4 · 210 × 297 mm</option>
                      <option value="816x1056">US Letter · 8.5 × 11 in</option>
                      <option value="1080x1080">Square · 1080 × 1080</option>
                      <option value="1280x720">Landscape · 16:9</option>
                    </select>
                    <Color
                      label="Page background"
                      value={page.background}
                      onChange={(background) =>
                        void apply([
                          {
                            type: "update_page",
                            pageId: page.id,
                            patch: { background },
                          },
                        ])
                      }
                    />
                  </section>
                  <section className="inspector-section">
                    <div className="quiet-card">
                      <Icon name="spark" size={23} />
                      <h3>A shared creative space.</h3>
                      <p>
                        Select something on the canvas to fine-tune it. Your
                        agent sees the same saved design.
                      </p>
                      <span>Shift + click to select multiple</span>
                    </div>
                  </section>
                </>
              ) : null}
            </>
          ) : null}
          {tab === "brand" && doc && (
            <>
              <div className="inspector-title">
                <div>
                  <span className="eyebrow">YOUR DESIGN DNA</span>
                  <h2>Brand kit</h2>
                </div>
                <Icon name="palette" size={22} />
              </div>
              <section className="inspector-section">
                <Field
                  label="Brand name"
                  value={doc.brand.name}
                  onChange={(name) =>
                    void apply([
                      {
                        type: "set_document",
                        patch: { brand: { ...doc.brand, name } },
                      },
                    ])
                  }
                />
                <div className="section-label spaced">PALETTE</div>
                <p className="help">
                  Palette and font changes update matching styles across all
                  pages. Custom styles stay as they are.
                </p>
                {Object.entries(doc.brand.colors).map(([name, color]) => (
                  <Color
                    key={name}
                    label={name}
                    value={color}
                    onChange={(value) =>
                      void apply(
                        brandOperations(doc, {
                          ...doc.brand,
                          colors: { ...doc.brand.colors, [name]: value },
                        }),
                        "Brand palette applied across matching elements",
                      )
                    }
                  />
                ))}
                <Button
                  icon="plus"
                  className="full"
                  onClick={() =>
                    void apply([
                      {
                        type: "set_document",
                        patch: {
                          brand: {
                            ...doc.brand,
                            colors: {
                              ...doc.brand.colors,
                              [`color_${Object.keys(doc.brand.colors).length + 1}`]:
                                "#f27e63",
                            },
                          },
                        },
                      },
                    ])
                  }
                >
                  Add color
                </Button>
                <div className="section-label spaced">FONTS</div>
                {(["heading", "body"] as const).map((role) => (
                  <label className="field" key={role}>
                    <span>{role === "heading" ? "Headings" : "Body text"}</span>
                    <select
                      aria-label={`${role} font`}
                      value={doc.brand.fonts[role]}
                      onChange={(e) =>
                        void apply(
                          brandOperations(doc, {
                            ...doc.brand,
                            fonts: {
                              ...doc.brand.fonts,
                              [role]: e.target
                                .value as Brand["fonts"]["heading"],
                            },
                          }),
                          "Brand fonts applied across matching elements",
                        )
                      }
                    >
                      {fonts.map((font) => (
                        <option key={font}>{font}</option>
                      ))}
                    </select>
                  </label>
                ))}
                <div className="section-label spaced">LOGO</div>
                {doc.brand.logoAssetId && (
                  <img
                    className="brand-logo-preview"
                    src={assets(doc.brand.logoAssetId)}
                    alt="Brand logo"
                  />
                )}
                <Button
                  icon="image"
                  className="full"
                  onClick={() => {
                    uploadMode.current = "logo";
                    assetInput.current?.click();
                  }}
                >
                  {doc.brand.logoAssetId ? "Replace logo" : "Upload logo"}
                </Button>
                {doc.brand.logoAssetId && (
                  <Button
                    className="full"
                    onClick={() => {
                      if (page)
                        void apply([
                          {
                            type: "add_element",
                            pageId: page.id,
                            element: {
                              id: uid(),
                              type: "image",
                              name: "Brand logo",
                              assetId: doc.brand.logoAssetId,
                              x: 48,
                              y: 48,
                              width: 160,
                              height: 80,
                              fit: "contain",
                              style: {},
                            },
                          },
                        ]);
                    }}
                  >
                    Add logo to page
                  </Button>
                )}
              </section>
              <section className="inspector-section">
                <div className="section-label">
                  REUSABLE COMPONENTS <span>{doc.brand.components.length}</span>
                </div>
                <p className="help">
                  Save a selected element or a whole section for your next
                  design.
                </p>
                <Button
                  icon="plus"
                  className="full"
                  disabled={!item}
                  onClick={() =>
                    item &&
                    void apply([
                      {
                        type: "set_document",
                        patch: {
                          brand: {
                            ...doc.brand,
                            components: [...doc.brand.components, fresh(item)],
                          },
                        },
                      },
                    ])
                  }
                >
                  Save selection as component
                </Button>
                {doc.brand.components.map((c, i) => (
                  <div className="component-row" key={c.id}>
                    <span>{c.name}</span>
                    <Button
                      title={`Remove component ${c.name}`}
                      icon="close"
                      onClick={() =>
                        void apply([
                          {
                            type: "set_document",
                            patch: {
                              brand: {
                                ...doc.brand,
                                components: doc.brand.components.filter(
                                  (_, n) => n !== i,
                                ),
                              },
                            },
                          },
                        ])
                      }
                    />
                  </div>
                ))}
              </section>
              <section className="inspector-section">
                <Button
                  className="primary full"
                  icon="check"
                  onClick={() =>
                    void api("/api/brands", doc.brand)
                      .then(() => api<Brand[]>("/api/brands"))
                      .then((brands) => {
                        setWorkspace((w) => (w ? { ...w, brands } : w));
                        setNotice({
                          text: "Brand kit saved to this workspace",
                        });
                      })
                      .catch(error)
                  }
                >
                  Save brand kit
                </Button>
                <label className="field">
                  <span>Load a saved kit</span>
                  <select
                    aria-label="Saved brand kit"
                    value=""
                    onChange={(e) => {
                      const brand = workspace?.brands.find(
                        (b) => b.id === e.target.value,
                      );
                      if (brand) void loadBrand(brand);
                    }}
                  >
                    <option value="">Choose brand kit…</option>
                    {workspace?.brands.map((b) => (
                      <option value={b.id} key={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
              </section>
            </>
          )}
          {tab === "comments" && doc && (
            <>
              <div className="inspector-title">
                <div>
                  <span className="eyebrow">KEEP THE CONTEXT</span>
                  <h2>Comments</h2>
                </div>
                <Icon name="comment" size={22} />
              </div>
              <section className="inspector-section">
                <div className="comment-anchor">
                  <Icon name={item ? "layers" : "shape"} size={14} />
                  {item ? item.name : (page?.name ?? "Document")}
                </div>
                <textarea
                  aria-label="Comment text"
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  placeholder="Leave a note for your agent or your future self…"
                  rows={4}
                />
                <Button
                  className="primary full"
                  testId="add-comment"
                  icon="comment"
                  disabled={!comment.trim() || busy}
                  onClick={() =>
                    void apply(
                      [
                        {
                          type: "add_comment",
                          comment: {
                            id: uid(),
                            text: comment,
                            author: "You",
                            createdAt: new Date().toISOString(),
                            resolved: false,
                            ...(item ? { elementId: item.id } : {}),
                            ...(page ? { pageId: page.id } : {}),
                          },
                        },
                      ],
                      "Comment added",
                    ).then((next) => {
                      if (next) setComment("");
                    })
                  }
                >
                  Add comment
                </Button>
                <p className="help">
                  Your agent can read these notes on its next request. Comments
                  do not wake an idle agent.
                </p>
              </section>
              <section className="inspector-section">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={showResolved}
                    onChange={(e) => setShowResolved(e.target.checked)}
                  />
                  Show resolved
                </label>
                {doc.comments
                  .filter((c) => showResolved || !c.resolved)
                  .map((c) => (
                    <article
                      className={`comment-card ${c.resolved ? "resolved" : ""}`}
                      key={c.id}
                    >
                      <header>
                        <span className="comment-avatar">{c.author[0]}</span>
                        <strong>{c.author}</strong>
                        <time>
                          {new Date(c.createdAt).toLocaleDateString(undefined, {
                            month: "short",
                            day: "numeric",
                          })}
                        </time>
                      </header>
                      {c.elementId && (
                        <button
                          className="anchor-link"
                          onClick={() => {
                            const loc = locate(doc, c.elementId);
                            if (loc) select([c.elementId!], loc.page.id);
                          }}
                        >
                          <Icon name="layers" size={12} />
                          {locate(doc, c.elementId)?.item.name ??
                            "Removed element"}
                        </button>
                      )}
                      <p>{c.text}</p>
                      <button
                        className="resolve-button"
                        onClick={() =>
                          void apply([
                            {
                              type: "update_comment",
                              commentId: c.id,
                              patch: { resolved: !c.resolved },
                            },
                          ])
                        }
                      >
                        <Icon name="check" size={13} />
                        {c.resolved ? "Reopen" : "Resolve"}
                      </button>
                    </article>
                  ))}
                {!doc.comments.length && (
                  <div className="empty-note centered">
                    <Icon name="comment" size={27} />
                    <p>
                      Good work starts
                      <br />
                      with a conversation.
                    </p>
                  </div>
                )}
              </section>
            </>
          )}
          {tab === "history" && doc && (
            <>
              <div className="inspector-title">
                <div>
                  <span className="eyebrow">ROOM TO EXPLORE</span>
                  <h2>History & versions</h2>
                </div>
                <Icon name="clock" size={22} />
              </div>
              <section className="inspector-section">
                <div className="section-label">NAMED SNAPSHOTS</div>
                <input
                  aria-label="Snapshot name"
                  value={snapshotName}
                  onChange={(e) => setSnapshotName(e.target.value)}
                  placeholder="e.g. Ready for review"
                />
                <Button
                  className="subtle-primary full"
                  icon="plus"
                  onClick={() => void snapshot()}
                >
                  Save snapshot
                </Button>
                {snapshots.map((s) => (
                  <div className="snapshot-row" key={s.id}>
                    <div>
                      <strong>{s.name}</strong>
                      <small>Revision {s.revision}</small>
                    </div>
                    <Button
                      onClick={() => void restore(s)}
                      title={`Restore ${s.name}`}
                    >
                      Restore
                    </Button>
                  </div>
                ))}
              </section>
              <section className="inspector-section">
                <div className="section-label">EXPLORE A VARIATION</div>
                <p className="help">
                  Duplicate your current design and compare both side by side.
                </p>
                <Button className="full" icon="copy" onClick={variation}>
                  Create variation
                </Button>
                <select
                  aria-label="Compare with document"
                  value=""
                  onChange={(e) => {
                    const other = workspace?.documents.find(
                      (d) => d.id === e.target.value,
                    );
                    if (other) {
                      setCompare(other);
                      setModal("compare");
                    }
                  }}
                >
                  <option value="">Compare an existing design…</option>
                  {workspace?.documents
                    .filter((d) => d.id !== doc.id)
                    .map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                </select>
              </section>
              <section className="inspector-section">
                <div className="section-label">
                  SAVED CHANGES <span>r{doc.revision}</span>
                </div>
                <p className="help">
                  Undo one change at a time. Later unrelated edits stay in
                  place.
                </p>
                <div className="history-list">
                  {[...history].reverse().map((h) => (
                    <article key={h.operationId}>
                      <span
                        className={`history-dot ${h.actor.startsWith("browser:") ? "human" : ""}`}
                      />
                      <div>
                        <strong>{h.summary || "Document edited"}</strong>
                        <p>
                          {h.actor.startsWith("browser:")
                            ? "You in the browser"
                            : h.actor}{" "}
                          · r{h.revision}
                        </p>
                        <small>
                          {new Date(h.createdAt).toLocaleTimeString(undefined, {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </small>
                      </div>
                      <Button
                        title={`Undo revision ${h.revision}`}
                        icon={h.undoOf ? "redo" : "undo"}
                        onClick={() => void undo(h)}
                        disabled={busy}
                      />
                    </article>
                  ))}
                </div>
              </section>
            </>
          )}
        </aside>
      </main>
      {notice && (
        <div
          className={`toast ${notice.error ? "error" : ""}`}
          role={notice.error ? "alert" : "status"}
        >
          <Icon name={notice.error ? "comment" : "check"} size={17} />
          <span>{notice.text}</span>
          <Button
            icon="close"
            title="Dismiss notification"
            onClick={() => setNotice(undefined)}
          />
        </div>
      )}
      {modal && (
        <div
          className="modal-scrim"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget && doc) setModal(null);
          }}
        >
          <section
            className={`modal ${modal === "new" ? "new-modal" : modal === "compare" ? "compare-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "new"
                ? "Create a design"
                : modal === "export"
                  ? "Export design"
                  : "Compare variations"
            }
          >
            <header className="modal-header">
              <span className="eyebrow">
                {modal === "new"
                  ? "A NEW CHAPTER"
                  : modal === "export"
                    ? "READY TO GO"
                    : "ROOM FOR POSSIBILITY"}
              </span>
              <Button
                icon="close"
                title="Close dialog"
                onClick={() => setModal(null)}
              />
            </header>
            {modal === "new" ? (
              <>
                <h1>What will you make today?</h1>
                <p className="modal-intro">
                  A fresh canvas. A thoughtful starting point. Entirely yours.
                </p>
                <label className="field new-name">
                  <span>Design name</span>
                  <input
                    aria-label="New design name"
                    autoFocus
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                  />
                </label>
                <div className="template-grid">
                  {(workspace?.templates?.length
                    ? workspace.templates
                    : [
                        {
                          id: "blank",
                          name: "Blank canvas",
                          description: "Make space for something new.",
                        },
                      ]
                  ).map((t, i) => (
                    <button
                      key={t.id}
                      className={`template-card ${template === t.id ? "selected" : ""}`}
                      aria-label={`${t.name} ${t.description}`}
                      onClick={() => setTemplate(t.id)}
                    >
                      <div className={`template-art art-${i % 4}`}>
                        {t.id === "blank" ? (
                          <Icon name="plus" size={32} />
                        ) : (
                          <div className="real-template-preview">
                            <PageView
                              page={templatePreviews[t.id].pages[0]}
                              brand={templatePreviews[t.id].brand}
                            />
                          </div>
                        )}
                        <span className="template-check">
                          <Icon name="check" size={14} />
                        </span>
                      </div>
                      <strong>{t.name}</strong>
                      <p>{t.description}</p>
                    </button>
                  ))}
                </div>
                <footer className="modal-footer">
                  <button
                    className="import-link"
                    onClick={() => bundleInput.current?.click()}
                  >
                    <Icon name="download" size={15} />
                    Import a project bundle
                  </button>
                  <Button
                    className="primary"
                    icon="arrow"
                    onClick={() => void create()}
                    disabled={busy}
                  >
                    Create design
                  </Button>
                </footer>
              </>
            ) : modal === "export" ? (
              <>
                <h1>Take your design with you.</h1>
                <p className="modal-intro">
                  Export the saved design at revision {doc?.revision}. Your
                  original stays editable.
                </p>
                <div className="export-options">
                  {[
                    {
                      id: "pdf",
                      label: "PDF document",
                      note: "Print-ready, selectable text & links",
                    },
                    {
                      id: "png",
                      label: "PNG images",
                      note: "A vertical contact sheet of all pages",
                    },
                    {
                      id: "html",
                      label: "Standalone HTML",
                      note: "A portable document for the web",
                    },
                    {
                      id: "bundle",
                      label: "Editable project",
                      note: "Design, brand kit & original assets",
                    },
                  ].map((f) => (
                    <label
                      key={f.id}
                      className={exportFormat === f.id ? "selected" : ""}
                    >
                      <input
                        type="radio"
                        name="format"
                        value={f.id}
                        checked={exportFormat === f.id}
                        onChange={() => {
                          setExportFormat(f.id);
                          setExportResult(undefined);
                        }}
                      />
                      <div>
                        <strong>{f.label}</strong>
                        <small>{f.note}</small>
                      </div>
                      <span>{f.id.toUpperCase()}</span>
                    </label>
                  ))}
                </div>
                {exportResult && (
                  <div className="export-result">
                    <Icon name="check" />
                    <div>
                      <strong>Your export is ready.</strong>
                      <a
                        href={exportResult.url}
                        download={exportResult.filename}
                      >
                        Download {exportResult.filename}
                      </a>
                      <details>
                        <summary>Render diagnostics</summary>
                        <pre>
                          {JSON.stringify(exportResult.diagnostics, null, 2)}
                        </pre>
                      </details>
                    </div>
                  </div>
                )}
                <footer className="modal-footer">
                  <span className="help">
                    PDF and PNG use locally installed Chromium.
                  </span>
                  <Button
                    className="primary"
                    icon="download"
                    onClick={() => void exportDoc()}
                    disabled={busy}
                  >
                    {busy ? "Preparing export…" : "Create export"}
                  </Button>
                </footer>
              </>
            ) : doc && compare ? (
              <>
                <h1>A different direction.</h1>
                <p className="modal-intro">
                  Compare two independent designs. Changes to one leave the
                  other intact.
                </p>
                <div className="comparison">
                  <div>
                    <header>
                      <strong>{doc.name}</strong>
                      <span>Current · r{doc.revision}</span>
                    </header>
                    {doc.pages.map((p) => (
                      <div
                        className="compare-page-space"
                        key={p.id}
                        style={{
                          width: p.width * Math.min(420 / p.width, 0.5),
                          height: p.height * Math.min(420 / p.width, 0.5),
                        }}
                      >
                        <div
                          style={{
                            transform: `scale(${Math.min(420 / p.width, 0.5)})`,
                            transformOrigin: "top left",
                          }}
                        >
                          {pageView(p, doc)}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div>
                    <header>
                      <strong>{compare.name}</strong>
                      <Button
                        onClick={() => {
                          openDoc(compare);
                          setModal(null);
                        }}
                      >
                        Open variation <Icon name="arrow" size={14} />
                      </Button>
                    </header>
                    {compare.pages.map((p) => (
                      <div
                        className="compare-page-space"
                        key={p.id}
                        style={{
                          width: p.width * Math.min(420 / p.width, 0.5),
                          height: p.height * Math.min(420 / p.width, 0.5),
                        }}
                      >
                        <div
                          style={{
                            transform: `scale(${Math.min(420 / p.width, 0.5)})`,
                            transformOrigin: "top left",
                          }}
                        >
                          {pageView(p, compare)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}
          </section>
        </div>
      )}
    </div>
  );
}
async function base64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () =>
      reject(new Error("Could not read the selected file."));
    reader.readAsDataURL(file);
  });
}
createRoot(document.getElementById("root")!).render(<App />);
