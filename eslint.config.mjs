// One job: catch React hooks used illegally — a hook after an early return, in
// a condition, or inside a callback. That mistake typechecks cleanly and then
// tears the whole page down at runtime ("This page couldn't load", shipped in
// v2.81.0), so it fails the build here instead of reaching the operator.
//
// Deliberately narrow: no style rules, nothing that blocks a deploy over
// something harmless. eslint and the plugin live in `dependencies` rather than
// devDependencies because Render builds with NODE_ENV=production, which skips
// dev ones.
import parser from "@typescript-eslint/parser";
import reactHooks from "eslint-plugin-react-hooks";

// The code carries eslint-disable comments for rules from plugins this config
// does not install (next/image, no-explicit-any). An unknown rule name in a
// disable comment is itself an error, so those names are registered as no-ops:
// the comments stay meaningful to a future full lint setup and stay silent here.
const noop = { create: () => ({}) };
const stub = (names) => ({ rules: Object.fromEntries(names.map((n) => [n, noop])) });

export default [
  { ignores: [".next/**", "node_modules/**", "public/**"] },
  {
    files: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "hooks/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
    languageOptions: {
      parser,
      parserOptions: { ecmaVersion: "latest", sourceType: "module", ecmaFeatures: { jsx: true } },
    },
    plugins: {
      "react-hooks": reactHooks,
      "@next/next": stub(["no-img-element"]),
      "@typescript-eslint": stub(["no-explicit-any", "no-unused-vars"]),
    },
    linterOptions: { reportUnusedDisableDirectives: "off" },
    rules: { "react-hooks/rules-of-hooks": "error" },
  },
];
