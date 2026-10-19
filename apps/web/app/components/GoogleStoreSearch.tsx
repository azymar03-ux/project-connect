"use client";
import { loadGoogleMaps } from "../../lib/google-maps";
import { useEffect, useRef, useState } from "react";
export default function GoogleStoreSearch({
  origin,
  radius,
  user,
  onSignIn,
}: {
  origin: { lat: number; lng: number };
  radius: number;
  user: any;
  onSignIn: () => void;
}) {
  const [status, setStatus] = useState<any>(null),
    [query, setQuery] = useState(
      "electronics hardware robotics components store",
    ),
    [items, setItems] = useState<any[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [mapMode, setMapMode] = useState(false);
  const generation = useRef(0);
  const container = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    fetch("/api/places/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => setError("Provider status unavailable"));
  }, []);
  useEffect(() => {
    generation.current++;
    setItems([]);
    setBusy(false);
    return () => {
      generation.current++;
    };
  }, [origin.lat, origin.lng, radius, user?.id]);
  useEffect(() => {
    if (!mapMode || !status?.browserKey || !container.current) return;
    let stopped = false;
    let map: any, maps: any;
    const markers: any[] = [];
    async function draw() {
      try {
        maps = await loadGoogleMaps(status.browserKey);
        if (stopped || !container.current) return;
        setError("");
        map = new maps.Map(container.current, {
          center: origin,
          zoom: 12,
        });
        for (const p of items)
          markers.push(
            new maps.Marker({
              map,
              position: { lat: p.location.latitude, lng: p.location.longitude },
              title: p.displayName.text,
            }),
          );
      } catch (e: any) {
        if (!stopped) setError(e.message);
      }
    }
    draw();
    return () => {
      stopped = true;
      for (const marker of markers) {
        marker.setMap(null);
        maps?.event?.clearInstanceListeners(marker);
      }
      if (map) {
        maps?.event?.clearInstanceListeners(map);
        map.unbindAll?.();
      }
    };
  }, [mapMode, status?.browserKey, items, origin.lat, origin.lng]);
  return (
    <section className="panel" style={{ marginBottom: 24 }}>
      <h2>Google Places search</h2>
      <p className="integration-note">
        Separate from community records. Results are transient suggestions, not
        stock or merchant verification. Location/search are sent to Google only
        when you search or explicitly open a Google map. Owner must approve
        policies and restrict keys.{" "}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google privacy
        </a>
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (!user) return onSignIn();
          const current = ++generation.current;
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/places/search", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                lat: origin.lat,
                lng: origin.lng,
                radiusKm: Math.min(50, radius),
                query,
              }),
            });
            const b = await r.json();
            if (!r.ok) throw Error(b.message);
            if (current === generation.current) setItems(b.items);
          } catch (e: any) {
            if (current === generation.current) setError(e.message);
          } finally {
            if (current === generation.current) setBusy(false);
          }
        }}
      >
        <label className="field">
          Google store query
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            minLength={3}
            maxLength={120}
          />
        </label>
        <button
          className="secondary-button"
          disabled={busy || !status?.configured}
        >
          {busy
            ? "Searching Google…"
            : status?.configured
              ? "Search Google Places"
              : "Google Places not configured"}
        </button>
        {status?.mapConfigured && (
          <button
            type="button"
            className="secondary-button"
            onClick={() => setMapMode(!mapMode)}
          >
            {mapMode ? "List only" : "Show Google map"}
          </button>
        )}
      </form>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      {mapMode && (
        <div
          ref={container}
          role="region"
          aria-label="Google store map"
          style={{ height: 320, marginTop: 16 }}
        />
      )}
      {items.length > 0 && (
        <div style={{ paddingTop: 16 }}>
          {/* Unmodified official attribution asset; minimum clear space per Google policy. */}
          <img
            src="/images/google-maps-attribution.png"
            alt="Google Maps"
            style={{ height: 18, width: "auto", margin: "10px 10px 5px" }}
          />
          {items.map((p) => (
            <article key={p.id} className="application-row">
              <div>
                <h3>{p.displayName.text}</h3>
                <p>{p.formattedAddress}</p>
                <small>
                  {p.distanceKm} km ·{" "}
                  {p.businessStatus || "Status not supplied"}
                </small>
                {(p.internationalPhoneNumber || p.nationalPhoneNumber) && (
                  <p>
                    Phone: {p.internationalPhoneNumber || p.nationalPhoneNumber}
                  </p>
                )}
                {p.websiteUri?.startsWith("https://") && (
                  <p>
                    <a
                      href={p.websiteUri}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Store website
                    </a>
                  </p>
                )}
                {p.currentOpeningHours && (
                  <div>
                    <p>
                      {p.currentOpeningHours.openNow === true
                        ? "Reported open now"
                        : p.currentOpeningHours.openNow === false
                          ? "Reported closed now"
                          : "Opening status not supplied"}
                      . Confirm with the store before travelling.
                    </p>
                    <ul>
                      {p.currentOpeningHours.weekdayDescriptions?.map(
                        (line: string, i: number) => (
                          <li key={i}>{line}</li>
                        ),
                      )}
                    </ul>
                  </div>
                )}
                {p.attributions.map((a: any, i: number) => (
                  <span key={i} style={{ display: "block" }}>
                    {a.provider}
                    {a.providerUri?.startsWith("https://") && (
                      <a
                        href={a.providerUri}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {" "}
                        Attribution source
                      </a>
                    )}
                  </span>
                ))}
              </div>
              {p.googleMapsUri?.startsWith("https://www.google.com/maps") && (
                <a
                  className="secondary-button"
                  href={p.googleMapsUri}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Google Maps
                </a>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
