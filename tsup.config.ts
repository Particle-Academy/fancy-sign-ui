import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts", "src/styles.css"],
  format: ["esm", "cjs"],
  dts: { entry: ["src/index.ts", "src/client.ts"] },
  // Every one of these is a peer. Bundling react-fancy would ship a second
  // React component registry into the consumer's tree, which looks exactly
  // like success right up until two copies of a context disagree.
  external: ["react", "react-dom", "@particle-academy/react-fancy", "tailwindcss"],
  treeshake: true,
  clean: true,
  sourcemap: true,
});
