// Synthesis validation retry after rate-limit window cleared
// Synthesis validation branch trigger
// Trigger atomic synthesis rebuild
// Preview-only memory architecture patches
import "./scripts/patch-jev-topical-occurrence.cjs";
import "./scripts/patch-memory-control-context.cjs";
import "./scripts/patch-topic-scoped-synthesis-adjudication.cjs";
import "./scripts/patch-semantic-synthesis.cjs";\nimport "./scripts/patch-document-advisory-edit.cjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
};

export default nextConfig;
