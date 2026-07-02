#!/usr/bin/env python
"""Compile-check every Basilisp namespace in the workspace.

Walks components/*/src and bases/*/src, computes each .lpy file's namespace
from its path, puts all src dirs on sys.path, then imports every namespace
via basilisp.main.init() + importlib.import_module (basilisp registers an
import hook; module name = namespace name with '-' -> '_').

Any import failure prints the namespace + traceback and exits 1.

Run with: .venv/bin/python scripts/compile_check.py
"""

import glob
import importlib
import os
import sys
import traceback

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def src_dirs():
    return sorted(
        glob.glob(os.path.join(REPO_ROOT, "components", "*", "src"))
        + glob.glob(os.path.join(REPO_ROOT, "bases", "*", "src"))
    )


def namespaces():
    """Yield (namespace, module, lpy_path) for every .lpy file under the src dirs."""
    for src in src_dirs():
        for path in sorted(
            glob.glob(os.path.join(src, "**", "*.lpy"), recursive=True)
        ):
            rel = os.path.relpath(path, src)
            mod = rel[: -len(".lpy")].replace(os.sep, ".")
            # Basilisp namespace name: underscores in path segments map to
            # hyphens in the ns; module import name keeps underscores.
            ns = mod.replace("_", "-")
            yield ns, mod, path


def main():
    dirs = src_dirs()
    for d in dirs:
        if d not in sys.path:
            sys.path.insert(0, d)

    import basilisp.main

    basilisp.main.init()

    failures = 0
    checked = 0
    for ns, mod, path in namespaces():
        checked += 1
        try:
            importlib.import_module(mod)
        except Exception:
            failures += 1
            print(f"COMPILE FAILURE: {ns} ({path})", file=sys.stderr)
            traceback.print_exc()
            print("-" * 72, file=sys.stderr)

    if failures:
        print(f"compile_check: {failures}/{checked} namespaces FAILED", file=sys.stderr)
        sys.exit(1)
    print(f"compile_check: {checked} namespaces OK")


if __name__ == "__main__":
    main()
