import { PUBLIC_USER } from "./security";
export const exportDefinitions = {
  profile: {
    model: "user",
    field: "id",
    scope: (id: string) => ({ id }),
    select: {
      ...PUBLIC_USER,
      email: true,
      emailVerifiedAt: true,
      notifySocial: true,
      notifyMessages: true,
      notifyWorkspace: true,
    },
  },
  projects: {
    model: "project",
    field: "id",
    scope: (id: string) => ({ ownerId: id }),
  },
  memberships: {
    model: "member",
    field: "id",
    scope: (id: string) => ({ userId: id }),
  },
  applications: {
    model: "application",
    field: "id",
    scope: (id: string) => ({ userId: id }),
  },
  resources: {
    model: "resource",
    field: "id",
    scope: (id: string) => ({ submittedById: id }),
  },
  stores: {
    model: "hardwareStore",
    field: "id",
    scope: (id: string) => ({ submittedById: id }),
  },
  sentMessages: {
    model: "message",
    field: "id",
    scope: (id: string) => ({ senderId: id }),
  },
  plans: {
    model: "aiPlan",
    field: "id",
    scope: (id: string) => ({
      userId: id,
      source: { notIn: ["pending", "deleted"] },
    }),
  },
  assistantConversations: {
    model: "aiConversation",
    field: "id",
    scope: (id: string) => ({ userId: id }),
  },
  assistantTurns: {
    model: "aiTurn",
    field: "id",
    scope: (id: string) => ({ userId: id, status: { not: "deleted" } }),
    select: {
      id: true,
      conversationId: true,
      prompt: true,
      content: true,
      status: true,
      source: true,
      createdAt: true,
      actualTokens: true,
    },
  },
  activities: {
    model: "activity",
    field: "id",
    scope: (id: string) => ({ authorId: id }),
  },
  notifications: {
    model: "notification",
    field: "id",
    scope: (id: string) => ({ userId: id }),
  },
  follows: {
    model: "follow",
    field: "followingId",
    scope: (id: string) => ({ followerId: id }),
  },
  blocks: {
    model: "block",
    field: "blockedId",
    scope: (id: string) => ({ blockerId: id }),
  },
  sentProjectMessages: {
    model: "projectMessage",
    field: "id",
    scope: (id: string) => ({ senderId: id }),
  },
  files: {
    model: "projectFile",
    field: "id",
    scope: (id: string) => ({ uploaderId: id }),
    select: {
      id: true,
      projectId: true,
      name: true,
      mime: true,
      size: true,
      createdAt: true,
    },
  },
  bookmarks: {
    model: "bookmark",
    field: "projectId",
    scope: (id: string) => ({ userId: id }),
  },
  resourceSaves: {
    model: "resourceSave",
    field: "resourceId",
    scope: (id: string) => ({ userId: id }),
  },
  resourceVotes: {
    model: "resourceVote",
    field: "resourceId",
    scope: (id: string) => ({ userId: id }),
  },
  storeFavorites: {
    model: "storeFavorite",
    field: "storeId",
    scope: (id: string) => ({ userId: id }),
  },
  invitations: {
    model: "projectInvite",
    field: "id",
    scope: (id: string) => ({ OR: [{ userId: id }, { inviterId: id }] }),
  },
  reports: {
    model: "report",
    field: "id",
    scope: (id: string) => ({ reporterId: id }),
  },
  connections: {
    model: "connection",
    field: "id",
    scope: (id: string) => ({ OR: [{ senderId: id }, { receiverId: id }] }),
  },
} as const;
