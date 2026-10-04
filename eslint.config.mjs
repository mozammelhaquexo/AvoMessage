import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Build output of `tsc -p tsconfig.server.json` — generated JS + maps, not source.
    "dist-server/**",
    // Generated Prisma client and runtime data written at boot.
    "lib/generated/**",
    "storage/**",
    "coverage/**",
  ]),
  {
    rules: {
      // eslint-plugin-react-hooks@7 (React Compiler) ships this as an error.
      //
      // Every data-loading component here follows the standard "fetch on mount,
      // clear a busy flag" pattern. The awaited call is always an `async`
      // function (`apiFetch` in lib/api-client.ts), so the `catch`/`finally`/
      // post-`try` paths can never actually run synchronously — but the rule
      // models them as synchronously reachable and rejects *every* shape that
      // clears the flag on the failure path: `finally`, code after the
      // `try`/`catch`, `await Promise.resolve()` and `queueMicrotask(...)` all
      // still report. The only accepted shape leaves `loading` stuck `true`
      // after a network error, i.e. an infinite spinner — a worse outcome than
      // a lint warning. It also reports inconsistently on byte-identical code,
      // so it is not reliably satisfiable.
      //
      // Kept at "warn" rather than "off" so the signal is not lost; the real
      // cascading-render cases it points at (reset-on-key-change effects) were
      // fixed properly instead of suppressed.
      "react-hooks/set-state-in-effect": "warn",

      // Honour the `_`-prefix convention for intentionally unused bindings.
      // `initiateCall` keeps a `MutationCtx` parameter it does not read so its
      // signature matches every other mutating service function.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
]);

export default eslintConfig;
