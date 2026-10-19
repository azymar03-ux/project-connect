// Commit one bounded forward page per refresh. Never discard an arbitrarily
// large offline gap; acknowledgements cover only messages returned to the UI.
export async function fetchChatPage(
  api: (path: string) => Promise<any>,
  path: string,
  cursor?: string,
  after?: string | null,
) {
  const query = cursor
    ? "?cursor=" + encodeURIComponent(cursor)
    : after
      ? "?limit=100&after=" + encodeURIComponent(after)
      : "";
  try {
    return await api(path + query);
  } catch (e: any) {
    if (e.code !== "CHAT_POSITION_EXPIRED") throw e;
    return { ...(await api(path)), reset: true };
  }
}
