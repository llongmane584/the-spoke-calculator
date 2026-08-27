# The Spoke Calculator

[Open the calculator](https://llongmane584.github.io/the-spoke-calculator/) · [日本語](README_ja.md)

A browser-based calculator for estimating the left- and right-side spoke lengths needed to build a bicycle wheel. Results update as dimensions and lacing patterns are entered.

The calculation assumes 12 mm nipples. Rim wall thickness, nipple length, measurement error, and component tolerances can affect the required length, so verify the result against the actual components before ordering or building.

## Highlights

- Live spoke-length calculation with rim offset and independent left/right lacing patterns
- Whole-wheel, hub, and rim presets
- Local saves, JSON import/export, shareable URLs, and spoke-reuse comparison
- English and Japanese UI, light/dark themes, responsive layout, and installable web app support

Detailed operating instructions are available from **How to use** in the application menu.

## Development

```bash
pnpm install
pnpm dev
```

Run the project checks before submitting changes:

```bash
pnpm lint
pnpm test
pnpm build
```
