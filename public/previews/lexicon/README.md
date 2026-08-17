# Lexicon preview stills

Bundled stills for `src/config/cinematographyCatalog.json`.

Velorn serves them from this folder so shot-parameter chips do not need an
external CDX Studio checkout. Catalog `preview` values are site-root paths
such as `/previews/lexicon/extreme-close-up.png`. Resolve them with
`getLexiconPreviewUrl()` so Vite `base: './'` and Electron `file://` both work.
