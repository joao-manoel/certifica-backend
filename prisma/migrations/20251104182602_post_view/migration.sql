-- CreateEnum
CREATE TYPE "ViewStatus" AS ENUM ('PENDING', 'APPLIED', 'DISCARDED');

-- CreateTable
CREATE TABLE "PostView" (
    "id" TEXT NOT NULL,
    "postId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "status" "ViewStatus" NOT NULL DEFAULT 'PENDING',
    "day" VARCHAR(8) NOT NULL,
    "ipHash" VARCHAR(64),
    "ua" VARCHAR(300),
    "referrer" VARCHAR(300),
    "path" VARCHAR(200),
    "fingerprint" VARCHAR(64),
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "country" VARCHAR(2),
    "device" VARCHAR(30),
    "browser" VARCHAR(30),
    "os" VARCHAR(30),

    CONSTRAINT "PostView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Utm" (
    "id" TEXT NOT NULL,
    "postViewId" TEXT,
    "source" VARCHAR(100),
    "medium" VARCHAR(100),
    "campaign" VARCHAR(150),
    "term" VARCHAR(150),
    "content" VARCHAR(150),
    "referrer" VARCHAR(300),
    "landingUrl" VARCHAR(400),
    "device" VARCHAR(30),
    "browser" VARCHAR(30),
    "os" VARCHAR(30),
    "country" VARCHAR(2),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Utm_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PostView_postId_status_idx" ON "PostView"("postId", "status");

-- CreateIndex
CREATE INDEX "PostView_postId_day_status_idx" ON "PostView"("postId", "day", "status");

-- CreateIndex
CREATE INDEX "PostView_createdAt_idx" ON "PostView"("createdAt");

-- CreateIndex
CREATE INDEX "Utm_source_medium_campaign_idx" ON "Utm"("source", "medium", "campaign");

-- CreateIndex
CREATE INDEX "Utm_capturedAt_idx" ON "Utm"("capturedAt");

-- AddForeignKey
ALTER TABLE "PostView" ADD CONSTRAINT "PostView_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Utm" ADD CONSTRAINT "Utm_postViewId_fkey" FOREIGN KEY ("postViewId") REFERENCES "PostView"("id") ON DELETE CASCADE ON UPDATE CASCADE;
