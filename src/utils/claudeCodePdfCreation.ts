import { Buffer } from 'node:buffer';
import { Sandbox } from '@vercel/sandbox';
import {
  generateGeminiImage,
  generateChatGPTImage,
  editGeminiImage,
  editChatGPTImage,
} from '@/utils/openrouterImages';
import {
  resolveRequestedEvidence,
  type ResourceBrokerContext,
} from '@/utils/resourceBroker';

export interface CodePdfImageRequest {
  id: string;
  mode: 'existing' | 'generate' | 'edit';
  prompt?: string;
  need?: string;
  filename?: string;
}

export interface ClaudeCodePdfArgs {
  filename: string;
  python: string;
  target_page_count?: number;
  images?: CodePdfImageRequest[];
}

export interface CodePdfImageSource {
  filename: string;
  storagePath?: string | null;
  url?: string | null;
}

export interface CodePdfImageCostEvent {
  costUsd: number;
  model: string;
  operation: 'generate' | 'edit';
}

export interface CreateClaudeCodePdfOptions {
  openai: any;
  serviceClient: any;
  args: ClaudeCodePdfArgs;
  signal?: AbortSignal;
  availableImages?: CodePdfImageSource[];
  resourceContext?: ResourceBrokerContext;
  reviewModel?: string;
  reviewModels?: string[];
  originalUserPrompt?: string;
  reviewSessionId?: string | null;
  onImageCost?: (event: CodePdfImageCostEvent) => void;
}

export interface CreateClaudeCodePdfResult {
  buffer: Buffer;
  filename: string;
  fullText: string;
  pageCount: number | null;
  initialPageCount: number | null;
  imageAssetCount: number;
  imageCostUsd: number;
  imageModels: string[];
  visualReviewCostUsd: number;
  visualReviewApplied: boolean;
  reviewRationale: string;
}

interface RenderedPage {
  pageNumber: number;
  data: Buffer;
  contentType: 'image/png';
}

interface CodeRunResult {
  buffer: Buffer;
  pageCount: number | null;
  fullText: string;
  reviewPages: RenderedPage[];
  elapsedMs: number;
}

const MAX_IMAGE_ASSETS = 12;
const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const MAX_CODE_CHARS = 180_000;
const MAX_REVIEW_PAGES = 6;

function clean(value: unknown, max = 10000): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\u0000/g, '').trim().slice(0, max);
}

function sanitizePdfFilename(value: string): string {
  const raw = clean(value, 160) || 'document.pdf';
  const base = (raw.split(/[\\/]/).pop() || 'document')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/\.pdf$/i, '')
    .slice(0, 130) || 'document';
  return `${base}.pdf`;
}

function mediaTypeFromFilename(filename?: string | null): string {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  return 'image/png';
}

function extensionFromMediaType(contentType: string): string {
  const type = contentType.toLowerCase();
  if (type.includes('jpeg') || type.includes('jpg')) return '.jpg';
  if (type.includes('webp')) return '.webp';
  if (type.includes('gif')) return '.gif';
  if (type.includes('bmp')) return '.bmp';
  return '.png';
}

function cleanMediaType(value?: string | null, filename?: string | null): string {
  const normalized = (value || '').split(';')[0].trim().toLowerCase();
  return normalized.startsWith('image/')
    ? normalized
    : mediaTypeFromFilename(filename);
}

function isImageFilename(value?: string | null): boolean {
  if (!value) return false;
  const path = value.split('?')[0].split('#')[0].toLowerCase();
  return /\.(png|jpe?g|webp|gif|bmp)$/.test(path);
}

function scoreImageSource(
  source: CodePdfImageSource,
  need: string,
  filename?: string
): number {
  const sourceName = (source.filename || '').toLowerCase();
  const wanted = (filename || '').trim().toLowerCase();
  if (wanted && sourceName === wanted) return 1000;
  if (wanted && sourceName.includes(wanted)) return 800;
  const tokens = `${need} ${filename || ''}`
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g) || [];
  let score = 0;
  for (const token of tokens) if (sourceName.includes(token)) score += 20;
  return score;
}

function fallbackResolveImageSource(
  availableImages: CodePdfImageSource[],
  need: string,
  filename?: string
): CodePdfImageSource | null {
  const candidates = availableImages.filter((source) =>
    isImageFilename(source.filename || source.url || source.storagePath)
  );
  if (candidates.length === 0) return null;
  const ranked = candidates
    .map((source) => ({
      source,
      score: scoreImageSource(source, need, filename),
    }))
    .sort((a, b) => b.score - a.score);
  if (
    ranked[0]?.score > 0 &&
    (!ranked[1] || ranked[0].score > ranked[1].score)
  ) {
    return ranked[0].source;
  }
  return candidates.length === 1 ? candidates[0] : null;
}

async function downloadImageBytes(
  serviceClient: any,
  source: CodePdfImageSource,
  signal?: AbortSignal
): Promise<{ data: Buffer; contentType: string }> {
  let data: Buffer;
  let contentType = mediaTypeFromFilename(source.filename);

  if (source.storagePath) {
    const { data: blob, error } = await serviceClient.storage
      .from('message-images')
      .download(source.storagePath);
    if (error || !blob) {
      throw new Error(
        `Failed to load PDF image asset: ${error?.message || 'Not found'}`
      );
    }
    data = Buffer.from(await blob.arrayBuffer());
    contentType = cleanMediaType(blob.type, source.filename);
  } else if (source.url) {
    const response = await fetch(source.url, { signal });
    if (!response.ok) {
      throw new Error(
        `Failed to fetch PDF image asset (HTTP ${response.status}).`
      );
    }
    data = Buffer.from(await response.arrayBuffer());
    contentType = cleanMediaType(
      response.headers.get('content-type'),
      source.filename
    );
  } else {
    throw new Error('Resolved PDF image asset has no retrievable source.');
  }

  if (!data.length) throw new Error('Resolved PDF image asset is empty.');
  if (data.length > MAX_IMAGE_BYTES) {
    throw new Error('PDF image asset exceeds the 15 MB image limit.');
  }
  return { data, contentType };
}

async function signImageSource(
  serviceClient: any,
  source: CodePdfImageSource
): Promise<string> {
  if (source.url) return source.url;
  if (!source.storagePath) {
    throw new Error('PDF image source cannot be signed.');
  }
  const { data, error } = await serviceClient.storage
    .from('message-images')
    .createSignedUrl(source.storagePath, 900);
  if (error || !data?.signedUrl) {
    throw new Error(
      `Failed to sign PDF image source: ${error?.message || 'Unknown error'}`
    );
  }
  return data.signedUrl;
}

async function generatePdfImage(
  prompt: string,
  signal: AbortSignal | undefined,
  onImageCost?: (event: CodePdfImageCostEvent) => void
): Promise<{ data: Buffer; contentType: string; model: string }> {
  const instruction = clean(prompt, 8000);
  if (!instruction) {
    throw new Error('Generated PDF image assets require a prompt.');
  }

  let result;
  try {
    result = await generateGeminiImage({ prompt: instruction, signal });
  } catch (geminiErr) {
    console.warn(
      '[Code PDF] Gemini image generation failed; falling back to GPT Image:',
      geminiErr
    );
    result = await generateChatGPTImage({ prompt: instruction, signal });
  }

  if (typeof result.costUsd === 'number' && result.costUsd > 0) {
    onImageCost?.({
      costUsd: result.costUsd,
      model: result.model,
      operation: 'generate',
    });
  }

  const cleanB64 = result.b64Json
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
    .trim();
  const data = Buffer.from(cleanB64, 'base64');
  if (!data.length) throw new Error('Generated PDF image returned empty bytes.');

  return {
    data,
    contentType: cleanMediaType(result.mediaType),
    model: result.model,
  };
}

async function editPdfImage(
  prompt: string,
  referenceImageUrl: string,
  signal: AbortSignal | undefined,
  onImageCost?: (event: CodePdfImageCostEvent) => void
): Promise<{ data: Buffer; contentType: string; model: string }> {
  const instruction = clean(prompt, 8000);
  if (!instruction) {
    throw new Error('Edited PDF image assets require an instruction.');
  }

  let result;
  try {
    result = await editGeminiImage({
      prompt: instruction,
      referenceImageUrl,
      signal,
    });
  } catch (geminiErr) {
    console.warn(
      '[Code PDF] Gemini image editing failed; falling back to GPT Image:',
      geminiErr
    );
    result = await editChatGPTImage({
      prompt: instruction,
      referenceImageUrl,
      signal,
    });
  }

  if (typeof result.costUsd === 'number' && result.costUsd > 0) {
    onImageCost?.({
      costUsd: result.costUsd,
      model: result.model,
      operation: 'edit',
    });
  }

  const cleanB64 = result.b64Json
    .replace(/^data:image\/[a-z0-9.+-]+;base64,/i, '')
    .trim();
  const data = Buffer.from(cleanB64, 'base64');
  if (!data.length) throw new Error('Edited PDF image returned empty bytes.');

  return {
    data,
    contentType: cleanMediaType(result.mediaType),
    model: result.model,
  };
}

async function resolveImageAssets(options: {
  requests: CodePdfImageRequest[];
  serviceClient: any;
  availableImages: CodePdfImageSource[];
  resourceContext?: ResourceBrokerContext;
  signal?: AbortSignal;
  onImageCost?: (event: CodePdfImageCostEvent) => void;
}): Promise<{
  assets: Map<string, { data: Buffer; contentType: string }>;
  imageModels: string[];
}> {
  const {
    requests,
    serviceClient,
    availableImages,
    resourceContext,
    signal,
    onImageCost,
  } = options;

  if (requests.length > MAX_IMAGE_ASSETS) {
    throw new Error(
      `PDF declares too many image assets (${requests.length}; max ${MAX_IMAGE_ASSETS}).`
    );
  }

  const assets = new Map<string, { data: Buffer; contentType: string }>();
  const imageModels = new Set<string>();

  for (const request of requests) {
    const id = clean(request?.id, 80);
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) {
      throw new Error(
        'Every PDF image asset requires a unique simple alphanumeric id.'
      );
    }
    if (assets.has(id)) {
      throw new Error(`Duplicate PDF image asset id "${id}".`);
    }

    const mode =
      request.mode === 'existing' || request.mode === 'edit'
        ? request.mode
        : 'generate';
    const need = clean(
      request.need || request.prompt || request.filename || id,
      4000
    );

    if (mode === 'generate') {
      const generated = await generatePdfImage(
        request.prompt || need,
        signal,
        onImageCost
      );
      assets.set(id, {
        data: generated.data,
        contentType: generated.contentType,
      });
      imageModels.add(generated.model);
      continue;
    }

    let source: CodePdfImageSource | null = null;
    if (resourceContext) {
      const broker = resolveRequestedEvidence(
        {
          modality: 'visual',
          resource_type: 'image',
          need,
          filename: request.filename,
        },
        resourceContext
      );
      if (broker.status === 'resolved' && broker.evidence?.storagePath) {
        source =
          availableImages.find(
            (candidate) =>
              candidate.storagePath === broker.evidence?.storagePath
          ) || {
            filename:
              broker.evidence.filename ||
              request.filename ||
              'image.png',
            storagePath: broker.evidence.storagePath,
          };
      }
    }

    source =
      source ||
      fallbackResolveImageSource(
        availableImages,
        need,
        request.filename
      );

    if (!source) {
      throw new Error(
        `Could not uniquely resolve the image requested for PDF asset "${id}": ${need}`
      );
    }

    if (mode === 'existing') {
      const downloaded = await downloadImageBytes(
        serviceClient,
        source,
        signal
      );
      assets.set(id, downloaded);
    } else {
      const signedUrl = await signImageSource(serviceClient, source);
      const edited = await editPdfImage(
        request.prompt || need,
        signedUrl,
        signal,
        onImageCost
      );
      assets.set(id, {
        data: edited.data,
        contentType: edited.contentType,
      });
      imageModels.add(edited.model);
    }
  }

  return {
    assets,
    imageModels: Array.from(imageModels),
  };
}

function parsePdfPageCount(raw: string): number | null {
  const match = raw.match(/^Pages:\s+(\d+)$/im);
  if (!match) return null;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function assertCommandSucceeded(
  result: Awaited<ReturnType<InstanceType<typeof Sandbox>['runCommand']>>,
  label: string
): Promise<void> {
  if (result.exitCode === 0) return;
  const stderr = (await result.stderr()).trim();
  const stdout = (await result.stdout()).trim();
  throw new Error(
    `${label} failed (exit ${result.exitCode}): ${(stderr || stdout || 'unknown error').slice(-6000)}`
  );
}

async function commandPath(
  sandbox: InstanceType<typeof Sandbox>,
  command: string
): Promise<string | null> {
  const probe = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', `command -v ${command} 2>/dev/null || true`],
  });
  const value = (await probe.stdout()).trim();
  return value || null;
}

async function installStudioDependencies(
  sandbox: InstanceType<typeof Sandbox>
): Promise<{ pythonPath: string }> {
  const packageProbe = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-lc',
      'if command -v apt-get >/dev/null 2>&1; then echo apt-get; elif command -v dnf >/dev/null 2>&1; then echo dnf; else echo none; fi',
    ],
  });
  await assertCommandSucceeded(packageProbe, 'PDF studio package-manager detection');
  const packageManager = (await packageProbe.stdout()).trim();

  if (packageManager === 'apt-get') {
    const install = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        [
          'set -eu',
          'sudo apt-get update -qq',
          'sudo apt-get install -y --no-install-recommends python3-venv python3-pip poppler-utils fonts-noto-cjk fonts-liberation fontconfig libpango-1.0-0 libpangoft2-1.0-0',
          'python3 -m venv /tmp/plurilog-pdf-studio',
          '/tmp/plurilog-pdf-studio/bin/pip install -q --disable-pip-version-check reportlab==4.4.4 weasyprint==70.0 pillow==11.3.0 matplotlib==3.10.6 svgwrite==1.4.3',
        ].join(' && '),
      ],
    });
    await assertCommandSucceeded(install, 'PDF studio dependency installation');
  } else if (packageManager === 'dnf') {
    const install = await sandbox.runCommand({
      cmd: 'sh',
      args: [
        '-lc',
        [
          'set -eu',
          'sudo dnf install -y python3-pip python3-devel poppler-utils pango liberation-sans-fonts liberation-serif-fonts fontconfig',
          'python3 -m venv /tmp/plurilog-pdf-studio || true',
          '/tmp/plurilog-pdf-studio/bin/pip install -q --disable-pip-version-check reportlab==4.4.4 weasyprint==70.0 pillow==11.3.0 matplotlib==3.10.6 svgwrite==1.4.3',
        ].join(' && '),
      ],
    });
    await assertCommandSucceeded(install, 'PDF studio dependency installation');
  } else {
    throw new Error('PDF studio sandbox has neither apt-get nor dnf available.');
  }

  const pythonPath = '/tmp/plurilog-pdf-studio/bin/python';
  const verify = await sandbox.runCommand({
    cmd: pythonPath,
    args: [
      '-c',
      'import reportlab, weasyprint, PIL, matplotlib, svgwrite; print("ok")',
    ],
  });
  await assertCommandSucceeded(verify, 'PDF studio Python package verification');

  if (!(await commandPath(sandbox, 'pdfinfo')) || !(await commandPath(sandbox, 'pdftoppm'))) {
    throw new Error('PDF studio is missing Poppler utilities.');
  }

  return { pythonPath };
}

function validatePythonSource(raw: string): string {
  const code = clean(raw, MAX_CODE_CHARS);
  if (!code) throw new Error('PDF studio Python source cannot be empty.');

  // The sandbox is the primary security boundary. These checks reduce accidental
  // misuse and keep the document program focused on local file creation.
  const forbidden = [
    /\bsubprocess\b/i,
    /\bos\.system\b/i,
    /\bsocket\b/i,
    /\brequests\b/i,
    /\burllib\b/i,
    /\bhttpx\b/i,
    /\baiohttp\b/i,
    /\bparamiko\b/i,
    /\bftplib\b/i,
    /\bshutil\.rmtree\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(code)) {
      throw new Error(
        `PDF studio code contains a disallowed operation: ${pattern.source}`
      );
    }
  }

  return code;
}

async function writeStudioAssets(
  sandbox: InstanceType<typeof Sandbox>,
  assets: Map<string, { data: Buffer; contentType: string }>
): Promise<Record<string, string>> {
  await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', 'mkdir -p /vercel/sandbox/assets'],
  });

  const manifest: Record<string, string> = {};
  const files: { path: string; content: Buffer }[] = [];

  for (const [id, asset] of assets.entries()) {
    const ext = extensionFromMediaType(asset.contentType);
    const path = `/vercel/sandbox/assets/${id}${ext}`;
    manifest[id] = path;
    files.push({ path, content: asset.data });
  }

  if (files.length > 0) {
    await sandbox.writeFiles(files);
  }

  await sandbox.writeFiles([
    {
      path: '/vercel/sandbox/assets.json',
      content: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8'),
    },
  ]);

  return manifest;
}

async function runPdfProgram(options: {
  sandbox: InstanceType<typeof Sandbox>;
  pythonPath: string;
  code: string;
  renderId: number;
  targetPageCount?: number;
  signal?: AbortSignal;
}): Promise<CodeRunResult> {
  const {
    sandbox,
    pythonPath,
    code,
    renderId,
    signal,
  } = options;

  if (signal?.aborted) {
    throw new DOMException('PDF studio run aborted.', 'AbortError');
  }

  const startedAt = Date.now();
  const source = validatePythonSource(code);
  const scriptPath = `/vercel/sandbox/create-pdf-${renderId}.py`;
  const outputPath = `/vercel/sandbox/output-${renderId}.pdf`;

  const prelude = [
    '# Plurilog document studio runtime',
    'OUTPUT_PDF = r"' + outputPath + '"',
    'ASSET_DIR = r"/vercel/sandbox/assets"',
    'ASSET_MANIFEST = r"/vercel/sandbox/assets.json"',
    '',
  ].join('\n');

  await sandbox.writeFiles([
    {
      path: scriptPath,
      content: Buffer.from(prelude + source, 'utf8'),
    },
  ]);

  const run = await sandbox.runCommand({
    cmd: pythonPath,
    args: [scriptPath],
    cwd: '/vercel/sandbox',
  });
  await assertCommandSucceeded(run, 'Claude PDF studio program');

  const exists = await sandbox.runCommand({
    cmd: 'sh',
    args: ['-lc', `test -s "${outputPath}"`],
  });
  await assertCommandSucceeded(exists, 'PDF studio output validation');

  const pdfInfo = await sandbox.runCommand({
    cmd: 'pdfinfo',
    args: [outputPath],
  });
  await assertCommandSucceeded(pdfInfo, 'PDF studio page inspection');
  const pageCount = parsePdfPageCount(await pdfInfo.stdout());

  const textResult = await sandbox.runCommand({
    cmd: 'pdftotext',
    args: [outputPath, '-'],
  });
  const fullText =
    textResult.exitCode === 0
      ? (await textResult.stdout()).trim()
      : '';

  const prefix = `/vercel/sandbox/review-${renderId}-page`;
  const review = await sandbox.runCommand({
    cmd: 'pdftoppm',
    args: [
      '-png',
      '-r',
      '110',
      '-f',
      '1',
      '-l',
      String(Math.min(pageCount || MAX_REVIEW_PAGES, MAX_REVIEW_PAGES)),
      outputPath,
      prefix,
    ],
  });
  await assertCommandSucceeded(review, 'PDF studio visual review rendering');

  const list = await sandbox.runCommand({
    cmd: 'sh',
    args: [
      '-lc',
      `find /vercel/sandbox -maxdepth 1 -type f -name 'review-${renderId}-page-*.png' -printf '%f\\n' | sort -V`,
    ],
  });
  await assertCommandSucceeded(list, 'PDF studio review-page enumeration');

  const filenames = (await list.stdout())
    .split(/\r?\n/)
    .map((name) => name.trim())
    .filter(Boolean)
    .slice(0, MAX_REVIEW_PAGES);

  const reviewPages: RenderedPage[] = [];
  for (let index = 0; index < filenames.length; index += 1) {
    const data = await sandbox.readFileToBuffer({
      path: `/vercel/sandbox/${filenames[index]}`,
    });
    if (data?.length) {
      reviewPages.push({
        pageNumber: index + 1,
        data,
        contentType: 'image/png',
      });
    }
  }

  const buffer = await sandbox.readFileToBuffer({ path: outputPath });
  if (!buffer?.length) throw new Error('PDF studio produced an empty file.');

  return {
    buffer,
    pageCount,
    fullText,
    reviewPages,
    elapsedMs: Date.now() - startedAt,
  };
}

async function reviewPdfProgramWithClaude(options: {
  openai: any;
  model: string;
  models: string[];
  code: string;
  pages: RenderedPage[];
  targetPageCount?: number;
  originalUserPrompt?: string;
  assetManifest: Record<string, string>;
  signal?: AbortSignal;
  sessionId?: string | null;
}): Promise<{
  code: string;
  costUsd: number;
  applied: boolean;
  rationale: string;
  respondingModel: string;
}> {
  const {
    openai,
    model,
    models,
    code,
    pages,
    targetPageCount,
    originalUserPrompt = '',
    assetManifest,
    signal,
    sessionId,
  } = options;

  const content: any[] = [
    {
      type: 'text',
      text: [
        'You are in the final visual QA pass for a PDF you just created programmatically.',
        'Inspect the ACTUAL rendered page images, then return a complete revised Python program only through the revise_pdf_program tool.',
        'The file should feel human-designed and editorially intentional, not like generic AI output. Judge hierarchy, proportion, whitespace, typography, page balance, line length, alignment, density, colour restraint, diagrams, tables, and visual rhythm.',
        'Do not default to dashboards, equal-sized cards, rainbow accents, oversized callouts, or decorative boxes unless the document purpose genuinely calls for them. Prefer a clear art direction and restraint.',
        'Preserve the factual substance and requested aesthetic. You may reflow or shorten wording modestly for layout.',
        'Do not use the network, subprocesses, shell commands, or package installation. Do not add or remove image assets. Use only the local asset paths listed below.',
        'The program must write the final PDF to OUTPUT_PDF. ASSET_DIR and ASSET_MANIFEST are predefined by the runtime.',
        targetPageCount
          ? `The final document must be exactly ${targetPageCount} page${targetPageCount === 1 ? '' : 's'}.`
          : '',
        originalUserPrompt
          ? `Original user request:\n${originalUserPrompt}`
          : '',
        `Available local image assets:\n${JSON.stringify(assetManifest, null, 2)}`,
        `Current Python program:\n${code}`,
      ].filter(Boolean).join('\n\n'),
    },
  ];

  for (const page of pages.slice(0, MAX_REVIEW_PAGES)) {
    content.push({
      type: 'text',
      text: `Rendered PDF page ${page.pageNumber}`,
    });
    content.push({
      type: 'image_url',
      image_url: {
        url: `data:${page.contentType};base64,${page.data.toString('base64')}`,
      },
    });
  }

  const tool = {
    type: 'function',
    function: {
      name: 'revise_pdf_program',
      description:
        'Return the complete revised Python program for the final PDF after visually inspecting the rendered pages.',
      parameters: {
        type: 'object',
        properties: {
          python: {
            type: 'string',
            description:
              'Complete revised Python source. It must create OUTPUT_PDF and use only local packages/assets.',
          },
          rationale: {
            type: 'string',
            description:
              'Brief internal summary of the visual corrections made.',
          },
        },
        required: ['python'],
        additionalProperties: false,
      },
    },
  };

  const response = await (openai.chat.completions.create as any)({
    model,
    models,
    messages: [
      {
        role: 'system',
        content:
          'You are Claude acting as a senior editorial designer and document engineer. Use adaptive high-effort reasoning. Inspect the rendered pages closely and make one decisive final correction pass.',
      },
      { role: 'user', content },
    ],
    tools: [tool],
    tool_choice: {
      type: 'function',
      function: { name: 'revise_pdf_program' },
    },
    parallel_tool_calls: false,
    temperature: 0.2,
    max_tokens: 24000,
    reasoning: { effort: 'high' },
    signal,
    ...(sessionId ? { session_id: sessionId } : {}),
  });

  const respondingModel =
    typeof response?.model === 'string' ? response.model : model;
  const costUsd =
    typeof response?.usage?.cost === 'number' ? response.usage.cost : 0;
  const call = response?.choices?.[0]?.message?.tool_calls?.find(
    (entry: any) => entry?.function?.name === 'revise_pdf_program'
  );
  const raw = call?.function?.arguments;

  if (!raw || typeof raw !== 'string') {
    return {
      code,
      costUsd,
      applied: false,
      rationale: 'Claude returned no usable PDF-program revision.',
      respondingModel,
    };
  }

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      code,
      costUsd,
      applied: false,
      rationale: 'Claude returned invalid JSON for the PDF-program revision.',
      respondingModel,
    };
  }

  const revisedCode = validatePythonSource(parsed?.python || '');
  return {
    code: revisedCode,
    costUsd,
    applied: revisedCode !== code,
    rationale:
      clean(parsed?.rationale, 1200) ||
      'Claude completed the programmatic PDF visual review.',
    respondingModel,
  };
}

export async function createClaudeCodePdf(
  options: CreateClaudeCodePdfOptions
): Promise<CreateClaudeCodePdfResult> {
  const {
    openai,
    serviceClient,
    args,
    signal,
    availableImages = [],
    resourceContext,
    reviewModel,
    reviewModels = reviewModel ? [reviewModel] : [],
    originalUserPrompt = '',
    reviewSessionId,
    onImageCost,
  } = options;

  const filename = sanitizePdfFilename(args.filename);
  const sourceCode = validatePythonSource(args.python);
  const targetPageCount =
    typeof args.target_page_count === 'number' &&
    Number.isFinite(args.target_page_count)
      ? Math.max(1, Math.min(30, Math.floor(args.target_page_count)))
      : undefined;

  let imageCostUsd = 0;
  const costAwareCallback = (event: CodePdfImageCostEvent) => {
    imageCostUsd += event.costUsd;
    onImageCost?.(event);
  };

  const resolved = await resolveImageAssets({
    requests: Array.isArray(args.images) ? args.images : [],
    serviceClient,
    availableImages,
    resourceContext,
    signal,
    onImageCost: costAwareCallback,
  });

  const sandbox = await Sandbox.create({
    persistent: false,
    timeout: 120_000,
    resources: { vcpus: 2 },
    networkPolicy: 'allow-all',
  });

  let visualReviewCostUsd = 0;
  let visualReviewApplied = false;
  let reviewRationale = '';

  try {
    const { pythonPath } = await installStudioDependencies(sandbox);
    const assetManifest = await writeStudioAssets(sandbox, resolved.assets);

    // Dependencies are installed before model-authored code runs. Lock egress down
    // completely so the document program cannot make network requests.
    await sandbox.updateNetworkPolicy('deny-all');

    const initial = await runPdfProgram({
      sandbox,
      pythonPath,
      code: sourceCode,
      renderId: 1,
      targetPageCount,
      signal,
    });

    let selected = initial;

    if (reviewModel && initial.reviewPages.length > 0) {
      try {
        const review = await reviewPdfProgramWithClaude({
          openai,
          model: reviewModel,
          models:
            reviewModels.length > 0 ? reviewModels : [reviewModel],
          code: sourceCode,
          pages: initial.reviewPages,
          targetPageCount,
          originalUserPrompt,
          assetManifest,
          signal,
          sessionId: reviewSessionId,
        });
        visualReviewCostUsd += review.costUsd;
        reviewRationale = review.rationale;

        if (review.applied) {
          const revised = await runPdfProgram({
            sandbox,
            pythonPath,
            code: review.code,
            renderId: 2,
            targetPageCount,
            signal,
          });

          const target = targetPageCount || 0;
          const initialDistance =
            target && initial.pageCount
              ? Math.abs(initial.pageCount - target)
              : 0;
          const revisedDistance =
            target && revised.pageCount
              ? Math.abs(revised.pageCount - target)
              : 0;

          if (!target || revisedDistance <= initialDistance) {
            selected = revised;
            visualReviewApplied = true;
          } else {
            reviewRationale =
              `${reviewRationale} Revision was rejected because it moved farther from the requested page count.`.trim();
          }

          console.log('[Code PDF Visual Review]', {
            applied: visualReviewApplied,
            respondingModel: review.respondingModel,
            initialPageCount: initial.pageCount,
            revisedPageCount: revised.pageCount,
            targetPageCount: target || null,
            initialBytes: initial.buffer.length,
            revisedBytes: revised.buffer.length,
            rationale: reviewRationale,
          });
        }
      } catch (reviewErr) {
        console.warn(
          '[Code PDF Visual Review] Non-critical review failure; using first render:',
          reviewErr
        );
      }
    }

    console.log('[Code PDF Studio]', {
      filename,
      initialPageCount: initial.pageCount,
      finalPageCount: selected.pageCount,
      imageAssetCount: resolved.assets.size,
      imageModels: resolved.imageModels,
      visualReviewApplied,
      visualReviewCostUsd,
      elapsedMs: selected.elapsedMs,
    });

    return {
      buffer: selected.buffer,
      filename,
      fullText: selected.fullText,
      pageCount: selected.pageCount,
      initialPageCount: initial.pageCount,
      imageAssetCount: resolved.assets.size,
      imageCostUsd,
      imageModels: resolved.imageModels,
      visualReviewCostUsd,
      visualReviewApplied,
      reviewRationale,
    };
  } finally {
    await sandbox.stop().catch(() => undefined);
  }
}
