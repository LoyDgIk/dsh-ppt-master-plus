#!/usr/bin/env python3
"""
dsh-ppt-master-plus — LaTeX formula preview renderer (visual QA only).

Renders LaTeX to standalone SVG through a local TeX distribution
(`latex` / `pdflatex` / `xelatex`) plus `dvisvgm`.

READ THIS BEFORE USING THE OUTPUT
    These SVGs are **previews**. They are for a human (or a vision model) to
    check that an expression looks the way the author intended. They are NOT
    slide assets.

    Upstream ppt-master compiles each `data-pptx-inline-formula` /
    `data-pptx-replace-with="formula"` marker into editable Office Math, and
    its reference `references/native-formula.md` explicitly forbids the
    picture branch: "Never substitute a PNG, flatten structural math into
    ordinary text, hand-write OMML, or leave raw LaTeX visible."

    So: use this to verify, then author the native marker. Never place the
    rendered SVG into a slide.

Usage
    python3 latex_preview.py "\\frac{a}{b}" -o /tmp/f1.svg
    python3 latex_preview.py --manifest projects/demo/images/formula_manifest.json
    python3 latex_preview.py --manifest formula_manifest.json -o previews/ --font-size 14
    python3 latex_preview.py "E=mc^2" --compiler xelatex --json

Contract
    stdout, human mode : `OUTPUT: <absolute svg path>` (or one line per SVG)
    stdout, --json     : one JSON object
    exit               : 0 ok · 2 usage or missing toolchain · 1 render failure
                         · 4 partial success (manifest mode, some failed)

Environment
    PPT_MASTER_TEX_COMPILER   pin the compiler (latex | pdflatex | xelatex | lualatex)
    PPT_MASTER_DVISVGM        explicit path to dvisvgm

Dependencies
    A TeX distribution providing one of the compilers above plus `dvisvgm`.
    Python 3.9+ standard library only.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# `standalone` produces a tightly-cropped page; `preview` + border gives the
# SVG a little breathing room so strokes are not clipped at the viewBox edge.
LATEX_DOCUMENT = r"""\documentclass[preview,border={border}pt]{{standalone}}
\usepackage{{amsmath,amssymb,amsfonts}}
\usepackage{{mhchem}}
\begin{{document}}
$\displaystyle {body}$
\end{{document}}
"""

# TeX primitives that break compilation under `standalone` or are outside the
# math profile. Rejected up front so the error names the real cause instead of
# surfacing a cryptic TeX log.
FORBIDDEN = (
    r"\documentclass", r"\usepackage", r"\input", r"\include",
    r"\write", r"\openout", r"\read", r"\catcode", r"\def", r"\newcommand",
    r"\renewcommand", r"\loop", r"\repeat", r"\csname", r"\endcsname",
)

COMPILERS = ("latex", "pdflatex", "xelatex", "lualatex")
PDF_COMPILERS = {"pdflatex", "xelatex", "lualatex"}


class RenderError(RuntimeError):
    """A single formula failed to render."""


def find_compiler(preferred: str | None = None) -> tuple[str, str]:
    """Return (name, path) of an available TeX compiler."""
    if preferred:
        path = shutil.which(preferred)
        if path:
            return preferred, path
        raise RenderError(
            f"requested compiler {preferred!r} is not on PATH. "
            f"Available: {[c for c in COMPILERS if shutil.which(c)] or 'none'}"
        )
    for candidate in COMPILERS:
        path = shutil.which(candidate)
        if path:
            return candidate, path
    raise RenderError(
        "no TeX compiler found. Install MiKTeX (https://miktex.org) or TeX Live "
        "(https://tug.org/texlive) and make sure latex/pdflatex/xelatex is on PATH."
    )


def find_dvisvgm() -> str:
    """Return the dvisvgm path."""
    override = os.environ.get("PPT_MASTER_DVISVGM")
    if override and Path(override).is_file():
        return override
    path = shutil.which("dvisvgm")
    if path:
        return path
    raise RenderError(
        "dvisvgm not found. MiKTeX and TeX Live both ship it; install one and "
        "make sure dvisvgm is on PATH."
    )


def validate_latex(latex: str) -> str:
    """Reject LaTeX that must not reach the preview renderer."""
    body = latex.strip()
    if not body:
        raise RenderError("empty LaTeX body")
    for token in FORBIDDEN:
        if token in body:
            raise RenderError(f"{token} is not allowed in a formula body")
    # Strip one complete outer delimiter pair, matching upstream's marker rule.
    for opening, closing in (("$$", "$$"), (r"\[", r"\]"), (r"\(", r"\)"), ("$", "$")):
        if body.startswith(opening) and body.endswith(closing) and len(body) > len(opening) + len(closing):
            body = body[len(opening):-len(closing)].strip()
            break
    return body


def run_quiet(command: list[str], cwd: Path, timeout: int = 120) -> subprocess.CompletedProcess:
    """Run a subprocess with captured output and a timeout."""
    return subprocess.run(
        command,
        cwd=str(cwd),
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        timeout=timeout,
        check=False,
    )


def render_one(latex: str, destination: Path, *, compiler: str, dvisvgm: str,
               font_size: int, border: int) -> None:
    """Compile one LaTeX formula to an SVG file."""
    body = validate_latex(latex)
    destination.parent.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="dsh-ppt-latex-") as raw:
        work = Path(raw)
        (work / "formula.tex").write_text(
            LATEX_DOCUMENT.format(body=body, border=border), encoding="utf-8"
        )

        source = run_quiet([compiler, "-interaction=nonstopmode", "-halt-on-error", "formula.tex"], work)
        if source.returncode != 0:
            log_tail = (source.stdout or "") + (source.stderr or "")
            raise RenderError(f"{compiler} failed:\n{tail(log_tail)}")

        # latex emits .dvi; the pdf-based engines emit .pdf for dvisvgm to read.
        produced = work / ("formula.pdf" if compiler in PDF_COMPILERS else "formula.dvi")
        if not produced.is_file():
            raise RenderError(f"{compiler} produced no {produced.suffix} output")

        args = [
            dvisvgm,
            "--no-fonts",
            "--exact",
            f"--font-format=woff2",
            "--scale=1.0",
            str(produced),
        ]
        converted = run_quiet(args, work)

        # Older dvisvgm builds reject --font-format; retry without it rather
        # than failing a render over a purely cosmetic flag.
        if converted.returncode != 0:
            converted = run_quiet([dvisvgm, "--no-fonts", "--exact", str(produced)], work)
        if converted.returncode != 0:
            raise RenderError(f"dvisvgm failed:\n{tail((converted.stdout or '') + (converted.stderr or ''))}")

        candidates = sorted(work.glob("*.svg"))
        if not candidates:
            raise RenderError("dvisvgm produced no SVG")
        svg = candidates[0].read_text(encoding="utf-8", errors="replace")

    # `--no-fonts` turns glyphs into paths; stamp the intended point size so the
    # preview is at least self-describing about the size it was checked at.
    svg = re.sub(r"<svg\b", f'<svg data-preview-font-size="{font_size}"', svg, count=1)
    svg = (
        "<!-- PREVIEW ONLY - not a slide asset. Upstream ppt-master compiles the "
        "native formula marker to editable Office Math; a picture cannot be substituted. -->\n"
        + svg
    )
    destination.write_text(svg, encoding="utf-8")


def tail(text: str, lines: int = 12) -> str:
    """Last `lines` non-empty lines of a TeX log."""
    kept = [line for line in text.splitlines() if line.strip()]
    return "\n".join(kept[-lines:])


def sanitize(name: str) -> str:
    """Make a safe file stem."""
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", name).strip("_.")
    return cleaned[:60] or "formula"


def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser."""
    parser = argparse.ArgumentParser(
        prog="latex_preview.py",
        description=(
            "Render LaTeX formulas to SVG for VISUAL QA ONLY. The result is never a slide "
            "asset — upstream compiles native formula markers to editable Office Math."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python3 latex_preview.py "\\\\frac{a}{b}" -o previews/f1.svg
  python3 latex_preview.py --manifest projects/demo/images/formula_manifest.json -o previews/
""",
    )
    parser.add_argument("latex", nargs="?", help="A LaTeX expression to render.")
    parser.add_argument(
        "--manifest",
        help="Render every formula whose manifest entry has \"include\": true.",
    )
    parser.add_argument("-o", "--output", help="Output .svg file, or a directory in manifest mode.")
    parser.add_argument("--compiler", help="Pin the TeX compiler (latex|pdflatex|xelatex|lualatex).")
    parser.add_argument("--font-size", type=int, default=12, help="Recorded preview point size. Default: 12")
    parser.add_argument("--border", type=int, default=2, help="standalone border in pt. Default: 2")
    parser.add_argument("--json", action="store_true", help="Print a machine-readable result.")
    parser.add_argument("--check", action="store_true", help="Only report whether the toolchain is usable.")
    return parser


def configure_utf8_stdio() -> None:
    """
    Force UTF-8 on stdout/stderr.

    Windows consoles default to a legacy code page. Without this, LaTeX source
    containing CJK arrives mangled whenever the output is redirected or captured
    rather than printed to a terminal. Mirrors the convention upstream uses for
    its own CLI scripts.
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

    env_compiler = args.compiler or os.environ.get("PPT_MASTER_TEX_COMPILER") or None

    try:
        compiler, compiler_path = find_compiler(env_compiler)
        dvisvgm = find_dvisvgm()
    except RenderError as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        print(
            "[INFO] This is an optional QA step. The supported path for formulas is the "
            "upstream native marker, which needs no TeX at all.",
            file=sys.stderr,
        )
        return 2

    if args.check:
        payload = {"compiler": compiler, "compilerPath": compiler_path, "dvisvgm": dvisvgm}
        print(json.dumps({"ok": True, **payload}, ensure_ascii=False) if args.json
              else f"[OK] {compiler} -> {compiler_path}\n[OK] dvisvgm -> {dvisvgm}")
        return 0

    jobs: list[tuple[str, str]] = []

    if args.manifest:
        manifest_path = Path(args.manifest).expanduser()
        if not manifest_path.is_file():
            print(f"[ERROR] manifest not found: {manifest_path}", file=sys.stderr)
            return 2
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            print(f"[ERROR] cannot read manifest: {exc}", file=sys.stderr)
            return 2

        selected = [
            entry for entry in manifest.get("formulas", [])
            if isinstance(entry, dict) and entry.get("include")
        ]
        if not selected:
            print(
                "[ERROR] no manifest entry has \"include\": true. Review formula_manifest.json "
                "and mark the formulas worth previewing.",
                file=sys.stderr,
            )
            return 2
        out_dir = Path(args.output).expanduser() if args.output else manifest_path.parent / "formula_previews"
        for index, entry in enumerate(selected, start=1):
            name = sanitize(str(entry.get("id") or f"formula_{index:02d}"))
            jobs.append((str(entry.get("latex") or ""), str(out_dir / f"{index:02d}_{name}.svg")))
    elif args.latex:
        if not args.output:
            print("[ERROR] -o is required when rendering a single expression", file=sys.stderr)
            return 2
        jobs.append((args.latex, args.output))
    else:
        print("[ERROR] provide a LaTeX expression or --manifest", file=sys.stderr)
        return 2

    results: list[dict] = []
    failures = 0
    for latex, destination in jobs:
        try:
            render_one(
                latex,
                Path(destination),
                compiler=compiler,
                dvisvgm=dvisvgm,
                font_size=args.font_size,
                border=args.border,
            )
            results.append({"latex": latex, "svg": str(Path(destination).resolve()), "ok": True})
            if not args.json:
                print(f"OUTPUT: {Path(destination).resolve()}")
        except (RenderError, subprocess.TimeoutExpired) as exc:
            failures += 1
            results.append({"latex": latex, "svg": destination, "ok": False, "error": str(exc)})
            print(f"[ERROR] {latex[:80]!r}: {exc}", file=sys.stderr)

    if args.json:
        print(json.dumps(
            {"ok": failures == 0, "rendered": len(results) - failures, "failed": failures,
             "compiler": compiler, "results": results},
            ensure_ascii=False,
        ))

    if failures and len(results) == failures:
        return 1
    if failures:
        return 4
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
