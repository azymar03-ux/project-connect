import { inventoryStorage } from "../apps/api/src/core/storage-inventory";
import { db } from "../apps/api/src/core/security";
const apply = process.argv.includes("--apply");
try {
  console.log(
    JSON.stringify({
      mode: apply ? "queue-after-grace" : "dry-run",
      ...(await inventoryStorage(apply)),
    }),
  );
} finally {
  await db.$disconnect();
}
