// Preview-only memory architecture patches
import "./scripts/patch-jev-topical-occurrence.cjs";
import "./scripts/patch-memory-control-context.cjs";
import "./scripts/patch-topic-scoped-synthesis-plan.cjs";
import "./scripts/patch-semantic-synthesis.cjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
};

export default nextConfig;
