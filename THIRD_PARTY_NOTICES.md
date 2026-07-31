# Third-party notices

VVTools distributes or uses the following third-party software. This file is not a substitute for a legal review before distribution.

## FFmpeg and FFprobe

The packaged executables are supplied by the `ffmpeg-static` and `@derhuerst/ffprobe-static` packages. Their builds may include GPL components such as libx264. Distributions must include the corresponding license notices and satisfy the source-code and attribution requirements that apply to the exact binaries being shipped.

- FFmpeg project: https://ffmpeg.org/
- License information: https://ffmpeg.org/legal.html
- Static binary package: https://github.com/eugeneware/ffmpeg-static

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
