# @vite-plugin-drupal/css

Drupal-aware CSS compilation for Vite: load paths for `@import`, and
stylesheets preloaded into every CSS file from the modules' and themes'
`.info.yml`, made for Tailwind CSS 4.

```sh
npm install --save-dev @vite-plugin-drupal/css
```

```js
import tailwindcss from '@tailwindcss/vite';
import drupalCss from '@vite-plugin-drupal/css';

export default defineConfig({
  plugins: [
    // Before tailwindcss(), which compiles the @reference rules it adds.
    drupalCss({ loadPaths: ['node_modules', 'web/themes/custom'], moduleTheme: 'my_theme' }),
    tailwindcss(),
  ],
});
```

## Load paths

A bare `@import 'my_theme/css/forms.css'` is looked up in each load path in
turn (`node_modules` first by default), and the webpack-style `~package/...`
prefix is accepted. Load paths other than `node_modules` become aliases for
their top-level directories, so the same names also work in JS imports. A name
already found in an earlier load path keeps that one.

## Preloaded stylesheets

Tailwind theme, utilities and custom variants usable in every CSS file without
referencing them. Each module, theme and profile lists its own in its
`.info.yml`:

```yaml
vite:
  preload: [css/style.css]
```

Paths are relative to the extension, or to the load paths (e.g.
`tailwindcss`). They're added to each compiled file as `@reference`, so they
output no CSS of their own. A file is never given a reference to itself, so a
theme can preload its main stylesheet.

A file gets one theme's preloads: the nearest theme with `preload`, from its
own up the `base theme:` chain. Files in modules and profiles get a theme's
and then their own: `moduleTheme`'s, or for a module in a site's own directory
(`sites/<site>/modules` in the web root), that site's theme from `siteThemes`.
`vite: { preload: false }` turns preloading off for an extension's files.

Preloads go into each CSS file Vite compiles: library entries, component CSS
and CSS imported from JS, but not files those `@import` or CSS in
`node_modules`.

## Options

| Option | Default | |
|---|---|---|
| `loadPaths` | `['node_modules']` | Where bare `@import`s are looked up |
| `preload` | `[]` | Stylesheets preloaded before every theme's |
| `moduleTheme` | `null` | The theme whose preloads modules and profiles get |
| `siteThemes` | `{}` | The theme per site directory, for modules in `sites/<site>/` in the web root; keys are names or globs (`*`, `?`, `{a,b}`), an exact name winning, then the first matching glob |
| `webRoot` | `'web'` | Drupal's web root (the directory with its `index.php`), relative to `root`: e.g. `'docroot'`, or `''` when Drupal is the project root |
| `dirs` | `extensionDirs(root, webRoot)` | The directories to look for extensions in |
