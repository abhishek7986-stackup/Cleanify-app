import { JoinForm } from "./JoinForm";

export const metadata = { title: "Join Cleanify" };

export default function JoinPage() {
  return (
    <main className="flex min-h-full flex-col px-5 py-8">
      <div className="mx-auto w-full max-w-sm space-y-6">
        <div className="text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" className="mx-auto mb-3 size-14 rounded-2xl" />
          <h1 className="text-2xl font-semibold text-slate-900">Join Cleanify</h1>
          <p className="mt-1 text-sm text-slate-500">Create your staff account. The office approves it after checking your documents.</p>
        </div>
        <JoinForm />
      </div>
    </main>
  );
}
