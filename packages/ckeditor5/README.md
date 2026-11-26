# vite-plugin-drupal-ckeditor5

Builds Drupal CKEditor 5 plugins with Vite instead of webpack.

```sh
npm install --save-dev vite-plugin-drupal-ckeditor5
```

```js
import ckeditor5Plugins from 'vite-plugin-drupal-ckeditor5';

export default defineConfig({
  plugins: [ckeditor5Plugins()],
});
```

It applies to sources in Drupal's layout,
`<module>/js/ckeditor5_plugins/<pluginName>/src/*.js`, written exactly as for
the webpack/DLL build:

- `import { Plugin } from 'ckeditor5/src/core'` becomes a lookup in the
  CKEditor 5 DLL that Drupal core already loads
  (`CKEditor5.dll('./src/core.js')`), so the plugin shares core's CKEditor
  instead of bundling its own;
- `import icon from './icon.svg'` gives the SVG markup (webpack's raw-loader);
- the default export of `src/index.js` is registered as
  `CKEditor5.<pluginName>`, where Drupal looks for `<pluginName>.<Class>` from
  the `*.ckeditor5.yml`.

Which plugins to build comes from each module's `*.ckeditor5.yml`, written as
for webpack: a definition whose `drupal.library` is a library of the module
loading `js/build/<pluginName>.js`, for its `<pluginName>.<Class>` plugins
with a source in this layout. CSS the plugin imports is loaded with it.

A plugin whose library has `vite: false` is left out, so a module can keep its
own webpack build (a contrib module's, say) on a site that builds the others
with Vite:

```yaml
# mymodule.libraries.yml
my_plugin:
  vite: false
  js:
    js/build/myPlugin.js: { minified: true }
```

## The Drupal side

Drupal still loads `js/build/<pluginName>.js`, so a module has to swap it for
the plugin's source in `hook_library_info_alter()`, running before
[drupal/vite](https://www.drupal.org/project/vite)'s, and set `vite: true` on
the library. drupal/vite then rewrites the source to the Vite build, or to the
dev server.

## Options

| Option | Default | |
|---|---|---|
| `root` | `process.cwd()` | The project root |
| `webRoot` | `'web'` | Drupal's web root (the directory with its `index.php`), relative to `root`: e.g. `'docroot'`, or `''` when Drupal is the project root |
| `dirs` | `extensionDirs(root, webRoot)` | The directories to look for modules in |
