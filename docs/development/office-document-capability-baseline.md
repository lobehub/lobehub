# Office document capability baseline and gap analysis

Status: design baseline for T-324\
Snapshot date: 2026-09-03\
Scope: PPTX, XLSX, and DOCX creation/import, editing, save, reopen, export/download, and fidelity. This document records requirements and gaps; it does not claim that missing editor capabilities have been implemented.

## 1. Executive finding

At this snapshot, the open-source LobeHub repository has a useful **file workflow**, not a full Office editor:

- Users can upload modern and legacy Office formats. Modern OOXML files (`.pptx`, `.xlsx`, `.docx`) can be previewed in the local-file portal; legacy `.ppt`, `.xls`, and `.doc` fall back to download or opening in the system application.
- Agents can read extracted text/data and can generate downloadable Office files through a sandbox/skill workflow. Generated files can be registered as durable Works.
- The visible repository has no in-app object/cell/rich-text editor, document-specific save model, Office-aware undo/redo stack, or round-trip serialization path. The current preview panes are read-only renderers.

Therefore, the current baseline does **not** meet the goal-level editing criteria. The largest gap is not individual toolbar commands; it is the absence of an editable, persisted Office document model and a lossless import-edit-export round trip for each format.

## 2. Evidence and confidence rules

Capability labels used below:

- **Available**: directly evidenced in repository code or official product documentation.
- **Partial**: a neighboring workflow exists but does not satisfy the complete user outcome.
- **Missing**: no implementation was found after targeted repository search, and the existing rendering architecture is read-only.
- **Needs runtime validation**: code supports the path, but fidelity/performance must be measured with the scenario suite.

Repository evidence:

1. The resource upload control accepts `.doc/.docx`, `.xls/.xlsx`, and `.ppt/.pptx` (`src/features/ResourceManager/components/Header/AddButton.tsx`, lines 28-38). The chat upload guard recognizes the three modern OOXML MIME types and the legacy Office MIME types (`src/store/file/slices/chat/uploadGuard.ts`, lines 91-103).
2. `DocumentPreview` maps only modern `.pptx`, `.xlsx`, and `.docx` MIME types to in-app preview panes; its own contract says legacy Office formats degrade to download/open externally (`src/features/Portal/LocalFile/DocumentPreview.tsx`, lines 401-425).
3. PPTX preview uses `@aiden0z/pptx-renderer`; DOCX preview uses `docx-preview`; XLSX preview loads with `exceljs` and renders a plain DOM table (`DocumentPreview.tsx`, lines 195-399). The spreadsheet pane shows cached formula results, not formula expressions, and caps preview at 500 rows (`DocumentPreview.tsx`, lines 281-342).
4. When preview parsing fails, users can download the blob or open a local file with the default application (`DocumentPreview.tsx`, lines 437-475).
5. File loaders are extraction-oriented: DOCX is converted to raw text with Mammoth; XLS/XLSX sheets become Markdown tables; PPTX slide XML is reduced to text paragraphs. These paths do not preserve an editable Office object model (`packages/file-loaders/src/loaders/{docx,excel,pptx}`).
6. The agent output path recognizes authored `.docx/.xlsx/.pptx` files and registers exported sandbox files as Works (`packages/builtin-tools/src/fileEditScan/index.ts`, lines 375-384; `apps/server/src/services/workRegistration/registerWorksForOperation.ts`, lines 137-177). This supports file delivery/version cards, not semantic in-app editing.
7. The public LobeHub docs describe Office upload as extraction, summarization, search, and spreadsheet data extraction, and describe sandbox output as generated downloadable files. They do not document an Office editor (`docs/usage/getting-started/file-upload.mdx`; `docs/usage/agent/sandbox.mdx`).

Targeted negative search used for the baseline:

```bash
rg -n --hidden -S "pptx|docx|xlsx|PowerPoint|Excel|Word|spreadsheet|presentation" \
  --glob '!node_modules' --glob '!pnpm-lock.yaml' --glob '!locales/**' .
```

The hits resolve to preview/rendering, extraction, upload, agent-generated files, and work registration. No Office-specific edit command surface or serializer was found. This is evidence of the open-source snapshot only; private cloud overrides must be assessed separately if they are in the acceptance environment.

## 3. External comparison baseline: ChatGPT/Codex

The comparison is deliberately capability-based rather than pixel-based, because availability varies by plan, workspace policy, connected apps, and surface.

Official OpenAI documentation current at the snapshot states that ChatGPT Work can create or edit documents, spreadsheets, and presentations from instructions, source material, existing files, or templates; it can preview/refine supported files in the desktop app; it can create/edit native Google Docs, Sheets, and Slides with the relevant connected app; and Codex can directly inspect/update an open Microsoft Excel workbook through the ChatGPT for Excel add-in. It also states that PowerPoint is not part of that direct desktop Work flow at launch. ChatGPT Canvas provides direct document editing and export to DOCX, PDF, and Markdown. Data Analysis accepts XLS/XLSX/CSV and creates tables/charts using code-backed analysis.

Primary sources:

- OpenAI Help, “Creating and editing documents, spreadsheets, and presentations with ChatGPT Work”: <https://help.openai.com/en/articles/20001278>
- OpenAI Help, “Data analysis with ChatGPT”: <https://help.openai.com/en/articles/8437071-data-analysis-with-chatgpt/>
- OpenAI Help, “What is the canvas feature in ChatGPT and how do I use it?”: <https://help.openai.com/en/articles/9930697>

The acceptance comparison must record the exact ChatGPT/Codex plan, version, platform, enabled skills/apps, and date. A capability unavailable due to policy or missing connector must be marked `N/A-environment`, not silently treated as a product failure.

## 4. Shared user journey and product contract

Each format must expose the same six-stage mental model:

1. **Create or import**: New blank file, template, prompt-generated file, drag/drop, picker, or existing Work version.
2. **Edit**: Select content directly, mutate it with predictable controls, and see the result immediately.
3. **Format/structure**: Apply format-specific styling and document structure without destroying unsupported content.
4. **Save**: Show `Saving`, `Saved`, and `Save failed`; save must create a recoverable revision.
5. **Reopen**: Close the editor, reopen the same Work/file, and restore content, format, selection-independent state, and document structure.
6. **Export/download**: Produce a standards-compliant OOXML file that opens in Microsoft Office and LibreOffice and visually matches the editor within stated tolerances.

Shared interaction requirements:

- One consistent entry point and toolbar grammar across all formats; format-specific tools may differ.
- Keyboard copy/paste, undo, redo, delete, and select-all use platform conventions.
- Destructive operations are undoable; irreversible fallback paths require confirmation.
- Autosave is debounced and revisioned. A failed save keeps local edits and offers retry/download-recovery.
- Unsupported imported features are never silently dropped. Show a compatibility warning and preserve untouched OOXML parts when possible.
- Reopen validation compares semantic content plus format-specific structure, not only screenshots.
- Export validation includes package integrity, application openability, semantic assertions, and visual comparison.

## 5. PPTX requirements and gaps

### Core flow

Create/import a 4-slide 16:9 deck → edit text → add/replace image → add and resize a shape → change chart data → move/resize objects → duplicate/delete/reorder slides → change a slide layout → undo/redo → save → close/reopen → export PPTX and PDF → compare preview and exports.

### Requirement and gap list

| ID     | Requirement                                                              | LobeHub snapshot                                                          | ChatGPT/Codex comparison baseline                                                         | Priority |
| ------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | -------- |
| PPT-01 | Create blank or generated multi-slide deck                               | Partial: agent can generate a file; no native blank-deck editor           | File creation supported through Work/Presentations                                        | P0       |
| PPT-02 | Import PPTX with masters/layouts/theme                                   | Partial: import + preview; no editable model                              | Existing files/templates can be edited; exact fidelity still scenario-tested              | P0       |
| PPT-03 | Add/edit/delete text, image, shape, and chart                            | Missing                                                                   | Artifact/file editing supported                                                           | P0       |
| PPT-04 | Move, resize, align, layer, and group objects                            | Missing                                                                   | File editing supported; exact commands must be observed at acceptance                     | P0       |
| PPT-05 | Add/delete/duplicate/reorder slides and change layout                    | Missing                                                                   | File editing/template workflows supported                                                 | P0       |
| PPT-06 | Preserve theme, master, layout, fonts, crop, chart data, and slide count | Preview only; needs runtime validation even before editing                | Reference/template preservation is an explicit Work workflow                              | P0       |
| PPT-07 | Save status, revision, reopen, undo/redo                                 | Missing as Office semantics; Works provide only file-level output history | Work supports refine cycles; persistence depends on cloud/local surface                   | P0       |
| PPT-08 | Export valid PPTX and PDF; visual parity                                 | Partial: agent-generated download exists; no editor export pipeline       | Work produces editable files; desktop direct PowerPoint control is not promised at launch | P0       |

PPTX constraints: accept `.pptx` as editable. Treat `.ppt` as import-only with explicit conversion. Preserve unknown OOXML parts where feasible. Embedded video/audio, macros, ActiveX, SmartArt, advanced animation, linked charts, uncommon fonts, and password protection are compatibility-risk features and must trigger a visible warning rather than silent loss.

## 6. XLSX requirements and gaps

### Core flow

Create/import a 3-sheet workbook → edit cells/ranges → fill/copy/paste → insert/delete/resize rows and columns → add/rename/reorder sheet → edit SUM/AVERAGE/IF/XLOOKUP and cross-sheet formulas → apply currency/percent/date formats, borders, fill, alignment, and conditional formatting → change chart data → undo/redo → save → close/reopen → export XLSX/CSV → recalculate and reconcile expected values.

### Requirement and gap list

| ID     | Requirement                                                         | LobeHub snapshot                                                   | ChatGPT/Codex comparison baseline                                             | Priority |
| ------ | ------------------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------- | -------- |
| XLS-01 | Create/import multi-sheet XLSX                                      | Partial: import/preview and generated output; no native editor     | Work creates/edits files; Excel add-in supports direct workbook control       | P0       |
| XLS-02 | Cell/range edit, copy/paste, fill, clear                            | Missing                                                            | Direct Excel control and spreadsheet artifact editing available where enabled | P0       |
| XLS-03 | Insert/delete/resize rows and columns                               | Missing                                                            | Comparison path available in Excel/Work                                       | P0       |
| XLS-04 | Add/rename/delete/reorder worksheets                                | Preview can switch sheets only; mutations missing                  | Comparison path available in Excel/Work                                       | P0       |
| XLS-05 | Formula authoring and recalculation                                 | Preview displays cached result only; no calculation engine/editing | Data Analysis and spreadsheet editing available                               | P0       |
| XLS-06 | Typed numbers/dates, number formats, styles, conditional formatting | Preview flattens cells to strings and plain table display          | Spreadsheet authoring preserves typed values and formatting                   | P0       |
| XLS-07 | Charts and chart-source updates                                     | Missing in preview/editor                                          | Charts can be created in analysis/spreadsheet flows                           | P1       |
| XLS-08 | Save/reopen with formula, result, format, sheet-order fidelity      | Missing as an edit path                                            | Work/Excel save path available; exact fidelity scenario-tested                | P0       |
| XLS-09 | Export valid XLSX and per-sheet CSV                                 | Partial generated-file download; no native editor export           | Work can produce spreadsheet files                                            | P0       |

XLSX constraints: `.xlsx` is the editable canonical format; `.xls` and CSV require explicit conversion. CSV is single-sheet and cannot preserve formulas, styles, charts, merges, or additional sheets, so export must warn and ask for a sheet. External links, macros, Power Query, pivot caches, data connections, array formulas, and protected sheets are compatibility-risk features. Formula locale must remain invariant internally, and cached results must be refreshed before export or clearly marked stale.

## 7. DOCX requirements and gaps

### Core flow

Create/import a multi-page document → edit and paste text → apply title/heading/body styles, font, alignment, spacing, and lists → edit table → replace/resize image → add/edit hyperlink → undo/redo → save → close/reopen → export DOCX and PDF → verify heading hierarchy, body text, list numbering, table geometry, image, and link.

### Requirement and gap list

| ID     | Requirement                                                                                  | LobeHub snapshot                                               | ChatGPT/Codex comparison baseline                               | Priority |
| ------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------- | -------- |
| DOC-01 | Create/import multi-page DOCX                                                                | Partial: import/preview and generated output; no native editor | Work/Documents creates/edits DOCX; Canvas exports DOCX          | P0       |
| DOC-02 | Rich text edit and copy/paste                                                                | Missing                                                        | Canvas supplies direct text editing; Work supplies file editing | P0       |
| DOC-03 | Heading/paragraph styles, font, alignment, spacing                                           | Missing                                                        | Direct document editing/export baseline exists                  | P0       |
| DOC-04 | Bulleted/numbered lists                                                                      | Preview only                                                   | Direct document editing baseline exists                         | P0       |
| DOC-05 | Tables, images, and hyperlinks                                                               | Preview only; loader extraction drops structure                | Work file editing baseline exists                               | P0       |
| DOC-06 | Preserve sections, headers/footers, numbering, styles, table geometry, image crop/alt, links | Preview needs runtime validation; extraction is lossy          | Existing-file/template workflow provides comparison surface     | P0       |
| DOC-07 | Save/reopen, revision, undo/redo                                                             | Missing as Office semantics                                    | Work/Canvas refine cycles available                             | P0       |
| DOC-08 | Export valid DOCX/PDF with visual parity                                                     | Partial generated-file download; no editor export pipeline     | Canvas exports DOCX/PDF; Work produces editable files           | P0       |

DOCX constraints: `.docx` is editable canonical format; `.doc`, `.odt`, and `.rtf` require explicit conversion. Track changes, comments, fields/TOC, footnotes/endnotes, floating shapes, section breaks, custom fonts, content controls, macros, password protection, and embedded objects are compatibility-risk features. Unsupported fields must retain their cached display text and must not disappear silently.

## 8. Cross-format reliability gates

The following are release-blocking for all three formats:

1. **Integrity**: OOXML is a valid ZIP package with required content types and relationships; Microsoft Office or LibreOffice opens it without repair prompts.
2. **Semantic fidelity**: all fixture sentinel strings, object/sheet/page counts, formulas, typed values, links, and required relationships survive save/reopen/export.
3. **Visual fidelity**: no missing object, overlap introduced by the editor, clipped required text, broken image, or material pagination/layout shift. Use format-specific golden renders, not cross-application pixel identity.
4. **State certainty**: the user can distinguish dirty/saving/saved/error/offline states; no navigation silently discards edits.
5. **Recovery**: undo/redo covers every listed mutation; failed save can retry; the last saved revision can be reopened; a recovery download is available when persistence fails.
6. **Performance**: baseline fixture interactive within 3 seconds on the reference machine; stress fixture must remain responsive with progress/cancellation. Exact budgets should be calibrated and then frozen before implementation sign-off.

## 9. Deliverables for repeatable acceptance

- `office-document-acceptance-scenarios.yaml` is the executable-style scenario catalog with setup, actions, checkpoints, and hard failure rules.
- `office-document-fixture-spec.md` defines deterministic fixture contents, sentinel values, expected formulas/totals, visual invariants, and generation/validation requirements.
- Existing lightweight repository seeds `packages/file-loaders/test/fixtures/test.pptx` and `test.docx` may continue to test extraction, but they are not substitutes for the richer acceptance fixtures. There is currently no XLSX fixture in that directory.

## 10. Recommended implementation sequence

1. Build shared document lifecycle primitives first: editable Work version, dirty/save/error states, revision reopen, undo/redo, compatibility warnings, and export job/recovery.
2. Deliver XLSX first because semantic correctness is machine-checkable and current preview loses formula/format semantics.
3. Deliver DOCX next around a schema that preserves OOXML round-trip data outside the editable subset.
4. Deliver PPTX around slide/object identity, master/layout preservation, and deterministic rendering.
5. Run the same scenario IDs against LobeHub and the accessible ChatGPT/Codex surface, recording environment metadata and evidence in a side-by-side result sheet.
