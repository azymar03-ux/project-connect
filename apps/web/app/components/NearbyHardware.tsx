"use client";
import GoogleStoreSearch from "./GoogleStoreSearch";
import { useEffect, useState, useRef } from "react";
import {
  MapPin,
  Navigation,
  Star,
  Search,
  Plus,
  X,
  Loader2,
  Flag,
  LocateFixed,
} from "lucide-react";
async function api(path: string, method = "GET", data?: unknown) {
  const r = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.message || "Request failed.");
  return b;
}
const DEFAULT = { lat: 11.0168, lng: 76.9558, label: "Coimbatore city centre" };
export default function NearbyHardware({
  user,
  onSignIn,
  notify,
}: {
  user: any;
  onSignIn: () => void;
  notify: (s: string) => void;
}) {
  const [origin, setOrigin] = useState(DEFAULT),
    [radius, setRadius] = useState(25),
    [category, setCategory] = useState(""),
    [search, setSearch] = useState(""),
    [items, setItems] = useState<any[]>([]),
    [cats, setCats] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [favOnly, setFavOnly] = useState(false),
    [submit, setSubmit] = useState(false),
    [busy, setBusy] = useState(false),
    [active, setActive] = useState<string | null>(null);
  const generation = useRef(0);
  async function load() {
    const current = ++generation.current;
    setLoading(true);
    setError("");
    try {
      const q = new URLSearchParams({
        lat: String(origin.lat),
        lng: String(origin.lng),
        radiusKm: String(radius),
        ...(category ? { category } : {}),
        ...(search ? { search } : {}),
        ...(favOnly ? { favorites: "true" } : {}),
      });
      const b = await api("stores?" + q);
      if (current !== generation.current) return;
      setItems(b.items);
      setCats(b.categories);
    } catch (e: any) {
      if (current === generation.current) setError(e.message);
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }
  useEffect(() => {
    const t = setTimeout(load, 200);
    return () => {
      generation.current++;
      clearTimeout(t);
    };
  }, [origin, radius, category, search, favOnly, user?.id]);
  function locate() {
    if (!navigator.geolocation)
      return notify("Location is not available in this browser.");
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setOrigin({
          lat: p.coords.latitude,
          lng: p.coords.longitude,
          label: "Your location",
        });
        notify("Showing stores near you");
      },
      () => notify("Location permission denied. Showing the default area."),
      { timeout: 10000, maximumAge: 300000 },
    );
  }
  const span =
    Math.max(
      0.02,
      ...items.map((s) =>
        Math.max(Math.abs(s.lat - origin.lat), Math.abs(s.lng - origin.lng)),
      ),
    ) * 1.25;
  const pos = (s: { lat: number; lng: number }) => ({
    x: 50 + (45 * (s.lng - origin.lng)) / span,
    y: 50 - (45 * (s.lat - origin.lat)) / span,
  });
  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">THE RIGHT PARTS. RIGHT AROUND YOU.</div>
          <h1>Nearby hardware</h1>
          <p>
            Find electronics, drone, robotics and prototyping shops near you.
          </p>
        </div>
        <button
          className="primary-button"
          onClick={() => (user ? setSubmit(true) : onSignIn())}
        >
          <Plus size={17} />
          Suggest a store
        </button>
      </div>
      <div className="resource-controls">
        <label className="search-box">
          <Search size={18} />
          <input
            aria-label="Search stores"
            placeholder="Search stores or components…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <button className="filter-button" onClick={locate}>
          <LocateFixed size={15} />
          Use my location
        </button>
        <label className="sort-control">
          Radius{" "}
          <select
            aria-label="Search radius"
            value={radius}
            onChange={(e) => setRadius(Number(e.target.value))}
          >
            {[5, 10, 25, 50, 100].map((r) => (
              <option key={r} value={r}>
                {r} km
              </option>
            ))}
          </select>
        </label>
        <button
          className={"filter-button " + (favOnly ? "enabled" : "")}
          onClick={() => (user ? setFavOnly(!favOnly) : onSignIn())}
        >
          <Star size={15} />
          Favourites
        </button>
      </div>
      <div className="category-tabs">
        <button
          className={category === "" ? "active" : ""}
          onClick={() => setCategory("")}
        >
          All
        </button>
        {cats.map((c) => (
          <button
            key={c}
            className={category === c ? "active" : ""}
            onClick={() => setCategory(c)}
          >
            {c}
          </button>
        ))}
      </div>
      <p className="integration-note">
        <MapPin size={12} /> Distances from {origin.label}. Listings marked
        “Sample” are demonstration data, not verified businesses. Directions
        open Google Maps.
      </p>
      {error && (
        <div className="form-error" role="alert">
          {error}
        </div>
      )}
      <GoogleStoreSearch
        origin={origin}
        radius={radius}
        user={user}
        onSignIn={onSignIn}
      />
      <div className="store-layout">
        <section className="panel store-map" aria-label="Relative store map">
          <svg
            viewBox="0 0 100 100"
            role="group"
            aria-label={`${items.length} stores plotted relative to ${origin.label}`}
          >
            <defs>
              <radialGradient id="mapglow">
                <stop offset="0" stopColor="#58d9da33" />
                <stop offset="1" stopColor="#58d9da00" />
              </radialGradient>
            </defs>
            {[15, 30, 45].map((r) => (
              <circle
                key={r}
                cx="50"
                cy="50"
                r={r}
                fill="none"
                stroke="#2f4256"
                strokeDasharray="1 1.5"
                strokeWidth=".3"
              />
            ))}
            <circle cx="50" cy="50" r="12" fill="url(#mapglow)" />
            <circle cx="50" cy="50" r="1.8" fill="#58d9da" />
            {items.map((s) => {
              const p = pos(s);
              return (
                <g
                  key={s.id}
                  onClick={() => setActive(s.id)}
                  role="button"
                  tabIndex={0}
                  aria-label={"Highlight " + s.name}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setActive(s.id);
                    }
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <circle
                    cx={p.x}
                    cy={p.y}
                    r={active === s.id ? 3 : 2.2}
                    fill={active === s.id ? "#a99bff" : "#7aa7ff"}
                    stroke="#0c1018"
                    strokeWidth=".6"
                  />
                  <title>{s.name}</title>
                </g>
              );
            })}
          </svg>
          <small>Relative positions · north is up · not to exact scale</small>
        </section>
        <div className="store-list">
          {loading ? (
            <div className="loading-state">
              <Loader2 className="spin" />
              Finding stores…
            </div>
          ) : items.length === 0 ? (
            <div className="empty-state">
              <MapPin size={32} />
              <h3>No stores in this area yet.</h3>
              <p>
                Try a larger radius, another category, or suggest a store you
                know.
              </p>
            </div>
          ) : (
            items.map((s) => (
              <article
                key={s.id}
                className={
                  "panel store-card " + (active === s.id ? "active" : "")
                }
                onMouseEnter={() => setActive(s.id)}
              >
                <div className="store-card-top">
                  <div>
                    <h3>{s.name}</h3>
                    <p className="muted">
                      {s.address}, {s.city}
                    </p>
                  </div>
                  {s.distanceKm !== null && (
                    <span className="match">{s.distanceKm} km</span>
                  )}
                </div>
                <p>{s.description}</p>
                <div className="tags">
                  {s.categories.map((c: string) => (
                    <span key={c}>{c}</span>
                  ))}
                  {s.sample && <span>Sample listing</span>}
                </div>
                <div className="resource-footer">
                  <a
                    className="secondary-button"
                    href={`https://www.google.com/maps/dir/?api=1&destination=${s.lat},${s.lng}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Navigation size={13} />
                    Directions
                  </a>
                  <button
                    className={"icon-button " + (s.favorite ? "saved" : "")}
                    aria-label={
                      (s.favorite ? "Remove favourite " : "Favourite ") + s.name
                    }
                    onClick={async () => {
                      if (!user) return onSignIn();
                      try {
                        await api(`stores/${s.id}/favorite`, "POST", {
                          enabled: !s.favorite,
                        });
                        load();
                      } catch (e: any) {
                        notify(e.message);
                      }
                    }}
                  >
                    <Star
                      size={17}
                      fill={s.favorite ? "currentColor" : "none"}
                    />
                  </button>
                  <button
                    className="icon-button"
                    aria-label={"Report " + s.name}
                    onClick={async () => {
                      if (!user) return onSignIn();
                      const reason = window.prompt(
                        "What is wrong with this listing? (at least 10 characters)",
                      );
                      if (!reason) return;
                      try {
                        notify(
                          (
                            await api("reports", "POST", {
                              targetType: "store",
                              targetId: s.id,
                              reason,
                            })
                          ).message,
                        );
                      } catch (e: any) {
                        notify(e.message);
                      }
                    }}
                  >
                    <Flag size={15} />
                  </button>
                  <span>{s.hours || "Hours not listed"}</span>
                </div>
              </article>
            ))
          )}
        </div>
      </div>
      {submit && (
        <div className="modal-backdrop" onClick={() => setSubmit(false)}>
          <section
            className="modal wide-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Suggest a store"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close store dialog"
              onClick={() => setSubmit(false)}
            >
              <X size={20} />
            </button>
            <div className="eyebrow">HELP THE COMMUNITY FIND PARTS</div>
            <h2>Suggest a hardware store.</h2>
            <p className="modal-subtitle">
              Listings appear after a moderator reviews them.
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                const f = new FormData(e.currentTarget);
                try {
                  const r = await api("stores", "POST", {
                    name: f.get("name"),
                    address: f.get("address"),
                    city: f.get("city"),
                    lat: Number(f.get("lat")),
                    lng: Number(f.get("lng")),
                    phone: f.get("phone"),
                    hours: f.get("hours"),
                    description: f.get("description"),
                    categories: f.getAll("categories"),
                  });
                  setSubmit(false);
                  notify(r.message);
                } catch (e: any) {
                  notify(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="field">
                Store name
                <input name="name" required minLength={3} maxLength={120} />
              </label>
              <label className="field">
                Address
                <input name="address" required minLength={5} maxLength={250} />
              </label>
              <div className="form-columns">
                <label className="field">
                  City
                  <input name="city" required defaultValue="Coimbatore" />
                </label>
                <label className="field">
                  Phone
                  <input name="phone" maxLength={30} />
                </label>
              </div>
              <div className="form-columns">
                <label className="field">
                  Latitude
                  <input
                    name="lat"
                    type="number"
                    step="any"
                    min={-90}
                    max={90}
                    required
                    defaultValue={origin.lat}
                  />
                </label>
                <label className="field">
                  Longitude
                  <input
                    name="lng"
                    type="number"
                    step="any"
                    min={-180}
                    max={180}
                    required
                    defaultValue={origin.lng}
                  />
                </label>
              </div>
              <label className="field">
                Opening hours
                <input
                  name="hours"
                  maxLength={120}
                  placeholder="e.g. Mon–Sat 10:00–20:00"
                />
              </label>
              <label className="field">
                What do they sell?
                <textarea name="description" maxLength={600} rows={2} />
              </label>
              <fieldset className="field category-fieldset">
                <legend>Categories</legend>
                {cats.map((c) => (
                  <label key={c} className="checkbox-field">
                    <input type="checkbox" name="categories" value={c} />
                    {c}
                  </label>
                ))}
              </fieldset>
              <button className="primary-button full-width" disabled={busy}>
                Submit for review
              </button>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
