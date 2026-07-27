-- AlterTable
ALTER TABLE "Post"
ADD COLUMN "seoTitle" VARCHAR(60),
ADD COLUMN "metaDescription" VARCHAR(160),
ADD COLUMN "focusKeyword" VARCHAR(160),
ADD COLUMN "imageCredit" VARCHAR(300),
ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ApiClient" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" VARCHAR(64) NOT NULL,
    "authorId" TEXT NOT NULL,
    "scopes" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "expiresAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ApiClient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "apiClientId" TEXT,
    "userId" TEXT,
    "action" VARCHAR(100) NOT NULL,
    "resourceType" VARCHAR(80) NOT NULL,
    "resourceId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL,
    "apiClientId" TEXT NOT NULL,
    "key" VARCHAR(200) NOT NULL,
    "operation" VARCHAR(100) NOT NULL,
    "requestHash" VARCHAR(64) NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "response" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiClient_tokenHash_key" ON "ApiClient"("tokenHash");
CREATE INDEX "AuditLog_apiClientId_createdAt_idx" ON "AuditLog"("apiClientId", "createdAt");
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX "AuditLog_resourceType_resourceId_idx" ON "AuditLog"("resourceType", "resourceId");
CREATE UNIQUE INDEX "IdempotencyRecord_apiClientId_key_operation_key" ON "IdempotencyRecord"("apiClientId", "key", "operation");
CREATE INDEX "IdempotencyRecord_expiresAt_idx" ON "IdempotencyRecord"("expiresAt");

-- AddForeignKey
ALTER TABLE "ApiClient" ADD CONSTRAINT "ApiClient_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_apiClientId_fkey" FOREIGN KEY ("apiClientId") REFERENCES "ApiClient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
