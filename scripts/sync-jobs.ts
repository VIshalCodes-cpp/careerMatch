import "dotenv/config";
import { prisma } from "../server/lib/database";
import { jobProviderStatus, syncExternalJobs } from "../server/services/job-import";

/**
 * Imports real listings from the enabled public job APIs.
 * Usage: pnpm jobs:sync
 */
async function main() {
  for (const provider of jobProviderStatus()) {
    if (provider.enabled) console.log(`[jobs] ${provider.name}: enabled`);
    else if (!provider.configured) console.log(`[jobs] ${provider.name}: skipped (needs ${provider.requires})`);
    else console.log(`[jobs] ${provider.name}: skipped (disabled via JOB_IMPORT_DISABLED)`);
  }
  const result = await syncExternalJobs({ force: true });
  console.log("Job import finished:", JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error("Job import failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
