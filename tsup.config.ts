import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts", "src/client.ts", "src/template.tsx", "src/styles.css"],
  format: ["esm", "cjs"],
  dts: { entry: ["src/index.ts", "src/client.ts", "src/template.tsx"] },
  // Every one of these is a peer. Bundling react-fancy would ship a second
  // React component registry into the consumer's tree, which looks exactly
  // like success right up until two copies of a context disagree.
  external: ["react", "react-dom", "@particle-academy/react-fancy", "tailwindcss", "@particle-academy/fancy-template-ui"],
  treeshake: true,
  clean: true,
  sourcemap: true,
});
