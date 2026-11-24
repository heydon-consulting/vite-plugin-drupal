# vite-plugin-drupal-sass

Compiles existing Drupal SCSS with Vite the way the Sass CLI did, so it
doesn't need converting to the module system or to Vite's URL rules.

```sh
npm install --save-dev vite-plugin-drupal-sass sass-embedded
```

```js
import drupalSass from 'vite-plugin-drupal-sass';

export default defineConfig({
  plugins: [
    drupalSass({
      loadPaths: ['node_modules', 'web/themes/custom'],
      moduleTheme: 'my_theme',
    }),
  ],
});
```

- Relative `@import` / `@use` are resolved by Sass itself, and `url()`s stay as
  written, relative to the compiled CSS, as with the Sass CLI. Vite resolves
  them from the entry file, which matches the CLI as long as the entry and the
  old CSS output directory are at the same depth (e.g. `scss/style.scss` →
  `css/style.css`).
- `loadPaths` replaces `--load-path`, and the webpack-style `~package/...`
  prefix is accepted.
- Deprecation warnings that older code triggers on every build are silenced.

## Preloaded partials

Variables, mixins and functions usable in every SCSS file without importing
them. Each module, theme and profile lists its own in its `.info.yml`:

```yaml
vite:
  preload:
    functions: [bootstrap/scss/functions]
    variables: [scss/_variables.scss]
    mixins: [scss/_mixins.scss]
```

Paths are relative to the extension, or to the load paths; a plain list is
the same as `mixins`. Preloaded files should hold no CSS rules, as those would
be output into every compiled file.

A file gets one theme's preloads: the nearest theme with `preload`, from its
own up the `base theme:` chain (each theme's variables file imports the level
above itself). A theme's files get their theme's. Files in modules and
profiles get a theme's and then their own: `moduleTheme`'s, or for a module in
a site's own directory (`sites/<site>/modules` in the web root), that site's theme from
`siteThemes`. In order:

1. functions, the theme's then the module's;
2. variables, the module's then the theme's, so the module's values come
   before the theme's `!default`s;
3. mixins, the theme's then the module's.

They're loaded with `@use ... as *`, so this also works in files that start
with `@use`. `vite: { preload: false }` turns preloading off for an
extension's files.

## Options

| Option | Default | |
|---|---|---|
| `loadPaths` | `['node_modules']` | As the Sass CLI's `--load-path` |
| `preload` | `{}` | Partials preloaded before every theme's, in the same shape as in `.info.yml` |
| `moduleTheme` | `null` | The theme whose preloads modules and profiles get |
| `siteThemes` | `{}` | The theme per site directory, for modules in `sites/<site>/` in the web root; keys are names or globs (`*`, `?`, `{a,b}`), an exact name winning, then the first matching glob |
| `webRoot` | `'web'` | Drupal's web root (the directory with its `index.php`), relative to `root`: e.g. `'docroot'`, or `''` when Drupal is the project root |
| `dirs` | `extensionDirs(root, webRoot)` | The directories to look for extensions in |
| `silenceDeprecations` | `['import', 'global-builtin', 'color-functions', 'slash-div', 'if-function', 'abs-percent']` | Sass deprecations not to warn about; `[]` shows them all |

Needs `sass-embedded` (or `sass`) installed, as Vite does for SCSS.
