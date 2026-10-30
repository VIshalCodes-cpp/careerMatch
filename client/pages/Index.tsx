import { ArrowRight, Check, Circle, MoveUpRight, ShieldCheck, Sparkles, Target, TrendingUp, Users } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import JobCard from "@/components/JobCard";
import { api, Envelope } from "@/lib/api";
import { useAuth } from "@/context/AuthContext";
import type { Job } from "@/lib/types";

const steps = [
  ["01", "Build your profile", "Upload a resume, then review what we extracted. Add the skills, experience, and preferences that describe the work you actually want."],
  ["02", "Explore real opportunities", "Browse direct recruiter listings and attributed public feeds. Filter by location, work mode, and experience before you commit time."],
  ["03", "Apply with context", "See which required skills you already have, save roles worth a second look, and track every application in one place."],
];

type Stats = { jobs: number; companies: number; candidates: number; remoteJobs: number; newThisWeek: number };

export default function Index() {
  const location = useLocation();
  const { user } = useAuth();
  const [stats, setStats] = useState<Stats | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    if (location.hash === "#about") {
      document.getElementById("about")?.scrollIntoView({ behavior: "smooth" });
    }
  }, [location.hash]);

  useEffect(() => {
    api<Envelope<Stats>>("/stats").then((result) => setStats(result.data)).catch(() => undefined);
    api<{ data: Job[] }>("/jobs?limit=3&sort=newest").then((result) => setJobs(result.data)).catch(() => undefined);
  }, []);

  const primaryHref = user ? (user.roles.includes("ADMIN") ? "/admin" : user.roles.includes("RECRUITER") ? "/recruiter" : "/dashboard") : "/register";
  const primaryLabel = user ? "Open your workspace" : "Create your profile";

  return (
    <main>
      <section className="shell grid min-h-[600px] items-center gap-14 py-16 lg:grid-cols-[1.06fr_.94fr] lg:py-24">
        <div className="max-w-[650px]">
          <div className="eyebrow"><span className="size-1.5 rounded-full bg-coral" /> Your next move, made clearer</div>
          <h1 className="mt-7 font-display text-[clamp(3.4rem,7vw,6.6rem)] font-semibold leading-[.93] tracking-[-0.075em]">
            Work that feels like a <span className="text-coral">better fit.</span>
          </h1>
          <p className="mt-8 max-w-[500px] text-[17px] leading-8 text-ink/60">
            Career Match turns your skills into a clearer next step — with real opportunities, useful context, and fewer applications that go nowhere.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-5">
            <Link to="/jobs" className="button button-coral">Explore opportunities <ArrowRight size={16} /></Link>
            <Link to={primaryHref} className="text-sm font-medium text-ink underline decoration-ink/20 underline-offset-8 transition-colors hover:decoration-ink">{primaryLabel}</Link>
          </div>
          <div className="mt-12 flex flex-wrap items-center gap-x-6 gap-y-3 text-xs text-ink/45">
            <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#2f7a56]" /> {stats?.jobs ?? "700+"} live roles</span>
            <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#4b7fae]" /> {stats?.companies ?? "300+"} companies</span>
            <span className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-coral" /> {stats?.newThisWeek ?? "—"} added this week</span>
          </div>
        </div>

        <div className="relative mx-auto w-full max-w-[480px]">
          <div className="absolute -left-5 top-11 hidden size-10 rounded-full border border-ink/10 bg-paper lg:block" />
          <div className="job-preview relative overflow-hidden rounded-[22px] border border-ink/10 bg-card p-5 shadow-[0_28px_80px_rgba(30,36,31,.10)]">
            <div className="flex items-center justify-between border-b border-ink/10 pb-5">
              <div><p className="text-[11px] uppercase tracking-[.18em] text-ink/40">Your weekly shortlist</p><p className="mt-1 font-display text-lg font-semibold">Good places to start</p></div>
              <span className="grid size-9 place-items-center rounded-full bg-background text-ink/70"><MoveUpRight size={16} /></span>
            </div>
            <div className="mt-4 space-y-3">
              {jobs.length ? jobs.map((job, index) => (
                <Link key={job.id} to={`/jobs/${job.id}`} className="preview-card group !bg-white/70 transition-colors hover:!bg-white">
                  <span className={`grid size-9 shrink-0 place-items-center rounded-lg text-xs font-bold ${["bg-[#dff1e8] text-[#27634e]", "bg-[#e9e3fb] text-[#5f4b9d]", "bg-[#e1eef9] text-[#32618c]"][index % 3]}`}>{index + 1}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{job.title}</p>
                    <p className="mt-0.5 truncate text-[11px] text-ink/45">{job.company?.name} · {job.location}</p>
                  </div>
                  <strong className="match shrink-0 text-[10px]">{job.employmentType ?? "Open"}</strong>
                </Link>
              )) : (
                <>
                  <div className="preview-card"><span className="company-mark bg-[#dff1e8] text-[#27634e]">1</span><div className="min-w-0 flex-1"><p className="font-medium">Your profile</p><p className="mt-1 text-xs text-ink/45">Skills, experience, goals</p></div><strong className="match">You</strong></div>
                  <div className="preview-card"><span className="company-mark bg-[#e9e3fb] text-[#5f4b9d]">2</span><div className="min-w-0 flex-1"><p className="font-medium">Live listings</p><p className="mt-1 text-xs text-ink/45">Direct and partner roles</p></div><strong className="match">Live</strong></div>
                  <div className="preview-card opacity-75"><span className="company-mark bg-[#e1eef9] text-[#32618c]">3</span><div className="min-w-0 flex-1"><p className="font-medium">Explainable matches</p><p className="mt-1 text-xs text-ink/45">Skills and experience fit</p></div><strong className="match">Fit</strong></div>
                </>
              )}
            </div>
            <div className="mt-5 flex items-center justify-between gap-2 border-t border-ink/10 pt-5 text-xs text-ink/45">
              <span className="flex items-center gap-2"><Circle size={8} className="fill-coral text-coral" /> Updated from live listings</span>
              <Link to="/jobs" className="font-medium text-ink hover:text-coral">View all</Link>
            </div>
          </div>
        </div>
      </section>

      <section className="border-y border-ink/10 bg-secondary" id="about">
        <div className="shell py-20">
          <div className="max-w-xl">
            <p className="eyebrow">How it works</p>
            <h2 className="mt-5 font-display text-4xl font-semibold leading-tight tracking-[-.05em]">Less scrolling. More signal. Better moves.</h2>
          </div>
          <div className="mt-14 grid gap-10 md:grid-cols-3">
            {steps.map(([number, title, description]) => (
              <div key={number} className="border-t border-ink/20 pt-5">
                <span className="font-mono text-xs text-coral">{number}</span>
                <h3 className="mt-8 font-display text-xl font-semibold tracking-[-.03em]">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-ink/55">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="shell py-20">
        <div className="grid gap-10 lg:grid-cols-[1fr_1.1fr] lg:items-center">
          <div>
            <p className="eyebrow"><ShieldCheck size={12} /> Transparent by design</p>
            <h2 className="mt-5 max-w-lg font-display text-3xl font-semibold tracking-[-.05em] sm:text-4xl">Scores you can inspect, not a black box.</h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-ink/55">
              Every match breaks down into skills, experience, preferences, and a local text comparison. You can see what matched, what is missing, and why a role ranked where it did.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {[
                { icon: Target, title: "Skill-level detail", body: "Green means you have it. Coral means it is a gap worth considering." },
                { icon: Sparkles, title: "No paid AI key", body: "Resume parsing and ranking run in-process with open tooling." },
                { icon: TrendingUp, title: "Career context", body: "Documented role transitions show the skills that bridge the next step." },
                { icon: Users, title: "Human decisions", body: "Recruiters review applicants. Scores are not hiring probabilities." },
              ].map((item) => {
                const Icon = item.icon;
                return (
                  <div key={item.title} className="rounded-xl border border-ink/10 bg-card p-4">
                    <Icon size={16} className="text-coral" />
                    <p className="mt-2 text-sm font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs leading-5 text-ink/45">{item.body}</p>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-2xl border border-ink/10 bg-card p-6 shadow-[0_20px_50px_rgba(25,30,26,.05)]">
            <div className="flex items-center justify-between border-b border-ink/10 pb-4">
              <div><p className="eyebrow">Example breakdown</p><p className="mt-1 font-display text-lg font-semibold">Senior Full Stack Engineer</p></div>
              <span className="rounded-md bg-[#dff1e8] px-2 py-1 text-xs font-semibold text-[#27634e]">73% fit</span>
            </div>
            <div className="mt-4 space-y-3">
              {[["Skills you have", 82, "#2f7a56"], ["Experience", 100, "#2f7a56"], ["Description match", 68, "#b08a2c"], ["Location preference", 75, "#b08a2c"]].map(([label, value, color]) => (
                <div key={String(label)}>
                  <div className="flex items-center justify-between text-[11px] text-ink/45"><span>{label}</span><span>{value}%</span></div>
                  <div className="mt-1.5 h-1.5 rounded-full bg-ink/10"><div className="h-full rounded-full" style={{ width: `${value}%`, background: String(color) }} /></div>
                </div>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5 border-t border-ink/10 pt-4">
              {["TypeScript", "React", "Node.js"].map((skill) => <span key={skill} className="rounded bg-[#dff1e8] px-2 py-1 text-[11px] text-[#27634e]">{skill}</span>)}
              {["PostgreSQL", "AWS"].map((skill) => <span key={skill} className="rounded bg-[#f8e0dc] px-2 py-1 text-[11px] text-[#9a3f33]">{skill}</span>)}
            </div>
            <p className="mt-3 text-[10px] leading-4 text-ink/35">Illustrative breakdown. Your own scores come from your saved profile.</p>
          </div>
        </div>
      </section>

      {jobs.length > 0 && (
        <section className="shell pb-20">
          <div className="flex flex-wrap items-end justify-between gap-4 border-t border-ink/10 pt-12">
            <div><p className="eyebrow">Fresh listings</p><h2 className="mt-3 font-display text-3xl font-semibold tracking-[-.05em]">Recently added</h2></div>
            <Link to="/jobs" className="button button-outline">Browse all roles <ArrowRight size={15} /></Link>
          </div>
          <div className="mt-6 grid gap-3">{jobs.map((job) => <JobCard key={job.id} job={job} />)}</div>
        </section>
      )}

      <section className="shell pb-20">
        <div className="rounded-2xl border border-ink/10 bg-ink px-8 py-10 text-paper md:px-12">
          <div className="flex flex-col justify-between gap-6 md:flex-row md:items-center">
            <div>
              <p className="text-[10px] uppercase tracking-[.18em] text-paper/45">For recruiters</p>
              <h2 className="mt-3 max-w-xl font-display text-3xl font-semibold tracking-[-.04em]">Publish a role. See ranked applicants, not a pile of PDFs.</h2>
              <p className="mt-3 max-w-xl text-sm leading-6 text-paper/60">Create a company profile, add required and preferred skills, and review applicants with a transparent breakdown.</p>
            </div>
            <Link to={user?.roles.includes("RECRUITER") ? "/recruiter" : "/register?role=recruiter"} className="button bg-paper text-ink hover:bg-paper/90">Start hiring <ArrowRight size={15} /></Link>
          </div>
        </div>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 text-xs text-ink/40">
          <span className="flex items-center gap-2"><Check size={13} className="text-coral" /> Career guidance with human decisions at the center</span>
          <span>Listings attributed to Adzuna, Jooble, Remotive, Jobicy, and RemoteOK</span>
        </div>
      </section>
    </main>
  );
}
