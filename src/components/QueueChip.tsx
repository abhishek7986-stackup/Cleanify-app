"use client";

import { useEffect, useState } from "react";
import { flushUploadQueue, onQueueChange } from "@/lib/upload-queue";

/**
 * "2 photos waiting to sync".
 *
 * Without this a supervisor on a rooftop has no way to tell the difference
 * between "uploaded" and "silently stuck", which is how people lose faith in a
 * field app and go back to WhatsApp.
 */
export function QueueChip() {
  const [count, setCount] = useState(0);

  useEffect(() => onQueueChange(setCount), []);

  if (count === 0) return null;

  return (
    <button
      type="button"
      onClick={() => void flushUploadQueue()}
      className="tap rounded-full bg-warn-100 px-3 text-xs font-semibold text-warn-700"
    >
      {count} waiting to sync
    </button>
  );
}
