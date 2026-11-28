---
"vite-plugin-drupal-libraries": minor
---

Themes' `ckeditor5-stylesheets` are only built with the new `ckeditor5Stylesheets: true` option, as drupal/vite needs a patch (#3447335) to serve them. Sites with the patch need to turn it on.
