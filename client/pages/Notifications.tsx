import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { Bell, CheckCheck, Inbox, Trash2 } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import { useAuth } from "@/context/AuthContext";
import { api, Envelope } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { NotificationRecord } from "@/lib/types";

export default function Notifications() {
  const { user, loading } = useAuth();
  const [items, setItems] = useState<NotificationRecord[]>([]);
  const [fetching, setFetching] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "unread">("all");

  const load = () => api<Envelope<{ items: NotificationRecord[]; unread: number }>>("/me/notifications?limit=100")
    .then((result) => setItems(result.data.items))
    .catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load notifications."))
    .finally(() => setFetching(false));

  useEffect(() => { if (user) void load(); }, [user?.id]);

  if (loading) return <main className="shell py-16 text-sm text-ink/50">Loading notifications…</main>;
  if (!user) return <Navigate to="/login" replace />;

  const unread = items.filter((item) => !item.readAt);
  const shown = filter === "unread" ? unread : items;

  const markOne = async (item: NotificationRecord) => {
    if (item.readAt) return;
    await api(`/me/notifications/${item.id}/read`, { method: "PATCH" }).catch(() => undefined);
    setItems((current) => current.map((entry) => entry.id === item.id ? { ...entry, readAt: new Date().toISOString() } : entry));
  };

  const markAll = async () => {
    await api("/me/notifications/read-all", { method: "POST" }).catch(() => undefined);
    setItems((current) => current.map((entry) => ({ ...entry, readAt: entry.readAt ?? new Date().toISOString() })));
  };

  const remove = async (item: NotificationRecord) => {
    await api(`/me/notifications/${item.id}`, { method: "DELETE" }).catch(() => undefined);
    setItems((current) => current.filter((entry) => entry.id !== item.id));
  };

  return (
    <main className="shell max-w-4xl py-10 md:py-16">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink/10 pb-8">
        <div>
          <p className="eyebrow"><Bell size={12} /> Notifications</p>
          <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">What changed.</h1>
          <p className="mt-3 text-sm text-ink/55">{unread.length ? `${unread.length} unread ${unread.length === 1 ? "update" : "updates"}.` : "You are all caught up."}</p>
        </div>
        {unread.length > 0 && <button type="button" onClick={() => void markAll()} className="button button-outline"><CheckCheck size={15} /> Mark all read</button>}
      </div>

      <div className="mt-5 flex gap-1">
        {[{ key: "all" as const, label: "All", count: items.length }, { key: "unread" as const, label: "Unread", count: unread.length }].map((tab) => (
          <button key={tab.key} type="button" onClick={() => setFilter(tab.key)} className={`chip ${filter === tab.key ? "chip-active" : ""}`}>{tab.label} <span className="opacity-60">{tab.count}</span></button>
        ))}
      </div>

      {error && <p role="alert" className="mt-5 rounded-xl border border-red-300/40 bg-red-50/60 p-4 text-sm text-red-700">{error}</p>}

      {fetching ? (
        <div className="mt-6 space-y-2">{[0, 1, 2].map((index) => <div key={index} className="h-20 animate-pulse rounded-xl border border-ink/10 bg-ink/[.03]" />)}</div>
      ) : shown.length ? (
        <div className="mt-6 divide-y divide-ink/[.07] overflow-hidden rounded-2xl border border-ink/10">
          {shown.map((item) => (
            <div key={item.id} className={`group flex items-start gap-3 px-4 py-4 transition-colors hover:bg-ink/[.02] ${item.readAt ? "bg-transparent" : "bg-coral/[.025]"}`}>
              <span className={`mt-2 size-2 shrink-0 rounded-full ${item.readAt ? "bg-ink/15" : "bg-coral"}`} />
              <button type="button" onClick={() => void markOne(item)} className="min-w-0 flex-1 text-left">
                <p className={`text-sm ${item.readAt ? "font-normal text-ink/60" : "font-semibold text-ink"}`}>{item.title}</p>
                <p className="mt-0.5 text-[13px] leading-5 text-ink/50">{item.message}</p>
                <p className="mt-1 text-[10px] uppercase tracking-[.1em] text-ink/30">{timeAgo(item.createdAt)}</p>
              </button>
              <button type="button" onClick={() => void remove(item)} aria-label="Delete notification" className="mt-1 grid size-7 place-items-center rounded-full text-ink/25 opacity-0 transition-opacity hover:bg-ink/[.05] hover:text-red-600 group-hover:opacity-100">
                <Trash2 size={13} />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-6">
          <EmptyState icon={<Inbox size={22} />} title={filter === "unread" ? "No unread notifications" : "Nothing here yet"} description="Application status changes and new recruiter messages will appear here." actionLabel="Back to dashboard" actionTo="/dashboard" />
        </div>
      )}
    </main>
  );
}
