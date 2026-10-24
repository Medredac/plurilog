// Trusted inspection runs after document generation. Read properties from the actual output.
export const DOCUMENT_INSPECTION_PYTHON = String.raw`
import json, sys, pathlib, zipfile
from docx import Document
from pypdf import PdfReader
root = pathlib.Path('/vercel/sandbox')
fmt = sys.argv[1]
pdf = PdfReader(str(root / 'output.pdf'))
if len(pdf.pages) < 1 or len(pdf.pages) > 20:
    raise ValueError('Preview supports 1–20 rendered pages; do not silently truncate the requested document.')
report = {'page_count': len(pdf.pages), 'pages': [], 'warnings': [], 'image_count': 0}
texts = []
for i, page in enumerate(pdf.pages):
    text = page.extract_text() or ''
    texts.append(text)
    report['image_count'] += len(page.images)
    report['pages'].append({'page': i+1, 'width_pt': float(page.mediabox.width), 'height_pt': float(page.mediabox.height), 'text': text[:16000]})
    if not text.strip(): report['warnings'].append('Page %s has no extractable text; inspect the image.' % (i+1))
def length(v):
    return round(v.pt, 3) if v is not None else None
def inherited(p, prop):
    value = getattr(p.paragraph_format, prop)
    style = p.style
    while value is None and style is not None:
        value = getattr(style.paragraph_format, prop)
        style = style.base_style
    return value
def paragraph(p):
    spacing = inherited(p, 'line_spacing')
    return {'text': p.text[:2000], 'style': p.style.name, 'alignment': str(inherited(p, 'alignment')),
        'line_spacing': length(spacing) if hasattr(spacing, 'pt') else spacing,
        'line_spacing_rule': str(inherited(p, 'line_spacing_rule')),
        'before_pt': length(inherited(p, 'space_before')), 'after_pt': length(inherited(p, 'space_after')),
        'first_indent_pt': length(inherited(p, 'first_line_indent')), 'left_indent_pt': length(inherited(p, 'left_indent')),
        'page_break_before': inherited(p, 'page_break_before'),
        'runs': [{'text': r.text[:160], 'font': r.font.name, 'size_pt': length(r.font.size), 'bold': r.bold, 'italic': r.italic} for r in p.runs[:20]]}
if (root / 'output.docx').exists():
    with zipfile.ZipFile(root / 'output.docx') as z:
        if sum(x.file_size for x in z.infolist()) > 100*1024*1024: raise ValueError('Uncompressed DOCX too large')
    doc = Document(root / 'output.docx')
    report['normal_style'] = {'font': doc.styles['Normal'].font.name, 'size_pt': length(doc.styles['Normal'].font.size)}
    report['sections'] = [{'width_pt': length(s.page_width), 'height_pt': length(s.page_height),
        'top_pt': length(s.top_margin), 'bottom_pt': length(s.bottom_margin), 'left_pt': length(s.left_margin), 'right_pt': length(s.right_margin),
        'header_distance_pt': length(s.header_distance), 'footer_distance_pt': length(s.footer_distance),
        'header': [paragraph(p) for p in s.header.paragraphs], 'footer': [paragraph(p) for p in s.footer.paragraphs],
        'header_fields': s.header._element.xpath('.//w:instrText/text() | .//w:fldSimple/@w:instr'), 'footer_fields': s.footer._element.xpath('.//w:instrText/text() | .//w:fldSimple/@w:instr')} for s in doc.sections]
    report['paragraph_count'] = len(doc.paragraphs)
    report['paragraphs'] = [paragraph(p) for p in doc.paragraphs[:160]]
    report['table_count'] = len(doc.tables)
    report['inline_image_count'] = len(doc.inline_shapes)
    report['tables'] = [{'rows': len(t.rows), 'columns': len(t.columns), 'first_rows': [[c.text[:300] for c in row.cells] for row in t.rows[:3]]} for t in doc.tables]
    if len(doc.paragraphs) > 160: report['warnings'].append('Structural paragraph report sampled at 160 paragraphs; full rendered text retained.')
(root / 'inspection.json').write_text(json.dumps(report, ensure_ascii=False, default=str))
(root / 'full-text.txt').write_text('\n\n'.join(texts))
`;
