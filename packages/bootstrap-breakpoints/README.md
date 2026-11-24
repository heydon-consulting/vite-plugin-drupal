# @vite-plugin-drupal/bootstrap-breakpoints

Writes a Drupal theme's `<theme>.breakpoints.yml` from Bootstrap's grid
breakpoints, so they're defined once, in Sass.

```sh
npm install --save-dev @vite-plugin-drupal/bootstrap-breakpoints
```

```js
import bootstrapBreakpoints from '@vite-plugin-drupal/bootstrap-breakpoints';

export default defineConfig({
  plugins: [bootstrapBreakpoints()],
});
```

Bootstrap's compiled CSS lists its grid breakpoints as custom properties
(Bootstrap 4: `:root { --breakpoint-sm: 576px; ... }`, from
`$grid-breakpoints`). A theme opts in from its `.info.yml`:

```yaml
vite:
  breakpoints:
    # The stylesheet that compiles Bootstrap, relative to the theme.
    css: scss/bootstrap.scss
    # Optional: the custom property prefix (Bootstrap 5.3: bs-breakpoint)
    # and the multipliers of every breakpoint.
    prefix: breakpoint
    multipliers: ['1x', '2x']
```

The stylesheet is compiled through Vite's CSS pipeline (so preloaded
variables apply), and each breakpoint becomes `<theme>.<name>` with a
mobile-first `all and (min-width: ...)` query, weighted in Bootstrap's order.

The file is written on every build and dev server start, and again in dev
when a file the stylesheet uses changes; only when its contents change.
Drupal caches breakpoints, so run `drush cr` after it changes.

## Options

| Option | Default | |
|---|---|---|
| `root` | `process.cwd()` | The project root |
| `webRoot` | `'web'` | Drupal's web root (the directory with its `index.php`), relative to `root`: e.g. `'docroot'`, or `''` when Drupal is the project root |
| `dirs` | `extensionDirs(root, webRoot)` | The directories to look for themes in |
