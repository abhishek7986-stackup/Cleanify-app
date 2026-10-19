"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "@/lib/domain/database";

/**
 * Browser client. This is the primary data path: ~90% of reads and writes go
 * straight to PostgREST and are governed by RLS, which keeps the code small,
 * makes Realtime trivial, and works with an offline cache.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
