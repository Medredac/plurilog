import crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { Sandbox } from '@vercel/sandbox';
import type { RichDocumentBlock } from './richPdfRenderer';
import type { KnownDiscussionDocument } from './discussionMemory';

export const MAX_REBUILT_PHOTOS = 32;

// Read-only extraction. Caption geometry, not XObject enumeration or portrait
// ranking, binds Photo N to its original image. Never infer a missing label.
export const PDF_PHOTO_EXTRACT_SCRIPT = String.raw`
import fitz, json, os, re, sys
doc = fitz.open(sys.argv[1])
out = sys.argv[2]
os.makedirs(out, exist_ok=True)
photos = []
seen = set()
total_bytes = 0
for pi, page in enumerate(doc):
    words = page.get_text('words')
    labels = []
    for i, word in enumerate(words[:-1]):
        nxt = words[i+1]
        if word[4].lower() != 'photo' or not re.fullmatch(r'\d+[.:]?', nxt[4]): continue
        if abs(word[1]-nxt[1]) > 3 or nxt[0] < word[2] or nxt[0]-word[2] > 24: continue
        labels.append((int(nxt[4].rstrip('.:')), fitz.Rect(word[:4]) | fitz.Rect(nxt[:4])))
    images = [x for x in page.get_image_info(xrefs=True) if x['width'] >= 80 and x['height'] >= 80]
    used = set()
    for number, label in labels:
        if number in seen: raise RuntimeError('Duplicate Photo label: %d' % number)
        cx = (label.x0+label.x1)/2
        candidates = []
        for ii, info in enumerate(images):
            r = fitz.Rect(info['bbox'])
            if ii in used or r.y0 < label.y1-3 or not (r.x0-30 <= cx <= r.x1+10): continue
            if r.y0-label.y1 > 160: continue
            # A following label in this same column means this is a different photo.
            if any(other.y0 > label.y1 and other.y0 < r.y0 and r.x0-30 <= (other.x0+other.x1)/2 <= r.x1+10 for _,other in labels): continue
            candidates.append((r.y0-label.y1, ii, info))
        candidates.sort(key=lambda x:x[0])
        if not candidates or (len(candidates)>1 and abs(candidates[0][0]-candidates[1][0])<2):
            raise RuntimeError('Cannot uniquely bind Photo %d to an image on page %d' % (number, pi+1))
        _, ii, info = candidates[0]
        xref = info.get('xref',0)
        if not xref: raise RuntimeError('Photo %d has no extractable original image' % number)
        if info['width']*info['height'] > 25000000: raise RuntimeError('Photo exceeds pixel budget')
        payload = doc.extract_image(xref)
        if payload.get('smask',0):
            pix = fitz.Pixmap(fitz.Pixmap(doc,xref),fitz.Pixmap(doc,payload['smask']))
            data, ext = pix.tobytes('png'), 'png'
        else:
            data, ext = payload['image'], payload['ext']
            if ext not in ('jpeg','jpg','png'):
                data, ext = fitz.Pixmap(doc,xref).tobytes('png'), 'png'
        if len(data)>15*1024*1024: raise RuntimeError('Photo exceeds byte budget')
        total_bytes += len(data)
        if total_bytes>100*1024*1024: raise RuntimeError('Photo set exceeds byte budget')
        name = 'photo-%03d.%s' % (number,ext)
        with open(os.path.join(out,name),'wb') as f: f.write(data)
        photos.append({'number':number,'page':pi+1,'name':name,'width':info['width'],'height':info['height'],'sha256':__import__('hashlib').sha256(data).hexdigest()})
        seen.add(number)
        used.add(ii)
        if len(photos)>32: raise RuntimeError('Photo set exceeds 32-photo limit')
    if len(used)!=len(images):
        raise RuntimeError('Not every image on photo page %d has a verified caption binding' % (pi+1))
if not photos: raise RuntimeError('No unambiguous numbered photo collection found')
photos.sort(key=lambda x:x['number'])
if [p['number'] for p in photos] != list(range(1,len(photos)+1)):
    raise RuntimeError('Photo numbering is incomplete; refusing a partial rebuild')
print(json.dumps(photos))
`;

export function photoNumber(block: RichDocumentBlock): number | null {
  if (block.type !== 'image') return null;
  const fields = [block.need, block.filename, block.caption].filter(Boolean).join('\n');
  const numbers = [...fields.matchAll(/\bphoto\s*#?\s*(\d+)\b/gi)].map(m => Number(m[1]));
  const unique = [...new Set(numbers)];
  return unique.length === 1 && unique[0] > 0 ? unique[0] : null;
}

export function validatePhotoRebuildBlocks(blocks: RichDocumentBlock[], numbers: number[]) {
  const images = blocks.filter(b => b.type === 'image');
  if (images.length > MAX_REBUILT_PHOTOS) throw new Error('A photo rebuild supports at most 32 photos.');
  const requested = images.map(photoNumber);
  if (images.some(b => b.type !== 'image' || b.mode !== 'existing') || requested.some(n => n === null) ||
      requested.length !== numbers.length || requested.some((n,i) => n !== numbers[i])) {
    throw new Error(`A complete source-PDF rebuild must reuse Photos ${numbers.join(', ')} exactly once, in source order. No photo was omitted or substituted.`);
  }
}

export function selectPhotoRebuildSource(filename: string, documents: KnownDiscussionDocument[]) {
  const matches = documents.filter(d => d.filename.toLowerCase() === filename.trim().toLowerCase() && /\.pdf$/i.test(d.filename));
  const distinct = [...new Map(matches.map(d => [d.id || d.storagePath, d])).values()];
  if (distinct.length !== 1 || !distinct[0].storagePath) throw new Error('The photo rebuild needs one exact, known source PDF.');
  return distinct[0];
}

export async function preparePdfPhotoRebuild(options: {
  supabase: SupabaseClient; serviceClient: SupabaseClient; discussionId: string; source: KnownDiscussionDocument;
  blocks: RichDocumentBlock[]; signal?: AbortSignal;
}) {
  const { supabase, serviceClient, discussionId, source, blocks, signal } = options;
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || !source.storagePath?.startsWith(`${user.id}/`)) throw new Error('Source PDF ownership could not be verified.');
  const { data: owned } = await supabase.from('discussions').select('id').eq('id', discussionId).eq('user_id', user.id).maybeSingle();
  if (!owned) throw new Error('Discussion ownership could not be verified.');
  if (signal?.aborted) throw new DOMException('Photo rebuild aborted', 'AbortError');
  const { data: blob, error } = await serviceClient.storage.from('message-images').download(source.storagePath);
  if (error || !blob || blob.size > 25*1024*1024) throw new Error('Source PDF unavailable or exceeds the 25 MB extraction limit.');
  const bytes = Buffer.from(await blob.arrayBuffer());
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  if (source.fileHash && source.fileHash !== hash) throw new Error('Source PDF byte identity changed.');
  const sandbox = await Sandbox.create({ source: { type: 'snapshot', snapshotId: 'snap_vwQhLmdtlIxq4OliWzLOjVlHEzuD' }, persistent: false, timeout: 120_000, networkPolicy: 'allow-all' });
  const abort = () => { void sandbox.stop().catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  try {
    if (signal?.aborted) throw new DOMException('Photo rebuild aborted', 'AbortError');
    await sandbox.writeFiles([{ path: '/vercel/sandbox/source.pdf', content: bytes }, { path: '/vercel/sandbox/photos.py', content: Buffer.from(PDF_PHOTO_EXTRACT_SCRIPT) }]);
    const install = await sandbox.runCommand({ cmd: 'sh', args: ['-lc', "python3 -c 'import fitz' >/dev/null 2>&1 || python3 -m pip install --quiet --disable-pip-version-check 'PyMuPDF==1.26.4'"] });
    if (install.exitCode !== 0) throw new Error('PDF photo extractor unavailable.');
    const result = await sandbox.runCommand({ cmd: 'python3', args: ['/vercel/sandbox/photos.py', '/vercel/sandbox/source.pdf', '/vercel/sandbox/photos'] });
    if (result.exitCode !== 0) throw new Error(`PDF photo extraction failed: ${(await result.stderr()).slice(-1200)}`);
    const manifest: Array<{number:number;page:number;name:string;width:number;height:number;sha256:string}> = JSON.parse(await result.stdout());
    validatePhotoRebuildBlocks(blocks, manifest.map(p => p.number));
    const sources = [];
    for (const photo of manifest) {
      if (signal?.aborted) throw new DOMException('Photo rebuild aborted', 'AbortError');
      if (!/^photo-\d+\.(png|jpeg|jpg)$/.test(photo.name)) throw new Error('Invalid extracted photo path.');
      const data = await sandbox.readFileToBuffer({ path: `/vercel/sandbox/photos/${photo.name}` });
      if (!data || crypto.createHash('sha256').update(data).digest('hex') !== photo.sha256) throw new Error('Extracted photo verification failed.');
      const ext = photo.name.split('.').pop();
      const contentType = ext === 'png' ? 'image/png' : 'image/jpeg';
      const storagePath = `${user.id}/pdf-assets/${hash}/photo-${String(photo.number).padStart(3,'0')}-${photo.sha256.slice(0,16)}.${ext}`;
      const filename = `${source.filename.replace(/\.pdf$/i,'')} — Photo ${photo.number} (page ${photo.page}).${ext}`;
      const { error: uploadError } = await supabase.storage.from('message-images').upload(storagePath,data,{contentType,upsert:false});
      if (uploadError && !/already exists|duplicate/i.test(uploadError.message || '')) throw new Error('Could not preserve extracted photo.');
      sources.push({ number: photo.number, filename, storagePath, data, contentType });
    }
    console.log('[PDF Photo Rebuild]', { discussionId, sourceFilename: source.filename, photoCount: sources.length, originalBytes: bytes.length, extractedBytes: sources.reduce((sum,p)=>sum+p.data.length,0) });
    return sources;
  } finally {
    signal?.removeEventListener('abort',abort);
    await sandbox.stop().catch(() => undefined);
  }
}
