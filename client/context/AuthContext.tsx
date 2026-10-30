import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, Envelope, User } from "@/lib/api";

type AuthValue = { user: User | null; loading: boolean; signIn: (email: string, password: string) => Promise<void>; register: (values: { name: string; email: string; password: string; role: "CANDIDATE" | "RECRUITER" }) => Promise<void>; signInWithGoogle: (values: { credential: string; flow: "login" | "register"; role?: "CANDIDATE" | "RECRUITER" }) => Promise<User>; signOut: () => Promise<void>; reload: () => Promise<void> };
const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = async () => {
    try { const result = await api<Envelope<User>>("/auth/me"); setUser(result.data); }
    catch { setUser(null); }
    finally { setLoading(false); }
  };
  useEffect(() => { void reload(); }, []);
  const signIn = async (email: string, password: string) => { const result = await api<Envelope<User>>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }); setUser(result.data); };
  const register = async (values: { name: string; email: string; password: string; role: "CANDIDATE" | "RECRUITER" }) => { const result = await api<Envelope<User>>("/auth/register", { method: "POST", body: JSON.stringify(values) }); setUser(result.data); };
  const signInWithGoogle = async (values: { credential: string; flow: "login" | "register"; role?: "CANDIDATE" | "RECRUITER" }) => { const result = await api<Envelope<User>>("/auth/google", { method: "POST", body: JSON.stringify(values) }, false); setUser(result.data); return result.data; };
  const signOut = async () => { try { await api("/auth/logout", { method: "POST" }, false); } finally { setUser(null); } };
  return <AuthContext.Provider value={{ user, loading, signIn, register, signInWithGoogle, signOut, reload }}>{children}</AuthContext.Provider>;
}

export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("useAuth must be used inside AuthProvider"); return value; }
