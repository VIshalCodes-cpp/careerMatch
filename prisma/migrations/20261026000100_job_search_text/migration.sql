-- AlterTable
ALTER TABLE "Job" ADD COLUMN "searchText" TEXT;

-- Backfill the lighter ranking corpus for existing listings.
UPDATE "Job" SET "searchText" = LEFT("description", 3000) WHERE "searchText" IS NULL;
