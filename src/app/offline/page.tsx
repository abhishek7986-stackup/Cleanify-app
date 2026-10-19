export const metadata = { title: "Offline" };

export default function OfflinePage() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="text-xl font-semibold">You are offline</h1>
      <p className="max-w-sm text-balance text-slate-600">
        Anything you have already captured is saved on this phone and will upload
        by itself once you have signal again. You do not need to take the photos
        a second time.
      </p>
    </main>
  );
}
