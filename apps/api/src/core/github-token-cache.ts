// Process-local quota optimization, NOT an authorization/revocation boundary.
// Every consumer must still recheck current link and authorization after reads.
export class GithubTokenCache {
  private entries = new Map<
    string,
    { installation: string; expires: number; promise: Promise<string> }
  >();
  constructor(
    private clock = Date.now,
    private capacity = 200,
  ) {}
  invalidate(installation: string) {
    for (const [key, e] of this.entries)
      if (e.installation === installation) this.entries.delete(key);
  }
  async get(
    key: string,
    installation: string,
    mint: () => Promise<{ token: string; expires: number }>,
  ) {
    const existing = this.entries.get(key);
    if (existing && existing.expires > this.clock()) return existing.promise;
    this.entries.delete(key);
    if (this.entries.size >= this.capacity)
      this.entries.delete(this.entries.keys().next().value!);
    const entry = {
      installation,
      expires: this.clock() + 10000,
      promise: null as unknown as Promise<string>,
    };
    entry.promise = Promise.resolve()
      .then(mint)
      .then((result) => {
        // Object identity prevents a revoked/evicted mint from repopulating cache.
        if (this.entries.get(key) === entry) {
          entry.expires = Math.min(
            result.expires - 60000,
            this.clock() + 300000,
          );
          if (entry.expires <= this.clock()) this.entries.delete(key);
        }
        return result.token;
      })
      .catch((error) => {
        if (this.entries.get(key) === entry) this.entries.delete(key);
        throw error;
      });
    this.entries.set(key, entry);
    return entry.promise;
  }
}
export const githubTokens = new GithubTokenCache();
