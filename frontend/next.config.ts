import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  ...(process.platform === "win32" ? {} : { output: "standalone" as const }),
  reactStrictMode: true,
  poweredByHeader: false,
  experimental: { optimizePackageImports: ["viem"] },
};

export default nextConfig;
