import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 exports native flat configs; ESLint 10 needs no FlatCompat.
export default defineConfig([
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/ban-ts-comment": "off",
      // New in Next 16's React Compiler preset (eslint-plugin-react-hooks 7).
      // The pre-bump gate had no such rule; migrating every mount/async-load
      // call site is a separate UI refactor. Preserves the prior rule set.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
