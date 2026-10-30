import { FormEvent, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowRight, Mail } from "lucide-react";
import { api, Envelope } from "@/lib/api";

export default function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get("token");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [devResetUrl, setDevResetUrl] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    setDevResetUrl("");
    try {
      const result = await api<Envelope<{ accepted?: boolean; developmentResetUrl?: string; reset?: boolean }>>(
        token ? "/auth/password-reset/complete" : "/auth/password-reset/request",
        { method: "POST", body: JSON.stringify(token ? { token, password } : { email }) },
        false,
      );
      if (token) {
        setMessage("Password updated. You can sign in with your new password.");
      } else if (result.data.developmentResetUrl) {
        setDevResetUrl(result.data.developmentResetUrl);
        setMessage("Email delivery is not configured locally, so here is the reset link directly: ");
      } else {
        setMessage("If that email is registered, password reset instructions have been sent. Check your inbox and spam folder.");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not complete this request.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="shell flex min-h-[calc(100vh-76px)] items-center justify-center py-16">
      <div className="w-full max-w-md">
        <p className="eyebrow">Account recovery</p>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-[-.05em]">{token ? "Choose a new password." : "Reset your password."}</h1>
        <p className="mt-3 text-sm leading-6 text-ink/55">
          {token ? "Choose a password of at least 10 characters. All other sessions will be signed out." : "Enter the email on your account and we will send a secure, one-time reset link that expires in 30 minutes."}
        </p>

        <form onSubmit={submit} className="mt-8 space-y-4">
          {token ? (
            <label className="input-label">
              New password
              <input className="field mt-2" type="password" autoComplete="new-password" minLength={10} maxLength={128} required value={password} onChange={(event) => setPassword(event.target.value)} />
              <span className="mt-1 block text-xs text-ink/40">Use at least 10 characters. Avoid reusing a password from another site.</span>
            </label>
          ) : (
            <label className="input-label">
              Account email
              <span className="relative mt-2 block">
                <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-ink/30" size={15} />
                <input className="field pl-10" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" />
              </span>
            </label>
          )}

          {error && <p role="alert" className="rounded-lg border border-red-300/40 bg-red-50/60 px-3 py-2 text-sm text-red-700">{error}</p>}
          {message && (
            <p role="status" className="rounded-lg border border-[#2f7a56]/25 bg-[#dff1e8]/60 px-3 py-2 text-sm leading-6 text-[#27634e]">
              {message}
              {devResetUrl && <a href={devResetUrl} className="ml-1 font-medium underline underline-offset-2">Open reset link</a>}
            </p>
          )}

          <button disabled={busy} className="button button-dark w-full">
            {busy ? "Please wait…" : token ? <>Update password <ArrowRight size={15} /></> : <>Send reset link <ArrowRight size={15} /></>}
          </button>
        </form>

        <p className="mt-5 text-sm text-ink/55">
          {token ? <>Remembered it? <Link to="/login" className="underline underline-offset-4 hover:text-ink">Back to sign in</Link></> : <>New here? <Link to="/register" className="underline underline-offset-4 hover:text-ink">Create an account</Link></>}
        </p>
        {!token && <p className="mt-6 text-[11px] leading-5 text-ink/35">In production, reset emails require `RESEND_API_KEY` and `EMAIL_FROM` to be configured. Reset tokens are never returned in production.</p>}
      </div>
    </main>
  );
}
