# FFmpeg WebAssembly core: licences and corresponding sources

The optional in-browser AAC conversion uses **@ffmpeg/core 0.12.10**, the single-threaded
FFmpeg WebAssembly program, supplied as unmodified `ffmpeg-core.js` and `ffmpeg-core.wasm`.
The program includes GPL-enabled FFmpeg 5.1.4, libx264 and libx265 and is distributed under
**GPL-2.0-or-later**. Its [full GPLv2 licence](LICENSE.FFmpeg.txt),
[GPLv3 licence](LICENSE.GPLv3.txt), [linked-component notices](LICENSE.dependencies.txt)
and [MIT notice for the upstream ffmpeg.wasm binding/build sources](LICENSE.ffmpeg-wasm-MIT.txt)
are provided alongside the binaries. FreeType uses its GPLv2-or-later licence option.
The application source retains its existing MIT licence; the GPL program is loaded separately
in a Worker when local AAC conversion is requested.

## Source downloads

The downloadable source snapshots below are hosted **beside the distributed binaries**.
They include the preferred source form of FFmpeg and every linked library, the original
binding and build-control scripts, Emscripten's JavaScript and compiled runtime sources,
and its SDL2 port. The immutable commit and SHA-256 of each archive are recorded in
[manifest.json](sources/manifest.json) and [SHA256SUMS](sources/SHA256SUMS).
Each archive retains its upstream licence and per-file copyright notices.

The release source is upstream tag **v12.15**, commit
`71aa99d37c02a7b4c435275ca9ef50e612f6efa1` (2025-01-07). That tag releases
`@ffmpeg/core` 0.12.10. The similarly named tag `v0.12.10` releases core 0.12.6.
Dependency references are those in the release Dockerfile, resolved to immutable commits.
The moving `x264` `4-cores` and LAME `master` references were unchanged since 2022 and 2020,
respectively, and predate this release.

| Component | Upstream reference | Source archive | Size |
| --- | --- | --- | --- |
| ffmpeg | `n5.1.4` | [4729204c17f7](sources/ffmpeg-4729204c17f7.tar.xz) | 9.36 MiB |
| x264 | `4-cores` | [33cac6b77d5b](sources/x264-33cac6b77d5b.tar.xz) | 0.66 MiB |
| x265 | `3.4` | [2bb5520e9596](sources/x265-2bb5520e9596.tar.xz) | 0.94 MiB |
| vpx | `v1.13.1` | [10b9492dcf05](sources/vpx-10b9492dcf05.tar.xz) | 4.12 MiB |
| lame | `master` | [2badea1974ae](sources/lame-2badea1974ae.tar.xz) | 0.98 MiB |
| ogg | `v1.3.4` | [bada45718453](sources/ogg-bada45718453.tar.xz) | 0.21 MiB |
| theora | `v1.1.1` | [7ffd8b2ecfc2](sources/theora-7ffd8b2ecfc2.tar.xz) | 0.66 MiB |
| opus | `v1.3.1` | [e85ed7726db5](sources/opus-e85ed7726db5.tar.xz) | 0.53 MiB |
| vorbis | `v1.3.3` | [779816404319](sources/vorbis-779816404319.tar.xz) | 0.88 MiB |
| zlib | `v1.2.11` | [cacf7f1d4e3d](sources/zlib-cacf7f1d4e3d.tar.xz) | 0.45 MiB |
| webp | `v1.3.2` | [ca332209cb55](sources/webp-ca332209cb55.tar.xz) | 2.00 MiB |
| freetype | `VER-2-10-4` | [6a2b3e4007e7](sources/freetype-6a2b3e4007e7.tar.xz) | 1.35 MiB |
| fribidi | `v1.0.9` | [f9e8e71a6fbf](sources/fribidi-f9e8e71a6fbf.tar.xz) | 0.82 MiB |
| harfbuzz | `5.2.0` | [4a1d891c6317](sources/harfbuzz-4a1d891c6317.tar.xz) | 15.51 MiB |
| ass | `0.15.0` | [d149636f502f](sources/ass-d149636f502f.tar.xz) | 0.19 MiB |
| zimg | `release-3.0.5` | [e5b0de6bebbc](sources/zimg-e5b0de6bebbc.tar.xz) | 0.23 MiB |
| emscripten | `3.1.40` | [5c27e79dd0a9](sources/emscripten-5c27e79dd0a9.tar.xz) | 19.64 MiB |
| sdl2 | `release-2.24.2` | [55b03c7493a7](sources/sdl2-55b03c7493a7.tar.xz) | 5.18 MiB |
| ffmpeg-wasm | `v12.15` | [71aa99d37c02](sources/ffmpeg-wasm-71aa99d37c02.tar.xz) | 1.06 MiB |
| zimg-googletest | `703bd9caab50b139428cea1aaff9974ebee5742e` | [703bd9caab50](sources/zimg-googletest-703bd9caab50.tar.xz) | 0.59 MiB |
| emscripten-googletest | `4fb7039fda3f6588c7ca9664176f8c9e0a023b4a` | [4fb7039fda3f](sources/emscripten-googletest-4fb7039fda3f.tar.xz) | 0.58 MiB |
| emscripten-posixtestsuite | `869e266b090a8d44e51bb040904c942556b1e4ab` | [869e266b090a](sources/emscripten-posixtestsuite-869e266b090a.tar.xz) | 0.41 MiB |
| emscripten-wasi-test-suite | `ac9371207fc61972a21d7d086074ca690a99d14d` | [ac9371207fc6](sources/emscripten-wasi-test-suite-ac9371207fc6.tar.xz) | 0.48 MiB |

The four test-submodule snapshots restore the pinned zimg/Emscripten test directories.
Upstream ffmpeg.wasm's external `testdata` submodule is test media, is not compiled or
linked into the program, and is not needed to modify or build the distributed program.

## Rebuilding or modifying the program

Download all the archives and metadata in the table to one `sources/` directory,
together with [rebuild.py](sources/rebuild.py). Python 3.12 or later verifies the
checksums and prepares a build context from these local sources:

```sh
python3 sources/rebuild.py
python3 sources/rebuild.py --prepare /tmp/ffmpeg-core-rebuild
cd /tmp/ffmpeg-core-rebuild
make prd
```

`make prd` uses the supplied original release Makefile and build scripts with
`EXTRA_CFLAGS="-O3 -msimd128"` and `FFMPEG_ST=yes`. It requires Docker with Buildx,
Make, and access to the normal `emscripten/emsdk:3.1.40` compiler image and OS build tools.
The preparation helper substitutes local source directories for the upstream Dockerfile's
remote Git downloads and selects the supplied SDL2 port. It also installs the supplied
Emscripten runtime sources and clears the compiler's library cache so runtime modifications
are rebuilt. The original unmodified Dockerfile remains in the ffmpeg.wasm source archive.

Build outputs are `packages/core/dist/umd/ffmpeg-core.js` and `ffmpeg-core.wasm` in the
prepared directory. Modify the preferred source files under `local/`, or the binding/build
files under `src/` and `build/`, then run `make prd` again. The rebuild recipe has been
prepared and its source extraction checked; a complete compiler rebuild is not claimed
as a bit-for-bit reproducibility check of the npm artefact. Upstream build images and OS
package versions are not all pinned to content digests.

## Distribution

Keep the source archives, metadata, build helper, source index and licence files available
from the same distribution location as both binary files. They are source downloads and
are never fetched during conversion. The original application licence does not replace
the GPL or the other notices for this component. No copyright notice has been removed
from the supplied source archives.
