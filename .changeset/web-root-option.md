---
"@vite-plugin-drupal/libraries": minor
"@vite-plugin-drupal/ckeditor5": minor
"@vite-plugin-drupal/sass": minor
"@vite-plugin-drupal/css": minor
"@vite-plugin-drupal/bootstrap-breakpoints": minor
"@vite-plugin-drupal/tailwind-breakpoints": minor
---

Add a `webRoot` option for projects whose Drupal web root isn't `web/`, e.g. `docroot`, or `''` when Drupal is the project root. It defaults to `'web'`, so existing setups don't change. `extensionDirs()` and `findExtensions()` take it too, and the new `webPath()` helper joins paths in the web root.
