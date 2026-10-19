import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";

export const metadata: Metadata = {
  title: {
    default: "Cleanify Operations",
    template: "%s · Cleanify",
  },
  description: "Job dispatch, check-in and proof of work for Cleanify field teams.",
  manifest: "/manifest.webmanifest",
  applicationName: "Cleanify",
  appleWebApp: {
    capable: true,
    title: "Cleanify",
    statusBarStyle: "default",
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/apple-touch-icon.png",
  },
  formatDetection: { telephone: true },
  robots: { index: false, follow: false }, // internal tool
};

export const viewport: Viewport = {
  themeColor: "#0f766e",
  width: "device-width",
  initialScale: 1,
  // Field staff need to pinch-zoom a client's address or a photo, so zoom is
  // deliberately NOT disabled.
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900">
        {children}
        <ServiceWorkerRegistrar />
      </body>
    </html>
  );
}
