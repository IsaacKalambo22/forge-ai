import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // transformers.js loads a native ONNX binary at runtime. Bundling it breaks
  // that resolution, so Next must leave it as a plain node_modules require.
  serverExternalPackages: ["@xenova/transformers"],
  // The route indicator is dev-only chrome, not part of the app — left on it
  // shows up in every `pnpm dev` demo and every `pnpm visual` screenshot.
  devIndicators: false,
};

export default nextConfig;
