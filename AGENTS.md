# COMPAREX — Agent Guide

## Product mission

COMPAREX is a professional web application for reviewing two document versions side by side. It helps users find meaningful changes faster while keeping the human reviewer in control of every conclusion.

The product must communicate clarity, accuracy, efficiency, control, and trust. It is a review tool—not an autonomous decision-maker.

## Product principles

1. **Show evidence, not conclusions.** Display the source text, location, and change type behind every result.
2. **Preserve document context.** A difference without its page, section, and surrounding content is incomplete.
3. **Keep the reviewer in control.** Never imply that an automated comparison is a legal, technical, or compliance judgment.
4. **Prefer clarity over feature density.** Important changes should be obvious without making the interface visually noisy.
5. **Fail honestly.** Unsupported, unreadable, password-protected, scanned, or partially parsed files must be identified clearly.
6. **Treat documents as sensitive data.** Minimize retention, logging, exposure, and unnecessary transmission.

## MVP scope

Build the smallest reliable workflow first:

- Upload or select two documents: Version A and Version B.
- Support PDF and DOCX input.
- Render both documents in a synchronized split view.
- Provide independent and linked scrolling.
- Show filename, file type, page count, and processing status.
- Allow zoom, page navigation, swapping sides, and replacing either file.
- Preserve readable layout across desktop screen sizes.
- Report parsing and rendering failures in plain language.

Do not claim semantic change detection until it is implemented and verified. Features such as added/deleted/modified text, change navigation, OCR, tables, annotations, and export belong to later milestones unless the current task explicitly includes them.

## Comparison model

Use neutral terminology consistently:

- **Version A / Original**: the baseline document.
- **Version B / Revised**: the document being compared.
- **Added**: content present only in Version B.
- **Deleted**: content present only in Version A.
- **Modified**: aligned content whose value changed.
- **Moved**: substantially matching content found in another location. Do not label content as moved unless confidence is sufficient.
- **Unresolved**: content the system cannot align reliably.

Every detected change should eventually expose:

- change type;
- page and section location on both sides, where available;
- original and revised content;
- surrounding context;
- comparison confidence or an uncertainty state when applicable.

Never hide uncertainty behind a binary pass/fail result.

## UX requirements

- Desktop-first for the primary review workspace; remain usable on tablets.
- Use a stable two-column split view with an adjustable divider.
- Keep document controls close to the pane they affect.
- Use color and a second signal such as labels, underlines, patterns, or icons. Color alone is insufficient.
- Maintain keyboard navigation and visible focus states.
- Meet WCAG 2.2 AA contrast targets.
- Avoid modal dialogs for routine navigation.
- Preserve the user’s page, zoom, scroll, and filter state whenever practical.
- Confirm destructive actions such as removing an uploaded file or clearing a session.
- Loading states must explain the current stage: uploading, extracting, rendering, aligning, or comparing.
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
- Use Teal and Blue to distinguish document versions; do not let either imply correct/incorrect.
- Reserve Amber for items needing review—not generic decoration.
- Avoid gradients, glow, glass effects, AI sparkles, playful illustrations, cybersecurity styling, and decorative animation.
- Motion must clarify state changes and respect `prefers-reduced-motion`.
- The COMPAREX symbol should remain recognizable at 16 px and in monochrome.

## Content design

- Use concise, factual language.
- Never say “No differences” when only part of a document was processed. Say exactly what was checked.
- Avoid implying legal approval, compliance certification, or factual correctness.
- Prefer “Review complete” over “Approved”.
- Prefer “Potential change” when confidence is limited.
- File-processing errors should identify the affected file and preserve the other file when possible.
- Design English and Thai copy together; do not assume English string length.

## Architecture expectations

- Keep document ingestion, extraction, normalization, alignment, diffing, rendering, and presentation as separable modules.
- Use explicit typed contracts between stages.
- Keep original file bytes immutable.
- Derive previews and extracted representations as versioned artifacts.
- Ensure results can be traced back to source page coordinates.
- Run expensive parsing and comparison work outside the interactive rendering loop.
- Use cancellable jobs and idempotent processing where practical.
- Do not bind the product to PDF-only concepts; use a document adapter interface.
- Prefer deterministic comparison logic. If probabilistic or model-based processing is introduced, isolate it and expose uncertainty.

Suggested domain boundary:

```text
DocumentAdapter -> ExtractedDocument -> Normalizer -> Aligner -> ChangeSet -> ReviewUI
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

- same document compared with itself;
- one-character, word, paragraph, and page-level changes;
- insertions and deletions at the beginning and end;
- repeated paragraphs and ambiguous alignment;
- reordered sections;
- tables, lists, headers, footers, and page numbers;
- mixed Thai and English text;
- Unicode normalization, ligatures, and unusual whitespace;
- scanned/image-only PDFs;
- malformed, encrypted, oversized, and unsupported files;
- DOCX files with tracked changes, comments, images, and page breaks;
- keyboard-only use and screen-reader labels;
- light mode, dark mode, high zoom, and narrow layouts.

Use synthetic or approved fixtures. Never add customer documents to the repository.

## Performance targets

- Keep the initial interface responsive while documents process.
- Render only visible or nearby pages for long documents.
- Avoid loading an entire large document into the browser when streaming or pagination is possible.
- Debounce synchronized scrolling and prevent feedback loops between panes.
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
- Do not use red/green alone to communicate changes.
- Do not silently omit unsupported pages, objects, or extraction failures.
- Do not fabricate page matches, text coordinates, confidence, or successful processing.
- Do not retain uploaded documents indefinitely by default.
- Do not expand scope into editing, signing, approving, or document management unless explicitly requested.
