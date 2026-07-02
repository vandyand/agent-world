#!/usr/bin/env python
"""Enforce dependency direction across workspace components (polylith gate).

Rules (specs/agent-world-demo/implementation-plan.md, Phase 1):

  1. Components may NOT require any base namespace (agentworld.base.*).
  2. The engine component may require all components (it is the top of the
     component graph and exempt from rule 3).
  3. Pure components (world, persona, memory, recorder) may NOT require
     LLM components (inference, cognition, conversation, chronicle).

Parses (:require ...) / (require ...) forms from every component .lpy file
and matches required namespaces (hyphenated, as written in source) against
the forbidden prefixes for that component. Violations print and exit 1.

Run with: .venv/bin/python scripts/check_deps.py
"""

import glob
import os
import re
import sys

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

TOP_NS = "agentworld"

# Bricks with no LLM dependencies — must stay pure.
PURE_BRICKS = {"world", "persona", "memory", "recorder"}

# Bricks that talk to (or orchestrate) LLMs.
LLM_BRICKS = {"inference", "cognition", "conversation", "chronicle"}

REQUIRE_OPEN_RE = re.compile(r"\((?::require\b|require\b)")
NS_TOKEN_RE = re.compile(rf"{TOP_NS}[\w.\-]*")


def component_files():
    return sorted(
        glob.glob(
            os.path.join(REPO_ROOT, "components", "*", "src", "**", "*.lpy"),
            recursive=True,
        )
    )


def file_brick(path):
    """Return the component brick name a .lpy file belongs to."""
    rel = os.path.relpath(path, os.path.join(REPO_ROOT, "components"))
    return rel.split(os.sep)[0]


def file_namespace(path):
    """Compute the (hyphenated) namespace a component .lpy file defines."""
    parts = path.split(os.sep)
    src_idx = parts.index("src")
    rel = parts[src_idx + 1 :]
    mod = ".".join(rel)[: -len(".lpy")]
    return mod.replace("_", "-")


def strip_comments(text):
    return re.sub(r";[^\n]*", "", text)


def require_blocks(text):
    """Yield the text of each (:require ...)/(require ...) form (balanced parens)."""
    for m in REQUIRE_OPEN_RE.finditer(text):
        start = m.start()
        depth = 0
        for i in range(start, len(text)):
            ch = text[i]
            if ch == "(":
                depth += 1
            elif ch == ")":
                depth -= 1
                if depth == 0:
                    yield text[start : i + 1]
                    break


def required_namespaces(text):
    text = strip_comments(text)
    nses = set()
    for block in require_blocks(text):
        nses.update(NS_TOKEN_RE.findall(block))
    return nses


def forbidden_reason(brick, req):
    """Return a violation reason string, or None if the require is allowed."""
    # Rule 1: no component may require a base.
    if req.startswith(f"{TOP_NS}.base."):
        return "components may not require bases"
    # Rule 2: engine may require all components.
    if brick == "engine":
        return None
    # Rule 3: pure components may not require LLM components.
    if brick in PURE_BRICKS:
        for llm in LLM_BRICKS:
            if req == f"{TOP_NS}.{llm}" or req.startswith(f"{TOP_NS}.{llm}."):
                return f"pure component '{brick}' may not require LLM component '{llm}'"
    return None


def main():
    violations = []
    for path in component_files():
        brick = file_brick(path)
        own_ns = file_namespace(path)
        with open(path, encoding="utf-8") as f:
            text = f.read()
        for req in sorted(required_namespaces(text)):
            reason = forbidden_reason(brick, req)
            if reason:
                violations.append((own_ns, req, reason, path))

    if violations:
        print("check_deps: dependency direction violations:", file=sys.stderr)
        for own_ns, req, reason, path in violations:
            print(f"  {own_ns} requires {req} — {reason}  ({path})", file=sys.stderr)
        sys.exit(1)
    print(f"check_deps: {len(component_files())} component files OK")


if __name__ == "__main__":
    main()
