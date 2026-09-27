import "./scripts/patch-jev-topical-occurrence.cjs";
import "./scripts/patch-jev-recent-context-occurrence.cjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
};

export default nextConfig;
