import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, BriefcaseBusiness, Check, Eye, EyeOff, Lock, Mail, UserRound } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import GoogleSignInButton from "@/components/GoogleSignInButton";

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [role, setRole] = useState<"CANDIDATE" | "RECRUITER">(params.get("role") === "recruiter" ? "RECRUITER" : "CANDIDATE");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const strength = useMemo(() => {
    const checks = [password.length >= 10, /[a-z]/.test(password) && /[A-Z]/.test(password), /\d/.test(password), /[^A-Za-z0-9]/.test(password)];
    return checks.filter(Boolean).length;
  }, [password]);

  const redirectAfterSignUp = (userRole = role) => navigate(userRole === "RECRUITER" ? "/recruiter" : "/profile");
  const redirectAfterGoogleSignUp = (user: { roles: string[] }) => redirectAfterSignUp(user.roles.includes("RECRUITER") ? "RECRUITER" : "CANDIDATE");

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await register({ name: name.trim(), email: email.trim(), password, role });
      redirectAfterSignUp();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not create your account.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell grid min-h-[calc(100vh-76px)] items-center gap-14 py-14 lg:grid-cols-2">
      <div className="hidden max-w-md lg:block">
        <p className="eyebrow"><span className="size-1.5 rounded-full bg-coral" /> Join Career Match</p>
        <h1 className="mt-6 font-display text-6xl font-semibold leading-[.95] tracking-[-.07em]">Make your next move.</h1>
        <p className="mt-6 text-sm leading-7 text-ink/55">Create a candidate profile to get explained matches, or a recruiter account to publish roles and review ranked applicants.</p>
        <div className="mt-10 grid gap-3">
          {[
            ["For candidates", "Upload a resume, add skills, save roles, and track every application."],
            ["For recruiters", "Publish listings, see applicant rankings, and manage the hiring pipeline."],
            ["No paid AI key", "Resume parsing and matching run in-process with open tooling."],
          ].map(([title, body]) => (
            <div key={title} className="flex gap-3 rounded-xl border border-ink/10 bg-card p-4">
              <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-[#dff1e8] text-[#27634e]"><Check size={12} /></span>
              <div><p className="text-sm font-medium">{title}</p><p className="mt-0.5 text-xs leading-5 text-ink/45">{body}</p></div>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto w-full max-w-md">
        <p className="eyebrow lg:hidden">Create account</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.06em] lg:mt-0">Create your account.</h1>
        <p className="mt-3 text-sm text-ink/55">Choose how you want to use Career Match. You can add roles later.</p>

        <div className="mt-6 grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={() => setRole("CANDIDATE")} className={`rounded-xl border p-3.5 text-left transition-colors ${role === "CANDIDATE" ? "border-coral bg-coral/[.06]" : "border-ink/12 hover:border-ink/25"}`}>
            <UserRound size={17} className={role === "CANDIDATE" ? "text-coral" : "text-ink/40"} />
            <span className="mt-2 block text-sm font-semibold">Job seeker</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-ink/45">Build a profile and find roles.</span>
          </button>
          <button type="button" onClick={() => setRole("RECRUITER")} className={`rounded-xl border p-3.5 text-left transition-colors ${role === "RECRUITER" ? "border-coral bg-coral/[.06]" : "border-ink/12 hover:border-ink/25"}`}>
            <BriefcaseBusiness size={17} className={role === "RECRUITER" ? "text-coral" : "text-ink/40"} />
            <span className="mt-2 block text-sm font-semibold">Recruiter</span>
            <span className="mt-0.5 block text-[11px] leading-4 text-ink/45">Publish roles and review applicants.</span>
          </button>
        </div>

        {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
          <>
            <div className="mt-6"><GoogleSignInButton flow="register" role={role} onSuccess={redirectAfterGoogleSignUp} onError={setError} /></div>
            <div className="my-5 flex items-center gap-3 text-xs text-ink/40"><span className="h-px flex-1 bg-ink/10" />or use your email<span className="h-px flex-1 bg-ink/10" /></div>
          </>
        )}

        <form onSubmit={submit} className="space-y-4">
          <label className="input-label">
            Full name
            <span className="relative mt-2 block">
              <UserRound className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/30" size={15} />
              <input className="field pl-10" autoComplete="name" required minLength={2} maxLength={160} value={name} onChange={(event) => setName(event.target.value)} placeholder="Jordan Candidate" />
            </span>
          </label>
          <label className="input-label">
            Email
            <span className="relative mt-2 block">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/30" size={15} />
              <input className="field pl-10" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
            </span>
          </label>
          <label className="input-label">
            Password
            <span className="relative mt-2 block">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/30" size={15} />
              <input className="field pl-10 pr-11" type={showPassword ? "text" : "password"} autoComplete="new-password" required minLength={10} maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 10 characters" />
              <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-ink/35 hover:text-ink">
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
            <span className="mt-2 flex gap-1" aria-hidden="true">
              {[0, 1, 2, 3].map((index) => <span key={index} className={`h-1 flex-1 rounded-full ${index < strength ? (strength <= 1 ? "bg-red-400" : strength === 2 ? "bg-amber-400" : strength === 3 ? "bg-[#7a9a5a]" : "bg-[#2f7a56]") : "bg-ink/10"}`} />)}
            </span>
            <span className="mt-1 block text-[11px] text-ink/40">Use 10+ characters with upper and lower case, a number, and a symbol.</span>
          </label>

          {error && <p role="alert" className="rounded-lg border border-red-300/40 bg-red-50/60 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="button button-coral w-full">{busy ? "Creating account…" : <>Create account <ArrowRight size={15} /></>}</button>
          <p className="text-[11px] leading-5 text-ink/40">By creating an account you agree to keep applications honest and to let recruiters review the profile information you choose to share.</p>
        </form>

        <p className="mt-5 text-sm text-ink/55">Already registered? <Link to="/login" className="underline underline-offset-4 hover:text-ink">Log in</Link></p>
      </div>
    </main>
  );
}
