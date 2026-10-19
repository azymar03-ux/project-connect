import { z } from "zod";
import { boundedJson } from "./http-json";
import { SharedLimiter } from "./rate-limit";
const metadata = z.object({
  full_name: z.string().max(250),
  description: z.string().max(3000).nullable().optional(),
  stargazers_count: z.number().int().nonnegative(),
  language: z.string().max(100).nullable().optional(),
  license: z
    .object({ spdx_id: z.string().max(100) })
    .nullable()
    .optional(),
  updated_at: z.iso.datetime(),
  private: z.boolean().optional(),
});
type Data = {
  name: string;
  description: string;
  stars: number;
  language: string | null;
  license: string | null;
  url: string;
  updatedAt: string;
  fetchedAt: string;
};
type Entry = {
  data?: Data;
  expires: number;
  used: number;
  pending?: Promise<Data>;
};
export class GithubMetadataCache {
  private entries = new Map<string, Entry>();
  private cooldown = 0;
  constructor(
    private fetcher: typeof fetch = fetch,
    private clock = Date.now,
    private budget: () => Promise<boolean> = async () => true,
  ) {}
  async get(owner: string, repo: string, background = false): Promise<Data> {
    if (!/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo))
      throw Error("INVALID_GITHUB_PATH");
    const key = owner + "/" + repo,
      now = this.clock();
    let entry = this.entries.get(key);
    if (!entry) {
      if (this.entries.size >= 200)
        this.entries.delete(this.entries.keys().next().value!);
      entry = { expires: 0, used: now };
      this.entries.set(key, entry);
    }
    if (!background) entry.used = now;
    if (entry.data && entry.expires > now) return entry.data;
    if (entry.pending) return entry.pending;
    if (this.cooldown > now) throw Error("GITHUB_RATE_LIMITED");
    const target = entry;
    target.pending = (async () => {
      if (!(await this.budget())) throw Error("GITHUB_RATE_LIMITED");
      const r = await this.fetcher(
        `https://api.github.com/repos/${owner}/${repo}`,
        {
          redirect: "error",
          signal: AbortSignal.timeout(8000),
          headers: {
            Accept: "application/vnd.github+json",
            "User-Agent": "ProjectConnect",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (
        r.status === 429 ||
        (r.status === 403 &&
          (r.headers.has("retry-after") ||
            r.headers.get("x-ratelimit-remaining") === "0"))
      ) {
        const retry = Number(r.headers.get("retry-after")),
          reset = Number(r.headers.get("x-ratelimit-reset")) * 1000;
        this.cooldown =
          this.clock() +
          Math.max(
            1000,
            Math.min(
              3600000,
              retry > 0
                ? retry * 1000
                : reset > this.clock()
                  ? reset - this.clock()
                  : 60000,
            ),
          );
        throw Error("GITHUB_RATE_LIMITED");
      }
      if (!r.ok)
        throw Error(
          r.status === 404 ? "GITHUB_NOT_FOUND" : "GITHUB_UNAVAILABLE",
        );
      const b = metadata.parse(await boundedJson(r));
      if (b.private) throw Error("GITHUB_NOT_PUBLIC");
      const data = {
        name: b.full_name,
        description: b.description || "",
        stars: b.stargazers_count,
        language: b.language || null,
        license: b.license?.spdx_id || null,
        url: `https://github.com/${owner}/${repo}`,
        updatedAt: b.updated_at,
        fetchedAt: new Date(this.clock()).toISOString(),
      };
      target.data = data;
      target.expires = this.clock() + 300000;
      return data;
    })().finally(() => {
      target.pending = undefined;
    });
    return target.pending;
  }
  async refresh() {
    const now = this.clock();
    for (const [key, e] of this.entries) {
      if (now - e.used > 900000) {
        this.entries.delete(key);
        continue;
      }
      if (!e.pending && e.expires <= now) {
        const [owner, repo] = key.split("/");
        await this.get(owner, repo, true);
        return;
      }
    }
  }
}
let limiter: Promise<SharedLimiter> | undefined;
async function budget() {
  const l = await (limiter ??= (async () => {
    const l = new SharedLimiter(process.env.REDIS_URL);
    await l.connect();
    return l;
  })());
  return (await l.hit("github-public-upstream", 50, 3600000)).allowed;
}
export const githubMetadata = new GithubMetadataCache(
  (...args) => fetch(...args),
  Date.now,
  budget,
);
export function startGithubMetadataWorker() {
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void githubMetadata
      .refresh()
      .catch(() => {
        /* Next manual read reports upstream failure; no private payload logging. */
      })
      .finally(() => {
        running = false;
      });
  }, 60000);
  timer.unref();
}
