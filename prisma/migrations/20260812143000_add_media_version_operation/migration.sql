ALTER TABLE "MediaVersion"
ADD COLUMN "operation" JSONB;

ALTER TABLE "MediaVersion"
ADD COLUMN "createdById" TEXT;

CREATE INDEX "MediaVersion_createdById_idx" ON "MediaVersion"("createdById");

ALTER TABLE "MediaVersion"
ADD CONSTRAINT "MediaVersion_createdById_fkey"
FOREIGN KEY ("createdById") REFERENCES "User"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
