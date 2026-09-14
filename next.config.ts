import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // transformers.js loads a native ONNX binary at runtime. Bundling it breaks
  // that resolution, so Next must leave it as a plain node_modules require.
  serverExternalPackages: ["@xenova/transformers"],
};

export default nextConfig;
