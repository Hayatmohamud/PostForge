import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Keep development startup from generating files outside the task scope.
  agentRules: false,
};

export default nextConfig;
