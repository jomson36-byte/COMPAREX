# COMPAREX - Agent Guide

## Product mission

COMPAREX is a professional document review workspace for opening, viewing, comparing, and annotating multiple PDF files. Users can add documents to a workspace, open them in either review pane, highlight text or page areas, and create explicit links between highlights or structured table rows.

COMPAREX organizes review evidence and relationships. It must communicate clarity, accuracy, efficiency, control, and trust, and it must not make legal, technical, compliance, or factual judgments on the user's behalf.

## Product principles

1. **Keep documents flexible.** Files do not have fixed roles such as Original, Revised, TOR, or Evidence.
2. **Show source context.** Every highlight and link must remain traceable to its document, page, and location.
3. **Make relationships explicit.** Links are created or confirmed by the reviewer and must be visible, navigable, and removable.
4. **Keep the reviewer in control.** Never infer approval, compliance, correctness, or equivalence from a highlight or link.
5. **Prefer clarity over feature density.** Important review items should be obvious without making the interface visually noisy.
6. **Preserve workspace state.** Keep open files, pane assignments, highlights, links, table rows, zoom, and navigation state when practical.
7. **Fail honestly.** Unsupported, unreadable, password-protected, scanned, or partially rendered files must be identified clearly.
8. **Treat documents as sensitive data.** Minimize retention, logging, exposure, and unnecessary transmission.

## MVP scope

Build a flexible PDF review workspace:

- Add one or more PDF files through file selection or drag and drop.
- Show all workspace files in a document list similar to an editor workspace.
- Open and switch documents independently in either review pane.
- Display two PDF documents side by side with an adjustable divider.
- Allow the same document or different documents to be opened in each pane.
- Show filename, file type, page count, and rendering status.
- Provide zoom and page navigation for each pane.
- Highlight selected text or rectangular page areas.
- Create links between a PDF highlight and another PDF highlight.
- Create links between a PDF highlight and a row in a workspace table.
- Show linked and unlinked states without implying pass or fail.
- Navigate from a table row or highlight to its linked source location.
- Rename, reorder, open, close, replace, and remove workspace files.
- Export annotated PDF files when the source PDF can be processed safely.
- Preserve workspace metadata and review state locally when practical.
- Preserve readable layout across desktop screen sizes and usable tablet widths.
- Report unsupported, malformed, encrypted, or unreadable PDFs clearly.

DOCX rendering is outside the current scope. DOCX files must not be presented as supported until rendering and review behavior are implemented and verified.

Automatic semantic comparison, OCR, automatic requirement extraction, and automatic compliance decisions are outside the MVP. Do not claim these capabilities until they are implemented and verified.

## Workspace model

Use neutral terminology consistently:

- **Workspace document**: any PDF file added to the current workspace.
- **Review pane**: a document viewer that can open any workspace document.
- **Highlight**: a reviewer-created text selection or rectangular page-area mark.
- **Table row**: a structured review item created or imported by the user.
- **Link**: an explicit relationship between two review items.
- **Linked**: an item with at least one valid relationship.
- **Unlinked**: an item without a relationship.
- **Unresolved**: a relationship whose source document or source location is unavailable.

Do not assign fixed semantic roles to the left and right panes. Labels such as TOR, requirement, evidence, original, or revised may be user-defined workspace content, but they must not be assumptions in the core document model.

Every highlight should retain:

- source document identity;
- page number;
- selected text or page-area coordinates where available;
- optional reviewer note;
- links to other highlights or table rows.

Every link must be navigable and removable by the reviewer. Never hide uncertainty or missing source information behind a binary pass/fail result.

## UX requirements

- Desktop-first for the primary review workspace; remain usable on tablets.
- Use a stable two-column split view with an adjustable divider and independent document selection in each pane.
- Keep the workspace file list easy to scan and make opening a file feel similar to an editor workspace.
- Keep document controls close to the pane they affect.
- Use color and a second signal such as labels, underlines, patterns, or icons. Color alone is insufficient.
- Maintain keyboard navigation and visible focus states.
- Meet WCAG 2.2 AA contrast targets.
- Avoid modal dialogs for routine navigation.
- Preserve the user's open documents, pane assignments, page, zoom, scroll, table, and filter state whenever practical.
- Confirm destructive actions such as removing an uploaded file or clearing a session.
- Loading states must explain the current stage, such as opening, validating, or rendering.
- Empty and error states must tell the user what happened and what they can do next.

## Brand and visual system

Brand character: quiet professional technology—precise, calm, intelligent, modern, and approachable.

Core palette:

- Deep Ink: `#111827`
- Paper White: `#F8FAFC`
- Compare Teal: `#14B8A6`
- Change Blue: `#3B82F6`
- Signal Amber: `#F59E0B` for attention states only

Typography:

- Latin UI: Inter or Manrope.
- Thai UI: LINE Seed Sans TH or IBM Plex Sans Thai.
- Use tabular numerals for page numbers, counts, and measurements when available.

Visual rules:

- Favor neutral surfaces, restrained borders, deliberate spacing, and crisp typography.
- Use Teal and Blue to distinguish panes, highlights, or link types; do not let either imply correct/incorrect.
- Reserve Amber for items needing review—not generic decoration.
- Avoid gradients, glow, glass effects, AI sparkles, playful illustrations, cybersecurity styling, and decorative animation.
- Motion must clarify state changes and respect `prefers-reduced-motion`.
- The COMPAREX symbol should remain recognizable at 16 px and in monochrome.

## Content design

- Use concise, factual language.
- Never say "No differences," "Matched," or similar when the system only knows that items were linked. Say exactly what the reviewer marked or what the system processed.
- Avoid implying legal approval, compliance certification, or factual correctness.
- Prefer "Review complete" over "Approved."
- Prefer "Unresolved" when a source file or location is unavailable.
- File-processing errors should identify the affected file and preserve the other file when possible.
- Design English and Thai copy together; do not assume English string length.

## Architecture expectations

- Keep workspace state, document ingestion, rendering, highlighting, linking, table data, and export as separable modules.
- Use explicit typed contracts between stages.
- Keep original file bytes immutable.
- Derive previews and extracted representations as versioned artifacts.
- Ensure highlights and links can be traced back to source page coordinates.
- Run expensive parsing, rendering, and export work outside the interactive rendering loop.
- Use cancellable jobs and idempotent processing where practical.
- Keep document adapters explicit even while the current product supports PDF only.
- Model links as a graph that supports highlight-to-highlight and highlight-to-row relationships.
- Prefer deterministic review behavior. If probabilistic or model-based processing is introduced, isolate it and expose uncertainty.

Suggested domain boundary:

```text
Workspace
  -> DocumentRegistry
  -> DocumentAdapter
  -> PDFRenderer
  -> HighlightStore
  -> LinkGraph
  -> TableModel
  -> ReviewUI
  -> Exporter
```

## Privacy and security

- Assume every uploaded document is confidential.
- Do not log document content, extracted text, filenames, signed URLs, or access tokens in production logs.
- Validate MIME type and file signature; do not trust file extensions alone.
- Enforce file-size, page-count, decompression, and processing-time limits.
- Scan or sandbox untrusted documents before parsing when infrastructure supports it.
- Prevent path traversal, formula injection, script execution, embedded-file abuse, and unsafe archive expansion.
- Encrypt files in transit and at rest.
- Define and surface a retention policy. Delete temporary artifacts when their purpose expires.
- Never send document content to a third-party service without explicit product approval and user-facing disclosure.
- Avoid exposing sequential document IDs or predictable download URLs.

## Engineering standards

- Follow the repository’s existing framework, package manager, formatting, linting, and test conventions.
- Inspect the codebase before introducing a new dependency or architectural pattern.
- Prefer small, composable functions and explicit names over clever abstractions.
- Avoid broad refactors unless required by the task.
- Do not modify unrelated user work or generated lockfiles without cause.
- Treat warnings as actionable; do not silence them globally.
- Keep accessibility, error handling, and loading behavior in the same change as the feature—not as later cleanup.
- Add comments only where intent or a non-obvious constraint would otherwise be lost.
- Never commit secrets, real customer documents, or sensitive extracted content.

## Testing requirements

Changes are not complete until relevant checks pass.

At minimum, cover:

- adding multiple PDFs and switching the document in each pane;
- opening the same PDF or different PDFs in both panes;
- text highlights and rectangular area highlights;
- links between highlights in different files;
- links between highlights and table rows;
- navigation from links to their source page and location;
- removing a highlight and handling its related links correctly;
- removing, replacing, renaming, and reordering workspace files;
- restoring workspace state when one or more files no longer have permission;
- annotations containing mixed Thai and English text;
- Unicode normalization, ligatures, and unusual whitespace;
- scanned/image-only, malformed, encrypted, oversized, and unsupported PDFs;
- annotated PDF export and partial export failures;
- keyboard-only use and screen-reader labels;
- light mode, dark mode, high zoom, and narrow layouts.

Use synthetic or approved fixtures. Never add customer documents to the repository.

## Performance targets

- Keep the initial interface responsive while documents process.
- Render only visible or nearby pages for long documents.
- Avoid loading an entire large document into the browser when streaming or pagination is possible.
- Keep independent pane scrolling responsive and prevent navigation feedback loops.
- Measure before optimizing, but treat memory growth and UI blocking as defects.
- Show progress for operations that are not effectively instant.

## Agent workflow

Before making changes:

1. Read this file and any more specific `AGENTS.md` in the target directory.
2. Inspect the relevant code, tests, configuration, and current git status.
3. State assumptions when product behavior is ambiguous.
4. Identify privacy, document-integrity, or backward-compatibility risks.

While working:

1. Keep the change scoped to the user’s request.
2. Preserve existing behavior unless the request requires a change.
3. Add or update tests with the implementation.
4. Use realistic synthetic fixtures for document edge cases.
5. Keep user-visible terminology consistent with this guide.

Before handing off:

1. Run the narrowest relevant tests, then broader checks when practical.
2. Verify the main workflow manually when UI behavior changes.
3. Check light/dark mode, keyboard navigation, responsive layout, and error states.
4. Report what changed, what was verified, and any remaining limitation.
5. Do not claim success for checks that were not run.

## Definition of done

A change is complete when it:

- solves the requested user problem;
- preserves source-document integrity;
- presents uncertainty and errors honestly;
- works with keyboard navigation and accessible labeling;
- includes appropriate automated coverage;
- passes relevant formatting, type, lint, test, and build checks;
- introduces no known leakage of document data;
- matches the COMPAREX visual and content principles;
- documents any intentional limitation or follow-up work.

## Non-goals and prohibited behavior

- Do not present COMPAREX as a legal, compliance, engineering, or editorial authority.
- Do not use “AI-powered” as decoration or imply AI makes the final decision.
- Do not prioritize flashy visual effects over document readability.
- Do not use red/green alone to communicate highlight or link states.
- Do not silently omit unsupported pages, objects, or extraction failures.
- Do not fabricate links, page locations, text coordinates, confidence, or successful processing.
- Do not retain uploaded documents indefinitely by default.
- Do not expand scope into editing document content, signing, approving, cloud synchronization, or general-purpose document management unless explicitly requested.
