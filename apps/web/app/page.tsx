"use client";
import { useChatReadAck } from "./components/useChatReadAck";
import ImageUpload from "./components/ImageUpload";
import { fetchChatPage } from "./components/chat-sync";
import {
  useChatDelivery,
  clearChatDelivery,
} from "./components/useChatDelivery";
import SocialFeed from "./components/SocialFeed";
import NotificationCenter from "./components/NotificationCenter";
import { useDialogAccessibility } from "./components/useDialogAccessibility";
import Invitations from "./components/Invitations";
import NearbyHardware from "./components/NearbyHardware";
import AiAssistant from "./components/AiAssistant";
import AdminPanel from "./components/AdminPanel";
import AccountSecurity from "./components/AccountSecurity";
import ResourceHub from "./components/ResourceHub";
import Workspace from "./components/Workspace";
import { useEffect, useState, useRef } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  Search,
  Plus,
  House,
  Layers,
  Users,
  MapPin,
  BookOpen,
  Bot,
  MessageSquare,
  Bell,
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  SlidersHorizontal,
  Bookmark,
  Check,
  X,
  Send,
  LogOut,
  Settings,
  Sparkles,
  Code2,
  Radio,
  Leaf,
  Compass,
  Menu,
  Globe,
  Clock,
  ExternalLink,
  CheckCircle2,
  Loader2,
  Zap,
  Briefcase,
  Link as LinkIcon,
  Heart,
} from "lucide-react";
type Person = {
  avatarId?: string;
  education?: string;
  portfolioUrl?: string;
  following?: boolean;
  id: string;
  name: string;
  initials: string;
  color: string;
  role: string;
  bio: string;
  city: string;
  skills: string[];
  interests: string[];
  match?: number;
  connection?: any;
};
type Project = {
  id: string;
  title: string;
  description: string;
  image: string;
  category: string;
  tags: string[];
  requiredSkills: string[];
  positions: string[];
  city: string;
  remote: boolean;
  status: string;
  teamSize: number;
  ownerId: string;
  owner: Person;
  members: any[];
  match: number | null;
  bookmarked: boolean;
  application: any;
  isMember: boolean;
  createdAt: string;
};
async function api(path: string, method = "GET", data?: unknown) {
  const res = await fetch("/api/" + path, {
    method,
    headers: { "Content-Type": "application/json" },
    signal: AbortSignal.timeout(15000),
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const body = await res.json();
  if (!res.ok)
    throw Object.assign(
      new Error(body.message || "Something went wrong. Please try again."),
      { code: body.code, status: res.status },
    );
  return body;
}
function Mark({ small = false }: { small?: boolean }) {
  return (
    <span className={"brand-mark " + (small ? "small" : "")}>
      <svg viewBox="0 0 44 44" fill="none">
        <defs>
          <linearGradient
            id="brand"
            x1="6"
            y1="39"
            x2="36"
            y2="4"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#9957ff" />
            <stop offset=".52" stopColor="#497aff" />
            <stop offset="1" stopColor="#27e5e5" />
          </linearGradient>
        </defs>
        <path
          d="M13 5h15c10 0 15 6 12 15-2 7-8 11-15 11h-5l3-9h4c3 0 5-2 5-5 0-2-2-3-5-3H10l3-9ZM9 19h11l-8 22H2l7-22Z"
          fill="url(#brand)"
        />
      </svg>
    </span>
  );
}
function Avatar({
  person,
  size = "",
}: {
  person: Partial<Person>;
  size?: string;
}) {
  return (
    <span className={`avatar ${person.color || "purple"} ${size}`}>
      {person.avatarId ? (
        <img src={`/api/images/${person.avatarId}`} alt="" />
      ) : (
        person.initials || person.name?.slice(0, 2).toUpperCase()
      )}
    </span>
  );
}
const cats = [
  "All projects",
  "Robotics",
  "AI & ML",
  "IoT",
  "Web development",
  "Design",
];
const PRO_SKILLS = [
  { name: "Supabase", color: "green" },
  { name: "Next.js", color: "cyan" },
  { name: "React", color: "cyan" },
  { name: "TypeScript", color: "blue" },
  { name: "PostgreSQL", color: "blue" },
  { name: "Tailwind CSS", color: "cyan" },
  { name: "Node.js", color: "green" },
  { name: "Python", color: "yellow" },
  { name: "Robotics", color: "orange" },
  { name: "IoT & Arduino", color: "orange" },
  { name: "AI & ML", color: "purple" },
  { name: "UI/UX Design", color: "pink" },
];
export default function Page() {
  useDialogAccessibility();
  const chatGeneration = useRef(0),
    chatHasHistory = useRef(false);
  const chatGap = useRef(false);
  const chatBoundary = useRef<string | null>(null),
    chatFetching = useRef<number | null>(null);
  const [chatCursor, setChatCursor] = useState<string | null>(null),
    [chatError, setChatError] = useState(""),
    [chatLoading, setChatLoading] = useState(false);
  const [authReady, setAuthReady] = useState(false),
    [googleConfigured, setGoogleConfigured] = useState(false);
  const [unread, setUnread] = useState({ notifications: 0, messages: 0 });
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [view, setView] = useState("Discover"),
    [user, setUser] = useState<Person | null>(null),
    [projects, setProjects] = useState<Project[]>([]),
    [people, setPeople] = useState<Person[]>([]),
    [loading, setLoading] = useState(true),
    [query, setQuery] = useState(""),
    [category, setCategory] = useState("All projects"),
    [sort, setSort] = useState("Recommended"),
    [remoteOnly, setRemoteOnly] = useState(false),
    [showFilters, setShowFilters] = useState(false),
    [toast, setToast] = useState(""),
    [modal, setModal] = useState<"auth" | "create" | "profile" | null>(null),
    [authMode, setAuthMode] = useState("login"),
    [selected, setSelected] = useState<Project | null>(null),
    [mobileOpen, setMobileOpen] = useState(false),
    [applications, setApplications] = useState<any[]>([]),
    [applicationCursor, setApplicationCursor] = useState<string | null>(null),
    [applicationsLoading, setApplicationsLoading] = useState(false),
    [activeChat, setActiveChat] = useState<Person | null>(null),
    [messages, setMessages] = useState<any[]>([]),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [applyText, setApplyText] = useState(""),
    [applyOpen, setApplyOpen] = useState(false);
  const delivery = useChatDelivery(
    `${user?.id}:dm:${activeChat?.id}`,
    (body) => api("messages/" + activeChat?.id, "POST", body),
    async () => {
      setMessage("");
      await refreshChat();
    },
    (s) => notify(s),
    (requestId) =>
      api(
        "messages/" +
          activeChat?.id +
          "?requestId=" +
          encodeURIComponent(requestId),
      ),
  );
  async function refreshUnread() {
    if (user) {
      try {
        setUnread(await api("unread"));
      } catch {}
    } else setUnread({ notifications: 0, messages: 0 });
  }
  const [projectCursor, setProjectCursor] = useState<string | null>(null),
    [peopleCursor, setPeopleCursor] = useState<string | null>(null),
    [discoveryError, setDiscoveryError] = useState("");
  const discoveryGeneration = useRef(0);
  async function openProject(id: string) {
    try {
      setSelected(await api("projects/" + id));
      setApplyOpen(false);
    } catch (e: any) {
      notify(e.message);
    }
  }
  const notify = (text: string) => {
    setToast(text);
    setTimeout(() => setToast(""), 4000);
  };
  function discoveryPath(kind: "projects" | "people", cursor?: string) {
    const scope =
      kind === "projects"
        ? view === "My projects"
          ? "mine"
          : view === "Saved projects"
            ? "saved"
            : "all"
        : view === "Messages"
          ? "connections"
          : "all";
    return (
      "discovery/" +
      kind +
      "?" +
      new URLSearchParams({
        q: query,
        category: kind === "projects" ? category : "All projects",
        remote: String(kind === "projects" && remoteOnly),
        scope,
        sort: sort === "Newest first" ? "newest" : "recommended",
        limit: "12",
        ...(cursor ? { cursor } : {}),
      }).toString()
    );
  }
  async function load(
    cursor?: string,
    kind: "projects" | "people" = "projects",
  ) {
    const generation = ++discoveryGeneration.current;
    setLoading(true);
    try {
      if (cursor) {
        const b = await api(discoveryPath(kind, cursor));
        if (generation !== discoveryGeneration.current) return;
        if (kind === "projects") {
          setProjects((old) =>
            Array.from(
              new Map([...old, ...b.items].map((p) => [p.id, p])).values(),
            ),
          );
          setProjectCursor(b.nextCursor);
        } else {
          setPeople((old) =>
            Array.from(
              new Map([...old, ...b.items].map((p) => [p.id, p])).values(),
            ),
          );
          setPeopleCursor(b.nextCursor);
        }
      } else {
        const [ps, pe] = await Promise.all([
          api(discoveryPath("projects")),
          api(discoveryPath("people")),
        ]);
        if (generation !== discoveryGeneration.current) return;
        setProjects(ps.items);
        setPeople(pe.items);
        setProjectCursor(ps.nextCursor);
        setPeopleCursor(pe.nextCursor);
      }
      setDiscoveryError("");
    } catch (e: any) {
      if (generation === discoveryGeneration.current)
        setDiscoveryError(e.message);
    } finally {
      if (generation === discoveryGeneration.current) setLoading(false);
    }
  }
  useEffect(() => {
    api("auth/google/status")
      .then((b) => setGoogleConfigured(b.configured))
      .catch(() => {});
    const reason = new URLSearchParams(window.location.search).get("authError");
    if (reason) {
      setError(
        reason === "SIGN_IN_WITH_EMAIL_THEN_LINK_GOOGLE"
          ? "An account with this email exists. Sign in with email, then link Google in Settings."
          : "Google sign-in could not be completed. Please try again or use email.",
      );
      setModal("auth");
      window.history.replaceState({}, "", window.location.pathname);
    }
    api("me")
      .then(setUser)
      .catch(() => {})
      .finally(() => setAuthReady(true));
    const requested = new URLSearchParams(window.location.search).get(
      "project",
    );
    if (requested) openProject(requested);
  }, []);
  useEffect(() => {
    if (!authReady) return;
    const timer = setTimeout(() => load(), query ? 250 : 0);
    return () => {
      clearTimeout(timer);
      discoveryGeneration.current++;
    };
  }, [authReady, user?.id, view, query, category, sort, remoteOnly]);
  useEffect(() => {
    refreshUnread();
    if (!user) return;
    const timer = setInterval(refreshUnread, 10000);
    return () => clearInterval(timer);
  }, [user?.id]);
  const applicationsGeneration = useRef(0);
  async function loadApplications(append = false) {
    const generation = applicationsGeneration.current;
    setApplicationsLoading(true);
    try {
      const b = await api(
        "applications?paged=true" +
          (append && applicationCursor
            ? "&cursor=" + encodeURIComponent(applicationCursor)
            : ""),
      );
      if (generation !== applicationsGeneration.current) return;
      setApplications((old) =>
        append
          ? Array.from(
              new Map([...old, ...b.items].map((r) => [r.id, r])).values(),
            )
          : b.items,
      );
      setApplicationCursor(b.nextCursor);
    } catch (e: any) {
      if (generation === applicationsGeneration.current) notify(e.message);
    } finally {
      if (generation === applicationsGeneration.current)
        setApplicationsLoading(false);
    }
  }
  useEffect(() => {
    applicationsGeneration.current++;
    setApplications([]);
    setApplicationCursor(null);
    if (user && (view === "My projects" || view === "Notifications"))
      void loadApplications();
    return () => {
      applicationsGeneration.current++;
    };
  }, [view, user?.id]);
  async function refreshChat(cursor?: string) {
    if (!activeChat) return;
    const generation = chatGeneration.current;
    if (chatFetching.current === generation) return;
    chatFetching.current = generation;
    const initial = !chatBoundary.current;
    setChatLoading(true);
    try {
      const b = await fetchChatPage(
        api,
        "messages/" + activeChat.id,
        cursor,
        chatBoundary.current,
      );
      if (generation !== chatGeneration.current) return;
      if (initial || b.reset)
        chatGap.current = Boolean(
          b.hasOlderUnread || (b.reset && b.nextCursor),
        );
      if (cursor && (!b.nextCursor || b.hasOlderUnread === false))
        chatGap.current = false;
      setChatError(
        chatGap.current
          ? "Load earlier unread messages to close the history gap; unread status is preserved."
          : "",
      );
      if (b.reset) chatBoundary.current = null;
      if ((!cursor || b.reset) && b.items.length)
        chatBoundary.current = b.afterPosition || b.items.at(-1).id;
      if (cursor) chatHasHistory.current = true;
      setMessages((old) => {
        const merged = [...(b.reset ? [] : old), ...b.items];
        return Array.from(new Map(merged.map((m) => [m.id, m])).values()).sort(
          (a, b) =>
            new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime() ||
            a.id.localeCompare(b.id),
        );
      });
      if (cursor || initial || b.reset)
        setChatCursor(b.nextPosition || b.nextCursor);

      refreshUnread();
    } catch (e: any) {
      if (generation === chatGeneration.current) setChatError(e.message);
    } finally {
      if (chatFetching.current === generation) chatFetching.current = null;
      if (generation === chatGeneration.current) setChatLoading(false);
    }
  }
  useEffect(() => {
    if (!activeChat || view !== "Messages") return;
    chatGeneration.current++;
    chatHasHistory.current = false;
    setMessages([]);
    chatBoundary.current = null;
    chatGap.current = false;
    setMessage("");
    setChatCursor(null);
    refreshChat();
    const reconnect = () => {
      if (document.visibilityState === "visible") void refreshChat();
    };
    window.addEventListener("online", reconnect);
    document.addEventListener("visibilitychange", reconnect);
    const t = setInterval(() => {
      if (document.visibilityState === "visible") refreshChat();
    }, 4000);
    return () => {
      clearInterval(t);
      window.removeEventListener("online", reconnect);
      document.removeEventListener("visibilitychange", reconnect);
      chatGeneration.current++;
    };
  }, [activeChat?.id, view]);

  const readAck = useChatReadAck(
    `${user?.id}:dm:${activeChat?.id}`,
    "messages/" + activeChat?.id + "/read",
    messages.at(-1)?.id,
    view === "Messages" && !!activeChat && !chatGap.current,
    () => {
      void refreshUnread();
    },
  );

  function navigate(v: string) {
    setView(v);
    setWorkspaceId(null);
    setQuery("");
    setMobileOpen(false);
  }
  function requireAuth(action: () => void) {
    if (!authReady) {
      notify("Checking your session. Please try again in a moment.");
      return;
    }
    if (!user) {
      setError("");
      setModal("auth");
      return;
    }
    action();
  }
  async function bookmark(p: Project) {
    requireAuth(async () => {
      try {
        await api("projects/" + p.id + "/bookmark", "POST");
        await load();
        notify(
          p.bookmarked
            ? "Removed from saved projects"
            : "Project saved to your collection",
        );
      } catch (e: any) {
        notify(e.message);
      }
    });
  }
  async function connect(p: Person) {
    requireAuth(async () => {
      try {
        if (
          p.connection?.status === "Pending" &&
          p.connection.receiverId === user?.id
        )
          await api("connections/" + p.connection.id, "PATCH");
        else await api("connections/" + p.id, "POST");
        await load();
        notify(
          p.connection ? "Connection accepted!" : "Connection request sent",
        );
      } catch (e: any) {
        notify(e.message);
      }
    });
  }
  async function submitAuth(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const u = await api(
        "auth/" + (authMode === "login" ? "login" : "register"),
        "POST",
        {
          email: f.get("email"),
          password: f.get("password"),
          ...(authMode === "register" ? { name: f.get("name") } : {}),
        },
      );
      if (!u.id) {
        setModal(null);
        notify(u.message);
        return;
      }
      setUser(u);
      setModal(authMode === "register" ? "profile" : null);
      await load();
      notify(
        authMode === "register"
          ? "Welcome! Let’s set up your maker profile."
          : "Welcome back, " + u.name.split(" ")[0] + "!",
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function createProject(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget),
      split = (k: string) =>
        String(f.get(k))
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
    try {
      await api("projects", "POST", {
        title: f.get("title"),
        description: f.get("description"),
        category: f.get("category"),
        tags: split("skills"),
        requiredSkills: split("skills"),
        positions: split("positions"),
        city: f.get("city"),
        remote: f.get("remote") === "on",
        teamSize: Number(f.get("teamSize")),
      });
      setModal(null);
      await load();
      navigate("My projects");
      notify("Your project is live. Time to find your people!");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveProfile(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      const u = await api("me", "PATCH", {
        name: f.get("name"),
        role: f.get("role"),
        city: f.get("city"),
        bio: f.get("bio"),
        skills: String(f.get("skills"))
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        interests: String(f.get("interests"))
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean),
        education: f.get("education") || "",
        portfolioUrl: f.get("portfolioUrl") || "",
      });
      setUser(u);
      setModal(null);
      await load();
      notify("Profile updated. Your recommendations are refreshed.");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  const filtered = projects;
  const nav = [
    { label: "Discover", icon: House },
    { label: "Activity feed", icon: Globe },
    { label: "My projects", icon: Layers },
    { label: "People", icon: Users },
    { label: "Messages", icon: MessageSquare },
  ];
  const future = [
    { label: "Nearby hardware", icon: MapPin },
    { label: "Resources", icon: BookOpen },
    { label: "AI assistant", icon: Bot },
  ];
  function Card({ p }: { p: Project }) {
    return (
      <article className="project-card">
        <button
          className="project-image"
          onClick={() => {
            setSelected(p);
            setApplyOpen(false);
          }}
          aria-label={"View " + p.title}
        >
          <img src={p.image} alt={p.title} />
          <span className="image-scrim" />
          <span className="status-pill">
            <span />
            {p.status}
          </span>
          <span className="image-category">{p.category}</span>
        </button>
        <button
          className={"save-button " + (p.bookmarked ? "saved" : "")}
          aria-label={p.bookmarked ? "Unsave project" : "Save project"}
          onClick={() => bookmark(p)}
        >
          <Bookmark size={16} fill={p.bookmarked ? "currentColor" : "none"} />
        </button>
        <div className="project-body">
          <div className="project-title-line">
            <button
              className="project-title"
              onClick={() => {
                setSelected(p);
                setApplyOpen(false);
              }}
            >
              {p.title}
            </button>
            <ArrowUpRight size={17} />
          </div>
          <p className="project-description">{p.description}</p>
          {p.positions && p.positions.length > 0 && (
            <div className="open-positions">
              <span className="positions-label">OPEN ROLES:</span>
              {p.positions.slice(0, 2).map((pos) => (
                <span key={pos} className="position-pill">
                  {pos}
                </span>
              ))}
              {p.positions.length > 2 && (
                <span className="position-more">+{p.positions.length - 2}</span>
              )}
            </div>
          )}
          <div className="tags">
            {p.tags.map((t) => (
              <span key={t}>{t}</span>
            ))}
          </div>
          <div className="project-meta">
            <span>
              <MapPin size={13} />
              {p.remote ? "Remote friendly" : p.city}
            </span>
            <span>
              <Users size={13} />
              {p.members.length}/{p.teamSize} members
            </span>
          </div>
          <div className="card-divider" />
          <div className="project-footer">
            <div className="avatar-stack">
              {p.members.slice(0, 3).map((m: any) => (
                <Avatar key={m.userId} person={m.user} size="tiny" />
              ))}
              <span className="members-needed">
                +{Math.max(0, p.teamSize - p.members.length)} spots
              </span>
            </div>
            <span className="match">
              {p.match !== null ? (
                <>
                  <Sparkles size={12} />
                  {p.match}% match
                </>
              ) : (
                <>
                  <Radio size={12} /> Recruiting
                </>
              )}
            </span>
          </div>
        </div>
      </article>
    );
  }
  return (
    <div className="app-shell">
      {mobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={() => setMobileOpen(false)}
        />
      )}
      <aside className={"sidebar " + (mobileOpen ? "open" : "")}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("Discover");
          }}
        >
          <Mark />
          <span>
            Project<span className="connect-word">Connect</span>
            <small>THE MAKER NETWORK</small>
          </span>
        </a>
        <div className="workspace-picker">
          <span className="workspace-icon">
            <Code2 size={18} />
          </span>
          <div>
            Builder’s workspace<small>Personal account</small>
          </div>
          <ChevronDown size={14} />
        </div>
        <span className="nav-heading">WORKSPACE</span>
        <nav>
          {nav.map((n) => (
            <button
              key={n.label}
              aria-label={n.label}
              disabled={
                !authReady &&
                ["My projects", "Messages", "Activity feed"].includes(n.label)
              }
              className={"nav-item " + (view === n.label ? "active" : "")}
              onClick={() =>
                n.label === "My projects" ||
                n.label === "Messages" ||
                n.label === "Activity feed"
                  ? requireAuth(() => navigate(n.label))
                  : navigate(n.label)
              }
            >
              <n.icon size={19} />
              <span>{n.label}</span>
              {n.label === "My projects" && user && (
                <span className="nav-count">
                  {projects.filter((p) => p.isMember).length}
                </span>
              )}
              {n.label === "Messages" && unread.messages > 0 && (
                <span className="nav-count">{unread.messages}</span>
              )}
            </button>
          ))}
          <button
            className={
              "nav-item " + (view === "Saved projects" ? "active" : "")
            }
            onClick={() => requireAuth(() => navigate("Saved projects"))}
          >
            <Bookmark size={19} />
            <span>Saved projects</span>
          </button>
        </nav>
        <span className="nav-heading explore-heading">EXPLORE MORE</span>
        <nav>
          {future.map((n) => (
            <button
              key={n.label}
              className={"nav-item " + (view === n.label ? "active" : "")}
              onClick={() => navigate(n.label)}
            >
              <n.icon size={19} />
              <span>{n.label}</span>
            </button>
          ))}
        </nav>
        {(user as any)?.isAdmin && (
          <nav>
            <button
              className={"nav-item " + (view === "Moderation" ? "active" : "")}
              onClick={() => navigate("Moderation")}
            >
              <Settings size={19} />
              <span>Moderation</span>
            </button>
          </nav>
        )}
        <div className="sidebar-bottom">
          <div className="build-callout">
            <span className="callout-spark">
              <Zap size={19} />
            </span>
            <h4>Big ideas start here.</h4>
            <p>
              Got something in mind?
              <br />
              Find the people to build it.
            </p>
            <button
              onClick={() =>
                requireAuth(() => {
                  setError("");
                  setModal("create");
                })
              }
            >
              Start a project <ArrowRight size={14} />
            </button>
          </div>
          <button
            className="nav-item settings"
            onClick={() => requireAuth(() => navigate("Account security"))}
          >
            <Settings size={18} />
            Settings & profile
          </button>
          <div className="sidebar-profile">
            <Avatar person={user || { initials: "Y", color: "cyan" }} />
            <div>
              <strong>{user?.name || "Your next chapter"}</strong>
              <small>{user?.role || "Join the maker community"}</small>
            </div>
            <button
              className="icon-button"
              aria-label={user ? "Sign out" : "Sign in"}
              onClick={async () => {
                if (user) {
                  await api("auth/logout", "POST");
                  clearChatDelivery();
                  setUser(null);
                  navigate("Discover");
                  await load();
                  notify("Signed out");
                } else {
                  setError("");
                  setModal("auth");
                }
              }}
            >
              {user ? <LogOut size={15} /> : <ArrowRight size={15} />}
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumbs">
            <button
              className="mobile-menu icon-button"
              onClick={() => setMobileOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={21} />
            </button>
            <span>Workspace</span>
            <ChevronRight size={13} />
            <strong>{view}</strong>
          </div>
          <div className="top-actions">
            <span className="community-live">
              <span /> Made for makers
            </span>
            <button
              className="icon-button notification-icon"
              aria-label="Notifications"
              onClick={() => requireAuth(() => navigate("Notifications"))}
            >
              <Bell size={19} />
              {unread.notifications > 0 && (
                <span className="notification-count">
                  {unread.notifications}
                </span>
              )}
            </button>
            <span className="top-divider" />
            {user ? (
              <button
                className="avatar-button"
                aria-label="Edit your profile"
                onClick={() => {
                  setModal("profile");
                  setError("");
                }}
              >
                <Avatar person={user} size="small" />
              </button>
            ) : (
              <button
                className="sign-in"
                onClick={() => {
                  setModal("auth");
                  setError("");
                }}
              >
                Sign in <ArrowRight size={14} />
              </button>
            )}
          </div>
        </header>
        <main>
          {(view === "Discover" ||
            view === "My projects" ||
            view === "Saved projects") && (
            <>
              {view === "Discover" ? (
                <>
                  <div className="page-heading">
                    <div>
                      <div className="eyebrow">THE MAKER NETWORK</div>
                      <h1>
                        Find your people. <span>Build your idea.</span>
                      </h1>
                      <p>
                        Discover projects worth building and people worth
                        building with.
                      </p>
                    </div>
                    <button
                      className="primary-button"
                      onClick={() =>
                        requireAuth(() => {
                          setModal("create");
                          setError("");
                        })
                      }
                    >
                      <Plus size={17} />
                      Create project
                    </button>
                  </div>
                  <section className="hero-banner">
                    <div className="hero-text">
                      <span className="hero-badge">
                        <span />
                        NEXT.JS 15 • SUPABASE • POSTGRESQL • ROBOTICS
                      </span>
                      <h2>
                        Where Pro Developers
                        <br />
                        &amp; Makers <span>Ship Together.</span>
                      </h2>
                      <p>
                        Pair elite Frontend design with resilient Backend architecture &amp; Physical hardware. Built for creators, researchers, and engineers.
                      </p>
                      <button
                        onClick={() => {
                          document
                            .getElementById("project-section")
                            ?.scrollIntoView({ behavior: "smooth" });
                          setCategory("All projects");
                        }}
                      >
                        Explore projects <ArrowUpRight size={17} />
                      </button>
                      <div className="hero-community">
                        <div className="avatar-stack">
                          {people.slice(0, 3).map((p) => (
                            <Avatar person={p} key={p.id} size="tiny" />
                          ))}
                        </div>
                        <span>A network of frontend &amp; backend builders</span>
                      </div>
                    </div>
                    <div className="hero-art" aria-hidden="true">
                      <span className="orbit orbit-one" />
                      <span className="orbit orbit-two" />
                      <span className="orbit orbit-three" />
                      <div className="orbit-center">
                        <Mark />
                      </div>
                      <div className="floating-chip chip-code">
                        <span
                          className="art-icon"
                          style={{ background: "#17304a", color: "#8fc7f2" }}
                        >
                          <Code2 size={19} />
                        </span>
                        <div>
                          Frontend &amp; UI
                          <small>Next.js &bull; React &bull; Tailwind</small>
                        </div>
                      </div>
                      <div className="floating-chip chip-people">
                        <span
                          className="art-icon"
                          style={{ background: "#242041", color: "#b5aef2" }}
                        >
                          <Users size={19} />
                        </span>
                        <div>
                          Backend &amp; Cloud
                          <small>Supabase &bull; Postgres &bull; APIs</small>
                        </div>
                      </div>
                      <div className="floating-chip chip-launch">
                        <span
                          className="art-icon"
                          style={{ background: "#123229", color: "#7fdec0" }}
                        >
                          <Zap size={19} />
                        </span>
                        <div>
                          Makers &amp; AI
                          <small>Drones &bull; IoT &bull; LLMs</small>
                        </div>
                      </div>
                      <span className="art-dot d1" />
                      <span className="art-dot d2" />
                      <span className="art-plus">+</span>
                      <span className="art-cross">×</span>
                    </div>
                  </section>
                  <div className="stats-strip">
                    <div>
                      <span className="stat-icon blue">
                        <Layers size={19} />
                      </span>
                      <div>
                        <strong>
                          {projects.length}
                          <span> active projects</span>
                        </strong>
                        <small>Ready for frontend &amp; backend devs</small>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon purple">
                        <Users size={19} />
                      </span>
                      <div>
                        <strong>
                          {people.length + (user ? 1 : 0)}
                          <span> builders online</span>
                        </strong>
                        <small>Connect with developers by skill</small>
                      </div>
                    </div>
                    <div>
                      <span className="stat-icon green">
                        <Globe size={19} />
                      </span>
                      <div>
                        <strong>
                          Supabase<span> backend powered</span>
                        </strong>
                        <small>Postgres database &amp; realtime ready</small>
                      </div>
                    </div>
                  </div>
                  <div className="pro-stack-strip">
                    <span className="stack-strip-label">
                      <Sparkles size={13} /> POPULAR STACKS:
                    </span>
                    <div className="stack-chips-scroll">
                      {PRO_SKILLS.map((s) => {
                        const active = query.toLowerCase().includes(s.name.toLowerCase());
                        return (
                          <button
                            key={s.name}
                            type="button"
                            className={"stack-chip " + (active ? "active" : "")}
                            onClick={() => {
                              if (active) {
                                setQuery("");
                              } else {
                                setQuery(s.name);
                              }
                            }}
                          >
                            <span className={"stack-dot " + s.color} />
                            {s.name}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </>
              ) : (
                <div className="page-heading">
                  <div>
                    <div className="eyebrow">YOUR BUILDER’S WORKSPACE</div>
                    <h1>
                      {view === "My projects"
                        ? "Ideas you’re bringing to life."
                        : "Your next possibilities."}
                    </h1>
                    <p>
                      {view === "My projects"
                        ? "Manage your projects, teams, and incoming applications."
                        : "All the projects you’ve saved, in one place."}
                    </p>
                  </div>
                  <button
                    className="primary-button"
                    onClick={() => {
                      setModal("create");
                      setError("");
                    }}
                  >
                    <Plus size={17} />
                    Create project
                  </button>
                </div>
              )}
              <div className="content-columns">
                <section className="project-section" id="project-section">
                  <div className="section-heading">
                    <h2>
                      {view === "Discover" ? "Discover projects" : view}
                      <span>{filtered.length}</span>
                    </h2>
                    <label className="sort-control">
                      Sort by:{" "}
                      <select
                        aria-label="Sort projects"
                        value={sort}
                        onChange={(e) => setSort(e.target.value)}
                      >
                        <option>Recommended</option>
                        <option>Best match</option>
                        <option>Newest first</option>
                      </select>
                    </label>
                  </div>
                  <div className="search-filter-row">
                    <label className="search-box">
                      <Search size={18} />
                      <input
                        aria-label="Search projects"
                        placeholder="Search projects, skills, or ideas…"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      {query ? (
                        <button
                          className="icon-button"
                          aria-label="Clear search"
                          onClick={() => setQuery("")}
                        >
                          <X size={14} />
                        </button>
                      ) : (
                        <span className="search-shortcut">⌘K</span>
                      )}
                    </label>
                    <button
                      className={
                        "filter-button " + (remoteOnly ? "enabled" : "")
                      }
                      onClick={() => setShowFilters(!showFilters)}
                    >
                      <SlidersHorizontal size={16} />
                      Filters{remoteOnly && <span>1</span>}
                    </button>
                  </div>
                  {showFilters && (
                    <div className="filters-panel">
                      <label>
                        <input
                          type="checkbox"
                          checked={remoteOnly}
                          onChange={(e) => setRemoteOnly(e.target.checked)}
                        />
                        Remote-friendly projects only
                      </label>
                      <button
                        onClick={() => {
                          setRemoteOnly(false);
                          setCategory("All projects");
                          setQuery("");
                        }}
                      >
                        Reset filters
                      </button>
                    </div>
                  )}
                  <div className="category-tabs">
                    {cats.map((c) => (
                      <button
                        className={category === c ? "active" : ""}
                        key={c}
                        onClick={() => setCategory(c)}
                      >
                        {c === "All projects" && <Compass size={14} />} {c}
                      </button>
                    ))}
                  </div>
                  {discoveryError && (
                    <p className="form-error" role="alert">
                      {discoveryError}
                      <button
                        className="secondary-button"
                        onClick={() => load()}
                      >
                        Retry discovery
                      </button>
                    </p>
                  )}
                  {loading ? (
                    <div className="loading-state" role="status">
                      <Loader2 className="spin" size={20} />
                      <span>Finding your next project…</span>
                    </div>
                  ) : filtered.length ? (
                    <div className="project-grid">
                      {filtered.map((p) => (
                        <Card p={p} key={p.id} />
                      ))}
                    </div>
                  ) : (
                    <div className="empty-state">
                      <Compass size={34} />
                      <h3>
                        {view === "Saved projects"
                          ? "Your collection starts here"
                          : "No projects found"}
                      </h3>
                      <p>
                        {view === "Saved projects"
                          ? "Tap the bookmark on any project to save it for later."
                          : "Try another search or start a project of your own."}
                      </p>
                      <button
                        className="secondary-button"
                        onClick={() => {
                          setQuery("");
                          setCategory("All projects");
                          setRemoteOnly(false);
                          if (view !== "Discover") navigate("Discover");
                        }}
                      >
                        Explore all projects <ArrowRight size={15} />
                      </button>
                    </div>
                  )}
                  {view === "My projects" && (
                    <div className="application-section">
                      <div className="section-heading">
                        <h2>
                          Join requests<span>{applications.length}</span>
                        </h2>
                      </div>
                      {applicationCursor && (
                        <button
                          className="secondary-button"
                          disabled={applicationsLoading}
                          onClick={() => loadApplications(true)}
                        >
                          Load more join requests
                        </button>
                      )}
                      {applications.length === 0 ? (
                        <p className="muted">
                          Applications to your projects will appear here.
                        </p>
                      ) : (
                        applications.map((a) => (
                          <div className="application-row" key={a.id}>
                            <Avatar person={a.user} />
                            <div>
                              <strong>{a.user.name}</strong>
                              <small>{a.project.title}</small>
                              <p>{a.message}</p>
                            </div>
                            {a.status === "Pending" ? (
                              <div className="application-actions">
                                <button
                                  className="secondary-button"
                                  onClick={async () => {
                                    try {
                                      await api(
                                        "applications/" + a.id,
                                        "PATCH",
                                        { status: "Rejected" },
                                      );
                                      await loadApplications();
                                      notify("Application declined");
                                    } catch (e: any) {
                                      notify(e.message);
                                    }
                                  }}
                                >
                                  Decline
                                </button>
                                <button
                                  className="primary-button"
                                  onClick={async () => {
                                    try {
                                      await api(
                                        "applications/" + a.id,
                                        "PATCH",
                                        { status: "Accepted" },
                                      );
                                      await loadApplications();
                                      load();
                                      notify("New teammate accepted!");
                                    } catch (e: any) {
                                      notify(e.message);
                                    }
                                  }}
                                >
                                  Accept
                                </button>
                              </div>
                            ) : (
                              <span className="tag">{a.status}</span>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                  <div className="end-note">
                    <span />
                    Built for the joy of building.
                    <Heart size={12} />
                  </div>
                </section>
                <aside className="right-column">
                  <section className="panel people-panel">
                    <div className="panel-heading">
                      <h3>Meet your next teammate</h3>
                      <Users size={17} />
                    </div>
                    <p className="panel-subtitle">
                      Good people. Complementary skills.
                    </p>
                    <div className="people-list">
                      {people.slice(0, 3).map((p) => (
                        <div className="person-row" key={p.id}>
                          <Avatar person={p} />
                          <div className="person-info">
                            <strong>{p.name}</strong>
                            <small>{p.role}</small>
                            <span className="person-skill">
                              {p.skills.slice(0, 2).join(" · ")}
                            </span>
                          </div>
                          <button
                            className={
                              "connect-button " +
                              (p.connection ? "connected" : "")
                            }
                            aria-label={"Connect with " + p.name}
                            onClick={() =>
                              p.connection?.status === "Accepted"
                                ? navigate("People")
                                : connect(p)
                            }
                          >
                            {p.connection ? (
                              <Check size={16} />
                            ) : (
                              <Plus size={16} />
                            )}
                          </button>
                        </div>
                      ))}
                    </div>
                    <button
                      className="panel-link"
                      onClick={() => navigate("People")}
                    >
                      Discover people <ArrowRight size={14} />
                    </button>
                  </section>
                  <section className="panel toolkit-panel">
                    <div className="panel-heading">
                      <h3>Your builder’s toolkit</h3>
                      <Zap size={17} />
                    </div>
                    <p className="panel-subtitle">
                      Less searching. More creating.
                    </p>
                    {[
                      {
                        name: "Hardware, closer to you",
                        desc: "Find the parts you need nearby",
                        icon: MapPin,
                        color: "green",
                        view: "Nearby hardware",
                      },
                      {
                        name: "Resources that move you",
                        desc: "Tools, tutorials, and open source",
                        icon: Code2,
                        color: "blue",
                        view: "Resources",
                      },
                      {
                        name: "A little AI. A lot of possibility.",
                        desc: "Turn your idea into a roadmap",
                        icon: Sparkles,
                        color: "purple",
                        view: "AI assistant",
                      },
                    ].map((t) => (
                      <button
                        className="toolkit-row"
                        key={t.name}
                        onClick={() => navigate(t.view)}
                      >
                        <span className={"toolkit-icon " + t.color}>
                          <t.icon size={18} />
                        </span>
                        <div>
                          <strong>{t.name}</strong>
                          <small>{t.desc}</small>
                        </div>
                        <ChevronRight size={15} />
                      </button>
                    ))}
                    <span className="toolkit-note">
                      BUILDER TOOLS · INTEGRATIONS OPTIONAL
                    </span>
                  </section>
                  <section className="open-source-note">
                    <span>
                      <Code2 size={16} /> A SPACE FOR EVERY BUILDER
                    </span>
                    <h3>
                      Student. Maker.
                      <br />
                      Developer. Dreamer.
                    </h3>
                    <p>
                      You don’t need all the answers.
                      <br />
                      Just a good question to start with.
                    </p>
                    <button
                      onClick={() =>
                        requireAuth(() => {
                          setModal("profile");
                          setError("");
                        })
                      }
                    >
                      Make yourself at home <ArrowUpRight size={14} />
                    </button>
                    <div className="mini-orb" />
                  </section>
                  <footer className="mini-footer">
                    <span>Build · Collaborate · Create · Grow</span>
                    <p>
                      © 2026 ProjectConnect{" "}
                      <span>Launch build · In progress</span>
                    </p>
                  </footer>
                </aside>
              </div>
            </>
          )}
          {["Discover", "My projects", "Saved projects"].includes(view) &&
            projectCursor && (
              <button
                className="secondary-button"
                disabled={loading}
                onClick={() => load(projectCursor, "projects")}
              >
                Load more projects
              </button>
            )}
          {view === "People" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">GREAT TEAMS START WITH A HELLO</div>
                  <h1>Find your kind of curious.</h1>
                  <p>
                    Meet developers, makers, and researchers who share your
                    drive to build.
                  </p>
                </div>
                <span className="tag">{people.length} builders</span>
              </div>
              <label className="search-box people-search">
                <Search size={18} />
                <input
                  placeholder="Search people, skills, or interests…"
                  aria-label="Search people"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </label>
              <div className="people-grid">
                {people
                  .filter((p) =>
                    (p.name + " " + p.skills.join(" "))
                      .toLowerCase()
                      .includes(query.toLowerCase()),
                  )
                  .map((p) => (
                    <article className="panel person-card" key={p.id}>
                      <div className="person-card-top">
                        <Avatar person={p} size="large" />
                        {p.match && (
                          <span className="match">
                            <Sparkles size={12} />
                            {p.match}% match
                          </span>
                        )}
                      </div>
                      <h3>
                        <a href={"/people/" + p.id}>{p.name}</a>
                      </h3>
                      <p className="role-text">{p.role}</p>
                      <p className="muted">{p.bio}</p>
                      <div className="tags">
                        {p.skills.map((s) => (
                          <span key={s}>{s}</span>
                        ))}
                      </div>
                      {p.education && <p className="muted">{p.education}</p>}
                      <span className="person-location">
                        <MapPin size={13} />
                        {p.city}
                      </span>
                      <button
                        className="secondary-button full-width"
                        style={{ marginBottom: 8 }}
                        onClick={() =>
                          requireAuth(async () => {
                            try {
                              await api("follows/" + p.id, "POST", {
                                enabled: !p.following,
                              });
                              await load();
                              notify(
                                p.following
                                  ? "Unfollowed"
                                  : "Following " + p.name,
                              );
                            } catch (e: any) {
                              notify(e.message);
                            }
                          })
                        }
                      >
                        {p.following ? "Following" : "Follow builder"}
                      </button>
                      {p.connection?.status === "Accepted" ? (
                        <button
                          className="secondary-button full-width"
                          onClick={() => {
                            setActiveChat(p);
                            navigate("Messages");
                          }}
                        >
                          <MessageSquare size={15} />
                          Message teammate
                        </button>
                      ) : (
                        <button
                          className="secondary-button full-width"
                          onClick={() => connect(p)}
                          disabled={
                            p.connection?.status === "Pending" &&
                            p.connection.senderId === user?.id
                          }
                        >
                          {p.connection ? (
                            p.connection.receiverId === user?.id ? (
                              <>
                                <Check size={15} />
                                Accept connection
                              </>
                            ) : (
                              <>
                                <Clock size={15} />
                                Request sent
                              </>
                            )
                          ) : (
                            <>
                              <Plus size={15} />
                              Connect
                            </>
                          )}
                        </button>
                      )}
                      {p.connection && (
                        <button
                          className="secondary-button full-width"
                          style={{ marginTop: 8 }}
                          onClick={async () => {
                            try {
                              await api(
                                "connections/" + p.connection.id,
                                "DELETE",
                              );
                              await load();
                              notify("Connection request removed");
                            } catch (e: any) {
                              notify(e.message);
                            }
                          }}
                        >
                          {p.connection.status === "Pending"
                            ? p.connection.senderId === user?.id
                              ? "Cancel request"
                              : "Decline request"
                            : "Disconnect"}
                        </button>
                      )}
                      {user && (
                        <div className="person-card-actions">
                          <button
                            className="icon-button"
                            aria-label={"Block " + p.name}
                            onClick={async () => {
                              if (
                                !window.confirm(
                                  "Block " +
                                    p.name +
                                    "? They will no longer be able to connect or message you.",
                                )
                              )
                                return;
                              try {
                                await api("blocks/" + p.id, "POST");
                                await load();
                                notify(p.name + " blocked");
                              } catch (e: any) {
                                notify(e.message);
                              }
                            }}
                          >
                            <X size={13} />
                            Block
                          </button>
                          <button
                            className="icon-button"
                            aria-label={"Report " + p.name}
                            onClick={async () => {
                              const reason = window.prompt(
                                "Why are you reporting this profile? (at least 10 characters)",
                              );
                              if (!reason) return;
                              try {
                                notify(
                                  (
                                    await api("reports", "POST", {
                                      targetType: "user",
                                      targetId: p.id,
                                      reason,
                                    })
                                  ).message,
                                );
                              } catch (e: any) {
                                notify(e.message);
                              }
                            }}
                          >
                            <Bell size={13} />
                            Report
                          </button>
                        </div>
                      )}
                    </article>
                  ))}
              </div>
            </>
          )}
          {view === "People" && peopleCursor && (
            <button
              className="secondary-button"
              disabled={loading}
              onClick={() => load(peopleCursor, "people")}
            >
              Load more people
            </button>
          )}
          {view === "Messages" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">KEEP THE CONVERSATION GOING</div>
                  <h1>Good things start with hello.</h1>
                  <p>Your conversations with connected teammates.</p>
                </div>
              </div>
              <div className="messenger">
                <div className="chat-people">
                  <h3>Conversations</h3>
                  {people.map((p) => (
                    <button
                      className={
                        "chat-person " +
                        (activeChat?.id === p.id ? "active" : "")
                      }
                      key={p.id}
                      onClick={() => setActiveChat(p)}
                    >
                      <Avatar person={p} />
                      <div>
                        <strong>{p.name}</strong>
                        <small>{p.role}</small>
                      </div>
                    </button>
                  ))}
                  {people.every((p) => p.connection?.status !== "Accepted") && (
                    <p className="muted">
                      Connect with builders to start a conversation.
                    </p>
                  )}
                </div>
                <div className="chat-body">
                  {activeChat ? (
                    <>
                      <div className="chat-header">
                        <Avatar person={activeChat} />
                        <div>
                          <strong>{activeChat.name}</strong>
                          <small>{activeChat.role}</small>
                        </div>
                      </div>
                      <div className="chat-messages">
                        {readAck.error && (
                          <p className="form-error" role="alert">
                            {readAck.error}{" "}
                            <button
                              className="secondary-button"
                              onClick={readAck.retry}
                            >
                              Retry read status
                            </button>
                          </p>
                        )}
                        {chatError && (
                          <p className="form-error" role="alert">
                            {chatError}
                          </p>
                        )}
                        {chatCursor && (
                          <button
                            className="secondary-button"
                            onClick={() => refreshChat(chatCursor)}
                            disabled={chatLoading}
                          >
                            Load earlier messages
                          </button>
                        )}
                        {messages.length === 0 && (
                          <div className="empty-state">
                            <MessageSquare size={30} />
                            <h3>Break the ice.</h3>
                            <p>
                              Say hello and share what you’re excited to build.
                            </p>
                          </div>
                        )}
                        {messages.map((m) => (
                          <div
                            key={m.id}
                            className={
                              "message-bubble " +
                              (m.senderId === user?.id ? "own" : "")
                            }
                          >
                            <p>{m.content}</p>
                            <small>
                              {new Date(m.createdAt).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </small>
                          </div>
                        ))}
                      </div>
                      <form
                        className="chat-input"
                        onSubmit={async (e) => {
                          e.preventDefault();
                          await delivery.send(message);
                        }}
                      >
                        <input
                          disabled={
                            delivery.busy ||
                            (delivery.failed && !delivery.needsText)
                          }
                          aria-label="Message"
                          placeholder="Write a message…"
                          value={message}
                          onChange={(e) => setMessage(e.target.value)}
                          maxLength={2000}
                        />
                        <button
                          className="primary-button"
                          disabled={
                            delivery.busy ||
                            (delivery.failed && !delivery.needsText)
                          }
                          aria-label="Send message"
                        >
                          <Send size={17} />
                        </button>
                      </form>
                      {delivery.failed && (
                        <p role="status">
                          Delivery not confirmed.{" "}
                          {delivery.needsText &&
                            "Re-enter the original text; private message text was not saved after reload."}{" "}
                          <button
                            className="secondary-button"
                            disabled={delivery.busy}
                            onClick={() => delivery.send(message)}
                          >
                            Retry message
                          </button>{" "}
                          <button
                            className="secondary-button"
                            disabled={delivery.busy}
                            onClick={() => delivery.discard()}
                          >
                            Discard retry
                          </button>
                        </p>
                      )}
                    </>
                  ) : (
                    <div className="empty-state">
                      <MessageSquare size={40} />
                      <h3>Your ideas deserve a conversation.</h3>
                      <p>Choose a teammate to start chatting.</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
          {view === "Notifications" && (
            <>
              <div className="page-heading">
                <div>
                  <div className="eyebrow">YOUR COMMUNITY UPDATES</div>
                  <h1>A little closer to your next team.</h1>
                  <p>Incoming connection requests and project applications.</p>
                </div>
              </div>
              <NotificationCenter
                notify={notify}
                onProject={openProject}
                onRefresh={refreshUnread}
              />
              <Invitations
                notify={notify}
                onAccepted={() => {
                  load();
                  refreshUnread();
                }}
              />
              <div className="panel notifications-panel">
                {people
                  .filter(
                    (p) =>
                      p.connection?.receiverId === user?.id &&
                      p.connection.status === "Pending",
                  )
                  .map((p) => (
                    <div className="application-row" key={p.id}>
                      <Avatar person={p} />
                      <div>
                        <strong>{p.name} wants to connect</strong>
                        <small>{p.role}</small>
                      </div>
                      <button
                        className="primary-button"
                        onClick={() => connect(p)}
                      >
                        Accept
                      </button>
                    </div>
                  ))}
                {applicationCursor && (
                  <button
                    className="secondary-button"
                    disabled={applicationsLoading}
                    onClick={() => loadApplications(true)}
                  >
                    Load more join requests
                  </button>
                )}
                {applications
                  .filter((a) => a.status === "Pending")
                  .map((a) => (
                    <div className="application-row" key={a.id}>
                      <Avatar person={a.user} />
                      <div>
                        <strong>{a.user.name} applied to your project</strong>
                        <small>{a.project.title}</small>
                      </div>
                      <button
                        className="secondary-button"
                        onClick={() => navigate("My projects")}
                      >
                        Review <ArrowRight size={14} />
                      </button>
                    </div>
                  ))}
                {!people.some(
                  (p) =>
                    p.connection?.receiverId === user?.id &&
                    p.connection.status === "Pending",
                ) &&
                  !applications.some((a) => a.status === "Pending") && (
                    <div className="empty-state">
                      <Bell size={35} />
                      <h3>You’re all caught up.</h3>
                      <p>New requests will appear here. Keep building!</p>
                    </div>
                  )}
              </div>
            </>
          )}
          {view === "Activity feed" && user && (
            <SocialFeed
              user={user}
              projects={projects}
              notify={notify}
              onProject={openProject}
            />
          )}
          {view === "Account security" && (
            <AccountSecurity
              notify={notify}
              onSignedOut={() => {
                clearChatDelivery();
                setUser(null);
                navigate("Discover");
                load();
              }}
            />
          )}
          {view === "Resources" && (
            <ResourceHub
              user={user}
              projects={projects}
              onSignIn={() => {
                setError("");
                setModal("auth");
              }}
              notify={notify}
            />
          )}
          {view === "Workspace" && workspaceId && (
            <Workspace
              id={workspaceId}
              user={user}
              onBack={() => navigate("My projects")}
              notify={notify}
            />
          )}
          {view === "Nearby hardware" && (
            <NearbyHardware
              user={user}
              onSignIn={() => {
                setError("");
                setModal("auth");
              }}
              notify={notify}
            />
          )}
          {view === "AI assistant" && (
            <AiAssistant
              user={user}
              projects={projects}
              onSignIn={() => {
                setError("");
                setModal("auth");
              }}
              notify={notify}
            />
          )}
          {view === "Moderation" && <AdminPanel notify={notify} />}
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={19} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => !busy && setModal(null)}>
          <section
            className={
              "modal " +
              (modal === "create" || modal === "profile" ? "wide-modal" : "")
            }
            role="dialog"
            aria-modal="true"
            aria-label={
              modal === "auth"
                ? "Sign in"
                : modal === "create"
                  ? "Create project"
                  : "Edit profile"
            }
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={21} />
            </button>
            {modal === "auth" ? (
              <>
                <Mark />
                <h2>
                  {authMode === "login"
                    ? "Welcome back, builder."
                    : "Your next team is out there."}
                </h2>
                <p className="modal-subtitle">
                  {authMode === "login"
                    ? "Sign in to turn your next idea into something real."
                    : "Join a community that brings ideas to life."}
                </p>
                <a
                  className="secondary-button full-width"
                  href={googleConfigured ? "/api/auth/google/start" : undefined}
                  aria-disabled={!googleConfigured}
                  style={
                    !googleConfigured
                      ? { opacity: 0.6, pointerEvents: "none" }
                      : {}
                  }
                >
                  Google sign-in{!googleConfigured && " — not configured"}
                </a>
                <div className="or-divider">
                  <span />
                  or use your email
                  <span />
                </div>
                <form onSubmit={submitAuth}>
                  {authMode === "register" && (
                    <label className="field">
                      Your name
                      <input
                        name="name"
                        placeholder="Ada Lovelace"
                        minLength={2}
                        required
                      />
                    </label>
                  )}
                  <label className="field">
                    Email address
                    <input
                      type="email"
                      name="email"
                      placeholder="you@example.com"
                      required
                    />
                  </label>
                  <label className="field">
                    Password
                    <input
                      type="password"
                      name="password"
                      placeholder={
                        authMode === "login"
                          ? "Your password"
                          : "At least 10 characters"
                      }
                      minLength={authMode === "register" ? 10 : 1}
                      required
                    />
                  </label>
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="primary-button full-width" disabled={busy}>
                    {busy ? (
                      <Loader2 className="spin" size={17} />
                    ) : authMode === "login" ? (
                      "Sign in"
                    ) : (
                      "Create account"
                    )}
                    <ArrowRight size={16} />
                  </button>
                </form>
                <p className="auth-toggle">
                  {authMode === "login"
                    ? "New to ProjectConnect?"
                    : "Already part of the community?"}{" "}
                  <button
                    onClick={() => {
                      setAuthMode(authMode === "login" ? "register" : "login");
                      setError("");
                    }}
                  >
                    {authMode === "login" ? "Join us" : "Sign in"}
                  </button>
                </p>
                <a className="panel-link" href="/account/forgot">
                  Forgot your password?
                </a>
                <p className="auth-disclaimer">
                  Email verification and recovery are implemented. Live delivery
                  requires configured SMTP. Google sign-in requires configured
                  owner credentials; existing accounts must explicitly link it
                  in Settings.
                </p>
              </>
            ) : modal === "create" ? (
              <>
                <div className="eyebrow">LET’S BUILD SOMETHING</div>
                <h2>A big idea starts with a small step.</h2>
                <p className="modal-subtitle">
                  Tell the community what you’re building and who you need.
                </p>
                <form onSubmit={createProject}>
                  <label className="field">
                    Project name
                    <input
                      name="title"
                      minLength={5}
                      maxLength={100}
                      placeholder="Give your idea a name"
                      required
                    />
                  </label>
                  <label className="field">
                    What are you building?
                    <textarea
                      name="description"
                      placeholder="The problem, the possibility, and what you want to create…"
                      minLength={20}
                      maxLength={5000}
                      required
                      rows={4}
                    />
                  </label>
                  <div className="form-columns">
                    <label className="field">
                      Category
                      <select name="category">
                        {cats.slice(1).map((c) => (
                          <option key={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      Team size
                      <input
                        type="number"
                        name="teamSize"
                        defaultValue={5}
                        min={2}
                        max={30}
                        required
                      />
                    </label>
                  </div>
                  <label className="field">
                    Skills & tags <small>Comma-separated</small>
                    <input
                      name="skills"
                      placeholder="Python, Robotics, OpenCV"
                      required
                    />
                  </label>
                  <label className="field">
                    Open positions <small>Comma-separated</small>
                    <input
                      name="positions"
                      placeholder="AI Developer, Hardware Engineer"
                      required
                    />
                  </label>
                  <label className="field">
                    Location
                    <input
                      name="city"
                      defaultValue={user?.city || "Coimbatore, India"}
                      required
                    />
                  </label>
                  <label className="checkbox-field">
                    <input type="checkbox" name="remote" />
                    Open to remote teammates
                  </label>
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="primary-button full-width" disabled={busy}>
                    {busy ? (
                      <Loader2 className="spin" size={17} />
                    ) : (
                      <Plus size={17} />
                    )}
                    Publish project
                  </button>
                </form>
              </>
            ) : (
              <>
                <div className="eyebrow">YOUR BUILDER IDENTITY</div>
                <h2>Show the world what makes you, you.</h2>
                <p className="modal-subtitle">
                  Your skills power your project and teammate recommendations.
                </p>
                <ImageUpload
                  endpoint="account/avatar"
                  label="Profile photo"
                  imageUrl={
                    user?.avatarId ? `/api/images/${user.avatarId}` : undefined
                  }
                  onChanged={async () => {
                    setUser(await api("me"));
                  }}
                />
                <form onSubmit={saveProfile}>
                  <div className="form-columns">
                    <label className="field">
                      Name
                      <input
                        name="name"
                        defaultValue={user?.name}
                        minLength={2}
                        required
                      />
                    </label>
                    <label className="field">
                      Role
                      <input
                        name="role"
                        defaultValue={user?.role}
                        placeholder="Developer, Maker, Researcher…"
                        required
                      />
                    </label>
                  </div>
                  <label className="field">
                    A little about you
                    <textarea
                      name="bio"
                      defaultValue={user?.bio}
                      maxLength={500}
                      rows={3}
                    />
                  </label>
                  <label className="field">
                    Location
                    <input
                      name="city"
                      defaultValue={user?.city}
                      placeholder="City, Country"
                    />
                  </label>
                  <label className="field">
                    Education
                    <input
                      name="education"
                      defaultValue={user?.education}
                      maxLength={250}
                      placeholder="Institution / qualification"
                    />
                  </label>
                  <label className="field">
                    Portfolio link
                    <input
                      name="portfolioUrl"
                      type="url"
                      defaultValue={user?.portfolioUrl}
                      maxLength={500}
                      placeholder="https://your-portfolio.example"
                    />
                  </label>
                  <label className="field">
                    Your skills <small>Comma-separated</small>
                    <input
                      name="skills"
                      defaultValue={user?.skills.join(", ")}
                      placeholder="Python, React, Robotics"
                    />
                  </label>
                  <label className="field">
                    Your interests <small>Comma-separated</small>
                    <input
                      name="interests"
                      defaultValue={user?.interests.join(", ")}
                      placeholder="AI & ML, Sustainability, Open Source"
                    />
                  </label>
                  {error && (
                    <p className="form-error" role="alert">
                      {error}
                    </p>
                  )}
                  <button className="primary-button full-width" disabled={busy}>
                    {busy ? (
                      <Loader2 className="spin" size={17} />
                    ) : (
                      <Check size={17} />
                    )}
                    Save profile
                  </button>
                </form>
              </>
            )}
          </section>
        </div>
      )}
      {selected && (
        <div className="modal-backdrop" onClick={() => setSelected(null)}>
          <section
            className="modal detail-modal"
            role="dialog"
            aria-modal="true"
            aria-label={selected.title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="detail-image">
              <img src={selected.image} alt={selected.title} />
              <div className="image-scrim" />
              <span className="status-pill">
                <span />
                {selected.status}
              </span>
              <button
                className="modal-close icon-button"
                aria-label="Close project"
                onClick={() => setSelected(null)}
              >
                <X size={21} />
              </button>
            </div>
            <div className="detail-content">
              <a className="panel-link" href={"/projects/" + selected.id}>
                Permanent project link
              </a>
              <div className="eyebrow">
                {selected.category} · OPEN FOR COLLABORATION
              </div>
              <h2>{selected.title}</h2>
              <div className="detail-owner">
                <Avatar person={selected.owner} size="small" />
                <span>
                  Started by <strong>{selected.owner.name}</strong>
                </span>
                <span className="match">
                  {selected.match !== null ? (
                    <>
                      <Sparkles size={12} />
                      {selected.match}% match
                    </>
                  ) : (
                    "Find your fit"
                  )}
                </span>
              </div>
              <p className="detail-description">{selected.description}</p>
              <div className="tags">
                {selected.tags.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
              <div className="detail-facts">
                <div>
                  <Users size={18} />
                  <span>
                    Team size
                    <strong>
                      {selected.members.length} of {selected.teamSize} builders
                    </strong>
                  </span>
                </div>
                <div>
                  <MapPin size={18} />
                  <span>
                    Location
                    <strong>
                      {selected.remote ? "Remote friendly" : selected.city}
                    </strong>
                  </span>
                </div>
              </div>
              <h3>Find your place on the team</h3>
              <div className="positions">
                {selected.positions.map((t) => (
                  <span key={t}>
                    <Briefcase size={14} />
                    {t}
                  </span>
                ))}
              </div>
              <h3>The people building it</h3>
              <div className="detail-team">
                {selected.members.map((m) => (
                  <div key={m.userId}>
                    <Avatar person={m.user} />
                    <span>
                      {m.user.name}
                      <small>{m.role}</small>
                    </span>
                  </div>
                ))}
              </div>
              {selected.isMember ? (
                <button
                  className="primary-button full-width"
                  onClick={() => {
                    setWorkspaceId(selected.id);
                    setSelected(null);
                    setView("Workspace");
                  }}
                >
                  <Layers size={17} />
                  Open project workspace <ArrowRight size={16} />
                </button>
              ) : selected.application?.status === "Pending" ? (
                <div className="member-banner">
                  <Clock size={18} />
                  Application pending.{" "}
                  <button
                    className="secondary-button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await api(
                          "projects/" + selected.id + "/application",
                          "DELETE",
                        );
                        await openProject(selected.id);
                        await load();
                        notify("Application cancelled. You may reapply.");
                      } catch (e: any) {
                        notify(e.message);
                      } finally {
                        setBusy(false);
                      }
                    }}
                  >
                    Cancel application
                  </button>
                </div>
              ) : applyOpen ? (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    try {
                      await api("projects/" + selected.id + "/apply", "POST", {
                        message: applyText,
                      });
                      setSelected({
                        ...selected,
                        application: { status: "Pending" },
                      });
                      setApplyOpen(false);
                      await load();
                      notify(
                        "Application sent. Your next team could be one step away.",
                      );
                    } catch (e: any) {
                      notify(e.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  <label className="field">
                    Say hello to the team
                    <textarea
                      value={applyText}
                      onChange={(e) => setApplyText(e.target.value)}
                      placeholder="What excites you about this project, and how can you contribute?"
                      minLength={10}
                      maxLength={1000}
                      required
                      rows={3}
                    />
                  </label>
                  <button className="primary-button full-width" disabled={busy}>
                    <Send size={16} />
                    Send join request
                  </button>
                </form>
              ) : (
                <button
                  className="primary-button full-width"
                  onClick={() => {
                    if (!user) {
                      setSelected(null);
                      setModal("auth");
                    } else {
                      setApplyOpen(true);
                      setApplyText("");
                    }
                  }}
                >
                  <Plus size={17} />
                  {selected.application
                    ? "Reapply to this project"
                    : "I’d love to build this"}{" "}
                  <ArrowRight size={16} />
                </button>
              )}
              <p className="detail-note">
                Members can collaborate on tasks, milestones, resources, and
                project chat. Private files and team invitations are available
                in the workspace.
              </p>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
