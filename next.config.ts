import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server in .next/standalone (run with `node server.js`),
  // so the Docker image for AWS needs no node_modules install. See Dockerfile.
  output: "standalone",
  poweredByHeader: false,

  // Lets a phone on the same Wi-Fi load the dev server's JS. Without this the
  // page renders but never hydrates, so no button does anything. 127.0.0.1 is
  // for testing as a second user on the Mac. Development only.
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "127.0.0.1"],

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // Nobody needs to frame the app; this stops clickjacking.
          { key: "X-Frame-Options", value: "DENY" },
          // The app itself uses the camera (photos) and location (check-in,
          // reached); nothing else on the page may.
          { key: "Permissions-Policy", value: "camera=(self), geolocation=(self), microphone=()" },
        ],
      },
      {
        // The service worker must never be cached, or a fix to push handling
        // would not reach phones until the cache expired.
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }],
      },
    ];
  },
};

export default nextConfig;
