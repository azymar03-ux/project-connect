import { HttpException } from "@nestjs/common";
export function githubRepo(url: string) {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new HttpException("Invalid repository URL.", 400);
  }
  if (
    u.protocol !== "https:" ||
    u.hostname !== "github.com" ||
    u.username ||
    u.password ||
    u.port ||
    u.search ||
    u.hash
  )
    throw new HttpException("A github.com repository URL is required.", 400);
  const parts = u.pathname.replace(/\/$/, "").split("/").filter(Boolean);
  if (
    parts.length !== 2 ||
    !parts.every((p) => /^[\w.-]{1,100}$/.test(p) && p !== "." && p !== "..")
  )
    throw new HttpException("Use https://github.com/owner/repository.", 400);
  if (
    !parts[1].replace(/\.git$/, "") ||
    [".", ".."].includes(parts[1].replace(/\.git$/, ""))
  )
    throw new HttpException("Invalid repository name.", 400);
  return { owner: parts[0], repo: parts[1].replace(/\.git$/, "") };
}
