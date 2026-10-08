// Deterministic document-image navigation and conditional same-turn delivery.
// No model calls, embeddings, or document summaries are generated here.
export const PDF_IMAGE_COUNT_THRESHOLD = 16;
export const PDF_IMAGE_MEGAPIXEL_THRESHOLD = 120;
export const DEFERRED_IMAGE_TOOL_NAME = 'inspect_deferred_pdf_images';
export const MAX_IMAGES_PER_INSPECTION = 5;

export type PdfVisualAsset = {
  id: string;
  filename: string;
  pageNumber: number | null;
  sourceIndex: number;
  width: number;
  height: number;
  signedUrl: string;
};

export type DocumentVisualInventory = {
  filename: string;
  format: 'pdf' | 'docx';
  imageCount: number;
  assets: PdfVisualAsset[];
  complete: boolean;
};

export function decidePdfImageDelivery(items: DocumentVisualInventory[]): {
  deferred: boolean;
  totalImages: number;
  totalMegapixels: number;
  inventoryComplete: boolean;
} {
  const pdfs = items.filter((x) => x.format === 'pdf');
  const totalImages = pdfs.reduce((sum, doc) => sum + doc.imageCount, 0);
  const totalMegapixels = pdfs.reduce((sum, doc) =>
    sum + doc.assets.reduce((part, asset) => part + asset.width * asset.height / 1_000_000, 0), 0);
  const inventoryComplete = pdfs.every((doc) => doc.complete && doc.assets.length === doc.imageCount);
  return {
    deferred: inventoryComplete && (totalImages >= PDF_IMAGE_COUNT_THRESHOLD ||
      totalMegapixels >= PDF_IMAGE_MEGAPIXEL_THRESHOLD),
    totalImages,
    totalMegapixels,
    inventoryComplete,
  };
}

export function formatDocumentVisualInventory(items: DocumentVisualInventory[], deferred: boolean): string {
  if (items.length === 0) return '';
  const lines: string[] = [
    'DOCUMENT VISUAL INVENTORY — file structure only, not a content summary:',
  ];
  for (const doc of items) {
    lines.push(`Document: ${doc.filename} (${doc.format.toUpperCase()}); embedded images: ${doc.imageCount}; image inventory ${doc.complete ? 'complete' : 'incomplete'}`);
    for (const asset of doc.assets) {
      lines.push(`- ${asset.id}: ${asset.pageNumber !== null ? `page ${asset.pageNumber}` : 'page unknown'}, ${asset.width}x${asset.height}px, original image ${asset.sourceIndex + 1}`);
    }
  }
  if (deferred) {
    lines.push(
      'SAME-ROUND VISUAL INSPECTION: The extracted PDF images listed above are durably stored but were not sent as separate images in your initial call. Their pixels remain accessible by calling inspect_deferred_pdf_images with exact image_ids. Inspect any image relevant to the task BEFORE completing this seat response. If comprehensive visual review is needed, request the necessary batches until covered. The original PDF files remain in the context. Do not claim to have visually inspected an image from this inventory alone. Web search remains available.',
    );
  } else {
    lines.push('Image delivery is unchanged for these documents; this inventory only identifies available media and does not substitute for inspecting the pixels.');
  }
  return lines.join('\n');
}

export const DEFERRED_PDF_IMAGE_TOOL = [{
  type: 'function',
  function: {
    name: DEFERRED_IMAGE_TOOL_NAME,
    description: 'Retrieve actual pixels of one or more images embedded in PDFs uploaded this turn. Use when a chart, photo, scan, illustration, signature or diagram might be relevant. The images are inspected DURING this same seat response, not in a later round. Request further batches when needed; do not infer visual details from image inventory labels.',
    parameters: {
      type: 'object',
      properties: {
        image_ids: {
          type: 'array', minItems: 1, maxItems: MAX_IMAGES_PER_INSPECTION,
          items: { type: 'string' },
          description: 'One to five exact image IDs from DOCUMENT VISUAL INVENTORY.',
        },
      },
      required: ['image_ids'],
      additionalProperties: false,
    },
  },
}];
