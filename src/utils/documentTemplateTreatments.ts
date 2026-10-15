/** Choose the higher-contrast neutral foreground for model-selected color fields. */
export function contrastTextColor(background: string): string {
  let hex = background.startsWith('#') ? background.slice(1) : background;
  if (hex.length === 3) hex = [...hex].map(c => c + c).join('');
  if (hex.length !== 6) return '#111111';
  const rgb = [0, 2, 4].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255);
  if (rgb.some(v => !Number.isFinite(v))) return '#111111';
  const linear = rgb.map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const luminance = linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
  return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? '#000000' : '#FFFFFF';
}

/** Compositions shared by PDF and Word. Selection is an agent decision, never
 * inferred from prompt words. Version 2 is assigned only to newly authored files. */
export const DOCUMENT_TREATMENTS = {
  essay: { titleSize: 32, sectionSize: 16, titleSpace: 360, paragraphSpace: 180, sectionSpace: 300, rule: true, band: false },
  report: { titleSize: 30, sectionSize: 16, titleSpace: 340, paragraphSpace: 140, sectionSpace: 300, rule: true, band: false },
  proposal: { titleSize: 34, sectionSize: 16, titleSpace: 380, paragraphSpace: 160, sectionSpace: 300, rule: false, band: true },
  letter: { titleSize: 18, sectionSize: 12, titleSpace: 300, paragraphSpace: 200, sectionSpace: 200, rule: false, band: false },
  resume: { titleSize: 28, sectionSize: 12, titleSpace: 180, paragraphSpace: 80, sectionSpace: 200, rule: true, band: false },
  guide: { titleSize: 32, sectionSize: 18, titleSpace: 340, paragraphSpace: 160, sectionSpace: 340, rule: false, band: true },
  flyer: { titleSize: 38, sectionSize: 20, titleSpace: 300, paragraphSpace: 160, sectionSpace: 220, rule: false, band: false },
  pamphlet: { titleSize: 24, sectionSize: 15, titleSpace: 200, paragraphSpace: 100, sectionSpace: 180, rule: true, band: false },
  'brochure-editorial': { titleSize: 34, sectionSize: 20, titleSpace: 340, paragraphSpace: 160, sectionSpace: 280, rule: true, band: false },
  'brochure-trifold': { titleSize: 24, sectionSize: 15, titleSpace: 200, paragraphSpace: 100, sectionSpace: 180, rule: true, band: false },
} as const;

export function documentTreatment(design: { layoutTemplate?: string; templateVersion?: number }) {
  return design.templateVersion === 2 && design.layoutTemplate && Object.hasOwn(DOCUMENT_TREATMENTS, design.layoutTemplate)
    ? DOCUMENT_TREATMENTS[design.layoutTemplate as keyof typeof DOCUMENT_TREATMENTS] : null;
}

/** Print-safe compositions: no fixed text boxes, clipping, or forced page count. */
export function documentTreatmentCss(design: { layoutTemplate?: string; templateVersion?: number; accentColor: string; textColor: string; mutedColor: string; bodySizePt: number }): string {
  const t = documentTreatment(design);
  if (!t) return '';
  const title = '.pdf-document-title';
  const common = `${title} { font-size:${t.titleSize}pt !important; line-height:1.12 !important; letter-spacing:-0.6pt; margin:0 0 ${t.titleSpace / 20}pt !important; ${t.rule ? `padding-bottom:7mm;border-bottom:1pt solid ${design.accentColor};` : ''} }
    .pdf-heading-2 { font-size:${t.sectionSize}pt !important; line-height:1.25 !important; margin:${t.sectionSpace / 20}pt 0 6pt !important; color:${design.accentColor} !important; }
    .pdf-paragraph { margin-bottom:${t.paragraphSpace / 20}pt !important; }
    .pdf-paragraph p { orphans:3; widows:3; }
    th { font-weight:650; } td { vertical-align:top; }`;
  const specific: Record<string, string> = {
    essay: `${title} { font-weight:600 !important; }
      .pdf-document-title + .pdf-paragraph { font-size:${design.bodySizePt + 1.5}pt; line-height:1.5; color:${design.mutedColor}; margin-bottom:7mm !important; }
      .pdf-heading-3 { font-size:12pt !important; margin:6mm 0 2mm !important; }`,
    report: `${title} { padding-top:6mm;border-top:5pt solid ${design.accentColor}; }
      .pdf-heading-2 { border-bottom:0.6pt solid ${design.mutedColor};padding-bottom:3mm; }
      main > .pdf-paragraph:first-of-type { font-size:${design.bodySizePt + 1}pt; }
      .pdf-card { border-radius:0;box-shadow:none; }`,
    proposal: `${title} { padding:10mm 8mm;background:${design.accentColor};color:${contrastTextColor(design.accentColor)} !important; }
      .pdf-heading-2 { padding-left:4mm;border-left:3pt solid ${design.accentColor}; }
      .pdf-callout { border-radius:0; }`,
    letter: `${title} { color:${design.textColor} !important;letter-spacing:0;font-weight:600 !important; }
      .pdf-heading-2, .pdf-heading-3 { color:${design.textColor} !important; }
      main { padding-top:5mm; }`,
    resume: `${title} { text-transform:none;letter-spacing:-0.5pt; }
      .pdf-heading-2 { font-size:11pt !important;text-transform:uppercase;letter-spacing:1pt;border-bottom:0.6pt solid ${design.mutedColor};padding-bottom:2mm; }
      .pdf-heading-3 { font-size:11pt !important;margin:4mm 0 1mm !important; }
      li { margin-bottom:2pt; }`,
    guide: `${title} { padding:8mm;border-left:6pt solid ${design.accentColor};background:#F3F5F4; }
      .pdf-heading-2 { padding:4mm 0;border-top:2pt solid ${design.accentColor}; }
      ol { padding-left:7mm; } ol li { padding-left:2mm;margin-bottom:4mm; } ol li::marker { font-weight:700;color:${design.accentColor}; }`,
    flyer: `${title} { color:${design.accentColor} !important;max-width:100%;font-weight:800 !important; }
      .pdf-heading-2 { letter-spacing:-0.3pt; }
      .pdf-document-title + .pdf-paragraph { font-size:${design.bodySizePt + 2}pt;line-height:1.35; }
      .pdf-image-caption { text-align:left; }`,
    pamphlet: '.pdf-heading-1 { font-size:24pt !important;line-height:1.12 !important; }',
  };
  // Brochure templates already have complete composed page/panel renderers.
  return design.layoutTemplate?.startsWith('brochure-') ? '' : common + (specific[design.layoutTemplate || ''] || '');
}
