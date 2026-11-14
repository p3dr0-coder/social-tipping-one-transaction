import { defineConfig } from "eslint/config";
import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

// eslint-config-next 16 exports native flat configs; ESLint 10 needs no FlatCompat.
export default defineConfig([...nextCoreWebVitals, ...nextTypescript]);
