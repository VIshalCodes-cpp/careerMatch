-- AlterTable
ALTER TABLE "Company" ADD COLUMN "logoUrl" VARCHAR(1000);

-- AlterTable
ALTER TABLE "Job" ADD COLUMN "sourceName" VARCHAR(60);

-- CreateIndex
CREATE INDEX "Job_source_status_publishedAt_idx" ON "Job"("source", "status", "publishedAt");
