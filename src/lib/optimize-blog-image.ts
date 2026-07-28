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
  mimeType: "image/jpeg"
  extension: ".jpg"
}

export async function optimizeBlogImage(
  input: Buffer,
): Promise<OptimizedBlogImage> {
  const source = sharp(input, { failOn: "error" }).rotate()
  let maxDimension = INITIAL_MAX_DIMENSION
  let quality = INITIAL_QUALITY

  for (;;) {
    const result = await source
      .clone()
      .resize({
        width: maxDimension,
        height: maxDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({
        quality,
        progressive: true,
        mozjpeg: true,
        chromaSubsampling: "4:2:0",
      })
      .toBuffer({ resolveWithObject: true })

    if (result.data.length <= TARGET_FILE_SIZE) {
      return {
        buffer: result.data,
        width: result.info.width,
        height: result.info.height,
        mimeType: "image/jpeg",
        extension: ".jpg",
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
