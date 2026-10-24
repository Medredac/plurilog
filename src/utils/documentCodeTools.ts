// Deliberately unavailable in production, including if this branch is merged accidentally.
export function isDocumentCodePreviewEnabled(env = process.env): boolean {
  return env.VERCEL_ENV === 'preview' && env.VERCEL_GIT_COMMIT_REF === 'preview/document-code-engine';
}

export const DOCUMENT_CODE_INSTRUCTION = `Document tools in this preview: first call start_document_work for any Word/PDF creation or revision request, before drafting code. It activates the document authoring model for the rest of this turn with the full conversation and research tools. Then use build_document, review_document_pages, then publish_document instead of create_file/revise_file/edit_source_document. These tools supersede older document-tool instructions. You author complete Python using python-docx 1.2, ReportLab 4.4, pypdf 6.1, Pillow and lxml. LibreOffice, Poppler, DejaVu, Liberation, Carlito and Noto CJK fonts are installed. No network or package installation is available inside execution. Use your normal research and image tools first when needed, then pass exact available filenames as inputs. Never invent missing facts, citations, logos or images.
First translate the user's document requirements into a concrete checklist, including content, formatting standard, page geometry, typography, headings, indentation, spacing, page numbering, images, tables and preservation where applicable. For a named style or standard, consult an authoritative reference with the research tools before building unless its rules are already in the discussion. Expand the standard into its actual requirements, including inline emphasis and citation formatting; do not reduce it to margins and headings. Do not ask for details with reasonable defaults. Write full content, not abbreviated placeholders. For long conversations retrieve the full relevant source first. For an existing file, supply it as an input and edit its actual bytes; preserve unrelated content, layout, headers, images and equations. Existing canonical code can help but the current file is authoritative.
Input files are at /vercel/sandbox/inputs/<exact filename>. Save the finished file to /vercel/sandbox/output.docx or output.pdf. For PDF you may create output.docx; the tool converts it with LibreOffice. Use real document formatting, not literal Markdown/HTML. Python-docx supports arbitrary OOXML for features such as page fields, equations and section settings. No imposed theme or spacing limits. Do not print the whole document or encode it in tool output.
build_document returns an unpublished draft, independently extracted structure/text and a page count. Inspect ALL rendered pages with review_document_pages (up to four per call), comparing the actual file to the checklist AND the user's original request and referenced standard. Look for omissions from your own checklist. Validate measurements and word counts using extracted properties, not visual estimates or what your code intended. Then publish_document with specific observations for every requirement. This is your own review, not independent certification of factual or legal correctness. There is no two-build or one-correction quota. Fix execution errors, then inspect and revise until the requested result is complete within the turn runtime. A successful replacement supersedes the prior draft of that filename; a failed build preserves it. Do not repeatedly tweak acceptable output. Correct unreadable text, overlap, missing content and unmet formatting requirements before publishing; a disclaimer is not a substitute for correcting a defect you can fix. If a requirement cannot be satisfied, explain what remains unfinished without publishing it as a completed document. Optional missing information or assets may be disclosed without inventing them. Never claim a draft has been delivered until publish_document succeeds. The UI displays the saved file as a download card. Refer to that attachment; do not invent a sandbox or Markdown download URL. All supported output formats requested by the user must be completed. Do not expose internal draft IDs or Python to the user unless requested.`;

const definition = (name: string, description: string, properties: Record<string, any>, required: string[]) => ({
  type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } },
});
export const DOCUMENT_START_TOOL = definition('start_document_work', 'Start creating or revising Word/PDF files. Call this before planning or writing document code; it activates full document authoring and review tools for this turn.', {}, []);
export const DOCUMENT_MODELS = ['openai/gpt-6.1-sol', 'openai/gpt-6-sol'];
/** Tool-selected, not keyword-selected: ordinary turns retain their existing route. */
export function createDocumentModelRoute(normalModels: string[], enabled: boolean) {
  let active = false;
  return {
    get active() { return active; },
    get models() { return active ? [...DOCUMENT_MODELS] : normalModels; },
    start() {
      if (!enabled) throw new Error('Document model routing is unavailable outside the document preview.');
      active = true;
    },
  };
}
export const DOCUMENT_CODE_TOOLS = [
  definition('build_document', 'Build and render an unpublished Word/PDF with full Python layout control. No files are attached yet.', {
    filename: { type: 'string' }, format: { type: 'string', enum: ['docx', 'pdf'] },
    code: { type: 'string', description: 'Complete Python script. Save /vercel/sandbox/output.docx or output.pdf. PDF can also be produced by saving output.docx for automatic conversion.' },
    requirements: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 30 },
    inputs: { type: 'array', items: { type: 'string' }, maxItems: 12 },
  }, ['filename', 'format', 'code', 'requirements', 'inputs']),
  definition('review_document_pages', 'View the actual rendered pages of the latest draft. Read all pages before publishing. Up to four pages per call.', {
    draft_id: { type: 'string' }, pages: { type: 'array', items: { type: 'integer', minimum: 1 }, minItems: 1, maxItems: 4 },
  }, ['draft_id', 'pages']),
  definition('publish_document', 'Attach a reviewed draft to this discussion. Requires all pages viewed and an observation for each requirement. Known limitations must be disclosed.', {
    draft_id: { type: 'string' },
    review: { type: 'array', items: { type: 'object', properties: { requirement: { type: 'integer', minimum: 1 }, observation: { type: 'string' }, satisfied: { type: 'boolean' } }, required: ['requirement', 'observation', 'satisfied'], additionalProperties: false } },
    limitations: { type: 'array', items: { type: 'string' } },
  }, ['draft_id', 'review', 'limitations']),
];

export interface DocumentCodeArgs { filename: string; format: 'docx' | 'pdf'; code: string; requirements: string[]; inputs: string[] }
export function validateDocumentCodeArgs(args: DocumentCodeArgs) {
  if (!['docx', 'pdf'].includes(args.format)) throw new Error('Use docx or pdf.');
  if (typeof args.filename !== 'string' || !/^[^/\\\x00-\x1f]{1,140}$/.test(args.filename) || args.filename.startsWith('.')) throw new Error('Use a plain filename, without paths.');
  if (!args.filename.toLowerCase().endsWith('.' + args.format)) throw new Error('Filename extension must match format.');
  if (typeof args.code !== 'string' || !args.code.trim() || Buffer.byteLength(args.code) > 180_000) throw new Error('Provide a complete Python script under 180 KB.');
  if (!Array.isArray(args.requirements) || !args.requirements.length || args.requirements.length > 30 || args.requirements.some(x => typeof x !== 'string' || !x.trim() || x.length > 1000)) throw new Error('Provide 1–30 concrete requirements.');
  if (!Array.isArray(args.inputs) || args.inputs.length > 12 || args.inputs.some(x => typeof x !== 'string' || !/^[^/\\\x00-\x1f]{1,200}$/.test(x) || x.startsWith('.'))) throw new Error('Inputs must be exact available filenames, without paths.');
}

/** Drafts remain available after execution errors; only successful same-name revisions supersede them. */
export function createDocumentDraftRegistry<T extends { id: string; args: DocumentCodeArgs; pages: unknown[] }>() {
  const drafts = new Map<string, T>();
  const seen = new Map<string, Set<number>>();
  const published = new Set<string>();
  return {
    begin(args: DocumentCodeArgs) {
      validateDocumentCodeArgs(args);
    },
    add(draft: T) {
      for (const [id, previous] of drafts) if (previous.args.filename === draft.args.filename && previous.args.format === draft.args.format) {
        drafts.delete(id); seen.delete(id); published.delete(id);
      }
      drafts.set(draft.id, draft); seen.set(draft.id, new Set());
    },
    get(id: string): T { const draft = drafts.get(id); if (!draft) throw new Error('Unknown or superseded draft. Use the latest successful build.'); return draft; },
    view(id: string, pages: number[]) {
      const draft = this.get(id);
      if (!Array.isArray(pages) || !pages.length || pages.length > 4 || pages.some(p => !Number.isInteger(p) || p < 1 || p > draft.pages.length)) throw new Error('Request 1–4 valid page numbers.');
      for (const page of pages) seen.get(id)!.add(page);
      return draft;
    },
    checkPublish(id: string, review: any[], limitations: string[]) {
      const draft = this.get(id);
      if (seen.get(id)!.size !== draft.pages.length) throw new Error('Review every rendered page before publishing.');
      if (!Array.isArray(review) || review.length !== draft.args.requirements.length || new Set(review.map(x => x.requirement)).size !== review.length || review.some(x => !Number.isInteger(x.requirement) || x.requirement < 1 || x.requirement > review.length || typeof x.satisfied !== 'boolean' || typeof x.observation !== 'string' || x.observation.trim().length < 10)) throw new Error('Provide one specific observation for each numbered requirement.');
      if (review.some(x => !x.satisfied)) throw new Error('Unmet document requirements: revise the draft and review the replacement before publishing. Disclosing a correctable defect is not completion.');
      if (!Array.isArray(limitations) || limitations.some(x => typeof x !== 'string' || !x.trim())) throw new Error('Disclose all unmet requirements as limitations.');
      return draft;
    },
    published(id: string) { published.add(id); },
    hasUnpublished() { return [...drafts.keys()].some(id => !published.has(id)); },
  };
}
