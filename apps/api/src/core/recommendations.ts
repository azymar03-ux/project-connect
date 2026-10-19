import { Prisma } from "@prisma/client";
export const recommendationVersion = "fit-v2";
type Profile = {
  skills?: string[];
  interests?: string[];
  city?: string;
} | null;
export function matchReasons(
  me: Profile,
  skills: string[],
  interests: string[],
  city: string,
  active = false,
) {
  const mine = new Set((me?.skills || []).map((s) => s.toLowerCase())),
    likes = new Set((me?.interests || []).map((s) => s.toLowerCase()));
  const matchedSkills = skills.filter((s) => mine.has(s.toLowerCase())),
    matchedInterests = interests.filter((s) => likes.has(s.toLowerCase()));
  const sameCity = !!me?.city && me.city.toLowerCase() === city.toLowerCase();
  return {
    matchedSkills,
    matchedInterests,
    sameCity,
    recentPublicActivity: active,
    version: recommendationVersion,
    note: "Explainable heuristic fit, not a calibrated success probability. Public activity means a visible update within 30 days, not online presence.",
  };
}
export function matchScore(
  me: Profile,
  skills: string[],
  interests: string[],
  city: string,
  active = false,
) {
  if (!me) return null;
  const r = matchReasons(me, skills, interests, city, active);
  return Math.min(
    100,
    Math.round(
      25 +
        (55 * r.matchedSkills.length) / Math.max(1, skills.length) +
        (r.sameCity ? 10 : 0) +
        (5 * r.matchedInterests.length) / Math.max(1, interests.length) +
        (active ? 5 : 0),
    ),
  );
}
// All SQL identifiers are closed constants, never user input.
export function matchSql(
  kind: "projects" | "people",
  me: Profile,
  active: Prisma.Sql,
) {
  const skills = (me?.skills || []).map((s) => s.toLowerCase()),
    interests = (me?.interests || []).map((s) => s.toLowerCase());
  const candidateSkills =
      kind === "projects"
        ? Prisma.sql`p."requiredSkills"`
        : Prisma.sql`p.skills`,
    candidateInterests =
      kind === "projects"
        ? Prisma.sql`p.tags||ARRAY[p.category]`
        : Prisma.sql`p.interests`;
  return Prisma.sql`LEAST(100,ROUND(25+55*(SELECT count(*) FROM unnest(${candidateSkills}) s WHERE lower(s)=ANY(${skills}::text[]))::numeric/GREATEST(1,cardinality(${candidateSkills}))+CASE WHEN ${me?.city || ""}<>'' AND lower(p.city)=lower(${me?.city || ""}) THEN 10 ELSE 0 END+5*(SELECT count(*) FROM unnest(${candidateInterests}) s WHERE lower(s)=ANY(${interests}::text[]))::numeric/GREATEST(1,cardinality(${candidateInterests}))+CASE WHEN ${active} THEN 5 ELSE 0 END))`;
}
