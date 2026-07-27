-- CreateEnum
CREATE TYPE "MediaSource" AS ENUM ('EXTERNAL', 'S3');

-- AlterTable
ALTER TABLE "Media"
ADD COLUMN "source" "MediaSource" NOT NULL DEFAULT 'EXTERNAL',
ADD COLUMN "storageKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Media_storageKey_key" ON "Media"("storageKey");
