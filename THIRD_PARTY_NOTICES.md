# Third-party notices

VVTools distributes or uses the following third-party software. This file is not a substitute for a legal review before distribution.

## FFmpeg and FFprobe

VVTools pins FFmpeg and FFprobe 8.1.2 executables by platform and verifies every downloaded
archive with the SHA-256 values recorded in `scripts/stage-media-binaries.mjs`. Windows binaries
are supplied by Gyan.dev; macOS and Linux binaries are supplied by Martin Riedl's FFmpeg build
server. Their builds include GPL components such as libx264 and libx265. Distributions must
include the corresponding license notices and satisfy the source-code and attribution
requirements that apply to the exact binaries being shipped.

- FFmpeg project: https://ffmpeg.org/
- FFmpeg 8.1.2 source: https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz
- License information: https://ffmpeg.org/legal.html
- Windows builds: https://www.gyan.dev/ffmpeg/builds/
- macOS and Linux builds: https://ffmpeg.martin-riedl.de/

## sharp and libvips

Image processing uses sharp and its libvips dependency.

- sharp: https://github.com/lovell/sharp
- libvips: https://github.com/libvips/libvips

The exact dependency versions used by a release are recorded in `pnpm-lock.yaml`.

## PDFium and qpdf

PDF page rendering and lossless PDF optimization use the bundled `@hyzyla/pdfium` and
`@neslinesli93/qpdf-wasm` packages. Review their upstream license files and the exact versions
recorded in `pnpm-lock.yaml` before distribution.

- PDFium wrapper: https://github.com/hyzyla/pdfium
- qpdf WASM package: https://github.com/neslinesli93/qpdf-wasm

## FontTools and fontkit

Font conversion, collection splitting, variable-font instancing, and subsetting use the bundled
`@web-alchemy/fonttools` and `fontkit` packages. The FontTools Python wheels and Pyodide runtime
are included transitively; review their licenses and the exact dependency tree before release.

- FontTools wrapper: https://github.com/web-alchemy/fonttools
- FontTools: https://github.com/fonttools/fonttools
- fontkit: https://github.com/foliojs/fontkit
