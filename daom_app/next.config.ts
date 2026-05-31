import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

const appRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  /* config options here */
  output: "standalone",
  turbopack: {
    root: appRoot,
  },
  experimental: {
    taint: true,
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  async redirects() {
    return [
      {
        source: "/",
        destination: "/extraction",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
