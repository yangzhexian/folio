# Attachment preview fixtures

These tiny fixtures are entirely synthetic. They contain no user files, personal data, remote URLs, embedded scripts, or third-party assets. `landscape.png` is a 1200 × 900 RGB image, `portrait.jpg` is a 900 × 1200 RGB image, `two-pages.pdf` has two distinguishable vector pages with a standard Helvetica font, and `broken.pdf` intentionally has no valid page tree.

The browser tests pass the checked-in file bytes through the public Tauri IPC mock and exercise the real image decoder and PDF.js worker. They never read a personal database or open a native application. To regenerate these fixtures, run `python tests/fixtures/generate-preview-fixtures.py` with Pillow installed.
