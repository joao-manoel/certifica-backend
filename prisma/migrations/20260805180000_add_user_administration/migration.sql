ALTER TABLE "User"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "passwordChangedAt" TIMESTAMP(3),
ADD COLUMN "sessionVersion" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "User_role_isActive_idx" ON "User"("role", "isActive");
