-- DropForeignKey
ALTER TABLE "public"."CategoryOnPosts" DROP CONSTRAINT "CategoryOnPosts_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "public"."CategoryOnPosts" DROP CONSTRAINT "CategoryOnPosts_postId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Comment" DROP CONSTRAINT "Comment_parentId_fkey";

-- DropForeignKey
ALTER TABLE "public"."Comment" DROP CONSTRAINT "Comment_postId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TagOnPosts" DROP CONSTRAINT "TagOnPosts_postId_fkey";

-- DropForeignKey
ALTER TABLE "public"."TagOnPosts" DROP CONSTRAINT "TagOnPosts_tagId_fkey";

-- AddForeignKey
ALTER TABLE "CategoryOnPosts" ADD CONSTRAINT "CategoryOnPosts_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CategoryOnPosts" ADD CONSTRAINT "CategoryOnPosts_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagOnPosts" ADD CONSTRAINT "TagOnPosts_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TagOnPosts" ADD CONSTRAINT "TagOnPosts_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
