# Aweborn

**Open by design.** Aweborn is a 501(c)(3) non-profit, and nothing about how it is built or run is meant to be hidden: the code, the plans in [`phases/`](phases/README.md), the [ROADMAP](ROADMAP.md) and the [business plan](docs/BUSINESS_PLAN.md) are all public. If you see problematic language or a bad idea anywhere in this repository, [open an issue](https://github.com/aweborn/aweborn.org/issues) and we'll answer it in public. The code is [MIT](LICENSE) and the docs in [`docs/`](docs/) are CC BY 4.0: borrow them to build your own thing.

---

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.
