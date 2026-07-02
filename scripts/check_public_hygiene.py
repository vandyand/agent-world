#!/usr/bin/env python
"""Public-artifact hygiene gate: refuse secrets and raw prompts in
anything that ships (replay JSONL, bases/server/resources/public/, dist/).

Scans every file given (dirs recurse) for:

  secret patterns
    - OpenRouter-style key literals:  sk-or-...
    - the OPENROUTER_API_KEY env var name (or its live value, if set in
      this process's environment)
    - api_key fields/assignments
  raw-prompt fields (should never survive the recorder sanitizer)
    - system_prompt / system-prompt fields
    - "messages" JSON fields (request payload shape)

Prints each hit as path:line:pattern and exits 1 on any hit; exits 0 clean.

Run with: .venv/bin/python scripts/check_public_hygiene.py <file-or-dir>...
"""

import os
import re
import sys

PATTERNS = [
    ("openrouter-key-literal", re.compile(r"sk-or-[A-Za-z0-9_\-]{8,}")),
    ("openrouter-env-name", re.compile(r"OPENROUTER_API_KEY")),
    ("api-key-field", re.compile(r"[\"']?api[_-]key[\"']?\s*[:=]")),
    ("raw-prompt-system", re.compile(r"[\"']?system[_-]prompt[\"']?\s*[:=]")),
    ("raw-prompt-messages", re.compile(r"[\"']messages[\"']\s*:")),
]

# The live key value, when present in this environment, must never appear
# in a public artifact either.
_env_key = os.environ.get("OPENROUTER_API_KEY")
if _env_key and len(_env_key) >= 8:
    PATTERNS.append(("openrouter-env-value", re.compile(re.escape(_env_key))))

SKIP_DIRS = {".git", "__pycache__", "node_modules", ".venv"}
SKIP_SUFFIXES = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff",
                 ".woff2", ".ttf", ".zip", ".lpyc", ".pyc"}


def iter_files(targets):
    for target in targets:
        if os.path.isdir(target):
            for root, dirs, files in os.walk(target):
                dirs[:] = [d for d in dirs if d not in SKIP_DIRS]
                for f in sorted(files):
                    yield os.path.join(root, f)
        else:
            yield target


def scan_file(path):
    """Yield (lineno, pattern_name) hits for one file."""
    if os.path.splitext(path)[1].lower() in SKIP_SUFFIXES:
        return
    try:
        with open(path, encoding="utf-8", errors="strict") as f:
            for lineno, line in enumerate(f, start=1):
                for name, rx in PATTERNS:
                    if rx.search(line):
                        yield lineno, name
    except (UnicodeDecodeError, OSError):
        return  # binary or unreadable — nothing textual to leak-check


def main(argv):
    if not argv:
        print("usage: check_public_hygiene.py <file-or-dir>...", file=sys.stderr)
        return 2

    hits = []
    checked = 0
    for path in iter_files(argv):
        if not os.path.exists(path):
            print(f"check_public_hygiene: no such path: {path}", file=sys.stderr)
            return 2
        checked += 1
        for lineno, name in scan_file(path):
            hits.append((path, lineno, name))

    if hits:
        print("check_public_hygiene: FAIL — leaked secrets/prompts:", file=sys.stderr)
        for path, lineno, name in hits:
            print(f"  {path}:{lineno}: {name}", file=sys.stderr)
        return 1

    print(f"check_public_hygiene: {checked} files OK")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
