import type { NextConfig } from "next";

// Served from https://tonyxin.com/sites/pirates/ (GitHub Pages). The repo-level build
// script passes SITE_BASE_PATH; the fallback keeps `npm run dev` identical to production.
const basePath = process.env.SITE_BASE_PATH ?? "/sites/pirates";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
  trailingSlash: true,
  images: { unoptimized: true },
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
};

export default nextConfig;
