# vite-drupal-tailwind-breakpoints

Writes a Drupal theme's `<theme>.breakpoints.yml` from Tailwind CSS 4's
breakpoints, so they're defined once, in CSS.

```sh
npm install --save-dev vite-drupal-tailwind-breakpoints @tailwindcss/node
```

```js
import tailwindBreakpoints from 'vite-drupal-tailwind-breakpoints';

export default defineConfig({
  plugins: [tailwindBreakpoints()],
});
```

Tailwind's breakpoints are the `--breakpoint-*` theme variables: its
defaults, and any a stylesheet sets in `@theme`. A theme opts in from its
`.info.yml`:

```yaml
vite:
  breakpoints:
    # The stylesheet that imports Tailwind, relative to the theme.
    css: css/style.css
    # Optional: the theme variable namespace and the multipliers of every
    # breakpoint.
    prefix: breakpoint
    multipliers: ['1x', '2x']
```

Tailwind compiles breakpoints into media queries rather than outputting them
as custom properties, so they're read from the stylesheet's resolved theme,
with Tailwind's own loader. Each breakpoint becomes `<theme>.<name>` with a
mobile-first `all and (min-width: ...)` query, weighted in Tailwind's order.

The file is written on every build and dev server start, and again in dev
when a CSS file in the theme changes; only when its contents change. Drupal
caches breakpoints, so run `drush cr` after it changes.

## Options

| Option | Default | |
|---|---|---|
| `root` | `process.cwd()` | The project root |
| `dirs` | `extensionDirs(root)` | The directories to look for themes in |
