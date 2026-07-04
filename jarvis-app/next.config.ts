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
  //
  // Investment Planner (Next.js, deployed separately on Vercel) follows the
  // same shape: its own next.config.mjs sets basePath: "/investment-planner"
  // so its routes and _next/static assets line up under this prefix too.
  //
  // Cardex (Next.js, deployed separately on Vercel) follows the same shape:
  // its own next.config.mjs sets basePath: "/cardex".
  //
  // Wrapped Together (Next.js, deployed separately on Vercel) follows the
  // same shape: its own next.config.mjs sets basePath: "/wrapped-together".
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
      {
        source: "/investment-planner",
        destination: "https://investment-planner-five.vercel.app/investment-planner",
      },
      {
        source: "/investment-planner/:path*",
        destination: "https://investment-planner-five.vercel.app/investment-planner/:path*",
      },
      {
        source: "/cardex",
        destination: "https://cardex-ruddy.vercel.app/cardex",
      },
      {
        source: "/cardex/:path*",
        destination: "https://cardex-ruddy.vercel.app/cardex/:path*",
      },
      {
        source: "/wrapped-together",
        destination: "https://wrapped-together.vercel.app/wrapped-together",
      },
      {
        source: "/wrapped-together/:path*",
        destination: "https://wrapped-together.vercel.app/wrapped-together/:path*",
      },
    ];
  },
  // Dev-only: lets phones/tablets on the LAN load dev assets (Next blocks
  // cross-origin /_next requests by default). Harmless in production builds.
  allowedDevOrigins: ["192.168.1.228"],
};

export default nextConfig;
