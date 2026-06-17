import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // Pin the workspace root — the repo has multiple lockfiles and Next would
  // otherwise infer the parent directory.
  turbopack: {
    root: path.join(__dirname),
  },
};

export default nextConfig;
