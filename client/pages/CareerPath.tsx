import { FormEvent, useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { ArrowRight, BookmarkPlus, Compass, Lightbulb, Sparkles, Target } from "lucide-react";
import { api, Envelope } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import { formatDate } from "@/lib/format";

type PathSuggestion = { from: string; to: string; skills: string[]; explanation: string; matchedSkills: string[]; missingSkills: string[]; evidence: string };
type SavedPath = { id: string; currentRole?: string | null; targetRole: string; createdAt: string; steps?: { roleTitle: string; explanation: string; skills: { skill: { name: string } }[] }[] };

const POPULAR_TARGETS = ["Machine Learning Engineer", "Senior Software Engineer", "Full Stack Engineer", "Data Scientist", "Solution Architect"];

export default function CareerPath() {
  const { user, loading } = useAuth();
  const [target, setTarget] = useState("");
  const [currentRole, setCurrentRole] = useState<string | null>(null);
  const [paths, setPaths] = useState<PathSuggestion[]>([]);
  const [saved, setSaved] = useState<SavedPath[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [savingPath, setSavingPath] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = async (goal?: string) => {
    const params = new URLSearchParams();
    if (goal) params.set("target", goal);
    const result = await api<Envelope<{ paths: PathSuggestion[]; currentRole?: string | null; notice?: string; targetRole?: string }>>(`/career-paths/suggestions?${params}`);
    setPaths(result.data.paths ?? []);
    setCurrentRole(result.data.currentRole ?? null);
    setNotice(result.data.notice ?? "");
    setLoaded(true);
  };

  const loadSaved = async () => {
    const result = await api<Envelope<SavedPath[]>>("/career-paths");
    setSaved(result.data);
  };

  useEffect(() => {
    if (!user?.roles.includes("CANDIDATE")) return;
    void load().catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load suggestions."));
    void loadSaved().catch(() => undefined);
  }, [user?.id]);

  if (loading) return <main className="shell py-16 text-sm text-ink/50">Loading career paths…</main>;
  if (!user) return <Navigate to="/login" replace />;
  if (!user.roles.includes("CANDIDATE")) return <Navigate to="/recruiter" replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await load(target.trim() || undefined);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not load paths.");
    } finally {
      setBusy(false);
    }
  };

  const savePath = async (targetRole: string) => {
    setError("");
    setSavingPath(targetRole);
    try {
      const result = await api<Envelope<{ alreadySaved?: boolean }>>("/career-paths", { method: "POST", body: JSON.stringify({ targetRole }) });
      setNotice(result.data.alreadySaved ? "This path is already saved." : "Career path saved. You can find it in the list below.");
      await loadSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save this path.");
    } finally {
      setSavingPath(null);
    }
  };

  return (
    <main className="shell py-10 md:py-16">
      <div className="grid gap-10 lg:grid-cols-[1fr_340px]">
        <div>
          <p className="eyebrow"><Compass size={12} /> Career direction</p>
          <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-.06em] sm:text-5xl">A direction, not a prediction.</h1>
          <p className="mt-4 max-w-2xl text-sm leading-6 text-ink/55">
            Explore a small, documented set of role transitions. Each path shows the skills you already have and the ones worth building next. It is a transparent rulebook, not a trained forecast of your career.
          </p>

          <form onSubmit={submit} className="mt-7 flex flex-col gap-3 sm:flex-row">
            <input className="field flex-1" value={target} onChange={(event) => setTarget(event.target.value)} placeholder={currentRole ? `Where do you want to go from ${currentRole}?` : "Target role, e.g. Machine Learning Engineer"} aria-label="Target role" />
            <button className="button button-coral" disabled={busy}>{busy ? "Exploring…" : <>Explore <ArrowRight size={15} /></>}</button>
          </form>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {POPULAR_TARGETS.map((role) => (
              <button key={role} type="button" onClick={() => { setTarget(role); void load(role).catch((reason) => setError(reason.message)); }} className="chip !px-2.5 !py-1 !text-[11px]">{role}</button>
            ))}
          </div>

          {error && <p role="alert" className="mt-5 rounded-xl border border-red-300/40 bg-red-50/60 p-4 text-sm text-red-700">{error}</p>}

          {paths.map((path, index) => (
            <article key={`${path.from}-${path.to}`} className="mt-6 rounded-2xl border border-ink/10 bg-card p-6">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <p className="text-[10px] uppercase tracking-[.16em] text-ink/35">Path {index + 1}</p>
                  <h2 className="mt-2 flex flex-wrap items-center gap-2 font-display text-2xl font-semibold tracking-[-.03em]">
                    <span className="capitalize">{path.from}</span> <ArrowRight className="text-coral" size={18} /> <span className="capitalize">{path.to}</span>
                  </h2>
                </div>
                <button type="button" disabled={savingPath === path.to} onClick={() => void savePath(path.to)} className="button button-outline !px-4 !py-2 text-xs"><BookmarkPlus size={14} /> {savingPath === path.to ? "Saving…" : "Save path"}</button>
              </div>
              <p className="mt-4 text-sm leading-6 text-ink/55">{path.explanation}</p>

              <div className="mt-5 grid gap-5 sm:grid-cols-2">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-[#27634e]">Skills you have</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {path.matchedSkills.length ? path.matchedSkills.map((skill) => <span key={skill} className="rounded-md bg-[#dff1e8] px-2 py-1 text-[11px] capitalize text-[#27634e]">{skill}</span>) : <span className="text-sm text-ink/40">Add profile skills to compare.</span>}
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[.14em] text-coral">Skills to develop</p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {path.missingSkills.length ? path.missingSkills.map((skill) => <span key={skill} className="rounded-md bg-coral/[.08] px-2 py-1 text-[11px] capitalize text-coral">{skill}</span>) : <span className="text-sm text-ink/40">You already cover this path's skills.</span>}
                  </div>
                </div>
              </div>

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-ink/10 pt-4 text-[11px] text-ink/35">
                <span>{path.evidence}</span>
                <Link to={`/jobs?q=${encodeURIComponent(path.to)}`} className="inline-flex items-center gap-1 text-ink/50 hover:text-ink">See {path.to} roles <ArrowRight size={11} /></Link>
              </div>
            </article>
          ))}

          {loaded && !paths.length && (
            <div className="mt-6 rounded-2xl border border-dashed border-ink/15 p-8 text-center">
              <Lightbulb size={24} className="mx-auto text-coral" />
              <h2 className="mt-3 font-display text-xl font-semibold">{notice || "No documented transition matches yet"}</h2>
              <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink/50">Update your current role or career goal in your profile, or try one of the target roles above. The transition graph is deliberately small and documented.</p>
              <Link to="/profile" className="button button-dark mt-5">Update profile</Link>
            </div>
          )}

          {saved.length > 0 && (
            <section className="mt-12 border-t border-ink/10 pt-8">
              <h2 className="section-title">Saved career paths</h2>
              <div className="mt-4 space-y-3">
                {saved.map((path) => (
                  <article key={path.id} className="rounded-xl border border-ink/10 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-medium capitalize">{path.currentRole ?? "Your profile"} <ArrowRight className="mx-1 inline text-coral" size={13} /> {path.targetRole}</h3>
                      <span className="text-[10px] uppercase tracking-[.1em] text-ink/30">Saved {formatDate(path.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-xs leading-5 text-ink/50">{path.steps?.[0]?.skills?.map((entry) => entry.skill.name).join(" · ")}</p>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>

        <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
          <div className="panel">
            <p className="eyebrow"><Target size={12} /> Your starting point</p>
            <p className="mt-3 text-lg font-semibold capitalize">{currentRole || "Role not set"}</p>
            <p className="mt-1 text-xs leading-5 text-ink/45">{currentRole ? "Suggestions compare this role with documented transitions." : "Add your current role in your profile to get relevant suggestions."}</p>
            <Link to="/profile" className="button button-outline mt-4 w-full !py-2.5 text-xs">Edit current role</Link>
          </div>
          <div className="rounded-2xl border border-ink/10 bg-secondary/60 p-5">
            <p className="flex items-center gap-1.5 text-xs font-semibold"><Sparkles size={13} className="text-coral" /> How to read this</p>
            <ul className="mt-3 space-y-2 text-[11px] leading-5 text-ink/50">
              <li>Green skills are already on your profile.</li>
              <li>Coral skills are gaps, not requirements to master before applying.</li>
              <li>Transitions are curated, not generated. Treat them as prompts for research.</li>
            </ul>
          </div>
        </aside>
      </div>
    </main>
  );
}
