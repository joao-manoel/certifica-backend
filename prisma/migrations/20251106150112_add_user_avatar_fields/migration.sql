-- AlterTable
ALTER TABLE "User" ADD COLUMN     "avatarKey" VARCHAR(300),
ADD COLUMN     "avatarMime" VARCHAR(100),
ADD COLUMN     "avatarUpdatedAt" TIMESTAMP(3);
