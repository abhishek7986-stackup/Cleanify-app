import { Suspense } from "react";
import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <main className="flex min-h-full flex-col justify-center px-5 py-10">
      <div className="mx-auto w-full max-w-sm">
        {/* New field staff create their own account; the office approves it. */}
        <a
          href="/join"
          className="tap mb-8 flex items-center justify-between gap-3 rounded-2xl border-2 border-brand-200 bg-brand-50 px-4 py-3"
        >
          <span>
            <span className="block font-semibold text-brand-800">New staff? Create your account</span>
            <span className="block text-sm text-brand-900/80">Joining Cleanify as a worker</span>
          </span>
          <span aria-hidden className="text-xl text-brand-700">→</span>
        </a>
        <div className="mb-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/icons/icon-192.png"
            alt=""
            className="mx-auto mb-4 size-16 rounded-2xl"
          />
          <h1 className="text-2xl font-semibold text-slate-900">Cleanify Operations</h1>
          <p className="mt-1 text-sm text-slate-500">Internal use only</p>
        </div>
        <Suspense fallback={null}>
          <LoginForm />
        </Suspense>
      </div>
    </main>
  );
}
