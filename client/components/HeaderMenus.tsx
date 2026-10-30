import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Bell, Bookmark, BriefcaseBusiness, ChevronDown, LayoutDashboard, LogOut, ShieldCheck, UserRound } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { api, Envelope } from "@/lib/api";
import { initials, timeAgo } from "@/lib/format";
import type { NotificationRecord } from "@/lib/types";

function useOutsideClick(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside();
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onOutside]);
  return ref;
}

export function NotificationsMenu() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [unread, setUnread] = useState(user?.unreadNotifications ?? 0);
  const [loading, setLoading] = useState(false);
  const ref = useOutsideClick(() => setOpen(false));

  useEffect(() => setUnread(user?.unreadNotifications ?? 0), [user?.unreadNotifications]);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api<Envelope<{ items: NotificationRecord[]; unread: number }>>("/me/notifications?limit=8");
      setItems(result.data.items);
      setUnread(result.data.unread);
    } catch {
      // A signed-out visitor simply sees no bell.
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!user) return;
    void load();
    const timer = window.setInterval(() => void load(), 90_000);
    return () => window.clearInterval(timer);
  }, [user?.id]);

  const openMenu = () => {
    setOpen((current) => !current);
    if (!open) void load();
  };

  const markRead = async (item: NotificationRecord) => {
    if (!item.readAt) {
      await api(`/me/notifications/${item.id}/read`, { method: "PATCH" }).catch(() => undefined);
      setItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry)));
      setUnread((current) => Math.max(0, current - 1));
    }
  };

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={openMenu}
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        className="relative grid size-9 place-items-center rounded-full border border-ink/12 text-ink/60 transition-colors hover:border-ink/30 hover:text-ink"
      >
        <Bell size={16} />
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 grid min-w-4 place-items-center rounded-full bg-coral px-1 text-[9px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-40 w-[340px] overflow-hidden rounded-2xl border border-ink/10 bg-card shadow-[0_24px_60px_rgba(20,25,22,.16)]">
          <div className="flex items-center justify-between border-b border-ink/10 px-4 py-3">
            <p className="text-sm font-semibold">Notifications</p>
            <button
              type="button"
              className="text-xs text-ink/45 hover:text-ink"
              onClick={async () => {
                await api("/me/notifications/read-all", { method: "POST" }).catch(() => undefined);
                setItems((current) => current.map((entry) => ({ ...entry, readAt: entry.readAt ?? new Date().toISOString() })));
                setUnread(0);
              }}
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-[360px] overflow-y-auto">
            {loading && !items.length && <p className="px-4 py-6 text-sm text-ink/45">Loading…</p>}
            {!loading && !items.length && <p className="px-4 py-8 text-center text-sm text-ink/45">You are all caught up.</p>}
            {items.map((item) => (
              <button
                type="button"
                key={item.id}
                onClick={() => {
                  void markRead(item);
                  setOpen(false);
                  navigate("/notifications");
                }}
                className={`block w-full border-b border-ink/[.07] px-4 py-3 text-left transition-colors last:border-0 hover:bg-ink/[.03] ${item.readAt ? "opacity-65" : ""}`}
              >
                <span className="flex items-start gap-2.5">
                  <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${item.readAt ? "bg-ink/20" : "bg-coral"}`} />
                  <span>
                    <span className="block text-[13px] font-medium leading-5">{item.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-ink/50">{item.message}</span>
                    <span className="mt-1 block text-[10px] uppercase tracking-[.12em] text-ink/35">{timeAgo(item.createdAt)}</span>
                  </span>
                </span>
              </button>
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-ink/10 px-4 py-3 text-center text-xs font-medium text-ink/55 hover:text-ink">
            View all notifications
          </Link>
        </div>
      )}
    </div>
  );
}

export function UserMenu() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const ref = useOutsideClick(() => setOpen(false));
  if (!user) return null;
  const isRecruiter = user.roles.includes("RECRUITER") || user.roles.includes("ADMIN");
  const home = user.roles.includes("ADMIN") ? "/admin" : isRecruiter ? "/recruiter" : "/dashboard";

  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((current) => !current)} className="flex items-center gap-2 rounded-full border border-ink/12 py-1 pl-1 pr-2.5 transition-colors hover:border-ink/30">
        <span className="grid size-7 place-items-center rounded-full bg-ink text-[10px] font-bold text-paper">{initials(user.name)}</span>
        <span className="hidden max-w-28 truncate text-xs font-medium lg:block">{user.name.split(" ")[0]}</span>
        <ChevronDown size={13} className="text-ink/40" />
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-40 w-60 overflow-hidden rounded-xl border border-ink/10 bg-card py-1.5 shadow-[0_20px_50px_rgba(20,25,22,.15)]">
          <div className="border-b border-ink/10 px-4 py-3">
            <p className="truncate text-sm font-semibold">{user.name}</p>
            <p className="truncate text-xs text-ink/45">{user.email}</p>
          </div>
          <Link to={home} onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink/70 hover:bg-ink/[.04] hover:text-ink"><LayoutDashboard size={15} /> {isRecruiter ? "Recruiter workspace" : "Dashboard"}</Link>
          {user.roles.includes("CANDIDATE") && <Link to="/profile" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink/70 hover:bg-ink/[.04] hover:text-ink"><UserRound size={15} /> Profile</Link>}
          {user.roles.includes("CANDIDATE") && <Link to="/saved" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink/70 hover:bg-ink/[.04] hover:text-ink"><Bookmark size={15} /> Saved jobs</Link>}
          {user.roles.includes("CANDIDATE") && <Link to="/applications" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink/70 hover:bg-ink/[.04] hover:text-ink"><BriefcaseBusiness size={15} /> Applications</Link>}
          {user.roles.includes("ADMIN") && <Link to="/admin" onClick={() => setOpen(false)} className="flex items-center gap-2.5 px-4 py-2.5 text-sm text-ink/70 hover:bg-ink/[.04] hover:text-ink"><ShieldCheck size={15} /> Admin</Link>}
          <button type="button" onClick={async () => { setOpen(false); await signOut(); navigate("/"); }} className="mt-1 flex w-full items-center gap-2.5 border-t border-ink/10 px-4 py-2.5 text-left text-sm text-ink/60 hover:bg-ink/[.04] hover:text-ink"><LogOut size={15} /> Log out</button>
        </div>
      )}
    </div>
  );
}
