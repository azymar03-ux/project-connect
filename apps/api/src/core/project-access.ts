import { HttpException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { lockUsers, socialTransaction } from "./security";
export async function projectLock(
  tx: Prisma.TransactionClient,
  id: string,
  actor: string,
  owner = false,
  active = false,
) {
  await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${id} FOR UPDATE`;
  const project = await tx.project.findUnique({ where: { id } });
  if (!project) throw new HttpException("Project not found.", 404);
  const membership = await tx.member.findUnique({
    where: { projectId_userId: { projectId: id, userId: actor } },
  });
  if (owner ? project.ownerId !== actor : !membership)
    throw new HttpException(
      owner ? "Owner permission required." : "Project membership required.",
      403,
    );
  if (active && project.status === "Archived")
    throw new HttpException(
      "Archived workspaces are read-only. Restore the project to make changes.",
      409,
    );
  return { project, membership };
}
export async function projectWrite<T>(
  id: string,
  actor: string,
  owner: boolean,
  fn: (
    tx: Prisma.TransactionClient,
    p: Awaited<ReturnType<typeof projectLock>>,
  ) => Promise<T>,
  active = true,
  users: string[] = [],
) {
  return socialTransaction(async (tx) => {
    await lockUsers(tx, actor, ...users);
    const user = await tx.user.findUnique({
      where: { id: actor },
      select: { suspendedAt: true, activationRequired: true },
    });
    if (!user || user.suspendedAt || user.activationRequired)
      throw new HttpException("Account unavailable.", 403);
    const p = await projectLock(tx, id, actor, owner, active);
    return fn(tx, p);
  });
}
