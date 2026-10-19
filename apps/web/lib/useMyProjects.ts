"use client";
import { useEffect, useState } from "react";
// Load all bounded membership pages, independent of public discovery filters.
export function useMyProjects(userId?: string) {
  const [projects, setProjects] = useState<any[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let stopped = false;
    setProjects([]);
    setError("");
    if (!userId) return;
    async function load() {
      let cursor: string | null = null;
      const rows: any[] = [];
      try {
        for (let page = 0; page < 20; page++) {
          const r: Response = await fetch(
            "/api/discovery/projects?scope=mine&sort=newest&limit=50" +
              (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
          );
          const b: {
            items: any[];
            nextCursor: string | null;
            message?: string;
          } = await r.json();
          if (!r.ok)
            throw Error(b.message || "Unable to load your project list.");
          rows.push(...b.items);
          cursor = b.nextCursor;
          if (!cursor) break;
        }
        if (cursor)
          throw Error(
            "More than 1,000 memberships: use workspace navigation or contact support.",
          );
        if (!stopped) setProjects(rows);
      } catch (e: any) {
        if (!stopped) setError(e.message);
      }
    }
    void load();
    return () => {
      stopped = true;
    };
  }, [userId]);
  return { projects, error };
}
