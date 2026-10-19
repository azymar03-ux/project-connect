// Sandbox-only conveniences. Production defaults and exact-origin CSRF remain intact.
export function sandboxPreviewOrigin(env = process.env) {
  if (env.NODE_ENV === "production" || !env.E2B_SANDBOX_ID) return undefined;
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(env.E2B_SANDBOX_ID))
    throw Error("Invalid sandbox identifier");
  return `https://3000-${env.E2B_SANDBOX_ID}.e2b.app`;
}
export function sessionCookieOptions(env = process.env) {
  const embedded =
    env.PC_SANDBOX_PREVIEW === "true" && Boolean(sandboxPreviewOrigin(env));
  return {
    httpOnly: true,
    sameSite: embedded ? ("none" as const) : ("lax" as const),
    secure: embedded || env.NODE_ENV === "production",
    ...(embedded ? { partitioned: true } : {}),
    path: "/",
  };
}
