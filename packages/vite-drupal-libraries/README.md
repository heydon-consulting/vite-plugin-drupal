# vite-drupal-libraries

Builds the Vite config from Drupal `*.libraries.yml` and `*.component.yml`
files, so assets only have to be defined once.

```sh
npm install --save-dev vite-drupal-libraries
```

```js
import drupalLibraries from 'vite-drupal-libraries';

export default defineConfig({
  plugins: [drupalLibraries()],
  build: { manifest: true, outDir: 'web/libraries', emptyOutDir: false },
});
```

It returns an array of plugins (this one and
[vite-drupal-npm-libraries](../vite-drupal-npm-libraries)), which Vite flattens.

## What it picks up

Every asset of a library or Single Directory Component that
[drupal/vite](https://www.drupal.org/project/vite) manages:

- files under `node_modules/` are copied by vite-drupal-npm-libraries;
- any other file (JS, SCSS, CSS...) becomes a build entry.

What is managed mirrors drupal/vite, minus overrides in `settings.php`:

- **Libraries:** `.info.yml` `vite: true`, `vite.enabled` or
  `vite.enableInAllLibraries`, then the library's `vite: true|false` or
  `vite.enabled`.
- **Components:** `.info.yml` `vite: true`, `vite.enabled` or
  `vite.enableInAllComponents`, for all of the extension's components. A
  component can't switch it on or off itself: core's SDC schema rejects `vite:`
  in `libraryOverrides`. Their assets are core's auto-discovered
  `<name>.css` / `<name>.js`, unless `libraryOverrides` replaces the `css` or
  `js` list.
- **Themes' `ckeditor5-stylesheets`:** when the theme is managed (the same
  `.info.yml` settings as for its libraries), or with
  `vite.ckeditor5Stylesheets` for them alone. drupal/vite needs the patch from
  [#3447335](https://www.drupal.org/node/3447335) to serve them.

## npm files

Options for an npm file go on the asset itself, under `vite:`; see
vite-drupal-npm-libraries for what they do:

```yaml
js:
  ../../../../node_modules/powerbi-client/dist/powerbi.min.js: { vite: { global: true } }
  ../../../../node_modules/filesize/dist/filesize.js: { vite: { namespace: filesize } }
  ../../../../node_modules/leaflet/dist/leaflet.js: { vite: { global: true, copy: [dist/images/*] } }
```

A library's `version:` is used for the copies' directory when the package's
own version is no use (e.g. 0.0.0 for a package installed from a git tag).

Contrib libraries that load a third-party library from `/libraries/<package>/`
(where Composer or a manual download would put it) are covered too, managed or
not: a file there that the npm package of that name has, at the same path, is
copied like a `node_modules/` asset. A Drupal `hook_library_info_alter()` then
has to point the library at the copy, using the Vite manifest.

## Options

| Option | Default | |
|---|---|---|
| `root` | `process.cwd()` | The project root |
| `dirs` | `extensionDirs(root)` | The directories to look for extensions in |

In dev, the server restarts when a `*.libraries.yml`, `*.component.yml` or
`.info.yml` changes.

## Helpers

The other vite-drupal packages use these, and they're exported for your own
plugins:

- `extensionDirs(root)`: the directories Drupal finds extensions in:
  `web/modules`, `web/themes`, `web/profiles`, and each site's own
  `web/sites/<site>/modules` and `themes`.
- `findExtensions(root, dirs)`: every module, theme and profile, keyed by directory, with its
  name, site and parsed `.info.yml`.
- `lookupExtension(extensions, name, site)`: an extension by machine name, as
  Drupal would find it for a site.
