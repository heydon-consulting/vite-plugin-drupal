---
'vite-plugin-drupal-ckeditor5': patch
---

Leave out plugins whose library has `vite: false`, so a module can keep its own webpack build.
