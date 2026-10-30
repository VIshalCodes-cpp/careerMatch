import { FormEvent, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, Eye, EyeOff, Lock, Mail } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import GoogleSignInButton from "@/components/GoogleSignInButton";

export default function Login() {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = params.get("next");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const redirectAfterSignIn = () => {
    if (next?.startsWith("/")) return navigate(next);
    return navigate("/dashboard");
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      redirectAfterSignIn();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not sign in.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell grid min-h-[calc(100vh-76px)] items-center gap-14 py-14 lg:grid-cols-2">
      <div className="hidden max-w-md lg:block">
        <p className="eyebrow"><span className="size-1.5 rounded-full bg-coral" /> Welcome back</p>
        <h1 className="mt-6 font-display text-6xl font-semibold leading-[.95] tracking-[-.07em]">Pick up where you left off.</h1>
        <p className="mt-6 text-sm leading-7 text-ink/55">Your saved roles, ranked matches, and application tracker are waiting. Sign in once and move between candidate and recruiter tools from the header.</p>
        <div className="mt-10 space-y-3 border-t border-ink/10 pt-6 text-sm text-ink/50">
          <p className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#2f7a56]" /> Transparent match explanations</p>
          <p className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-[#4b7fae]" /> Real listings, attributed sources</p>
          <p className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-coral" /> Your data stays in your account</p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-md">
        <p className="eyebrow lg:hidden">Your next move</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-.06em] lg:mt-0">Welcome back.</h1>
        <p className="mt-3 text-sm text-ink/55">Sign in to view saved opportunities and profile matches.</p>

        {import.meta.env.VITE_GOOGLE_CLIENT_ID && (
          <>
            <div className="mt-8"><GoogleSignInButton flow="login" onSuccess={redirectAfterSignIn} onError={setError} /></div>
            <div className="my-6 flex items-center gap-3 text-xs text-ink/40"><span className="h-px flex-1 bg-ink/10" />or use your email<span className="h-px flex-1 bg-ink/10" /></div>
          </>
        )}

        <form onSubmit={submit} className="space-y-4">
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
              <input className="field pl-10 pr-11" type={showPassword ? "text" : "password"} autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Your password" />
              <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? "Hide password" : "Show password"} className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded text-ink/35 hover:text-ink">
                {showPassword ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </span>
          </label>
          {error && <p role="alert" className="rounded-lg border border-red-300/40 bg-red-50/60 px-3 py-2 text-sm text-red-700">{error}</p>}
          <button disabled={busy} className="button button-dark w-full">{busy ? "Signing in…" : <>Log in <ArrowRight size={15} /></>}</button>
        </form>

        <div className="mt-5 flex justify-between text-sm text-ink/55">
          <Link to="/reset-password" className="underline underline-offset-4 hover:text-ink">Forgot password?</Link>
          <Link to="/register" className="underline underline-offset-4 hover:text-ink">Create account</Link>
        </div>
        {import.meta.env.DEV && <p className="mt-8 rounded-xl border border-ink/10 bg-secondary/50 p-3 text-[11px] leading-5 text-ink/40">
          Demo environment: candidate@careermatch.dev / CandidatePass123 · recruiter@careermatch.dev / RecruiterPass123 · admin@careermatch.dev / AdminPass12345. Remove demo accounts before a public launch.
        </p>}
      </div>
    </main>
  );
}
