import { Buffer } from 'node:buffer';
import { Sandbox } from '@vercel/sandbox';
import { ModelId } from '@/types/chat';
import { createServiceClient } from '@/utils/supabase/service';
import { parseDocx } from '@/utils/docxParser';
import { renderDocxPages } from '@/utils/docxPageRenderer';
import { persistGeneratedDocument } from '@/utils/generatedDocumentStorage';
import { persistDocxRenderedPages } from '@/utils/docxRenderedPages';
import { persistPdfRenderedPages } from '@/utils/pdfRenderedPages';
import { ingestParsedDocument } from '@/utils/discussionMemory';
import {
  persistDocumentStateSnapshot,
  type DocumentStateSnapshot,
} from '@/utils/documentRevisionState';

const SOURCE_EDIT_SNAPSHOT_ID = 'snap_vwQhLmdtlIxq4OliWzLOjVlHEzuD';
const MAX_SOURCE_DOCUMENT_BYTES = 25 * 1024 * 1024;
const MAX_RENDERED_PAGES = 12;

const DOCX_EDIT_SCRIPT = String.raw`
import copy, html, os, re, sys, zipfile, json
from xml.etree import ElementTree as ET

W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
NS = {'w': W}

src, plan_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
with open(plan_path, 'r', encoding='utf-8') as f:
    edits = json.load(f)

def decode_text(raw):
    return html.unescape(raw or '')

def encode_text(value):
    return html.escape(value or '', quote=False)

with zipfile.ZipFile(src, 'r') as zin:
    infos = zin.infolist()
    original = {info.filename: zin.read(info.filename) for info in infos}

styles_bytes = original.get('word/styles.xml')
style_sizes = {}
style_based_on = {}
default_size = 11.0
if styles_bytes:
    try:
        sroot = ET.fromstring(styles_bytes)
        dsz = sroot.find('.//w:docDefaults/w:rPrDefault/w:rPr/w:sz', NS)
        if dsz is not None and dsz.get('{%s}val' % W):
            default_size = float(dsz.get('{%s}val' % W)) / 2.0
        for style in sroot.findall('.//w:style', NS):
            sid = style.get('{%s}styleId' % W)
            if not sid:
                continue
            based = style.find('w:basedOn', NS)
            if based is not None:
                style_based_on[sid] = based.get('{%s}val' % W)
            sz = style.find('w:rPr/w:sz', NS)
            if sz is not None and sz.get('{%s}val' % W):
                style_sizes[sid] = float(sz.get('{%s}val' % W)) / 2.0
    except Exception:
        pass

def style_size(style_id):
    seen = set()
    cur = style_id
    while cur and cur not in seen:
        seen.add(cur)
        if cur in style_sizes:
            return style_sizes[cur]
        cur = style_based_on.get(cur)
    return default_size

P_RE = re.compile(r'<w:p\b[^>]*>.*?</w:p>', re.S)
R_RE = re.compile(r'<w:r\b[^>]*>.*?</w:r>', re.S)
T_RE = re.compile(r'(<w:t\b[^>]*>)(.*?)(</w:t>)', re.S)
PSTYLE_RE = re.compile(r'<w:pStyle\b[^>]*\bw:val=(["\'])(.*?)\1[^>]*/?>', re.S)
RPR_RE = re.compile(r'<w:rPr\b[^>]*>.*?</w:rPr>', re.S)
PPR_RE = re.compile(r'<w:pPr\b[^>]*>.*?</w:pPr>', re.S)

def paragraph_text(pxml):
    return ''.join(decode_text(m.group(2)) for m in T_RE.finditer(pxml))

def p_style_id(pxml):
    m = PSTYLE_RE.search(pxml)
    return m.group(2) if m else None

def run_text(rxml):
    return ''.join(decode_text(m.group(2)) for m in T_RE.finditer(rxml))

def get_val(xml, tag):
    pat = re.compile(
        r'(<w:' + re.escape(tag) + r'\b[^>]*\bw:val=(["\']))(.*?)(\2[^>]*/?>)',
        re.S,
    )
    m = pat.search(xml)
    return m.group(3) if m else None

def replace_or_insert_rpr_property(rxml, tag, val=None, toggle=False):
    prop_re = re.compile(r'<w:' + re.escape(tag) + r'\b[^>]*/?>', re.S)
    rpr_m = RPR_RE.search(rxml)
    if toggle:
        prop = '<w:%s w:val="%s"/>' % (tag, '1' if bool(val) else '0')
    else:
        prop = '<w:%s w:val="%s"/>' % (tag, val)
    if rpr_m:
        rpr = rpr_m.group(0)
        if prop_re.search(rpr):
            if toggle:
                new_rpr = prop_re.sub(prop, rpr, count=1)
            else:
                value_re = re.compile(
                    r'(<w:' + re.escape(tag) + r'\b[^>]*\bw:val=(["\']))(.*?)(\2[^>]*/?>)',
                    re.S
                )
                if value_re.search(rpr):
                    new_rpr = value_re.sub(
                        lambda m: m.group(1) + str(val) + m.group(4),
                        rpr,
                        count=1
                    )
                else:
                    new_rpr = prop_re.sub(prop, rpr, count=1)
        else:
            new_rpr = rpr[:-len('</w:rPr>')] + prop + '</w:rPr>'
        return rxml[:rpr_m.start()] + new_rpr + rxml[rpr_m.end():]
    opening = re.match(r'<w:r\b[^>]*>', rxml, re.S)
    if not opening:
        return rxml
    return rxml[:opening.end()] + '<w:rPr>' + prop + '</w:rPr>' + rxml[opening.end():]

def replace_or_insert_rpr_raw_property(rxml, tag, prop):
    prop_re = re.compile(r'<w:' + re.escape(tag) + r'\b[^>]*/?>', re.S)
    rpr_m = RPR_RE.search(rxml)
    if rpr_m:
        rpr = rpr_m.group(0)
        if prop_re.search(rpr):
            new_rpr = prop_re.sub(prop, rpr, count=1)
        else:
            new_rpr = rpr[:-len('</w:rPr>')] + prop + '</w:rPr>'
        return rxml[:rpr_m.start()] + new_rpr + rxml[rpr_m.end():]
    opening = re.match(r'<w:r\b[^>]*>', rxml, re.S)
    if not opening:
        return rxml
    return rxml[:opening.end()] + '<w:rPr>' + prop + '</w:rPr>' + rxml[opening.end():]

def patch_run_font_family(rxml, family):
    family = str(family or '').lower()
    if family == 'serif':
        latin, east_asia = 'Times New Roman', 'Yu Mincho'
    elif family == 'mono':
        latin, east_asia = 'Courier New', 'MS Gothic'
    else:
        latin, east_asia = 'Arial', 'Yu Gothic'
    prop = (
        '<w:rFonts w:ascii="' + latin +
        '" w:hAnsi="' + latin +
        '" w:cs="' + latin +
        '" w:eastAsia="' + east_asia + '"/>'
    )
    return replace_or_insert_rpr_raw_property(rxml, 'rFonts', prop)

def explicit_run_size(rxml):
    val = get_val(rxml, 'sz')
    if val is None:
        return None
    try:
        return float(val) / 2.0
    except Exception:
        return None

def patch_run_size(rxml, pxml, absolute=None, delta=None, scale=None):
    current = explicit_run_size(rxml)
    if current is None:
        current = style_size(p_style_id(pxml))
    if scale is not None and abs(float(scale) - 1.0) > 0.0001:
        size = current * float(scale)
    elif delta is not None and abs(float(delta)) > 0.0001:
        size = current + float(delta)
    else:
        size = float(absolute) if absolute is not None else current
    size = max(5.0, min(96.0, size))
    half_points = str(int(round(size * 2)))
    rxml = replace_or_insert_rpr_property(rxml, 'sz', half_points)
    rxml = replace_or_insert_rpr_property(rxml, 'szCs', half_points)
    return rxml

def text_node_spans(pxml):
    spans = []
    pos = 0
    for m in T_RE.finditer(pxml):
        decoded = decode_text(m.group(2))
        spans.append({'match': m, 'start': pos, 'end': pos + len(decoded), 'text': decoded})
        pos += len(decoded)
    return spans

def run_spans(pxml):
    out = []
    pos = 0
    for m in R_RE.finditer(pxml):
        txt = run_text(m.group(0))
        out.append({'match': m, 'start': pos, 'end': pos + len(txt), 'text': txt})
        pos += len(txt)
    return out

def replace_text_range(pxml, start, end, replacement):
    nodes = text_node_spans(pxml)
    affected = [n for n in nodes if n['end'] > start and n['start'] < end]
    if not affected:
        return pxml
    replacements = []
    first = affected[0]
    last = affected[-1]
    for node in affected:
        txt = node['text']
        if first is last:
            new_txt = txt[:max(0, start-node['start'])] + replacement + txt[max(0, end-node['start']):]
        elif node is first:
            new_txt = txt[:max(0, start-node['start'])] + replacement
        elif node is last:
            new_txt = txt[max(0, end-node['start']):]
        else:
            new_txt = ''
        m = node['match']
        raw_open = m.group(1)
        if (new_txt.startswith(' ') or new_txt.endswith(' ')) and 'xml:space=' not in raw_open:
            raw_open = raw_open[:-1] + ' xml:space="preserve">'
        replacements.append((m.start(), m.end(), raw_open + encode_text(new_txt) + m.group(3)))
    for s, e, rep in reversed(replacements):
        pxml = pxml[:s] + rep + pxml[e:]
    return pxml

def patch_runs_overlapping(pxml, start, end, action, edit):
    spans = run_spans(pxml)
    replacements = []
    for item in spans:
        if item['end'] <= start or item['start'] >= end:
            continue
        rxml = item['match'].group(0)
        if action == 'set_font_size':
            rxml = patch_run_size(
                rxml,
                pxml,
                absolute=edit.get('font_size_pt'),
                delta=edit.get('font_size_delta_pt'),
                scale=edit.get('font_size_scale')
            )
        elif action == 'set_bold':
            rxml = replace_or_insert_rpr_property(rxml, 'b', edit.get('value', True), toggle=True)
        elif action == 'set_italic':
            rxml = replace_or_insert_rpr_property(rxml, 'i', edit.get('value', True), toggle=True)
        elif action == 'set_font_family':
            rxml = patch_run_font_family(rxml, edit.get('font_family'))
        replacements.append((item['match'].start(), item['match'].end(), rxml))
    for s, e, rep in reversed(replacements):
        pxml = pxml[:s] + rep + pxml[e:]
    return pxml

def patch_alignment(pxml, alignment):
    prop = '<w:jc w:val="%s"/>' % alignment
    ppr_m = PPR_RE.search(pxml)
    jc_re = re.compile(r'<w:jc\b[^>]*/?>', re.S)
    if ppr_m:
        ppr = ppr_m.group(0)
        if jc_re.search(ppr):
            new_ppr = jc_re.sub(prop, ppr, count=1)
        else:
            new_ppr = ppr[:-len('</w:pPr>')] + prop + '</w:pPr>'
        return pxml[:ppr_m.start()] + new_ppr + pxml[ppr_m.end():]
    opening = re.match(r'<w:p\b[^>]*>', pxml, re.S)
    if not opening:
        return pxml
    return pxml[:opening.end()] + '<w:pPr>' + prop + '</w:pPr>' + pxml[opening.end():]

xml_names = ['word/document.xml'] + sorted(
    name for name in original
    if re.match(r'^word/(?:header|footer)\d*\.xml$', name)
)
xml_text = {}
for name in xml_names:
    if name in original:
        try:
            xml_text[name] = original[name].decode('utf-8')
        except UnicodeDecodeError:
            xml_text[name] = original[name].decode('utf-8-sig')

for edit in edits:
    action = edit.get('action')
    scope = str(edit.get('scope') or 'target').lower()

    if action == 'set_font_family' and scope == 'document':
        family = str(edit.get('font_family') or '').lower()
        if family not in ('sans', 'serif', 'mono'):
            raise RuntimeError('Unsupported DOCX font family: %s' % family)
        changed = 0
        for name in xml_names:
            text = xml_text.get(name)
            if text is None:
                continue
            def patch_all_runs(match):
                nonlocal_placeholder = None
                rxml = match.group(0)
                if not T_RE.search(rxml):
                    return rxml
                return patch_run_font_family(rxml, family)
            new_text = R_RE.sub(patch_all_runs, text)
            if new_text != text:
                changed += 1
                xml_text[name] = new_text
        if changed < 1:
            raise RuntimeError('Document-wide DOCX font edit found no text runs.')
        continue

    target = str(edit.get('target_text') or '')
    if not target:
        raise RuntimeError('Empty target_text')
    occurrence = max(1, int(edit.get('occurrence') or 1))
    matches = []
    for name in xml_names:
        text = xml_text.get(name)
        if text is None:
            continue
        for pm in P_RE.finditer(text):
            pxml = pm.group(0)
            ptxt = paragraph_text(pxml)
            start = 0
            while True:
                idx = ptxt.find(target, start)
                if idx < 0:
                    break
                matches.append((name, pm.start(), pm.end(), pxml, idx, idx + len(target)))
                start = idx + max(1, len(target))
    if occurrence > len(matches):
        raise RuntimeError("Target not found at requested occurrence: %r (#%d, matches=%d)" % (target, occurrence, len(matches)))

    name, ps, pe, pxml, start, end = matches[occurrence - 1]
    action = edit.get('action')
    if action == 'replace_text':
        new_pxml = replace_text_range(pxml, start, end, str(edit.get('replacement_text') or ''))
    elif action == 'delete_text':
        new_pxml = replace_text_range(pxml, start, end, '')
    elif action in ('set_font_size', 'set_bold', 'set_italic', 'set_font_family'):
        new_pxml = patch_runs_overlapping(pxml, start, end, action, edit)
    elif action == 'set_alignment':
        new_pxml = patch_alignment(pxml, edit.get('alignment') or 'left')
    else:
        raise RuntimeError('Unsupported DOCX edit action: %s' % action)

    if new_pxml == pxml:
        raise RuntimeError('Requested DOCX edit did not modify the target XML.')
    xml_text[name] = xml_text[name][:ps] + new_pxml + xml_text[name][pe:]

modified = dict(original)
for name, text in xml_text.items():
    modified[name] = text.encode('utf-8')

with zipfile.ZipFile(out, 'w') as zout:
    for info in infos:
        data = modified[info.filename]
        new_info = copy.copy(info)
        zout.writestr(new_info, data)
`;

const PDF_EDIT_SCRIPT = String.raw`import json, os, subprocess, sys
import fitz

src, plan_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
with open(plan_path, 'r', encoding='utf-8') as f:
    edits = json.load(f)
doc = fitz.open(src)

def rgb(v):
    try:
        v = int(v)
        return (((v >> 16) & 255)/255.0, ((v >> 8) & 255)/255.0, (v & 255)/255.0)
    except:
        return (0,0,0)

def bg_color(page, rect):
    clip = fitz.Rect(max(page.rect.x0, rect.x0-2), max(page.rect.y0, rect.y0-2),
                     min(page.rect.x1, rect.x1+2), min(page.rect.y1, rect.y1+2))
    try:
        pix = page.get_pixmap(matrix=fitz.Matrix(1,1), clip=clip, alpha=False)
        if pix.width < 1 or pix.height < 1 or pix.n < 3:
            return (1,1,1)
        pts=[]
        for x,y in [(0,0),(pix.width-1,0),(0,pix.height-1),(pix.width-1,pix.height-1)]:
            i=(y*pix.width+x)*pix.n
            pts.append(tuple(pix.samples[i+j]/255.0 for j in range(3)))
        return tuple(sum(p[k] for p in pts)/4 for k in range(3))
    except:
        return (1,1,1)

def best_span(page, rect):
    best, best_area = {}, 0
    for block in page.get_text('dict').get('blocks', []):
        for line in block.get('lines', []):
            for span in line.get('spans', []):
                r=fitz.Rect(span.get('bbox'))
                inter=r & rect
                area=max(0,inter.width)*max(0,inter.height)
                if area > best_area:
                    best, best_area=span, area
    return best

def style_flags(span):
    raw=str(span.get('font') or '').lower()
    bold = any(token in raw for token in ('bold','black','heavy','semibold','demi'))
    italic = any(token in raw for token in ('italic','oblique','slanted'))
    return bold, italic

def builtin_font(family, bold=False, italic=False):
    family=(family or '').lower()
    if family == 'serif':
        if bold and italic: return 'tibi'
        if bold: return 'tibo'
        if italic: return 'tiit'
        return 'tiro'
    if family == 'mono':
        if bold and italic: return 'cobi'
        if bold: return 'cobo'
        if italic: return 'coit'
        return 'cour'
    if bold and italic: return 'hebi'
    if bold: return 'hebo'
    if italic: return 'heit'
    return 'helv'

def unicode_font_name(page, family):
    desired = {
        'serif': 'Noto Serif CJK JP',
        'mono': 'Noto Sans Mono CJK JP',
        'sans': 'Noto Sans CJK JP',
    }.get((family or 'sans').lower(), 'Noto Sans CJK JP')
    try:
        fp=subprocess.check_output(['fc-match','-f','%{file}',desired], text=True).strip()
        if fp and os.path.exists(fp):
            safe_family=(family or 'sans').lower()
            name='PlurilogCJK_' + safe_family
            try:
                page.insert_font(fontname=name, fontfile=fp)
            except:
                pass
            return name
    except:
        pass
    return 'helv'

def font_name(page, span, text, family=None, bold=False, italic=False):
    raw=str(span.get('font') or '').lower()
    existing_bold, existing_italic = style_flags(span)
    if family:
        final_bold = bold or existing_bold
        final_italic = italic or existing_italic
        if any(ord(ch)>127 for ch in text):
            return unicode_font_name(page, family)
        return builtin_font(family, final_bold, final_italic)
    if any(ord(ch)>127 for ch in text):
        return unicode_font_name(page, 'sans')
    if bold: return 'hebo'
    if italic: return 'heit'
    if 'times' in raw or 'serif' in raw: return 'tiro'
    if 'courier' in raw or 'mono' in raw: return 'cour'
    return 'helv'

def iter_text_spans(page):
    for block in page.get_text('dict').get('blocks', []):
        for line in block.get('lines', []):
            direction = line.get('dir') or (1.0, 0.0)
            if abs(float(direction[1] or 0.0)) > 0.01:
                continue
            for span in line.get('spans', []):
                text=str(span.get('text') or '')
                bbox=span.get('bbox')
                if not text or not bbox:
                    continue
                rect=fitz.Rect(bbox)
                if rect.is_empty or rect.width <= 0 or rect.height <= 0:
                    continue
                yield span, text, rect

def apply_document_font_family(page, family):
    items=[]
    for span, text, rect in iter_text_spans(page):
        origin = span.get('origin') or (rect.x0, rect.y1)
        items.append({
            'span': span,
            'text': text,
            'rect': rect,
            'origin': fitz.Point(float(origin[0]), float(origin[1])),
            'background': bg_color(page, rect),
        })
    if not items:
        return 0
    for item in items:
        rect=item['rect']
        pad=max(0.35, float(item['span'].get('size') or 11.0) * 0.035)
        rr=fitz.Rect(rect.x0-pad, rect.y0-pad, rect.x1+pad, rect.y1+pad)
        page.add_redact_annot(rr, fill=item['background'])
    page.apply_redactions(images=0, graphics=0)
    for item in items:
        span=item['span']
        text=item['text']
        size=max(5.0,min(96.0,float(span.get('size') or 11.0)))
        bold, italic=style_flags(span)
        font=font_name(page, span, text, family=family, bold=bold, italic=italic)
        page.insert_text(
            item['origin'], text, fontsize=size, fontname=font,
            color=rgb(span.get('color',0)), overlay=True
        )
    return len(items)

for edit in edits:
    action=edit.get('action')
    scope=str(edit.get('scope') or 'target').lower()

    if action == 'set_font_family' and scope == 'document':
        family=str(edit.get('font_family') or '').lower()
        if family not in ('sans','serif','mono'):
            raise RuntimeError('Unsupported PDF font family: %s' % family)
        changed=0
        for page in doc:
            changed += apply_document_font_family(page, family)
        if changed < 1:
            raise RuntimeError('Document-wide PDF font edit found no text spans.')
        continue

    target=str(edit.get('target_text') or '')
    if not target:
        raise RuntimeError('Empty target_text')
    occ=max(1,int(edit.get('occurrence') or 1))
    page_filter=edit.get('page_number')
    matches=[]
    for pi in range(len(doc)):
        if page_filter and pi+1 != int(page_filter):
            continue
        for rect in doc[pi].search_for(target):
            matches.append((pi,rect))
    if occ > len(matches):
        raise RuntimeError("PDF target not found at requested occurrence: %r (#%d, matches=%d)" % (target,occ,len(matches)))
    pi, rect=matches[occ-1]
    page=doc[pi]
    span=best_span(page,rect)
    text=target
    if action == 'replace_text':
        text=str(edit.get('replacement_text') or '')
    elif action == 'delete_text':
        text=''
    elif action not in ('set_font_size','set_bold','set_italic','set_alignment','set_font_family'):
        raise RuntimeError('Unsupported PDF edit action: %s' % action)

    old_size=float(span.get('size') or 11.0)
    scale=edit.get('font_size_scale')
    delta=edit.get('font_size_delta_pt')
    absolute=edit.get('font_size_pt')
    if scale is not None and abs(float(scale)-1.0) > 0.0001:
        size=old_size*float(scale)
    elif delta is not None and abs(float(delta)) > 0.0001:
        size=old_size+float(delta)
    else:
        size=float(absolute) if absolute is not None else old_size
    size=max(5.0,min(96.0,float(size)))
    pad_x=max(1.5,old_size*0.12)
    pad_y=max(1.0,old_size*0.10)
    rr=fitz.Rect(rect.x0-pad_x,rect.y0-pad_y,rect.x1+pad_x,rect.y1+pad_y)
    page.add_redact_annot(rr, fill=bg_color(page,rect))
    page.apply_redactions(images=0, graphics=0)

    if text:
        scale=max(1.0,len(text)/max(1,len(target)),size/max(1.0,old_size))
        wr=fitz.Rect(
            rect.x0-pad_x, rect.y0-pad_y,
            min(page.rect.x1,rect.x0+(rect.width+2*pad_x)*scale+16),
            min(page.rect.y1,rect.y0+(rect.height+2*pad_y)*max(1.25,scale)+10)
        )
        align_name=edit.get('alignment')
        align=1 if align_name=='center' else 2 if align_name=='right' else 0
        family=str(edit.get('font_family') or '').lower() if action == 'set_font_family' else None
        font=font_name(
            page, span, text, family=family,
            bold=action=='set_bold' and bool(edit.get('value',True)),
            italic=action=='set_italic' and bool(edit.get('value',True))
        )
        rc=page.insert_textbox(
            wr, text, fontsize=size, fontname=font,
            color=rgb(span.get('color',0)), align=align, overlay=True
        )
        if rc < -2:
            raise RuntimeError("Replacement text did not fit target region for %r" % target)

doc.save(out,garbage=3,deflate=True,clean=False)
doc.close()
`;

export type SourceDocumentEditAction =
  | 'replace_text'
  | 'delete_text'
  | 'set_font_size'
  | 'set_font_family'
  | 'set_bold'
  | 'set_italic'
  | 'set_alignment';

export interface SourceDocumentEditOperation {
  action: SourceDocumentEditAction;
  target_text: string;
  occurrence?: number;
  replacement_text?: string;
  font_size_pt?: number;
  font_size_delta_pt?: number;
  font_size_scale?: number;
  font_family?: 'sans' | 'serif' | 'mono';
  scope?: 'target' | 'document';
  value?: boolean;
  alignment?: 'left' | 'center' | 'right' | 'justify';
  page_number?: number;
}

export interface SourceDocumentEditArgs {
  source_filename?: string;
  filename?: string;
  edits: SourceDocumentEditOperation[];
}

export interface ExecuteSourceDocumentEditOptions {
  supabase: any;
  openai: any;
  discussionId: string;
  messageId: string;
  seatId: ModelId;
  sourceStoragePath: string;
  sourceFilename: string;
  sourceDocumentId?: string | null;
  parentSnapshot?: DocumentStateSnapshot | null;
  args: SourceDocumentEditArgs;
  signal?: AbortSignal;
}

export interface ExecuteSourceDocumentEditResult {
  finalContent: string;
  format: 'docx' | 'pdf';
  messageId: string;
  createdAt: string;
  filename: string;
  storagePath: string;
  signedUrl: string;
  durableUrl: string;
  fullText: string;
  sourceRenderedPageAttachments: Array<{ url: string; filename: string }>;
  renderedPageAttachments: Array<{ url: string; filename: string }>;
  documentId?: string | null;
  documentStateId?: string | null;
  pageCount?: number | null;
  visualReviewCostUsd: number;
  visualReviewApplied: boolean;
  imageAssetCount: number;
  imageCostUsd: number;
}

interface EditedBytesResult {
  buffer: Buffer;
  fullText: string;
  sourcePageCount: number | null;
  pageCount: number | null;
  sourcePages: Array<{
    pageNumber: number;
    data: Buffer;
    contentType: 'image/png';
  }>;
  pages: Array<{
    pageNumber: number;
    data: Buffer;
    contentType: 'image/png';
  }>;
}

function cleanOutputFilename(sourceFilename: string, requested?: string): string {
  const source = (sourceFilename || 'document').split(/[\\/]/).pop() || 'document';
  const ext = source.toLowerCase().endsWith('.pdf') ? '.pdf' : '.docx';
  if (requested && requested.trim()) {
    const clean = requested
      .split(/[\\/]/)
      .pop()!
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[<>:"/\\|?*]/g, '-')
      .trim();
    const base = clean.replace(/\.(pdf|docx)$/i, '').trim() || 'document-edited';
    return base + ext;
  }
  const base = source.replace(/\.(pdf|docx)$/i, '').trim() || 'document';
  return base + '-edited' + ext;
}

function validateEdits(edits: SourceDocumentEditOperation[]): void {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new Error('At least one source-document edit is required.');
  }
  if (edits.length > 24) {
    throw new Error('A source-preserving edit is limited to 24 targeted operations.');
  }
  for (let i = 0; i < edits.length; i += 1) {
    const edit = edits[i];
    if (!edit || typeof edit.target_text !== 'string' || !edit.target_text.trim()) {
      throw new Error('Source-document edit #' + (i + 1) + ' requires exact target_text.');
    }
    if (edit.action === 'replace_text' && typeof edit.replacement_text !== 'string') {
      throw new Error('replace_text edit #' + (i + 1) + ' requires replacement_text.');
    }
    if (
      edit.action === 'set_font_size' &&
      typeof edit.font_size_pt !== 'number' &&
      typeof edit.font_size_delta_pt !== 'number' &&
      typeof edit.font_size_scale !== 'number'
    ) {
      throw new Error(
        'set_font_size edit #' + (i + 1) + ' requires font_size_pt, font_size_delta_pt, or font_size_scale.'
      );
    }
    if (
      edit.action === 'set_alignment' &&
      !['left', 'center', 'right', 'justify'].includes(edit.alignment || '')
    ) {
      throw new Error('set_alignment edit #' + (i + 1) + ' requires alignment.');
    }
  }
}

async function assertCommand(
  result: Awaited<ReturnType<InstanceType<typeof Sandbox>['runCommand']>>,
  label: string
): Promise<void> {
  if (result.exitCode === 0) return;
  const stderr = (await result.stderr()).trim();
  const stdout = (await result.stdout()).trim();
  throw new Error(
    label +
      ' failed (exit ' +
      result.exitCode +
      '): ' +
      (stderr || stdout || 'unknown error').slice(-4000)
  );
}

async function createEditSandbox(timeoutMs: number, signal?: AbortSignal) {
  if (signal && signal.aborted) {
    throw new DOMException('Document edit aborted.', 'AbortError');
  }
  const sandbox = await Sandbox.create({
    source: { type: 'snapshot', snapshotId: SOURCE_EDIT_SNAPSHOT_ID },
    persistent: false,
    timeout: timeoutMs,
    networkPolicy: 'allow-all',
  });
  const abort = () => {
    void sandbox.stop().catch(() => undefined);
  };
  if (signal) signal.addEventListener('abort', abort, { once: true });
  return { sandbox, abort };
}

async function editDocxBytes(
  source: Buffer,
  edits: SourceDocumentEditOperation[],
  signal?: AbortSignal
): Promise<EditedBytesResult> {
  const created = await createEditSandbox(90_000, signal);
  const sandbox = created.sandbox;
  try {
    await sandbox.writeFiles([
      { path: '/vercel/sandbox/input.docx', content: source },
      {
        path: '/vercel/sandbox/plan.json',
        content: Buffer.from(JSON.stringify(edits), 'utf8'),
      },
      {
        path: '/vercel/sandbox/edit_docx.py',
        content: Buffer.from(DOCX_EDIT_SCRIPT, 'utf8'),
      },
    ]);
    const run = await sandbox.runCommand({
      cmd: 'python3',
      args: [
        '/vercel/sandbox/edit_docx.py',
        '/vercel/sandbox/input.docx',
        '/vercel/sandbox/plan.json',
        '/vercel/sandbox/output.docx',
      ],
    });
    await assertCommand(run, 'Source-preserving DOCX edit');
    const output = await sandbox.readFileToBuffer({
      path: '/vercel/sandbox/output.docx',
    });
    if (!output || !output.length) {
      throw new Error('DOCX edit produced an empty file.');
    }
    const parsed = await parseDocx(output);
    const sourceRendered = await renderDocxPages(source, {
      signal,
      timeoutMs: 60_000,
    });
    const rendered = await renderDocxPages(output, {
      signal,
      timeoutMs: 60_000,
    });
    return {
      buffer: output,
      fullText: parsed.markdown || rendered.renderedText || '',
      sourcePageCount: sourceRendered.totalPageCount,
      pageCount: rendered.totalPageCount,
      sourcePages: sourceRendered.pages,
      pages: rendered.pages,
    };
  } finally {
    if (signal) signal.removeEventListener('abort', created.abort);
    await sandbox.stop().catch(() => undefined);
  }
}

async function editPdfBytes(
  source: Buffer,
  edits: SourceDocumentEditOperation[],
  signal?: AbortSignal
): Promise<EditedBytesResult> {
  const created = await createEditSandbox(120_000, signal);
  const sandbox = created.sandbox;
  try {
    await sandbox.writeFiles([
      { path: '/vercel/sandbox/input.pdf', content: source },
      {
        path: '/vercel/sandbox/plan.json',
        content: Buffer.from(JSON.stringify(edits), 'utf8'),
      },
      {
        path: '/vercel/sandbox/edit_pdf.py',
        content: Buffer.from(PDF_EDIT_SCRIPT, 'utf8'),
      },
    ]);
    const ensure = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        "python3 -c 'import fitz' >/dev/null 2>&1 || python3 -m pip install --quiet --disable-pip-version-check 'PyMuPDF==1.26.4'",
      ],
    });
    await assertCommand(ensure, 'PyMuPDF setup');
    const run = await sandbox.runCommand({
      cmd: 'python3',
      args: [
        '/vercel/sandbox/edit_pdf.py',
        '/vercel/sandbox/input.pdf',
        '/vercel/sandbox/plan.json',
        '/vercel/sandbox/output.pdf',
      ],
    });
    await assertCommand(run, 'Source-preserving PDF edit');

    const sourceInfo = await sandbox.runCommand({
      cmd: 'pdfinfo',
      args: ['/vercel/sandbox/input.pdf'],
    });
    await assertCommand(sourceInfo, 'Source PDF inspection');
    const sourceInfoText = await sourceInfo.stdout();
    const sourcePageMatch = sourceInfoText.match(/^Pages:\s+(\d+)$/im);
    const sourcePageCount = sourcePageMatch ? Number(sourcePageMatch[1]) : null;

    const info = await sandbox.runCommand({
      cmd: 'pdfinfo',
      args: ['/vercel/sandbox/output.pdf'],
    });
    await assertCommand(info, 'Edited PDF inspection');
    const infoText = await info.stdout();
    const pageMatch = infoText.match(/^Pages:\s+(\d+)$/im);
    const pageCount = pageMatch ? Number(pageMatch[1]) : null;

    const text = await sandbox.runCommand({
      cmd: 'pdftotext',
      args: ['/vercel/sandbox/output.pdf', '-'],
    });
    await assertCommand(text, 'Edited PDF text extraction');
    const fullText = (await text.stdout()).trim();

    const sourceRender = await sandbox.runCommand({
      cmd: 'pdftoppm',
      args: [
        '-png',
        '-r',
        '120',
        '-f',
        '1',
        '-l',
        String(MAX_RENDERED_PAGES),
        '/vercel/sandbox/input.pdf',
        '/vercel/sandbox/source-page',
      ],
    });
    await assertCommand(sourceRender, 'Source PDF rendering');

    const render = await sandbox.runCommand({
      cmd: 'pdftoppm',
      args: [
        '-png',
        '-r',
        '120',
        '-f',
        '1',
        '-l',
        String(MAX_RENDERED_PAGES),
        '/vercel/sandbox/output.pdf',
        '/vercel/sandbox/page',
      ],
    });
    await assertCommand(render, 'Edited PDF rendering');

    const sourceListing = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        "find /vercel/sandbox -maxdepth 1 -type f -name 'source-page-*.png' -printf '%f\\n' | sort -V",
      ],
    });
    await assertCommand(sourceListing, 'Source PDF page enumeration');

    const listing = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        "find /vercel/sandbox -maxdepth 1 -type f -name 'page-*.png' -printf '%f\\n' | sort -V",
      ],
    });
    await assertCommand(listing, 'Edited PDF page enumeration');
    const sourceNames = (await sourceListing.stdout())
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, MAX_RENDERED_PAGES);
    const names = (await listing.stdout())
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, MAX_RENDERED_PAGES);

    const sourcePages: EditedBytesResult['sourcePages'] = [];
    for (let i = 0; i < sourceNames.length; i += 1) {
      const data = await sandbox.readFileToBuffer({
        path: '/vercel/sandbox/' + sourceNames[i],
      });
      if (data && data.length) {
        sourcePages.push({
          pageNumber: i + 1,
          data,
          contentType: 'image/png',
        });
      }
    }

    const pages: EditedBytesResult['pages'] = [];
    for (let i = 0; i < names.length; i += 1) {
      const data = await sandbox.readFileToBuffer({
        path: '/vercel/sandbox/' + names[i],
      });
      if (data && data.length) {
        pages.push({
          pageNumber: i + 1,
          data,
          contentType: 'image/png',
        });
      }
    }

    const output = await sandbox.readFileToBuffer({
      path: '/vercel/sandbox/output.pdf',
    });
    if (!output || !output.length) {
      throw new Error('PDF edit produced an empty file.');
    }
    return {
      buffer: output,
      fullText,
      sourcePageCount:
        typeof sourcePageCount === 'number' && Number.isFinite(sourcePageCount)
          ? sourcePageCount
          : null,
      pageCount:
        typeof pageCount === 'number' && Number.isFinite(pageCount)
          ? pageCount
          : null,
      sourcePages,
      pages,
    };
  } finally {
    if (signal) signal.removeEventListener('abort', created.abort);
    await sandbox.stop().catch(() => undefined);
  }
}

async function persistAssistantMessage(options: {
  supabase: any;
  discussionId: string;
  messageId: string;
  seatId: ModelId;
  content: string;
}): Promise<{ id: string; created_at: string }> {
  const result = await options.supabase
    .from('messages')
    .insert({
      id: options.messageId,
      discussion_id: options.discussionId,
      sender: options.seatId,
      content: options.content,
    })
    .select('id, created_at')
    .maybeSingle();

  if (!result.error && result.data) return result.data;

  if (result.error && result.error.code === '23505') {
    const existing = await options.supabase
      .from('messages')
      .select('id, created_at')
      .eq('id', options.messageId)
      .eq('discussion_id', options.discussionId)
      .eq('sender', options.seatId)
      .maybeSingle();
    if (!existing.error && existing.data) return existing.data;
  }

  throw new Error(
    'Failed to persist source-document edit response: ' +
      (result.error?.message || 'missing message')
  );
}

export function isSourcePreservingDocumentState(
  snapshot: DocumentStateSnapshot | null | undefined
): boolean {
  return Boolean(snapshot?.spec?.source_preserving?.engine === 'native-source-edit-v1');
}

export async function executeSourcePreservingDocumentEdit(
  options: ExecuteSourceDocumentEditOptions
): Promise<ExecuteSourceDocumentEditResult> {
  if (
    !options.discussionId ||
    !options.sourceStoragePath ||
    !options.sourceFilename
  ) {
    throw new Error('A concrete source document is required for editing.');
  }

  validateEdits(options.args.edits);

  console.log('[Source Document Edit] Starting', {
    discussionId: options.discussionId,
    sourceFilename: options.sourceFilename,
    sourceStoragePath: options.sourceStoragePath,
    editCount: options.args.edits.length,
    hasParentSnapshot: Boolean(options.parentSnapshot),
  });

  const format: 'docx' | 'pdf' =
    options.sourceFilename.toLowerCase().endsWith('.pdf')
      ? 'pdf'
      : options.sourceFilename.toLowerCase().endsWith('.docx')
        ? 'docx'
        : (() => {
            throw new Error(
              'Source-preserving editing currently supports PDF and DOCX.'
            );
          })();

  const serviceClient = createServiceClient();
  const downloaded = await serviceClient.storage
    .from('message-images')
    .download(options.sourceStoragePath);

  if (downloaded.error || !downloaded.data) {
    throw new Error(
      'Could not load source document: ' +
        (downloaded.error?.message || 'not found')
    );
  }

  const sourceBytes = Buffer.from(await downloaded.data.arrayBuffer());
  if (
    !sourceBytes.length ||
    sourceBytes.length > MAX_SOURCE_DOCUMENT_BYTES
  ) {
    throw new Error(
      'Source document size is unsupported (' + sourceBytes.length + ' bytes).'
    );
  }

  const edited =
    format === 'docx'
      ? await editDocxBytes(sourceBytes, options.args.edits, options.signal)
      : await editPdfBytes(sourceBytes, options.args.edits, options.signal);

  const baselinePageCount =
    options.parentSnapshot?.pageCount || edited.sourcePageCount || null;
  if (
    baselinePageCount &&
    edited.pageCount &&
    baselinePageCount !== edited.pageCount
  ) {
    throw new Error(
      'Source-preserving edit changed page count from ' +
        baselinePageCount +
        ' to ' +
        edited.pageCount +
        '. The requested narrow edit was not saved because unrelated pagination changed.'
    );
  }

  const filename = cleanOutputFilename(
    options.sourceFilename,
    options.args.filename
  );
  const finalContent = 'Edited **' + filename + '**.';
  const persistedMsg = await persistAssistantMessage({
    supabase: options.supabase,
    discussionId: options.discussionId,
    messageId: options.messageId,
    seatId: options.seatId,
    content: finalContent,
  });

  const persisted = await persistGeneratedDocument({
    supabase: options.supabase,
    discussionId: options.discussionId,
    messageId: persistedMsg.id,
    seatId: options.seatId,
    fileBuffer: edited.buffer,
    filename,
    format,
  });

  let sourceRenderedPageAttachments: Array<{
    url: string;
    filename: string;
  }> = [];
  let renderedPageAttachments: Array<{
    url: string;
    filename: string;
  }> = [];

  try {
    if (format === 'docx') {
      const sourcePages = await persistDocxRenderedPages({
        supabase: options.supabase,
        parentFilename: options.sourceFilename,
        parentFileBytes: sourceBytes,
        pages: edited.sourcePages,
      });
      sourceRenderedPageAttachments = sourcePages.map((page) => ({
        url: page.signedUrl,
        filename: page.filename,
      }));
      const pages = await persistDocxRenderedPages({
        supabase: options.supabase,
        parentFilename: persisted.filename,
        parentFileBytes: edited.buffer,
        pages: edited.pages,
      });
      renderedPageAttachments = pages.map((page) => ({
        url: page.signedUrl,
        filename: page.filename,
      }));
    } else {
      const sourcePages = await persistPdfRenderedPages({
        supabase: options.supabase,
        parentFilename: options.sourceFilename,
        parentFileBytes: sourceBytes,
        pages: edited.sourcePages,
      });
      sourceRenderedPageAttachments = sourcePages.map((page) => ({
        url: page.signedUrl,
        filename: page.filename,
      }));
      const pages = await persistPdfRenderedPages({
        supabase: options.supabase,
        parentFilename: persisted.filename,
        parentFileBytes: edited.buffer,
        pages: edited.pages,
      });
      renderedPageAttachments = pages.map((page) => ({
        url: page.signedUrl,
        filename: page.filename,
      }));
    }
  } catch (pageError) {
    console.warn(
      '[Source Document Edit] Non-critical rendered-page persistence error:',
      pageError
    );
  }

  try {
    await ingestParsedDocument({
      serviceSupabase: serviceClient,
      openai: options.openai,
      discussionId: options.discussionId,
      filename: persisted.filename,
      fullText: edited.fullText,
      fileBytes: edited.buffer,
      storagePath: persisted.storagePath,
      signal: options.signal,
    });
  } catch (ingestError) {
    console.warn(
      '[Source Document Edit] Non-critical indexing error:',
      ingestError
    );
  }

  let documentId: string | null = null;
  let documentStateId: string | null = null;

  try {
    const indexed = await serviceClient
      .from('discussion_documents')
      .select('id')
      .eq('discussion_id', options.discussionId)
      .eq('storage_path', persisted.storagePath)
      .maybeSingle();

    documentId = indexed.data?.id || null;

    const previousHistory = Array.isArray(
      options.parentSnapshot?.spec?.source_preserving?.edit_history
    )
      ? options.parentSnapshot!.spec.source_preserving.edit_history
      : [];

    const state = await persistDocumentStateSnapshot({
      serviceSupabase: serviceClient,
      discussionId: options.discussionId,
      documentId,
      filename: persisted.filename,
      storagePath: persisted.storagePath,
      messageId: persistedMsg.id,
      format,
      spec: {
        source_preserving: {
          engine: 'native-source-edit-v1',
          format,
          original_storage_path:
            options.parentSnapshot?.spec?.source_preserving
              ?.original_storage_path || options.sourceStoragePath,
          original_filename:
            options.parentSnapshot?.spec?.source_preserving?.original_filename ||
            options.sourceFilename,
          edit_history: [
            ...previousHistory,
            {
              source_storage_path: options.sourceStoragePath,
              edits: options.args.edits,
            },
          ].slice(-20),
        },
      },
      fullText: edited.fullText,
      pageCount: edited.pageCount,
      parentSnapshotId: options.parentSnapshot?.id || null,
      parentDocumentId:
        options.parentSnapshot?.documentId || options.sourceDocumentId || null,
      parentStoragePath:
        options.parentSnapshot?.storagePath || options.sourceStoragePath,
      sourceDocumentIds: Array.from(
        new Set(
          [
            ...(options.parentSnapshot?.sourceDocumentIds || []),
            options.sourceDocumentId || null,
          ].filter((value): value is string => Boolean(value))
        )
      ),
      generationKind: 'revision',
    });

    documentStateId = state?.id || null;
  } catch (stateError) {
    console.warn(
      '[Source Document Edit] Non-critical state persistence error:',
      stateError
    );
  }

  console.log('[Source Document Edit] Completed', {
    discussionId: options.discussionId,
    sourceFilename: options.sourceFilename,
    outputFilename: persisted.filename,
    format,
    sourcePageCount: edited.sourcePageCount,
    pageCount: edited.pageCount,
    documentId,
    documentStateId,
  });

  return {
    finalContent,
    format,
    messageId: persistedMsg.id,
    createdAt: persistedMsg.created_at,
    filename: persisted.filename,
    storagePath: persisted.storagePath,
    signedUrl: persisted.signedUrl,
    durableUrl: persisted.durableUrl,
    fullText: edited.fullText,
    sourceRenderedPageAttachments,
    renderedPageAttachments,
    documentId,
    documentStateId,
    pageCount: edited.pageCount,
    visualReviewCostUsd: 0,
    visualReviewApplied: false,
    imageAssetCount: 0,
    imageCostUsd: 0,
  };
}
