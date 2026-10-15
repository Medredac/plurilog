/** Executable, original layout presets. No external templates or paid dependencies. */
export const DOCUMENT_LAYOUTS = {
  'brochure-editorial': { fontFamily: 'sans', headingFontFamily: 'sans', bodySizePt: 11, lineHeight: 1.45, marginMm: 12, columns: 1, accentColor: '#174D47', accentColor2: '#C68154', accentColor3: '#E9E1CD', backgroundColor: '#F7F4EB', showPageNumbers: false },
  'brochure-trifold': { fontFamily: 'sans', headingFontFamily: 'sans', bodySizePt: 10, lineHeight: 1.35, marginMm: 8, orientation: 'landscape', columns: 3, columnGapMm: 4, accentColor: '#174D47', accentColor2: '#C68154', accentColor3: '#E9E1CD', backgroundColor: '#F7F4EB', showPageNumbers: false },
  essay: { fontFamily: 'serif', headingFontFamily: 'serif', bodySizePt: 12, lineHeight: 1.6, marginMm: 25, accentColor: '#31534D', backgroundColor: '#FFFFFF', textColor: '#242B29', mutedColor: '#69736E', showPageNumbers: true },
  report: { fontFamily: 'sans', bodySizePt: 10.5, lineHeight: 1.4, marginMm: 20, accentColor: '#245269', showPageNumbers: true },
  proposal: { fontFamily: 'sans', bodySizePt: 11, lineHeight: 1.4, marginMm: 22, accentColor: '#234D42', showPageNumbers: true },
  letter: { fontFamily: 'serif', bodySizePt: 11, lineHeight: 1.35, marginMm: 25, accentColor: '#202020', showPageNumbers: false },
  resume: { fontFamily: 'sans', bodySizePt: 10, lineHeight: 1.2, marginMm: 17, accentColor: '#25354A', showPageNumbers: false },
  guide: { fontFamily: 'sans', bodySizePt: 11, lineHeight: 1.45, marginMm: 20, accentColor: '#255A5C', showPageNumbers: true },
  flyer: { fontFamily: 'sans', bodySizePt: 12, lineHeight: 1.3, marginMm: 16, accentColor: '#8C3F26', showPageNumbers: false },
  pamphlet: { fontFamily: 'sans', bodySizePt: 10, lineHeight: 1.3, marginMm: 12, orientation: 'landscape', columns: 3, columnGapMm: 8, accentColor: '#245269', accentColor2: '#B78056', accentColor3: '#EEE8D8', backgroundColor: '#FFFFFF', showPageNumbers: false },
} as const;
export type DocumentLayoutId = keyof typeof DOCUMENT_LAYOUTS | 'custom';
export interface DocumentLayoutOptions {
  layoutTemplate?: DocumentLayoutId;
  /** Server-owned version: existing saved documents retain their original layout. */
  templateVersion?: number;
  columns?: number;
  columnGapMm?: number;
}
/** Explicit user/model controls win. Legacy documents without a preset are unchanged. */
export function applyDocumentLayout<T extends DocumentLayoutOptions>(design?: T): T {
  const id = design?.layoutTemplate;
  const preset = id && Object.prototype.hasOwnProperty.call(DOCUMENT_LAYOUTS, id)
    ? DOCUMENT_LAYOUTS[id as keyof typeof DOCUMENT_LAYOUTS] : {};
  const resolved = { ...(id && Object.prototype.hasOwnProperty.call(DOCUMENT_LAYOUTS, id) ? { templateVersion: 2 } : {}), ...preset, ...Object.fromEntries(Object.entries(design || {}).filter(([,v]) => v !== undefined && v !== null)) } as T;
  // A tri-fold is structurally three panels, not a one-column style preset.
  // Custom geometry uses custom; legacy saved documents retain their settings.
  if (design?.templateVersion === 2 && id === 'brochure-trifold') {
    Object.assign(resolved, { columns: 3, orientation: 'landscape' });
  }
  return resolved;
}
export const DOCUMENT_LAYOUT_GUIDANCE = `Choose the visual template separately for each new file: essay, report, proposal, letter, resume, guide, flyer, pamphlet, brochure-editorial, brochure-trifold, or custom. These are reusable rendering styles. User-supplied templates and explicit design choices take priority. Preserve the selected design when editing an existing file. Omit optional overrides unless wanted.
For a photographic advertising booklet, use brochure-editorial: the Community Garden style combines large photo areas, contrasting colour panels, strong sans-serif headings, generous spacing, and coordinated accents. Compose each intended page using page_break. Keep small logos inline and use large/full for feature photos. Let additional content flow naturally; do not omit content to fit a decorative frame. For a folded PDF use brochure-trifold, column_break between panels and page_break between sheets. For Word use the editable core templates; do not claim identical fixed PDF art direction.
Essay: readable serif prose, a confident title, restrained headings and quiet page numbering. Report: clear findings, readable tables and section rules. Proposal: a distinctive title band with clear scope and deliverables. Letter: restrained typography and comfortable paragraphs. Resume: compact name/contact area, crisp section rules and factual entries. Guide: prominent section headings and readable instructions. Flyer: strong headline, large purposeful image and concise supporting information. Pamphlet: compact multi-column layout. Choose custom for specialist or supplied layouts.
Keep original logos and supplied images unchanged. Use the existing image tools as usual. Select image proportions and palette to suit the content. Do not add empty sections or invent facts to fill a template.`;
