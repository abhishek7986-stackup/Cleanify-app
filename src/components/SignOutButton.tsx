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
      aria-label="Sign out"
      title="Sign out"
      className="flex size-12 items-center justify-center rounded-full text-white/85 active:bg-white/10"
    >
      <svg viewBox="0 0 24 24" className="size-[22px]" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
        <path d="M9 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h3M16 17l5-5-5-5M21 12H9" />
      </svg>
    </button>
  );
}
