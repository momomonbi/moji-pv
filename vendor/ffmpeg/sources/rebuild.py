#!/usr/bin/env python3
"""Verify and prepare the supplied FFmpeg WebAssembly source snapshots.

This build helper is MIT licensed. The sources it handles retain their licences.
No source code is fetched by this helper. Docker may obtain its standard compiler
image and OS build tools when --build is requested.
"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess
import tarfile


ROOT = Path(__file__).resolve().parent


def verify():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    for component in manifest["sources"]:
        archive = ROOT / component["archive"]
        if archive.stat().st_size != component["bytes"]:
            raise ValueError(f"Incorrect size: {archive.name}")
        if hashlib.sha256(archive.read_bytes()).hexdigest() != component["sha256"]:
            raise ValueError(f"Incorrect SHA-256: {archive.name}")
    return manifest


def prepare(destination, manifest):
    destination = destination.resolve()
    if destination.exists():
        raise ValueError("The build directory must not already exist")
    local = destination / "local"
    local.mkdir(parents=True)
    for component in manifest["sources"]:
        with tarfile.open(ROOT / component["archive"], "r:xz") as archive:
            archive.extractall(local, filter="data")

    # Restore the pinned Git submodules from the separately supplied snapshots.
    submodules = {
        "zimg-googletest": "zimg/test/extra/googletest",
        "emscripten-googletest": "emscripten/test/third_party/googletest",
        "emscripten-posixtestsuite": "emscripten/test/third_party/posixtestsuite",
        "emscripten-wasi-test-suite": "emscripten/test/third_party/wasi-test-suite",
    }
    for name, target in submodules.items():
        shutil.copytree(local / name, local / target, dirs_exist_ok=True, symlinks=True)

    upstream = local / "ffmpeg-wasm"
    for name in ("build", "src"):
        shutil.copytree(upstream / name, destination / name, symlinks=True)
    shutil.copy2(upstream / "Makefile", destination / "Makefile")

    dockerfile = (upstream / "Dockerfile").read_text()
    for component in manifest["sources"]:
        remote = re.escape("https://github.com/" + component["repo"] + ".git")
        dockerfile = re.sub(
            r"^ADD " + remote + r"#\S+ /src$",
            "COPY local/" + component["name"] + " /src",
            dockerfile,
            flags=re.MULTILINE,
        )
    dockerfile = dockerfile.replace(
        "RUN git clone --recursive -b $ZIMG_BRANCH "
        "https://github.com/sekrit-twc/zimg.git /src",
        "COPY local/zimg /src",
    )
    if re.search(r"^ADD https://github.com/|^RUN git clone ", dockerfile, re.MULTILINE):
        raise ValueError("An upstream source acquisition instruction was not replaced")

    # Use the supplied matching runtime and SDL port sources. Clearing the cache
    # allows modifications to these sources to participate in the next build.
    dockerfile = dockerfile.replace(
        "FROM emscripten/emsdk:3.1.40 AS emsdk-base\n",
        "FROM emscripten/emsdk:3.1.40 AS emsdk-base\n"
        "COPY local/emscripten /emsdk/upstream/emscripten\n"
        "COPY local/sdl2 /opt/source-sdl2\n"
        "ENV EMCC_LOCAL_PORTS=sdl2=/opt/source-sdl2\n"
        "RUN emcc --clear-cache\n",
    )
    (destination / "Dockerfile").write_text(dockerfile)
    return destination


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepare", type=Path, help="Create a new local Docker build directory")
    parser.add_argument("--build", action="store_true", help="Run make prd after --prepare")
    args = parser.parse_args()
    if args.build and args.prepare is None:
        parser.error("--build requires --prepare")
    manifest = verify()
    print(f"Verified {len(manifest['sources'])} pinned source archives")
    if args.prepare is not None:
        destination = prepare(args.prepare, manifest)
        print(f"Prepared {destination}")
        if args.build:
            subprocess.run(["make", "prd"], cwd=destination, check=True)


if __name__ == "__main__":
    main()
