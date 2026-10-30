import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // `next dev` logs every request path, and the portal's paths /r/{token}/... hold the link token, which no log may
  // keep (docs/COMPLIANCE_AND_SAFETY.md, "Data we keep"). A production build logs no requests.
  logging: { incomingRequests: { ignore: [/^\/r\//] } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
