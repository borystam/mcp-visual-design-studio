import React, { useEffect, useRef, useState } from "react";
import type {
  DesignSystem,
  DesignSystemMapping,
  Document,
  DesignToken,
} from "../domain/model.js";
import { DesignComponentSchema } from "../domain/model.js";
import { SystemSpecimen } from "./SystemSpecimen.js";
import { SystemApplyPreview } from "./SystemApplyPreview.js";
import {
  SystemButton as Button,
  SystemField as Field,
  SystemMessage,
  useSystemDialog,
} from "./DesignSystemPrimitives.js";
import {
  systemFile,
  systemKey,
  systemReference,
  systemRequest,
  uploadSystemAsset,
  type SystemLibrary,
  type SystemPreview,
  type SystemReference,
} from "./design-system-api.js";
import "./design-systems.css";

const tokenTypes = [
  "color",
  "dimension",
  "number",
  "fontFamily",
  "fontWeight",
] as const;
const tokenText = (value: unknown) =>
  value && typeof value === "object" && "ref" in value
    ? `{${String(value.ref)}}`
    : String(value ?? "");
const nextVersion = (version: string) => {
  const [major, minor, patch] = version.split(/[.-]/).map(Number);
  return `${major || 1}.${minor || 0}.${(patch || 0) + 1}`;
};
const emptySystem = (): DesignSystem => ({
  id: crypto.randomUUID(),
  name: "Untitled design system",
  version: "1.0.0",
  tokens: {},
  fonts: [],
  components: [],
  guidelines: [],
  sources: [],
  assets: {},
});

export function DesignSystems({
  open,
  workspaceSignature,
  onClose,
  document,
  selectedIds,
  onLibraryChange,
  onApply,
}: {
  open: boolean;
  workspaceSignature: string;
  onClose: () => void;
  document?: Document;
  selectedIds: string[];
  onLibraryChange: () => Promise<void>;
  onApply: (
    reference: SystemReference,
    mapping: DesignSystemMapping,
    documentId: string,
  ) => Promise<Document | undefined>;
}) {
  const panel = useRef<HTMLElement>(null),
    importer = useRef<HTMLInputElement>(null),
    assetInput = useRef<HTMLInputElement>(null);
  const [library, setLibrary] = useState<SystemLibrary>({
    systems: [],
    defaultSystem: null,
  });
  const [draft, setDraft] = useState<DesignSystem>();
  const [review, setReview] = useState<SystemPreview>();
  const [reference, setReference] = useState<SystemReference>();
  const [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ message: string; error?: boolean }>();
  const [tab, setTab] = useState<
    "overview" | "tokens" | "assets" | "components" | "guidelines"
  >("overview");
  const [filter, setFilter] = useState("");
  const [componentJson, setComponentJson] = useState("[]"),
    [unappliedJson, setUnappliedJson] = useState(false);
  const [fontFamily, setFontFamily] = useState(""),
    [fontWeight, setFontWeight] = useState(400),
    [fontStyle, setFontStyle] = useState<"normal" | "italic">("normal"),
    [fontLicense, setFontLicense] = useState("");
  const [fontUnicodeRange, setFontUnicodeRange] = useState("");
  const [download, setDownload] = useState<{ url: string; filename: string }>();
  const [systemJson, setSystemJson] = useState("");
  const [unappliedSystemJson, setUnappliedSystemJson] = useState(false);
  const [applying, setApplying] = useState(false);
  useSystemDialog(open, panel, () =>
    applying ? setApplying(false) : onClose(),
  );
  const fail = (error: unknown) =>
    setNotice({
      message: error instanceof Error ? error.message : String(error),
      error: true,
    });
  async function reload() {
    setLibrary(await systemRequest<SystemLibrary>("/api/design-systems"));
    await onLibraryChange();
  }
  useEffect(() => {
    if (open) void reload().catch(fail);
  }, [open, workspaceSignature]);
  useEffect(() => {
    if (!unappliedSystemJson)
      setSystemJson(JSON.stringify(draft, null, 2) ?? "");
  }, [draft, unappliedSystemJson]);
  function change(update: (system: DesignSystem) => DesignSystem) {
    setDraft((old) => (old ? update(old) : old));
    setReview(undefined);
    setDownload(undefined);
  }
  function adopt(
    value: SystemPreview,
    editable: boolean,
    ref?: SystemReference,
  ) {
    setDraft(value.system);
    setReview(value);
    setEditing(editable);
    setReference(ref);
    setComponentJson(JSON.stringify(value.system.components, null, 2));
    setUnappliedJson(false);
    setUnappliedSystemJson(false);
    setDownload(undefined);
    setNotice(undefined);
  }
  async function choose(ref: SystemReference) {
    setBusy(true);
    try {
      const saved = await systemRequest<{
        system: DesignSystem;
        digest: string;
      }>(
        `/api/design-systems/${encodeURIComponent(ref.id)}/${encodeURIComponent(ref.version)}`,
      );
      const preview = await systemRequest<SystemPreview>(
        "/api/design-systems/preview",
        { system: saved.system },
      );
      adopt(preview, false, systemReference(saved.system, saved.digest));
      setTab("overview");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }
  async function importFiles(files: File[]) {
    setBusy(true);
    try {
      const result = await systemRequest<SystemPreview>(
        "/api/design-systems/preview",
        { files: await Promise.all(files.map(systemFile)) },
      );
      adopt(result, true);
      setTab("overview");
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }
  async function preview() {
    if (!draft || unappliedJson) return;
    setBusy(true);
    try {
      adopt(
        await systemRequest<SystemPreview>("/api/design-systems/preview", {
          system: draft,
        }),
        true,
      );
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    if (
      !review ||
      unappliedJson ||
      unappliedSystemJson ||
      review.validationErrors?.length
    )
      return;
    setBusy(true);
    try {
      const saved = await systemRequest<{
        system: DesignSystem;
        digest: string;
      }>("/api/design-systems", { system: review.system });
      setDraft(saved.system);
      setReference(systemReference(saved.system, saved.digest));
      setEditing(false);
      await reload();
      setNotice({
        message: `Saved ${saved.system.name} v${saved.system.version}. This version is immutable.`,
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }
  async function setDefault(value: SystemReference | null) {
    setBusy(true);
    try {
      await systemRequest("/api/design-systems/default", { system: value });
      await reload();
      setNotice({
        message: value
          ? "Workspace default updated. New designs will use this version."
          : "Workspace default cleared.",
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }
  async function uploadAssets(files: File[]) {
    setBusy(true);
    try {
      for (const file of files) {
        const font = /\.(woff2?|ttf|otf)$/i.test(file.name);
        if (font && !fontFamily.trim())
          throw new Error("Enter a font family name before uploading a font.");
        const asset = await uploadSystemAsset(file);
        change((system) => ({
          ...system,
          assets: { ...system.assets, [asset.id]: asset },
          ...(font
            ? {
                fonts: [
                  ...system.fonts,
                  {
                    family: fontFamily.trim(),
                    assetId: asset.id,
                    weight: fontWeight,
                    style: fontStyle,
                    ...(fontLicense.trim()
                      ? { license: fontLicense.trim() }
                      : {}),
                    ...(fontUnicodeRange.trim()
                      ? { unicodeRange: fontUnicodeRange.trim() }
                      : {}),
                  },
                ],
              }
            : {}),
        }));
      }
      setNotice({
        message: "Files added to the draft. Review the specimen before saving.",
      });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  }
  if (!open) return null;
  const isDefault =
    !!reference && library.defaultSystem?.digest === reference.digest;
  const tokens = Object.entries(draft?.tokens ?? {});
  const visibleTokens = tokens
    .filter(([path]) => path.toLowerCase().includes(filter.toLowerCase()))
    .slice(0, 100);
  return (
    <section
      ref={panel}
      className="ds-workspace"
      role="dialog"
      aria-modal="true"
      aria-label="Design Systems library"
    >
      <input
        ref={importer}
        hidden
        type="file"
        multiple
        accept=".json,.css,.zip"
        aria-label="Import design system files"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) void importFiles(files);
        }}
      />
      <input
        ref={assetInput}
        hidden
        type="file"
        multiple
        accept=".woff,.woff2,.ttf,.otf,image/png,image/jpeg,image/webp,image/svg+xml"
        aria-label="Upload system assets"
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          event.target.value = "";
          if (files.length) void uploadAssets(files);
        }}
      />
      <header className="ds-header" inert={applying}>
        <div>
          <span className="eyebrow">WORKSPACE LIBRARY</span>
          <h1>
            Design Systems<span className="ds-period">.</span>
          </h1>
        </div>
        <div className="ds-actions">
          <Button disabled={busy} onClick={() => importer.current?.click()}>
            Import system
          </Button>
          <Button onClick={onClose} aria-label="Close Design Systems">
            Back to canvas ↗
          </Button>
        </div>
      </header>
      <div className="ds-layout" inert={applying}>
        <aside className="ds-library">
          <div className="ds-library-heading">
            <span>SAVED VERSIONS</span>
            <span>{library.systems.length}</span>
          </div>
          <Button
            className="full"
            disabled={busy}
            onClick={() => {
              const value = emptySystem();
              setDraft(value);
              setReference(undefined);
              setReview(undefined);
              setEditing(true);
              setComponentJson("[]");
              setUnappliedJson(false);
              setTab("overview");
              setNotice(undefined);
            }}
          >
            + New system
          </Button>
          <div className="ds-system-list">
            {library.systems.map((system) => (
              <button
                className={`ds-system-card ${reference && systemKey(reference) === systemKey(system) ? "selected" : ""}`}
                key={systemKey(system)}
                onClick={() => void choose(system)}
                disabled={busy}
                aria-label={`Open ${system.name} version ${system.version}`}
              >
                <span className="ds-system-mark">
                  {system.name.slice(0, 1).toUpperCase()}
                </span>
                <strong>{system.name}</strong>
                <small>
                  v{system.version} · {system.tokenCount} tokens
                </small>
                {library.defaultSystem?.digest === system.digest && (
                  <span className="ds-badge">DEFAULT</span>
                )}
              </button>
            ))}
          </div>
          {!library.systems.length && (
            <p className="ds-help">
              Your saved systems will live here. Each version can travel with
              its fonts, assets and reusable components.
            </p>
          )}
          <div className="ds-local-note">
            <strong>Bring your own source.</strong>
            <p>
              Import portable systems, DTCG token JSON, CSS or a source ZIP.
              Your host agent can translate reference files and register a
              system through MCP.
            </p>
            <p>Source code is inspected as data and never executed.</p>
          </div>
        </aside>
        {!draft ? (
          <div className="ds-welcome">
            <div className="ds-welcome-mark">
              <i />
              <i />
              <i />
            </div>
            <span className="eyebrow">A COMMON DESIGN LANGUAGE</span>
            <h2>
              Bring the rules.
              <br />
              Make it your own.
            </h2>
            <p>
              Keep colors, type, reusable components and working guidelines
              together. Preview what was extracted, resolve gaps, and save a
              version you can trust.
            </p>
            <Button primary onClick={() => importer.current?.click()}>
              Import your first system
            </Button>
            <span className="ds-caption">
              JSON · design tokens · CSS · source ZIP
            </span>
          </div>
        ) : (
          <>
            <div className="ds-editor">
              <div className="ds-draft-heading">
                <div>
                  <span className="eyebrow">
                    {editing ? "WORKING DRAFT" : "IMMUTABLE VERSION"}
                  </span>
                  <h2>{draft.name || "Untitled system"}</h2>
                  <span className="ds-caption">
                    v{draft.version}
                    {editing ? " · review before saving" : " · saved locally"}
                  </span>
                </div>
                {!editing && (
                  <Button
                    onClick={() => {
                      setDraft({
                        ...draft,
                        version: nextVersion(draft.version),
                      });
                      setEditing(true);
                      setReference(undefined);
                      setReview(undefined);
                    }}
                  >
                    Create new version
                  </Button>
                )}
              </div>
              <div
                className="ds-tabs"
                role="tablist"
                aria-label="System sections"
              >
                {(
                  [
                    "overview",
                    "tokens",
                    "assets",
                    "components",
                    "guidelines",
                  ] as const
                ).map((name) => (
                  <button
                    role="tab"
                    aria-selected={tab === name}
                    key={name}
                    onClick={() => setTab(name)}
                  >
                    {name[0].toUpperCase() + name.slice(1)}
                    {name === "tokens" && <small>{tokens.length}</small>}
                  </button>
                ))}
              </div>
              {notice && (
                <SystemMessage error={notice.error}>
                  {notice.message}
                </SystemMessage>
              )}
              <fieldset className="ds-fields" disabled={!editing || busy}>
                {tab === "overview" && (
                  <>
                    <div className="ds-two-fields">
                      <Field
                        label="System name"
                        value={draft.name}
                        onCommit={(name) =>
                          change((system) => ({ ...system, name }))
                        }
                      />
                      <Field
                        label="System version"
                        value={draft.version}
                        onCommit={(version) =>
                          change((system) => ({ ...system, version }))
                        }
                      />
                    </div>
                    <p className="ds-help">
                      Versions are immutable. Create a new version to evolve a
                      saved system. Documents keep the version they were created
                      with until you apply another one.
                    </p>
                    <div className="ds-section-heading">SEMANTIC ROLES</div>
                    <p className="ds-help">
                      Connect tokens to their intended use. Roles guide new
                      designs; existing literal styles change only when you
                      explicitly map them.
                    </p>
                    <div className="ds-role-grid">
                      {(
                        [
                          ["primaryColor", "Primary color", "color"],
                          ["accentColor", "Accent color", "color"],
                          ["pageBackground", "Page background", "color"],
                          ["headingFont", "Heading font", "fontFamily"],
                          ["bodyFont", "Body font", "fontFamily"],
                        ] as const
                      ).map(([role, label, type]) => (
                        <label className="field" key={role}>
                          <span>{label}</span>
                          <select
                            aria-label={`${label} role`}
                            value={draft.roles?.[role] ?? ""}
                            onChange={(event) => {
                              const path = event.target.value;
                              change((system) => ({
                                ...system,
                                roles: {
                                  ...system.roles,
                                  [role]: path || undefined,
                                },
                              }));
                            }}
                          >
                            <option value="">No role assigned</option>
                            {tokens
                              .filter(([, token]) => token.type === type)
                              .map(([path]) => (
                                <option key={path} value={path}>
                                  {path}
                                </option>
                              ))}
                          </select>
                        </label>
                      ))}
                    </div>
                    <div className="ds-section-heading">SYSTEM CHECKS</div>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={draft.rules?.requireTokenBindings ?? false}
                        onChange={(event) => {
                          const requireTokenBindings = event.target.checked;
                          change((system) => ({
                            ...system,
                            rules: { ...system.rules, requireTokenBindings },
                          }));
                        }}
                      />
                      Flag unbound literal styles
                    </label>
                    <Field
                      label="Minimum text size"
                      value={String(draft.rules?.minimumFontSize ?? "")}
                      onCommit={(value) =>
                        change((system) => ({
                          ...system,
                          rules: {
                            ...system.rules,
                            minimumFontSize: value ? Number(value) : undefined,
                          },
                        }))
                      }
                    />
                    {!!draft.sources.length && (
                      <div className="ds-sources">
                        <div className="ds-section-heading">
                          SOURCE REFERENCES
                        </div>
                        {draft.sources.map((source, i) => (
                          <p key={i}>
                            <strong>{source.name}</strong>
                            {source.url && <span>{source.url}</span>}
                          </p>
                        ))}
                      </div>
                    )}
                  </>
                )}
                {tab === "tokens" && (
                  <>
                    <div className="ds-token-tools">
                      <input
                        aria-label="Find a token"
                        placeholder="Filter token paths…"
                        value={filter}
                        onChange={(event) => setFilter(event.target.value)}
                      />
                      <Button
                        onClick={() => {
                          let path = "color.new",
                            index = 2;
                          while (draft.tokens[path])
                            path = `color.new_${index++}`;
                          change((system) => ({
                            ...system,
                            tokens: {
                              ...system.tokens,
                              [path]: { type: "color", value: "#315448" },
                            },
                          }));
                        }}
                      >
                        + Color token
                      </Button>
                    </div>
                    <p className="ds-help">
                      Use <code>{"{token.path}"}</code> to reference another
                      token. Reference gaps are reported during preview.
                    </p>
                    <div className="ds-token-table">
                      <div className="ds-token-head">
                        <span>Token path</span>
                        <span>Type</span>
                        <span>Value / reference</span>
                        <span />
                      </div>
                      {visibleTokens.map(([path, token]) => (
                        <div className="ds-token-row" key={path}>
                          <code>{path}</code>
                          <select
                            aria-label={`Type for ${path}`}
                            value={token.type}
                            onChange={(event) => {
                              const type = event.target
                                .value as typeof token.type;
                              change((system) => ({
                                ...system,
                                tokens: {
                                  ...system.tokens,
                                  [path]: {
                                    type,
                                    value:
                                      type === "color"
                                        ? "#315448"
                                        : type === "fontFamily"
                                          ? "Inter"
                                          : type === "fontWeight"
                                            ? 400
                                            : 16,
                                  } as DesignToken,
                                },
                              }));
                            }}
                          >
                            {tokenTypes.map((type) => (
                              <option key={type}>{type}</option>
                            ))}
                          </select>
                          <div className="ds-token-value">
                            {token.type === "color" &&
                              typeof token.value === "string" &&
                              /^#[0-9a-f]{3,8}$/i.test(token.value) && (
                                <i style={{ background: token.value }} />
                              )}
                            <Field
                              label={`Value for ${path}`}
                              value={tokenText(token.value)}
                              onCommit={(input) => {
                                const match = input.match(/^\{(.+)\}$/);
                                const value = match
                                  ? { ref: match[1] }
                                  : [
                                        "dimension",
                                        "number",
                                        "fontWeight",
                                      ].includes(token.type)
                                    ? Number(input)
                                    : input;
                                change((system) => ({
                                  ...system,
                                  tokens: {
                                    ...system.tokens,
                                    [path]: { ...token, value } as DesignToken,
                                  },
                                }));
                              }}
                            />
                          </div>
                          <Button
                            aria-label={`Delete token ${path}`}
                            onClick={() =>
                              change((system) => {
                                const tokens = { ...system.tokens };
                                delete tokens[path];
                                return { ...system, tokens };
                              })
                            }
                          >
                            ×
                          </Button>
                        </div>
                      ))}
                    </div>
                    {!visibleTokens.length && (
                      <p className="ds-help">
                        No matching tokens. Add a color token or import a token
                        file.
                      </p>
                    )}
                    {tokens.length > 100 && (
                      <p className="ds-help">
                        Showing up to 100 matches. Filter by path to find a
                        specific token.
                      </p>
                    )}
                  </>
                )}
                {tab === "assets" && (
                  <>
                    <div className="ds-section-heading">
                      FONTS & ORIGINAL ASSETS
                    </div>
                    <p className="ds-help">
                      Files stay local and travel in portable system exports.
                      Set the font metadata below before uploading a font.
                      Upload only files you have permission to use and
                      distribute.
                    </p>
                    <div className="ds-two-fields">
                      <Field
                        label="Font family name"
                        value={fontFamily}
                        onCommit={setFontFamily}
                        placeholder="e.g. Studio Sans"
                      />
                      <label className="field">
                        <span>Font weight</span>
                        <select
                          aria-label="Font weight"
                          value={fontWeight}
                          onChange={(event) =>
                            setFontWeight(Number(event.target.value))
                          }
                        >
                          {[100, 200, 300, 400, 500, 600, 700, 800, 900].map(
                            (weight) => (
                              <option key={weight}>{weight}</option>
                            ),
                          )}
                        </select>
                      </label>
                    </div>
                    <div className="ds-two-fields">
                      <label className="field">
                        <span>Font style</span>
                        <select
                          aria-label="Font style"
                          value={fontStyle}
                          onChange={(event) =>
                            setFontStyle(
                              event.target.value as "normal" | "italic",
                            )
                          }
                        >
                          <option>normal</option>
                          <option>italic</option>
                        </select>
                      </label>
                      <Field
                        label="Font license reference"
                        value={fontLicense}
                        onCommit={setFontLicense}
                        placeholder="License name, file or permission reference"
                      />
                    </div>
                    <Button primary onClick={() => assetInput.current?.click()}>
                      Upload fonts or assets
                    </Button>
                    <Field
                      label="Font Unicode range (optional)"
                      value={fontUnicodeRange}
                      onCommit={setFontUnicodeRange}
                      placeholder="e.g. U+0000-00FF; empty uses the full font"
                    />
                    <div className="ds-asset-list">
                      {draft.fonts.map((font, i) => (
                        <article key={`${font.assetId}-${i}`}>
                          <span className="ds-font-mark">Aa</span>
                          <div>
                            <strong>{font.family}</strong>
                            <small>
                              {font.weight} · {font.style}
                              {font.license ? ` · ${font.license}` : ""}
                            </small>
                            <Field
                              label={`Unicode range for ${font.family} ${font.weight} face ${i + 1}`}
                              value={font.unicodeRange ?? ""}
                              onCommit={(unicodeRange) =>
                                change((system) => ({
                                  ...system,
                                  fonts: system.fonts.map((face, index) =>
                                    index === i
                                      ? {
                                          ...face,
                                          unicodeRange:
                                            unicodeRange.trim() || undefined,
                                        }
                                      : face,
                                  ),
                                }))
                              }
                            />
                          </div>
                          <Button
                            aria-label={`Remove font ${font.family} ${font.weight}`}
                            onClick={() =>
                              change((system) => ({
                                ...system,
                                fonts: system.fonts.filter(
                                  (_, index) => index !== i,
                                ),
                              }))
                            }
                          >
                            ×
                          </Button>
                        </article>
                      ))}
                      {Object.values(draft.assets)
                        .filter((asset) => asset.mime.startsWith("image/"))
                        .map((asset) => (
                          <article key={asset.id}>
                            <img
                              src={`/api/assets/${encodeURIComponent(asset.id)}`}
                              alt=""
                            />
                            <div>
                              <strong>{asset.name}</strong>
                              <small>
                                {asset.mime} · {Math.ceil(asset.bytes / 1024)}{" "}
                                KB
                              </small>
                            </div>
                          </article>
                        ))}
                    </div>
                  </>
                )}
                {tab === "components" && (
                  <>
                    <div className="ds-section-heading">
                      REUSABLE COMPONENTS <span>{draft.components.length}</span>
                    </div>
                    <p className="ds-help">
                      Components are declarative element trees with named
                      variants and text or image slots. Your host agent can help
                      translate source components into this editable format.
                    </p>
                    <div className="ds-component-overview">
                      {draft.components.map((component) => (
                        <article key={component.id}>
                          <strong>{component.name}</strong>
                          <p>{component.description}</p>
                          <small>
                            {Object.keys(component.variants).length} variants ·{" "}
                            {Object.keys(component.slots).length} slots
                          </small>
                          <div>
                            {Object.entries(component.slots).map(
                              ([id, slot]) => (
                                <span className="ds-chip" key={id}>
                                  {id} · {slot.type}
                                </span>
                              ),
                            )}
                          </div>
                        </article>
                      ))}
                    </div>
                    <label className="field">
                      <span>Component definitions</span>
                      <textarea
                        className="ds-code"
                        aria-label="Component definitions JSON"
                        rows={16}
                        value={componentJson}
                        onChange={(event) => {
                          setComponentJson(event.target.value);
                          setUnappliedJson(true);
                        }}
                      />
                    </label>
                    <Button
                      disabled={!unappliedJson}
                      onClick={() => {
                        try {
                          const components =
                            DesignComponentSchema.array().parse(
                              JSON.parse(componentJson),
                            );
                          change((system) => ({ ...system, components }));
                          setUnappliedJson(false);
                          setNotice({
                            message:
                              "Component draft updated. Review to validate element trees, variants and slot references.",
                          });
                        } catch (error) {
                          fail(error);
                        }
                      }}
                    >
                      Update component draft
                    </Button>
                    {unappliedJson && (
                      <p className="ds-help">
                        Apply these JSON edits to the draft before reviewing or
                        saving.
                      </p>
                    )}
                  </>
                )}
                {tab === "guidelines" && (
                  <>
                    <Field
                      label="Design guidelines"
                      multiline
                      rows={12}
                      value={draft.guidelines.join("\n")}
                      onCommit={(value) =>
                        change((system) => ({
                          ...system,
                          guidelines: value
                            .split("\n")
                            .map((line) => line.trim())
                            .filter(Boolean),
                        }))
                      }
                    />
                    <p className="ds-help">
                      One guideline per line. These travel with the design
                      system and are available to your host agent. They do not
                      execute code or trigger a model.
                    </p>
                  </>
                )}
                {tab === "overview" && (
                  <details className="ds-advanced">
                    <summary>Advanced normalized system JSON</summary>
                    <p className="ds-help">
                      Use this to repair references or edit token paths and
                      metadata. Review validates the draft without executing
                      imported code.
                    </p>
                    <textarea
                      className="ds-code"
                      aria-label="Normalized design system JSON"
                      rows={16}
                      value={systemJson}
                      onChange={(event) => {
                        setSystemJson(event.target.value);
                        setUnappliedSystemJson(true);
                      }}
                    />
                    <Button
                      disabled={busy || !unappliedSystemJson}
                      onClick={async () => {
                        setBusy(true);
                        try {
                          adopt(
                            await systemRequest<SystemPreview>(
                              "/api/design-systems/preview",
                              { system: JSON.parse(systemJson) },
                            ),
                            true,
                          );
                        } catch (error) {
                          fail(error);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      Review system JSON
                    </Button>
                    {unappliedSystemJson && (
                      <p className="ds-help">
                        Review these JSON changes before saving.
                      </p>
                    )}
                  </details>
                )}
              </fieldset>
              <footer className="ds-editor-footer">
                {editing ? (
                  <>
                    <span>
                      {review ? "Review current" : "Preview needs refresh"}
                    </span>
                    <Button
                      disabled={busy || unappliedJson || unappliedSystemJson}
                      onClick={() => void preview()}
                    >
                      Review & preview
                    </Button>
                    <Button
                      primary
                      disabled={
                        busy ||
                        !review ||
                        unappliedJson ||
                        unappliedSystemJson ||
                        !!review?.validationErrors?.length
                      }
                      onClick={() => void save()}
                    >
                      Save immutable version
                    </Button>
                  </>
                ) : (
                  <>
                    <span>
                      {isDefault
                        ? "Workspace default"
                        : "Available in this workspace"}
                    </span>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void setDefault(isDefault ? null : reference!)
                      }
                    >
                      {isDefault ? "Clear default" : "Use as workspace default"}
                    </Button>
                    <Button
                      disabled={busy}
                      onClick={() => {
                        if (reference)
                          void systemRequest<{ url: string; filename: string }>(
                            "/api/design-systems/export",
                            reference,
                          )
                            .then(setDownload)
                            .catch(fail);
                      }}
                    >
                      Export system
                    </Button>
                  </>
                )}
              </footer>
              {download && (
                <div className="ds-download">
                  <a href={download.url} download={download.filename}>
                    Download {download.filename}
                  </a>
                  <span>
                    Includes tokens, components, fonts and original assets.
                  </span>
                </div>
              )}
            </div>
            <aside className="ds-review">
              {review ? (
                <>
                  <SystemSpecimen document={review.specimen} />
                  <div className="ds-section-heading">
                    IMPORT & VALIDATION NOTES
                  </div>
                  {!!review.validationErrors?.length && (
                    <SystemMessage error>
                      <strong>Resolve before saving</strong>
                      <ul>
                        {review.validationErrors.map((error, index) => (
                          <li key={index}>{error}</li>
                        ))}
                      </ul>
                    </SystemMessage>
                  )}
                  {review.warnings.length ? (
                    <ul className="ds-warning-list">
                      {review.warnings.map((warning, i) => (
                        <li key={i}>{warning}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="ds-help">No import warnings reported.</p>
                  )}
                  <details>
                    <summary>Extraction report</summary>
                    <pre className="ds-report">
                      {JSON.stringify(review.report, null, 2)}
                    </pre>
                  </details>
                </>
              ) : (
                <div className="ds-preview-empty">
                  <span>Aa</span>
                  <strong>Review your draft.</strong>
                  <p>
                    Generate a specimen and inspect references before saving
                    this version.
                  </p>
                </div>
              )}
              {!editing && reference && document && (
                <div className="ds-apply-card">
                  <strong>Use in “{document.name}”</strong>
                  <p>
                    Preview the saved version and choose explicit token
                    mappings. Existing literal styles remain intact.
                  </p>
                  <Button
                    primary
                    className="full"
                    onClick={() => setApplying(true)}
                  >
                    Preview application
                  </Button>
                </div>
              )}
            </aside>
          </>
        )}
      </div>
      {applying && reference && draft && document && (
        <SystemApplyPreview
          document={document}
          system={draft}
          reference={reference}
          selectedIds={selectedIds}
          onClose={() => setApplying(false)}
          onApply={async (mapping) => {
            const saved = await onApply(reference, mapping, document.id);
            if (saved) {
              setApplying(false);
              setNotice({
                message: `Applied ${draft.name} v${draft.version} to ${saved.name}.`,
              });
            }
          }}
        />
      )}
    </section>
  );
}
