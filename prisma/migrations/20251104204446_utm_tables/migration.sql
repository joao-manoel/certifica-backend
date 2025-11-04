/*
  Warnings:

  - You are about to drop the `Utm` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "public"."Utm";

-- CreateTable
CREATE TABLE "UtmEvent" (
    "id" TEXT NOT NULL,
    "source" VARCHAR(100),
    "medium" VARCHAR(100),
    "campaign" VARCHAR(150),
    "term" VARCHAR(150),
    "content" VARCHAR(150),
    "sourceId" TEXT,
    "mediumId" TEXT,
    "campaignId" TEXT,
    "referrer" VARCHAR(300),
    "landingUrl" VARCHAR(400),
    "device" VARCHAR(30),
    "browser" VARCHAR(30),
    "os" VARCHAR(30),
    "country" VARCHAR(2),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UtmEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtmSource" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(120) NOT NULL,

    CONSTRAINT "UtmSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtmMedium" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(120) NOT NULL,
    "name" VARCHAR(120) NOT NULL,

    CONSTRAINT "UtmMedium_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UtmCampaign" (
    "id" TEXT NOT NULL,
    "slug" VARCHAR(160) NOT NULL,
    "name" VARCHAR(160) NOT NULL,

    CONSTRAINT "UtmCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UtmEvent_capturedAt_idx" ON "UtmEvent"("capturedAt");

-- CreateIndex
CREATE INDEX "UtmEvent_sourceId_mediumId_campaignId_idx" ON "UtmEvent"("sourceId", "mediumId", "campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "UtmSource_slug_key" ON "UtmSource"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "UtmMedium_slug_key" ON "UtmMedium"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "UtmCampaign_slug_key" ON "UtmCampaign"("slug");

-- AddForeignKey
ALTER TABLE "UtmEvent" ADD CONSTRAINT "UtmEvent_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "UtmSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtmEvent" ADD CONSTRAINT "UtmEvent_mediumId_fkey" FOREIGN KEY ("mediumId") REFERENCES "UtmMedium"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UtmEvent" ADD CONSTRAINT "UtmEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "UtmCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
