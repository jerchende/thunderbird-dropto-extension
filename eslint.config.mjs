import js from "@eslint/js";

export default [
  {
    ignores: ["dist/**", "node_modules/**", "web-ext-artifacts/**"],
  },
  js.configs.recommended,
  {
    files: ["src/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        messenger: "readonly",
        browser: "readonly",
        console: "readonly",
        URL: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        document: "readonly",
        window: "readonly",
      },
    },
    rules: {
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrorsIgnorePattern: "^_",
      }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      // Steuerzeichen im Dateinamen werden bewusst ersetzt (Sanitizing).
      "no-control-regex": "off",
    },
  },
  {
    files: ["src/experiments/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        ChromeUtils: "readonly",
        Components: "readonly",
        Services: "readonly",
        IOUtils: "readonly",
        PathUtils: "readonly",
      },
    },
    rules: {
      // Die Experiment-Klasse (var droptoFs) laedt Thunderbird ueber den Namespace.
      "no-unused-vars": "off",
    },
  },
];
