#!/usr/bin/env python3
"""
dsh-ppt-master-plus — LaTeX formula extraction and pre-flight.

Scans an ingested source Markdown for LaTeX math and produces a
`formula_manifest.json`: the review artifact the scientific workflow uses to
decide, per formula, whether it becomes ordinary text, an inline native marker,
or a block native marker.

The manifest is a *planning* input. It is deliberately not a renderer: upstream
ppt-master already compiles LaTeX to editable Office Math through its own
`data-pptx-inline-formula` / `data-pptx-replace-with="formula"` markers (see
the upstream reference `references/native-formula.md`). Rendering formulas to
pictures would forfeit editability and is rejected by upstream's checker, so
this script never produces images.

What it adds on top of a plain regex scan:

  * stable ids, so a review decision survives re-running the extraction;
  * inline/display classification and a complexity score, which is what the
    inline-versus-block choice actually turns on;
  * a pre-flight against upstream's stated LaTeX acceptance rules — the
    unsupported-primitive and document-scaffolding commands that upstream says
    must be repaired *before* authoring, not discovered at export time.

Usage
    python3 formula_manifest.py <markdown_file>
    python3 formula_manifest.py projects/demo/sources/paper.md -o projects/demo/images/formula_manifest.json
    python3 formula_manifest.py paper.md --min-length 8 --json
    python3 formula_manifest.py paper.md --fail-on-unsupported   # CI gate

Contract
    stdout, human mode : `OUTPUT: <absolute manifest path>`
    stdout, --json     : one JSON object
    exit               : 0 ok · 2 usage error · 1 IO failure ·
                         3 unsupported LaTeX found (only with --fail-on-unsupported)

Dependencies
    Python 3.9+ standard library only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

MANIFEST_SCHEMA = "dsh-ppt-master-plus.formula-manifest.v1"
MANIFEST_VERSION = 1

# ────────────────────────────────────────────────────────────────
# LaTeX acceptance pre-flight
# ────────────────────────────────────────────────────────────────

# Document scaffolding and TeX primitives. Upstream compiles each marker's
# LaTeX through the Microsoft 365 LaTeX profile; these constructs are outside
# it and are the documented cause of a blocked page. Catch them at review time.
#
# `begin` / `end` are deliberately absent: the profile *does* accept math
# environments (matrix family, cases, aligned, array, CD, …). Environment names
# are validated separately below, because flagging `\begin{bmatrix}` would
# reject exactly the notation this skill exists to support.
UNSUPPORTED_COMMANDS = {
    "documentclass", "usepackage", "input", "include",
    "includegraphics", "def", "newcommand", "renewcommand", "providecommand",
    "let", "catcode", "hbox", "vbox", "halign", "valign", "write", "openout",
    "read", "csname", "endcsname", "expandafter", "noexpand", "aftergroup",
    "toks", "count", "dimen", "skip", "if", "else", "fi", "loop", "repeat",
    "pgfplots", "lstlisting", "verbatim", "html", "hypertarget",
}

# Math environments the Microsoft 365 LaTeX profile accepts. Sourced from
# upstream's stated contract: "matrix and equation-array environments".
SUPPORTED_ENVIRONMENTS = {
    "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix",
    "smallmatrix", "array", "cases", "rcases", "drcases", "aligned", "align",
    "align*", "alignedat", "gather", "gathered", "gather*", "split",
    "multline", "multline*", "eqnarray", "eqnarray*", "subarray", "CD",
    "equation", "equation*", "displaymath", "math", "dmath", "darray",
    "substack", "matrix*",
}

# Structural math that upstream's own trigger table routes to a *block* marker
# because it expands vertically and cannot fit a prose row.
BLOCK_ENVIRONMENTS = {
    "matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix",
    "smallmatrix", "cases", "rcases", "drcases", "aligned", "align", "align*",
    "alignedat", "array", "gather", "gathered", "gather*", "split",
    "multline", "multline*", "eqnarray", "subarray", "CD", "darray",
}

# Fraction / radical / n-ary / accent constructors: structural notation whose
# native height exceeds its flat preview, so adjacent content needs reserving.
STRUCTURAL_TOKENS = (
    "\\frac", "\\dfrac", "\\tfrac", "\\binom", "\\sqrt", "\\sum", "\\prod",
    "\\int", "\\iint", "\\oint", "\\lim", "\\partial", "\\overline",
    "\\underline", "\\hat", "\\widehat", "\\vec", "\\dot", "\\ddot",
    "\\tilde", "\\underset", "\\overset", "\\substack", "\\ce", "\\pu",
)

MATH_COMMAND_RE = re.compile(r"\\([A-Za-z]+)")

# `\begin{env}` needs the environment name, not the literal word "begin".
ENV_RE = re.compile(r"\\begin\{([^}]*)\}")

# Fenced code blocks are quoted source, not math: `math` / `latex` fences are
# math, every other fence is skipped so a code sample never yields markers.
FENCE_RE = re.compile(r"^(\s*)(`{3,}|~{3,})\s*([A-Za-z0-9_+-]*)\s*$")

MATH_FENCE_LANGUAGES = {"math", "latex", "tex", "katex", "mathjax"}


# ────────────────────────────────────────────────────────────────
# scanning
# ────────────────────────────────────────────────────────────────


def strip_code_fences(text: str) -> tuple[str, list[tuple[int, str]]]:
    """
    Blank out non-math fenced code blocks and return the math fences found.

    Returns (text with other fences blanked, [(line_number, body), ...]).
    Blanking preserves line numbering so reported line numbers stay truthful,
    which matters because the workflow quotes them back to the user.
    """
    lines = text.split("\n")
    output: list[str] = []
    math_blocks: list[tuple[int, str]] = []

    in_fence = False
    fence_marker = ""
    fence_is_math = False
    fence_start_line = 0
    buffer: list[str] = []

    for index, line in enumerate(lines, start=1):
        match = FENCE_RE.match(line)
        if match and not in_fence:
            in_fence = True
            fence_marker = match.group(2)[0] * 3
            language = (match.group(3) or "").lower()
            fence_is_math = language in MATH_FENCE_LANGUAGES
            fence_start_line = index
            buffer = []
            output.append("")
            continue

        if match and in_fence and line.strip().startswith(fence_marker):
            if fence_is_math and buffer:
                math_blocks.append((fence_start_line + 1, "\n".join(buffer)))
            in_fence = False
            fence_is_math = False
            buffer = []
            output.append("")
            continue

        if in_fence:
            if fence_is_math:
                buffer.append(line)
            output.append("")
            continue

        output.append(line)

    # An unterminated math fence still holds usable formulas.
    if in_fence and fence_is_math and buffer:
        math_blocks.append((fence_start_line + 1, "\n".join(buffer)))

    return "\n".join(output), math_blocks


# `$$ … $$` before `$ … $`; the display form must win or the split is wrong.
DISPLAY_DOLLAR_RE = re.compile(r"\$\$(.+?)\$\$", re.DOTALL)
BRACKET_RE = re.compile(r"\\\[(.+?)\\\]", re.DOTALL)
PAREN_RE = re.compile(r"\\\((.+?)\\\)", re.DOTALL)
# Deliberately conservative: no newline inside, no bare `$`, so prose with
# prices ("$5 and $7") does not register as math.
INLINE_DOLLAR_RE = re.compile(r"(?<![\\$])\$(?!\s)([^$\n]+?)(?<!\s)\$(?!\$)")


def find_formulas(text: str, min_length: int) -> list[dict]:
    """Extract every LaTeX formula from Markdown text."""
    blanked, math_fences = strip_code_fences(text)
    found: list[dict] = []

    def add(latex: str, display: bool, line: int, origin: str) -> None:
        cleaned = latex.strip()
        if len(cleaned) < min_length:
            return
        found.append({"latex": cleaned, "display": display, "line": line, "origin": origin})

    for pattern, display, origin in (
        (DISPLAY_DOLLAR_RE, True, "dollar-display"),
        (BRACKET_RE, True, "bracket-display"),
        (PAREN_RE, False, "paren-inline"),
        (INLINE_DOLLAR_RE, False, "dollar-inline"),
    ):
        for match in pattern.finditer(blanked):
            add(match.group(1), display, blanked.count("\n", 0, match.start()) + 1, origin)

    for line, body in math_fences:
        add(body, True, line, "math-fence")

    found.sort(key=lambda item: (item["line"], item["latex"]))
    return found


# ────────────────────────────────────────────────────────────────
# classification
# ────────────────────────────────────────────────────────────────


def classify(latex: str, display: bool) -> dict:
    """
    Score one formula and pre-flight it against upstream's acceptance rules.

    Returns `{complexity, suggestedMarker, unsupported[], unsupportedEnvironments[],
    blockEnvironments[], structural[], warnings[]}`.
    """
    compact = re.sub(r"\s+", "", latex)
    commands = MATH_COMMAND_RE.findall(latex)
    envs = ENV_RE.findall(latex)

    unsupported = sorted({c for c in commands if c in UNSUPPORTED_COMMANDS})
    # An environment outside the accepted set is a real blocker (typically
    # `document`, `tikzpicture`, or `verbatim` leaking in from the source).
    bad_envs = sorted({e for e in envs if e not in SUPPORTED_ENVIRONMENTS})
    block_envs = sorted({e for e in envs if e in BLOCK_ENVIRONMENTS})
    structural = sorted({token for token in STRUCTURAL_TOKENS if token in latex})

    warnings: list[str] = []
    if unsupported:
        warnings.append(
            "Unsupported TeX primitives present. Upstream compiles markers through the "
            "Microsoft 365 LaTeX profile, which rejects these — repair the LaTeX before "
            "authoring the marker. Never substitute a picture or flatten it to plain text."
        )
    if bad_envs:
        warnings.append(
            f"Unknown environment(s) {bad_envs}: the accepted profile covers the matrix and "
            "equation-array families only. Rewrite the expression without them."
        )
    if re.search(r"(?<!\\)%", latex):
        warnings.append("Unescaped '%' — it starts a LaTeX comment. Escape it as '\\%'.")
    if re.search(r"\$\$|\$", latex):
        warnings.append("Nested '$' delimiters — strip the outer pair; markers carry delimiter-free bodies.")
    if len(compact) > 400:
        warnings.append("Very long formula; consider splitting it across lines or moving it to a block marker.")

    # Upstream routes matrices, cases, aligned blocks and standalone
    # high-structure math to a block marker; one-line structural math that fits
    # its row is the inline case.
    if block_envs or not display and len(compact) > 120:
        suggested = "block"
    elif display and (structural or len(compact) > 90):
        suggested = "block"
    else:
        suggested = "inline"

    return {
        "complexity": len(compact),
        "suggestedMarker": suggested,
        "unsupported": unsupported,
        "unsupportedEnvironments": bad_envs,
        "blockEnvironments": block_envs,
        "structural": structural,
        "warnings": warnings,
    }


def formula_id(latex: str) -> str:
    """Stable short id, so a review decision survives re-extraction."""
    return "f" + hashlib.sha256(latex.encode("utf-8")).hexdigest()[:12]


def build_manifest(source: Path, formulas: list[dict]) -> dict:
    """Assemble the manifest payload, deduplicating identical formulas."""
    by_id: dict[str, dict] = {}
    occurrences: dict[str, list[int]] = {}

    for item in formulas:
        identifier = formula_id(item["latex"])
        occurrences.setdefault(identifier, []).append(item["line"])
        if identifier in by_id:
            # Same math, later occurrence: keep the first record, note the rest.
            entry = by_id[identifier]
            entry["occurrences"] = occurrences[identifier]
            if item["display"]:
                entry["display"] = True
            entry["origins"] = sorted({*entry.get("origins", []), item["origin"]})
            continue

        classified = classify(item["latex"], item["display"])
        by_id[identifier] = {
            "id": identifier,
            "latex": item["latex"],
            "display": item["display"],
            "origin": item["origin"],
            "origins": [item["origin"]],
            "line": item["line"],
            "occurrences": [item["line"]],
            **classified,
            # The reviewer flips this to approve authoring. Default false: a
            # formula is a deliberate inclusion, never an accident of parsing.
            "include": False,
            "placement": None,
        }

    entries = sorted(by_id.values(), key=lambda entry: entry["line"])
    unsupported_count = sum(
        1 for entry in entries if entry["unsupported"] or entry["unsupportedEnvironments"]
    )

    return {
        "schema": MANIFEST_SCHEMA,
        "version": MANIFEST_VERSION,
        "source": str(source.resolve()),
        "sourceName": source.name,
        "upstreamContract": "skills/ppt-master/references/native-formula.md",
        "counts": {
            "total": len(entries),
            "display": sum(1 for entry in entries if entry["display"]),
            "inline": sum(1 for entry in entries if not entry["display"]),
            "suggestedBlock": sum(1 for entry in entries if entry["suggestedMarker"] == "block"),
            "withUnsupportedLatex": unsupported_count,
        },
        "formulas": entries,
    }


def default_output_path(source: Path) -> Path:
    """Mirror upstream: prefer `<project>/images/`, else beside the source."""
    for parent in source.resolve().parents:
        if (parent / "sources").is_dir():
            return parent / "images" / "formula_manifest.json"
    return source.parent / "formula_manifest.json"


# ────────────────────────────────────────────────────────────────
# CLI
# ────────────────────────────────────────────────────────────────


def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser."""
    parser = argparse.ArgumentParser(
        prog="formula_manifest.py",
        description=(
            "Extract LaTeX formulas from a source Markdown into formula_manifest.json, "
            "classified for inline/block authoring and pre-flighted against the "
            "Microsoft 365 LaTeX profile upstream compiles with."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python3 formula_manifest.py projects/demo/sources/paper.md
  python3 formula_manifest.py paper.md -o projects/demo/images/formula_manifest.json
  python3 formula_manifest.py paper.md --fail-on-unsupported
""",
    )
    parser.add_argument("markdown", help="Source Markdown file to scan.")
    parser.add_argument("-o", "--output", help="Manifest path. Default: <project>/images/formula_manifest.json")
    parser.add_argument(
        "--min-length",
        type=int,
        default=3,
        help="Ignore formulas shorter than this many characters. Default: 3",
    )
    parser.add_argument(
        "--fail-on-unsupported",
        action="store_true",
        help="Exit 3 when any formula uses LaTeX outside the accepted profile (CI gate).",
    )
    parser.add_argument("--json", action="store_true", help="Print a machine-readable result.")
    return parser


def configure_utf8_stdio() -> None:
    """
    Force UTF-8 on stdout/stderr.

    Windows consoles default to a legacy code page. Without this, a manifest
    path or a warning containing CJK arrives mangled whenever the output is
    redirected or captured rather than printed to a terminal. Mirrors the
    convention upstream uses for its own CLI scripts.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass


def main(argv: list[str] | None = None) -> int:
    """Entry point."""
    configure_utf8_stdio()
    args = build_parser().parse_args(argv)

    source = Path(args.markdown).expanduser()
    if not source.is_file():
        print(f"[ERROR] markdown not found: {source}", file=sys.stderr)
        return 2

    try:
        text = source.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        print(f"[ERROR] cannot read {source}: {exc}", file=sys.stderr)
        return 1

    formulas = find_formulas(text, max(args.min_length, 1))
    manifest = build_manifest(source, formulas)
    output = Path(args.output).expanduser() if args.output else default_output_path(source)

    try:
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    except OSError as exc:
        print(f"[ERROR] cannot write {output}: {exc}", file=sys.stderr)
        return 1

    counts = manifest["counts"]
    print(
        f"[OK] {counts['total']} formula(s) "
        f"({counts['display']} display / {counts['inline']} inline; "
        f"{counts['suggestedBlock']} suggest a block marker)",
        file=sys.stderr,
    )
    if counts["withUnsupportedLatex"]:
        print(
            f"[WARN] {counts['withUnsupportedLatex']} formula(s) use LaTeX outside the accepted "
            "profile. Repair them before authoring markers.",
            file=sys.stderr,
        )
    print(f"   Wrote manifest -> {output}", file=sys.stderr)

    if args.json:
        print(json.dumps({"ok": True, "manifest": str(output.resolve()), **counts}, ensure_ascii=False))
    else:
        print(f"OUTPUT: {output.resolve()}")

    if args.fail_on_unsupported and counts["withUnsupportedLatex"]:
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
