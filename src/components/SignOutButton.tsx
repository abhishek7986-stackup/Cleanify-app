"use client";

import { createClient } from "@/lib/supabase/client";

export function SignOutButton() {
  return (
    <button
      type="button"
      onClick={async () => {
        await createClient().auth.signOut();
        // Full load so the next person on this phone never sees cached screens
        // from the last one. See goHome() in LoginForm.
        window.location.replace("/login");
      }}
      className="tap rounded-xl px-3 text-sm font-medium text-slate-600"
    >
      Sign out
    </button>
  );
}
