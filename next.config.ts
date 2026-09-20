import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  ...(process.env.CAPACITOR_BUILD === '1' ? { output: 'export' as const, trailingSlash: true } : {}),
};
export default nextConfig;
