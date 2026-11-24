# vite-plugin-drupal

Vite plugins that build a Drupal site's front-end assets from Drupal's own
YAML: `*.libraries.yml`, `*.component.yml`, `*.ckeditor5.yml` and `.info.yml`.
Assets are defined once, in Drupal, and the
[drupal/vite](https://www.drupal.org/project/vite) module serves the build (or
the Vite dev server) in their place.

| Package | What it does |
|---|---|
| [vite-plugin-drupal-libraries](packages/vite-plugin-drupal-libraries) | Build entries from the libraries and Single Directory Components drupal/vite manages, and themes' `ckeditor5-stylesheets` |
| [vite-plugin-drupal-npm-libraries](packages/vite-plugin-drupal-npm-libraries) | Copies prebuilt files out of npm packages for Drupal libraries (used by vite-plugin-drupal-libraries) |
| [vite-plugin-drupal-ckeditor5](packages/vite-plugin-drupal-ckeditor5) | Builds CKEditor 5 plugins against core's CKEditor 5 DLL, instead of with webpack |
| [vite-plugin-drupal-sass](packages/vite-plugin-drupal-sass) | Compiles existing SCSS the way the Sass CLI did, with partials preloaded from `.info.yml` |
| [vite-plugin-drupal-css](packages/vite-plugin-drupal-css) | Load paths, and Tailwind `@reference` preloads from `.info.yml`, for plain CSS |
| [vite-plugin-drupal-bootstrap-breakpoints](packages/vite-plugin-drupal-bootstrap-breakpoints) | Writes a theme's `breakpoints.yml` from Bootstrap's grid breakpoints |
| [vite-plugin-drupal-tailwind-breakpoints](packages/vite-plugin-drupal-tailwind-breakpoints) | Writes a theme's `breakpoints.yml` from Tailwind's breakpoints |

Each package is versioned and published on its own; install only the ones a
site uses.

## Example

```js
// vite.config.js
import { defineConfig } from 'vite';
import drupalLibraries from 'vite-plugin-drupal-libraries';
import drupalSass from 'vite-plugin-drupal-sass';

export default defineConfig({
  base: './',
  plugins: [
    drupalSass({ loadPaths: ['node_modules', 'web/themes/custom'] }),
    drupalLibraries(),
  ],
  build: {
    manifest: true,
    outDir: 'web/libraries',
    emptyOutDir: false,
  },
});
```

The plugins expect a Composer-based Drupal project with the web root in `web/`,
and Vite run from the project root.

## Development

```sh
npm install
npm run check
```

The packages are npm workspaces, so they use each other from this repository.

### Releasing

Versions are independent, managed with [Changesets](https://github.com/changesets/changesets):

1. With each change, run `npm run changeset`, pick the packages it affects and
   whether it's a patch, minor or major change, and commit the file it adds.
2. To release, run `npm run version-packages`: it bumps the versions, updates
   each package's `CHANGELOG.md` (and the packages that depend on a bumped
   one), and refreshes the lockfile. Commit the result.
3. Run `npm run release` to publish the new versions to npm and tag them
   (`<package>@<version>`), then `git push --follow-tags`.

## License

MIT
