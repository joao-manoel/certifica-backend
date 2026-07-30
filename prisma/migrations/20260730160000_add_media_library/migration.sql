ALTER TABLE "Media"
ADD COLUMN "title" VARCHAR(160),
ADD COLUMN "caption" VARCHAR(500),
ADD COLUMN "credit" VARCHAR(300),
ADD COLUMN "originalFilename" VARCHAR(255),
ADD COLUMN "fileSizeBytes" INTEGER,
ADD COLUMN "createdById" TEXT;

CREATE TABLE "MediaVersion" (
  "id" TEXT NOT NULL,
  "mediaId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "storageKey" TEXT NOT NULL,
  "mimeType" VARCHAR(100) NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "fileSizeBytes" INTEGER NOT NULL,
  "dominantClr" VARCHAR(12),
  "isCurrent" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "MediaVersion_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MediaVersion_url_key" ON "MediaVersion"("url");
CREATE UNIQUE INDEX "MediaVersion_storageKey_key" ON "MediaVersion"("storageKey");
CREATE INDEX "Media_source_createdAt_idx" ON "Media"("source", "createdAt");
CREATE INDEX "Media_createdById_idx" ON "Media"("createdById");
CREATE INDEX "MediaVersion_mediaId_createdAt_idx" ON "MediaVersion"("mediaId", "createdAt");
CREATE INDEX "MediaVersion_mediaId_isCurrent_idx" ON "MediaVersion"("mediaId", "isCurrent");

ALTER TABLE "Media"
ADD CONSTRAINT "Media_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "MediaVersion"
ADD CONSTRAINT "MediaVersion_mediaId_fkey"
FOREIGN KEY ("mediaId") REFERENCES "Media"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "MediaVersion" (
  "id", "mediaId", "url", "storageKey", "mimeType", "width", "height",
  "fileSizeBytes", "dominantClr", "isCurrent", "createdAt"
)
SELECT
  gen_random_uuid()::text,
  "id",
  "url",
  "storageKey",
  COALESCE("mimeType", 'image/jpeg'),
  COALESCE("width", 1),
  COALESCE("height", 1),
  COALESCE("fileSizeBytes", 0),
  "dominantClr",
  true,
  "createdAt"
FROM "Media"
WHERE "source" = 'S3' AND "storageKey" IS NOT NULL;
