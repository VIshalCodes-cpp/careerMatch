import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { api } from "@/lib/api";

export default function VerifyEmail() {
  const [params] = useSearchParams(); const [message, setMessage] = useState("Verifying your email…"); const [error, setError] = useState("");
  useEffect(() => { const token = params.get("token"); if (!token) { setError("Verification link is missing its token."); return; } api("/auth/email-verification/complete", { method: "POST", body: JSON.stringify({ token }) }, false).then(() => setMessage("Your email is verified." )).catch((reason) => setError(reason.message)); }, []);
  return <main className="shell flex min-h-[calc(100vh-76px)] items-center justify-center py-16"><div className="max-w-md text-center">{error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <p role="status" className="text-lg">{message}</p>}<Link to="/dashboard" className="button button-dark mt-6">Continue</Link></div></main>;
}
