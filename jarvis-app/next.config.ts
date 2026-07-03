import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root — the repo has multiple lockfiles and Next would
  // otherwise infer the parent directory.
  turbopack: {
    root: path.join(__dirname),
  },
  // Dev-only: lets phones/tablets on the LAN load dev assets (Next blocks
  // cross-origin /_next requests by default). Harmless in production builds.
  allowedDevOrigins: ["192.168.1.228"],
};

export default nextConfig;
