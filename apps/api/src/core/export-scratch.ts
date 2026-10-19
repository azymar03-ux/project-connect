import { opendir, lstat, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { root } from "./storage";
// 24h conservative grace exceeds the 180s worker lease / 120s build cap. Private
// server-owned roots only; unknown names and symlinks are never traversed/deleted.
export async function scavengeExportScratch(
  options: { roots?: string[]; now?: number; limit?: number } = {},
) {
  const now = options.now ?? Date.now();
  let inspected = 0,
    removed = 0;
  for (const base of new Set(options.roots || [root, process.cwd()])) {
    let dir;
    try {
      dir = await opendir(base);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    for await (const entry of dir) {
      if (++inspected > (options.limit || 10000)) return removed;
      if (
        !entry.isDirectory() ||
        !/^\.export-tmp-[A-Za-z0-9]{6}$/.test(entry.name)
      )
        continue;
      const path = resolve(base, entry.name);
      try {
        const stat = await lstat(path);
        if (
          stat.isDirectory() &&
          !stat.isSymbolicLink() &&
          stat.mtimeMs < now - 86400000
        ) {
          await rm(path, { recursive: true, force: true });
          removed++;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
  }
  return removed;
}
