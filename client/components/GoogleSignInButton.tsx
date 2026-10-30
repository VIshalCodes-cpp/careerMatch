import { useState } from "react";
import { GoogleLogin } from "@react-oauth/google";
import { useAuth } from "@/context/AuthContext";
import { User } from "@/lib/api";

type Props = {
  flow: "login" | "register";
  role?: "CANDIDATE" | "RECRUITER";
  onSuccess: (user: User) => void;
  onError: (message: string) => void;
};

export default function GoogleSignInButton({ flow, role, onSuccess, onError }: Props) {
  const { signInWithGoogle } = useAuth();
  const [busy, setBusy] = useState(false);

  if (!import.meta.env.VITE_GOOGLE_CLIENT_ID) return null;

  const handleSuccess = async (response: { credential?: string }) => {
    if (!response.credential) {
      onError("Google did not return an identity token. Please try again.");
      return;
    }
    setBusy(true);
    try {
      const user = await signInWithGoogle({ credential: response.credential, flow, ...(role ? { role } : {}) });
      onSuccess(user);
    } catch (error) {
      onError(error instanceof Error ? error.message : "Google sign-in failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className={`flex justify-center ${busy ? "pointer-events-none opacity-60" : ""}`}>
      <GoogleLogin
        onSuccess={handleSuccess}
        onError={() => onError("Google sign-in could not be completed. Please try again.")}
        text={flow === "register" ? "signup_with" : "signin_with"}
        theme="outline"
        shape="rectangular"
        width={360}
        useOneTap={false}
      />
    </div>
  );
}
