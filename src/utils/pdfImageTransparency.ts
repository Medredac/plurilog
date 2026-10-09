import sharp from 'sharp';

export interface PdfImageEntry {
  number: number;
  page: number;
  type: 'image' | 'mask' | 'smask' | 'stencil';
  interpolate: boolean;
}

// Poppler numbers extraction files using the same zero-based numbers as -list.
// A mask immediately follows its parent image; it is not a separate picture.
export function parsePdfImageList(listing: string): PdfImageEntry[] {
  return listing.split(/\r?\n/).flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (!/^\d+$/.test(fields[0]) || !/^\d+$/.test(fields[1]) ||
        !['image', 'mask', 'smask', 'stencil'].includes(fields[2])) return [];
    return [{
      page: Number(fields[0]), number: Number(fields[1]),
      type: fields[2] as PdfImageEntry['type'], interpolate: fields[9] === 'yes',
    }];
  });
}

export async function applyPdfImageMask(
  image: Buffer, mask: Buffer, interpolate: boolean
): Promise<Buffer> {
  const options = { limitInputPixels: 25_000_000 };
  const { width, height } = await sharp(image, options).metadata();
  if (!width || !height) throw new Error('Invalid PDF image dimensions.');
  // pdfimages already applies grayscale decoding/inversion to PNG masks.
  // extractChannel avoids expanding a grayscale mask into three RGB channels.
  const alpha = await sharp(mask, options)
    .resize(width, height, { fit: 'fill', kernel: interpolate ? 'linear' : 'nearest' })
    .extractChannel(0).raw().toBuffer();
  // Complete removeAlpha before joining: Sharp otherwise applies it to the
  // final pipeline and removes the newly joined transparency channel too.
  const rgb = await sharp(image, options).removeAlpha().toColourspace('srgb')
    .raw().toBuffer();
  return sharp(rgb, { raw: { width, height, channels: 3 } })
    .joinChannel(alpha, { raw: { width, height, channels: 1 } })
    .png().toBuffer();
}
