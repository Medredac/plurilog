import sharp from 'sharp';

/** Rasterize a vector upload only at a consumer boundary; keep its stored source unchanged. */
export async function rasterizeSvg(data: Buffer): Promise<Buffer> {
  if (!data.length || data.length > 15 * 1024 * 1024) throw new Error('SVG image is empty or exceeds 15 MB.');
  // Buffer input provides no filesystem base URL for external SVG resources.
  const png = await sharp(data, { limitInputPixels: 25_000_000, density: 144 })
    .resize({ width: 2048, height: 2048, fit: 'inside' })
    .png().toBuffer();
  if (png.length > 15 * 1024 * 1024) throw new Error('Rendered SVG exceeds the image size limit.');
  return png;
}
