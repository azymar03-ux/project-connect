import { db, PUBLIC_USER } from "./security";
import { matchScore, matchReasons } from "./recommendations";
export function projectInclude(userId?: string) {
  return {
    owner: { select: PUBLIC_USER },
    updates: {
      where: {
        hiddenAt: null,
        createdAt: { gt: new Date(Date.now() - 30 * 86400000) },
        author: {
          suspendedAt: null,
          activationRequired: false,
          ...(userId
            ? {
                blocksMade: { none: { blockedId: userId } },
                blocksReceived: { none: { blockerId: userId } },
              }
            : {}),
        },
      },
      take: 1,
      select: { id: true },
    },
    members: {
      select: {
        userId: true,
        role: true,
        user: {
          select: { name: true, initials: true, color: true, avatarId: true },
        },
      },
    },
    applications: { where: { userId: userId || "none" } },
    bookmarks: { where: { userId: userId || "none" } },
  } as const;
}
export function serializeProject(p: any, user: any) {
  const { updates, ...visible } = p;
  const active = p.status !== "Archived" && !!updates?.length;
  return {
    ...visible,
    image: p.coverImageId ? `/api/images/${p.coverImageId}` : p.image,
    match: matchScore(
      user,
      p.requiredSkills,
      [...p.tags, p.category],
      p.city,
      active,
    ),
    matchReasons: matchReasons(
      user,
      p.requiredSkills,
      [...p.tags, p.category],
      p.city,
      active,
    ),
    bookmarked: p.bookmarks.length > 0,
    application: p.applications[0] || null,
    isMember: p.members.some((m: any) => m.userId === user?.id),
  };
}
export async function publicProject(id: string, userId?: string) {
  const p = await db.project.findUnique({
    where: { id },
    include: projectInclude(userId),
  });
  if (!p) return null;
  const ownerState = await db.user.findUnique({
    where: { id: p.ownerId },
    select: { suspendedAt: true, activationRequired: true },
  });
  if (ownerState?.activationRequired) return null;
  if (ownerState?.suspendedAt && !p.members.some((m) => m.userId === userId))
    return null;
  if (p.status === "Archived" && !p.members.some((m) => m.userId === userId))
    return null;
  if (
    userId &&
    (await db.block.findFirst({
      where: {
        OR: [
          { blockerId: userId, blockedId: p.ownerId },
          { blockerId: p.ownerId, blockedId: userId },
        ],
      },
    })) &&
    !p.members.some((m) => m.userId === userId)
  )
    return null;
  const user = userId
    ? await db.user.findUnique({ where: { id: userId } })
    : null;
  return serializeProject(p, user);
}
