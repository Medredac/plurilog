# Document code engine preview

Enabled only when `VERCEL_ENV=preview` and `VERCEL_GIT_COMMIT_REF=preview/document-code-engine`. Production continues to use its existing engine, including if this code is accidentally merged. GPT routing and billing accounting are unchanged. Document creation, inspection and revision use the same usage-selected GPT fallback sequence as the rest of the turn (GPT-5.6 Luna or GPT-6 Luna first). There is no document-specific model handoff or reasoning override. No schema migrations.

## Flow

1. GPT authors Python and a requirement checklist using its normal usage-selected model and tools. Existing assets must resolve to exact discussion filenames and be downloaded through the authenticated storage client.
2. A fresh Vercel Sandbox with network denied executes the script. No app credentials or signed URLs are passed into it. Python-docx/OOXML supports Word features without the old schema's layout restrictions. ReportLab supports direct PDFs; LibreOffice converts Word to PDF for inspection.
3. Server-authored inspection extracts actual file structure and rendered text. All pages are rendered and must be requested through `review_document_pages` before publishing.
4. GPT reviews the pages against every requirement. This is model self-review, not an independent correctness guarantee. There is no per-format build/correction quota. Failed executions preserve the last successful draft. Successful same-filename replacements reset page review; distinct documents keep separate drafts. Known unmet requirements block publication, including when a limitation is supplied. Optional missing information can still be disclosed.
5. Publishing uses existing message attachments, durable storage, embedded images, retrieval indexing and document-state artifacts. The original file is the source for subsequent code-based edits. Review does not add a separate nested model call; normal agent-loop usage is billed as before.

Preview limits: 25 MB input/output, 180 KB script, 20 pages. Execution remains subject to the existing turn deadline, 48-step tool loop and identical-failure guard. Code execution is bounded at 45 seconds, VM lifetime at 180 seconds, and VM cleanup runs on success or failure. Multiple distinct filenames in the same format are supported.

## Runtime

Snapshot `snap_Wyuhhi2KcdJRmRGmEl65eQTZEaCT` includes LibreOffice 26.2.6, Poppler, Python 3.14, python-docx 1.2.0, ReportLab 4.4.10, pypdf 6.1.3, Pillow 11.3.0, lxml 6.1.3, Liberation/Carlito/Caladea/DejaVu/Noto CJK fonts. Times New Roman may render through Liberation Serif on Linux; Word retains the requested font declaration.

The manually provisioned test snapshot has the provider's default 30-day lifetime (created October 24, 2026). Before any promotion, provision a non-expiring runtime with `scripts/provision-document-code-snapshot.mjs` and replace the snapshot ID. That script is explicit maintenance only, never invoked during a build or user request.

## Verification

- `npx tsc --noEmit`
- `node --test tests/document-code-engine.test.cjs tests/document-code-sandbox.test.cjs tests/agent-tool-loop.test.cjs tests/document-preservation.test.cjs`
- `tests/fixtures/document-code-smoke.py` runs **inside the sandbox** to exercise essay formatting, headers/page fields, indents, a report with image/table, a preserved revision, and direct PDF generation.
- Fixtures establish renderer capability, not model reliability. A live preview chat must still verify tool selection, visual review, attachment publication and retrieval by the other panelists.

The user authorized live model testing for this preview. Never execute model-authored Python on the app server or development host.

## Live verification — October 24, 2026

Tested application commit `d5d0707a2cbbb2a87e8091b5e50e2ca556c1715c` on deployment `dpl_9xyVKasWffpS7GGyF2viCQFvRLm3`.

- A real GPT chat created a four-page essay in Word through build → render → review → publish. The initial version missed bibliography italics despite passing its own checklist. This motivated the generic standard-reference and original-request review instructions in the tested commit; it is evidence that self-review is not infallible.
- A follow-up requested an MLA review without identifying the defect. GPT consulted MLA references, found the missing journal/book italics, edited the original file and produced corrected DOCX and PDF attachments. All four corrected Word pages were visually inspected. The PDF's four rendered-page hashes match the Word preview exactly.
- Normalized extracted-text hashes are identical across the original Word, corrected Word, and PDF. The essay wording was preserved. Both revised files retain source lineage and searchable document records.
- Claude and Gemini retrieved the exact closing sentence and both source titles from the PDF, correctly identifying the intentionally fictional references.
- No error/warning runtime logs were returned for the correction request. Model accounting recorded 7.2678 cents total for GPT's creation/correction turns, 12.5236 cents for Claude and 1.5118 cents for Gemini's retrieval check (21.3032 cents total; excludes sandbox infrastructure).
- Focused suite: 28 passed, one existing PDF integration test skipped, no failures. After the final instruction/inspection change, all 10 new document-engine tests passed. Vercel builds succeeded. Local generated Next route types report existing route-export issues, so do not describe the final local typecheck as universally clean.
- Native attachment download helpers in the automation browser stalled; the in-app file previews and page retrieval worked. Saving the DOCX/PDF through the user's normal browser remains a manual check.

Scope: preview only, no production deployment or database migration. The runtime expiry above must be addressed before any production rollout. This is general code-based document authoring, not a hardcoded MLA template; renderer fixtures cover tables, images, preservation and direct PDFs, but arbitrary document correctness is not guaranteed.
