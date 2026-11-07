import { Eye, EyeOff, Loader2, Lock } from "lucide-react";
import { useState } from "react";

import { supabase } from "@/integrations/supabase/client";
import { MEMBERS, type MemberEmail } from "@/lib/care-desk";
import { cn } from "@/lib/utils";

const HANDLES: MemberEmail[] = ["tim@popotso.app", "nicky@popotso.app"];

export function AuthScreen() {
  const [handle, setHandle] = useState<MemberEmail>(HANDLES[0]!);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (password.length < 6) {
      setError("Use at least 6 characters.");
      return;
    }
    setBusy(true);
    setError(null);

    const first = await supabase.auth.signInWithPassword({ email: handle, password });
    if (!first.error) {
      setBusy(false);
      return;
    }

    // First-time setup fallback
    const signUp = await supabase.auth.signUp({ email: handle, password });
    if (!signUp.error) {
      const second = await supabase.auth.signInWithPassword({ email: handle, password });
      if (!second.error) {
        setBusy(false);
        return;
      }
    }

    setBusy(false);
    setError("That passcode doesn't match this handle.");
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm animate-fade-up">
        <div className="mb-8 flex flex-col items-center text-center">
          <span className="mb-4 flex size-14 items-center justify-center rounded-[1.15rem] bg-primary text-primary-foreground">
            <Lock className="size-6" />
          </span>
          <h1 className="text-[26px] leading-tight font-semibold tracking-tight">
            Popotso Care Desk
          </h1>
          <p className="mt-1.5 text-[14px] text-muted-foreground">
            Private line. Two handles, no invitations.
          </p>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-secondary p-1">
          {HANDLES.map((email) => (
            <button
              key={email}
              type="button"
              onClick={() => setHandle(email)}
              className={cn(
                "rounded-xl px-3 py-2 text-[15px] font-medium transition-all duration-200",
                handle === email
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground",
              )}
            >
              {MEMBERS[email]}
            </button>
          ))}
        </div>

        <div className="rounded-2xl border border-border bg-card">
          <p className="hairline-b px-4 py-3 text-[15px] text-muted-foreground">{handle}</p>
          <div className="relative flex items-center">
            <input
              type={showPassword ? "text" : "password"}
              value={password}
              autoComplete="current-password"
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Passcode"
              className="w-full bg-transparent px-4 py-3 pr-11 text-[16.5px] outline-none placeholder:text-muted-foreground"
            />
            <button
              type="button"
              onClick={() => setShowPassword((prev) => !prev)}
              aria-label={showPassword ? "Hide passcode" : "Show passcode"}
              className="absolute right-3 p-1 text-muted-foreground transition-colors hover:text-foreground active:scale-90"
            >
              {showPassword ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
            </button>
          </div>
        </div>

        {error && <p className="mt-3 text-center text-[13px] text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-5 flex h-12 w-full items-center justify-center rounded-2xl bg-primary text-[16px] font-semibold text-primary-foreground transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {busy ? <Loader2 className="size-5 animate-spin" /> : "Unlock"}
        </button>

        <p className="mt-4 text-center text-[12px] leading-relaxed text-muted-foreground">
          No email is ever sent. Handles are internal identifiers only.
        </p>
      </form>
    </main>
  );
}
