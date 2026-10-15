/** Executable, original layout presets. No external templates or paid dependencies. */
export const DOCUMENT_LAYOUTS = {
  essay: { fontFamily: 'serif', headingFontFamily: 'serif', bodySizePt: 11.5, lineHeight: 1.6, marginMm: 24, accentColor: '#202020', showPageNumbers: true },
  report: { fontFamily: 'sans', bodySizePt: 10.5, lineHeight: 1.4, marginMm: 20, accentColor: '#245269', showPageNumbers: true },
  proposal: { fontFamily: 'sans', bodySizePt: 11, lineHeight: 1.4, marginMm: 22, accentColor: '#234D42', showPageNumbers: true },
  letter: { fontFamily: 'serif', bodySizePt: 11, lineHeight: 1.35, marginMm: 25, accentColor: '#202020', showPageNumbers: false },
  resume: { fontFamily: 'sans', bodySizePt: 10, lineHeight: 1.2, marginMm: 17, accentColor: '#25354A', showPageNumbers: false },
  guide: { fontFamily: 'sans', bodySizePt: 11, lineHeight: 1.45, marginMm: 20, accentColor: '#255A5C', showPageNumbers: true },
  flyer: { fontFamily: 'sans', bodySizePt: 12, lineHeight: 1.3, marginMm: 16, accentColor: '#8C3F26', showPageNumbers: false },
  pamphlet: { fontFamily: 'sans', bodySizePt: 10, lineHeight: 1.3, marginMm: 12, orientation: 'landscape', columns: 3, columnGapMm: 8, accentColor: '#245269', showPageNumbers: false },
} as const;
export type DocumentLayoutId = keyof typeof DOCUMENT_LAYOUTS | 'custom';
export interface DocumentLayoutOptions {
  layoutTemplate?: DocumentLayoutId;
  columns?: number;
  columnGapMm?: number;
}
/** Explicit user/model controls win. Legacy documents without a preset are unchanged. */
export function applyDocumentLayout<T extends DocumentLayoutOptions>(design?: T): T {
  const id = design?.layoutTemplate;
  const preset = id && Object.prototype.hasOwnProperty.call(DOCUMENT_LAYOUTS, id)
    ? DOCUMENT_LAYOUTS[id as keyof typeof DOCUMENT_LAYOUTS] : {};
  return { ...preset, ...Object.fromEntries(Object.entries(design || {}).filter(([,v]) => v !== undefined)) } as T;
}
export const DOCUMENT_LAYOUT_GUIDANCE = `DOCUMENT LAYOUT LIBRARY
For new files, select design.layoutTemplate semantically: essay, report, proposal, letter, resume, guide, flyer, pamphlet, or custom. These are executable layout foundations, not placeholder text. Explicit design choices override their defaults. User templates and requested styling take priority; preserve an existing document's design on edits instead of assigning a new preset.
Essay: connected prose with restrained serif typography; report: findings, evidence, readable tables and numbered pages; proposal: scope, deliverables, schedule and pricing only when supplied; letter: recipient, body and sign-off; resume: factual experience and qualifications; guide: instructions, examples and exercises as appropriate; flyer: concise hierarchy and purposeful images; pamphlet: landscape three-column panels. Do not invent facts or insert empty sections to fill a recipe.
For pamphlets, use column_break between panels and page_break between sheets. For a two-sided tri-fold, provide six panels and choose their print order for the intended fold direction; do not assume screen reading order is print order. Label the outside and inside in the reply and explain how to print/fold. Put a heading or title inside the cover panel rather than the top-level title. Leave space at folds. Never shrink or omit requested content to force a fit; use an additional sheet when the user did not require a fixed count. For long flowing documents, prefer one column. Multi-column tables and images must fit their column. Word now supports running headerText, footerText and showPageNumbers, columns (1–3), columnGapMm and column_break. Use PDF for print-fixed layouts and DOCX when editability matters. Free-form creation remains available with custom.
Use mode existing for supplied logos/images, generate only for newly requested artwork, and edit only when the image itself must change. Preserve image aspect ratios by default. Keep existing image bindings during later text/layout edits.
Layout QA must preserve the complete authored text, names, numbers, table cells and image identities. Change spacing, pagination and design, not substantive content, during visual repair.`;
