import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root — the repo has multiple lockfiles and Next would
  // otherwise infer the parent directory.
  turbopack: {
    root: path.join(__dirname),
  },
  // Woven (the Flutter web build, deployed separately on Vercel) is served
  // under /woven-together so it sits behind this app's auth gate (proxy.ts).
  // The Flutter bundle is built with --base-href /woven-together/, so asset
  // and route paths line up on both hosts.
  async rewrites() {
    return [
      {
        source: "/woven-together",
        destination: "https://woven-app-kappa.vercel.app/woven-together/",
      },
      {
        source: "/woven-together/:path*",
        destination: "https://woven-app-kappa.vercel.app/woven-together/:path*",
      },
    ];
  },
};

export default nextConfig;
