import "./global.css";

import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { ArrowUpRight, Menu, Moon, Sun, X } from "lucide-react";
import { Suspense, lazy, useEffect, useState } from "react";
import { GoogleOAuthProvider } from "@react-oauth/google";
const Index = lazy(() => import("./pages/Index"));
const Jobs = lazy(() => import("./pages/Jobs"));
const JobDetails = lazy(() => import("./pages/JobDetails"));
const NotFound = lazy(() => import("./pages/NotFound"));
const Login = lazy(() => import("./pages/Login"));
const Register = lazy(() => import("./pages/Register"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const Profile = lazy(() => import("./pages/Profile"));
const CareerPath = lazy(() => import("./pages/CareerPath"));
const Recruiter = lazy(() => import("./pages/Recruiter"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const VerifyEmail = lazy(() => import("./pages/VerifyEmail"));
const SavedJobs = lazy(() => import("./pages/SavedJobs"));
const Applications = lazy(() => import("./pages/Applications"));
const Notifications = lazy(() => import("./pages/Notifications"));
const Admin = lazy(() => import("./pages/Admin"));
const Companies = lazy(() => import("./pages/Companies"));
const CompanyPage = lazy(() => import("./pages/Company"));
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { NotificationsMenu, UserMenu } from "@/components/HeaderMenus";

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <main className="shell py-20">
      <div className="h-4 w-40 animate-pulse rounded bg-ink/10" />
      <div className="mt-6 h-12 w-2/3 animate-pulse rounded bg-ink/10" />
      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="h-40 animate-pulse rounded-2xl border border-ink/10 bg-ink/[.03]" />
        <div className="h-40 animate-pulse rounded-2xl border border-ink/10 bg-ink/[.03]" />
      </div>
    </main>
  );
}

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [pathname]);
  return null;
}

function Header() {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const { user } = useAuth();
  const location = useLocation();
  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm transition-colors ${isActive ? "text-ink" : "text-ink/55 hover:text-ink"}`;

  useEffect(() => {
    const savedTheme = localStorage.getItem("careermatch-theme") as "light" | "dark" | null;
    const nextTheme = savedTheme ?? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
  }, []);

  useEffect(() => setOpen(false), [location.pathname]);

  const toggleTheme = () => {
    const nextTheme = theme === "light" ? "dark" : "light";
    setTheme(nextTheme);
    localStorage.setItem("careermatch-theme", nextTheme);
    document.documentElement.classList.toggle("dark", nextTheme === "dark");
  };

  return (
    <header className="site-header">
      <div className="shell flex h-[76px] items-center justify-between">
        <Link to="/" className="flex items-center gap-2.5 font-display text-lg font-semibold tracking-[-0.04em]">
          <span className="grid size-7 place-items-center rounded-lg bg-coral/15 text-coral">
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 19V7l5 6 5-6v12" /><path d="M18 5v14" /><path d="M15 8l3-3 3 3" /></svg>
          </span>
          Career Match
        </Link>
        <nav className="hidden items-center gap-8 md:flex">
          <NavLink to="/jobs" className={linkClass}>Jobs</NavLink>
          <NavLink to="/companies" className={linkClass}>Companies</NavLink>
          <NavLink to="/career-path" className={linkClass}>Career path</NavLink>
          <a href="/#about" className="text-sm text-ink/55 transition-colors hover:text-ink">About</a>
        </nav>
        <div className="hidden items-center gap-3 md:flex">
          <button type="button" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} mode`} onClick={toggleTheme} className="theme-toggle">
            {theme === "light" ? <Moon size={16} /> : <Sun size={16} />}
          </button>
          {user ? (
            <>
              <NotificationsMenu />
              <UserMenu />
            </>
          ) : (
            <>
              <NavLink to="/login" className="text-sm text-ink/60 hover:text-ink">Log in</NavLink>
              <Link to="/register" className="button button-dark !px-4 !py-2.5 text-sm">Get started <ArrowUpRight size={15} /></Link>
            </>
          )}
        </div>
        <button aria-label="Toggle navigation" className="md:hidden" onClick={() => setOpen(!open)}>{open ? <X size={21} /> : <Menu size={21} />}</button>
      </div>
      {open && (
        <div className="border-t border-ink/10 bg-paper px-6 py-5 md:hidden">
          <nav className="flex flex-col gap-4">
            <NavLink to="/jobs" className={linkClass}>Jobs</NavLink>
            <NavLink to="/companies" className={linkClass}>Companies</NavLink>
            <NavLink to="/career-path" className={linkClass}>Career path</NavLink>
            <a href="/#about" className="text-sm text-ink/55">About</a>
            {user ? (
              <>
                <div className="my-1 h-px bg-ink/10" />
                <div className="flex items-center gap-2 text-sm text-ink/55"><span className="grid size-7 place-items-center rounded-full bg-ink text-[10px] font-bold text-paper">{user.name.slice(0, 1).toUpperCase()}</span>{user.name}</div>
                <NavLink to={user.roles.includes("ADMIN") ? "/admin" : user.roles.includes("RECRUITER") ? "/recruiter" : "/dashboard"} className={linkClass}>{user.roles.includes("RECRUITER") || user.roles.includes("ADMIN") ? "Recruiter workspace" : "Dashboard"}</NavLink>
                {user.roles.includes("CANDIDATE") && <NavLink to="/profile" className={linkClass}>Profile</NavLink>}
                {user.roles.includes("CANDIDATE") && <NavLink to="/saved" className={linkClass}>Saved jobs</NavLink>}
                {user.roles.includes("CANDIDATE") && <NavLink to="/applications" className={linkClass}>Applications</NavLink>}
                <NavLink to="/notifications" className={linkClass}>Notifications</NavLink>
              </>
            ) : (
              <>
                <NavLink to="/login" className={linkClass}>Log in</NavLink>
                <Link to="/register" className="button button-dark w-fit !px-4 !py-2.5 text-sm">Get started <ArrowUpRight size={15} /></Link>
              </>
            )}
            <button type="button" onClick={toggleTheme} className="flex items-center gap-2 pt-2 text-left text-sm text-ink/55">{theme === "light" ? <Moon size={16} /> : <Sun size={16} />} Switch to {theme === "light" ? "dark" : "light"} mode</button>
          </nav>
        </div>
      )}
    </header>
  );
}

function SiteFooter() {
  return (
    <footer className="mt-20 border-t border-ink/10 bg-secondary/60">
      <div className="shell grid gap-10 py-14 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
        <div>
          <p className="font-display text-lg font-semibold tracking-[-.04em]">Career Match</p>
          <p className="mt-3 max-w-xs text-sm leading-6 text-ink/50">A calmer job search: real listings, transparent match signals, and a profile that works across every role you apply to.</p>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-ink/40">Explore</p>
          <ul className="mt-3 space-y-2 text-sm text-ink/55">
            <li><Link to="/jobs" className="hover:text-ink">Browse jobs</Link></li>
            <li><Link to="/companies" className="hover:text-ink">Companies</Link></li>
            <li><Link to="/career-path" className="hover:text-ink">Career paths</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-ink/40">For candidates</p>
          <ul className="mt-3 space-y-2 text-sm text-ink/55">
            <li><Link to="/register" className="hover:text-ink">Create a profile</Link></li>
            <li><Link to="/saved" className="hover:text-ink">Saved jobs</Link></li>
            <li><Link to="/applications" className="hover:text-ink">Applications</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[.16em] text-ink/40">For recruiters</p>
          <ul className="mt-3 space-y-2 text-sm text-ink/55">
            <li><Link to="/register" className="hover:text-ink">Post a role</Link></li>
            <li><Link to="/recruiter" className="hover:text-ink">Recruiter workspace</Link></li>
            <li><Link to="/login" className="hover:text-ink">Log in</Link></li>
          </ul>
        </div>
      </div>
      <div className="shell flex flex-col gap-3 border-t border-ink/10 py-6 text-xs text-ink/40 sm:flex-row sm:items-center sm:justify-between">
        <span>© {new Date().getFullYear()} Career Match. Built as an open, explainable job-matching demo.</span>
        <span>Listings from direct recruiters and public feeds · Adzuna · Jooble · Remotive · Jobicy · RemoteOK</span>
      </div>
    </footer>
  );
}

const App = () => {
  const content = (
    <AuthProvider>
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <ScrollToTop />
            <Header />
            <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/" element={<Index />} />
              <Route path="/jobs" element={<Jobs />} />
              <Route path="/jobs/:jobId" element={<JobDetails />} />
              <Route path="/companies" element={<Companies />} />
              <Route path="/companies/:companyId" element={<CompanyPage />} />
              <Route path="/login" element={<Login />} />
              <Route path="/register" element={<Register />} />
              <Route path="/reset-password" element={<ResetPassword />} />
              <Route path="/verify-email" element={<VerifyEmail />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/saved" element={<SavedJobs />} />
              <Route path="/applications" element={<Applications />} />
              <Route path="/notifications" element={<Notifications />} />
              <Route path="/career-path" element={<CareerPath />} />
              <Route path="/recruiter" element={<Recruiter />} />
              <Route path="/admin" element={<Admin />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            </Suspense>
            <SiteFooter />
          </BrowserRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </AuthProvider>
  );
  const clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  return clientId ? <GoogleOAuthProvider clientId={clientId}>{content}</GoogleOAuthProvider> : content;
};

export default App;

import { createRoot } from "react-dom/client";
createRoot(document.getElementById("root")!).render(<App />);
