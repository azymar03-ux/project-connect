import { db } from "./security";
import { expireAssistant } from "./assistant-state";
export async function maintain() {
  await expireAssistant();
  await db.aiUsage.deleteMany({
    where: { createdAt: { lt: new Date(Date.now() - 48 * 3600000) } },
  });
  await db.session.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.oAuthState.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  await db.accountToken.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 7 * 86400000) } },
  });
  await db.githubDelivery.deleteMany({
    where: { receivedAt: { lt: new Date(Date.now() - 30 * 86400000) } },
  });
  await db.notification.deleteMany({
    where: {
      readAt: { not: null },
      createdAt: { lt: new Date(Date.now() - 90 * 86400000) },
    },
  });
}
export function startMaintenance() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await maintain();
    } catch {
      console.error(
        JSON.stringify({ level: "error", code: "MAINTENANCE_FAILURE" }),
      );
    } finally {
      running = false;
    }
  };
  const timer = setInterval(tick, 600000);
  timer.unref();
  void tick();
}
