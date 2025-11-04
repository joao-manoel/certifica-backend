/*
  Warnings:

  - You are about to drop the column `postViewId` on the `Utm` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Utm" DROP CONSTRAINT "Utm_postViewId_fkey";

-- AlterTable
ALTER TABLE "Utm" DROP COLUMN "postViewId";
