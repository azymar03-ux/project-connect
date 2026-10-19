"use client";
import { use, useEffect, useState } from "react";
import { ArrowLeft, MapPin, GraduationCap, ExternalLink } from "lucide-react";
export default function ProfilePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [profile, setProfile] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    fetch("/api/profiles/" + id)
      .then(async (r) => {
        const b = await r.json();
        if (!r.ok) throw new Error(b.message);
        setProfile(b);
      })
      .catch((e) => setError(e.message));
  }, [id]);
  return (
    <main className="public-profile-page">
      <a className="workspace-back" href="/">
        <ArrowLeft size={15} />
        Back to ProjectConnect
      </a>
      {error ? (
        <div className="empty-state">
          <h1>Profile unavailable</h1>
          <p>{error}</p>
        </div>
      ) : !profile ? (
        <p className="muted">Loading profile…</p>
      ) : (
        <>
          <section className="panel profile-hero">
            <span className={"avatar large " + profile.color}>
              {profile.initials}
            </span>
            <div>
              <div className="eyebrow">PROJECTCONNECT BUILDER</div>
              <h1>{profile.name}</h1>
              <p>{profile.role}</p>
            </div>
          </section>
          <div className="progress-layout">
            <section className="panel">
              <h3>About</h3>
              <p className="detail-description">
                {profile.bio || "This builder has not added a bio yet."}
              </p>
              <p className="person-location">
                <MapPin size={15} />
                {profile.city || "Location not specified"}
              </p>
              {profile.education && (
                <p className="person-location">
                  <GraduationCap size={15} />
                  {profile.education}
                </p>
              )}
              {profile.portfolioUrl && (
                <a
                  className="secondary-button"
                  href={profile.portfolioUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Portfolio
                  <ExternalLink size={14} />
                </a>
              )}
              <h3>Skills</h3>
              <div className="tags">
                {profile.skills.map((s: string) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
              <h3>Interests</h3>
              <div className="tags">
                {profile.interests.map((s: string) => (
                  <span key={s}>{s}</span>
                ))}
              </div>
              <p className="integration-note">
                {profile.followers} followers · {profile.following} following
              </p>
            </section>
            <section className="panel">
              <h3>Projects started</h3>
              {profile.projects.length === 0 ? (
                <p className="muted">No public projects yet.</p>
              ) : (
                profile.projects.map((p: any) => (
                  <a
                    className="workspace-resource-choice"
                    href={"/projects/" + encodeURIComponent(p.id)}
                    key={p.id}
                  >
                    {p.title}
                    <small>{p.status}</small>
                  </a>
                ))
              )}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
