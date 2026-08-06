CREATE TYPE "PortfolioProjectStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TABLE "PortfolioProject" (
  "id" TEXT NOT NULL, "title" TEXT NOT NULL, "slug" TEXT NOT NULL,
  "summary" VARCHAR(500) NOT NULL, "content" JSONB NOT NULL,
  "status" "PortfolioProjectStatus" NOT NULL DEFAULT 'DRAFT',
  "publishedAt" TIMESTAMP(3), "featured" BOOLEAN NOT NULL DEFAULT false,
  "displayOrder" INTEGER NOT NULL DEFAULT 0, "location" VARCHAR(160),
  "architects" TEXT[] DEFAULT ARRAY[]::TEXT[], "areaSquareMeters" DECIMAL(12,2),
  "completionYear" INTEGER, "clientName" VARCHAR(160),
  "servicesProvided" TEXT[] DEFAULT ARRAY[]::TEXT[], "seoTitle" VARCHAR(60),
  "metaDescription" VARCHAR(160), "coverId" TEXT, "createdById" TEXT,
  "version" INTEGER NOT NULL DEFAULT 1, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PortfolioProject_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PortfolioCategory" (
  "id" TEXT NOT NULL, "name" TEXT NOT NULL, "slug" TEXT NOT NULL,
  "description" VARCHAR(300), "displayOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "PortfolioCategory_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "PortfolioCategoryOnProjects" (
  "projectId" TEXT NOT NULL, "categoryId" TEXT NOT NULL,
  CONSTRAINT "PortfolioCategoryOnProjects_pkey" PRIMARY KEY ("projectId", "categoryId")
);
CREATE TABLE "PortfolioProjectMedia" (
  "projectId" TEXT NOT NULL, "mediaId" TEXT NOT NULL, "position" INTEGER NOT NULL,
  CONSTRAINT "PortfolioProjectMedia_pkey" PRIMARY KEY ("projectId", "mediaId")
);
CREATE UNIQUE INDEX "PortfolioProject_slug_key" ON "PortfolioProject"("slug");
CREATE INDEX "PortfolioProject_status_publishedAt_idx" ON "PortfolioProject"("status", "publishedAt");
CREATE INDEX "PortfolioProject_featured_displayOrder_idx" ON "PortfolioProject"("featured", "displayOrder");
CREATE INDEX "PortfolioProject_createdById_idx" ON "PortfolioProject"("createdById");
CREATE UNIQUE INDEX "PortfolioCategory_slug_key" ON "PortfolioCategory"("slug");
CREATE UNIQUE INDEX "PortfolioProjectMedia_projectId_position_key" ON "PortfolioProjectMedia"("projectId", "position");
CREATE INDEX "PortfolioProjectMedia_mediaId_idx" ON "PortfolioProjectMedia"("mediaId");
ALTER TABLE "PortfolioProject" ADD CONSTRAINT "PortfolioProject_coverId_fkey" FOREIGN KEY ("coverId") REFERENCES "Media"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortfolioProject" ADD CONSTRAINT "PortfolioProject_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PortfolioCategoryOnProjects" ADD CONSTRAINT "PortfolioCategoryOnProjects_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PortfolioProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioCategoryOnProjects" ADD CONSTRAINT "PortfolioCategoryOnProjects_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "PortfolioCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PortfolioProjectMedia" ADD CONSTRAINT "PortfolioProjectMedia_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PortfolioProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PortfolioProjectMedia" ADD CONSTRAINT "PortfolioProjectMedia_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Media"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
