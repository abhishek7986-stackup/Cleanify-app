"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

/**
 * The sign-in token still says "inactive" until it is renewed, so renew it
 * first; otherwise the app would send them straight back to this page.
 */
export function ContinueButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        await createClient().auth.refreshSession();
        window.location.replace("/");
      }}
      className="tap-lg w-full rounded-xl bg-brand-700 font-semibold text-white disabled:opacity-50"
    >
      {busy ? "Opening…" : "Open the app"}
    </button>
  );
}
