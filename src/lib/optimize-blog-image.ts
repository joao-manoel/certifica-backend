import sharp from "sharp"

const TARGET_FILE_SIZE = 950_000
const INITIAL_MAX_DIMENSION = 2400
const MIN_MAX_DIMENSION = 640
const INITIAL_QUALITY = 84
const MIN_QUALITY = 44

export type OptimizedBlogImage = {
  buffer: Buffer
  width: number
  height: number
  mimeType: "image/jpeg" | "image/webp"
  extension: ".jpg" | ".webp"
}

export async function optimizeBlogImage(
  input: Buffer,
): Promise<OptimizedBlogImage> {
  const source = sharp(input, { failOn: "error" }).rotate()
  const preserveTransparency = Boolean((await source.metadata()).hasAlpha)
  let maxDimension = INITIAL_MAX_DIMENSION
  let quality = INITIAL_QUALITY

  for (;;) {
    let resized = source.clone().resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
    const result = preserveTransparency
      ? await resized.webp({ quality, alphaQuality: 90, effort: 5 }).toBuffer({ resolveWithObject: true })
      : await resized.flatten({ background: "#ffffff" }).jpeg({ quality, progressive: true, mozjpeg: true, chromaSubsampling: "4:2:0" }).toBuffer({ resolveWithObject: true })

    if (result.data.length <= TARGET_FILE_SIZE) {
      return {
        buffer: result.data,
        width: result.info.width,
        height: result.info.height,
        mimeType: preserveTransparency ? "image/webp" : "image/jpeg",
        extension: preserveTransparency ? ".webp" : ".jpg",
      }
    }

    if (quality > MIN_QUALITY) {
      quality = Math.max(MIN_QUALITY, quality - 8)
      continue
    }

    if (maxDimension <= MIN_MAX_DIMENSION) {
      throw new Error("Não foi possível otimizar a imagem para menos de 1 MB.")
    }

    maxDimension = Math.max(MIN_MAX_DIMENSION, Math.floor(maxDimension * 0.8))
    quality = INITIAL_QUALITY
  }
}
