#!/usr/bin/env python3
"""
dsh-ppt-master-plus — MinerU source ingestion.

Turns a scientific document (PDF / DOCX / PPTX / XLSX / image) into the exact
Markdown shape the upstream ppt-master pipeline already consumes, and drops the
extracted figures beside it:

    <project>/sources/<stem>.md
    <project>/sources/<stem>_files/<figure>.<ext>
    <project>/sources/<stem>_files/image_manifest.json

Why this exists as a *separate* skill rather than a patch to upstream:
upstream's own `scripts/source_to_md/pdf_to_md.py` is a text-layer extractor.
For formula-dense, two-column, table-heavy academic PDFs it loses structure.
MinerU reconstructs reading order, tables and LaTeX math, which is exactly the
input quality the rest of the deck pipeline depends on. The output is ordinary
Markdown, so upstream needs no knowledge of how it was produced.

Usage
    python3 mineru_ingest.py <file> -o <project>/sources/<stem>.md
    python3 mineru_ingest.py paper.pdf -o projects/demo/sources/paper.md
    python3 mineru_ingest.py paper.pdf -o projects/demo/sources/paper.md --is-ocr
    python3 mineru_ingest.py mineru_result.zip --from-zip -o sources/paper.md
    python3 mineru_ingest.py paper.pdf -o sources/paper.md --json

Contract
    stdout, human mode : `OUTPUT: <absolute markdown path>` (same line protocol
                         upstream's source_to_md.py uses, so a caller can parse
                         either tool identically)
    stdout, --json     : one JSON object
    stderr             : diagnostics only
    exit               : 0 ok · 2 usage/config error · 1 upstream/IO failure

Environment
    MINERU_API_TOKEN | MINERU_API_KEY | MINERU_TOKEN
        Bearer token for the MinerU API. Required unless --from-zip.
        A `.env` file beside the current directory is read for these keys.
    MINERU_API_BASE_URL | MINERU_BASE_URL
        Override the API root. Default https://mineru.net/api/v4

Dependencies
    Python 3.9+ standard library only. No requests, no Pillow.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
import uuid
import zipfile
from pathlib import Path, PurePosixPath

DEFAULT_BASE_URL = "https://mineru.net/api/v4"
DEFAULT_POLL_INTERVAL_SECONDS = 2.0
DEFAULT_TIMEOUT_SECONDS = 300.0

TOKEN_ENV_KEYS = ("MINERU_API_TOKEN", "MINERU_API_KEY", "MINERU_TOKEN")
BASE_URL_ENV_KEYS = ("MINERU_API_BASE_URL", "MINERU_BASE_URL")

# Extensions MinerU accepts. The list is advisory only: this script uploads
# whatever it is given and lets MinerU's own detector decide.
SUPPORTED_SUFFIXES = {".pdf", ".docx", ".doc", ".pptx", ".ppt", ".xlsx", ".xls", ".png", ".jpg", ".jpeg"}

IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".bmp", ".gif", ".tiff", ".tif"}


# ────────────────────────────────────────────────────────────────
# diagnostics
# ────────────────────────────────────────────────────────────────


def log(message: str) -> None:
    """Write a diagnostic line to stderr (keeps stdout machine-parseable)."""
    print(message, file=sys.stderr)


def fail(message: str, code: int = 1) -> "NoReturn":  # noqa: F821 - typing only
    """Print an error to stderr and exit."""
    print(f"[ERROR] {message}", file=sys.stderr)
    raise SystemExit(code)


# ────────────────────────────────────────────────────────────────
# configuration
# ────────────────────────────────────────────────────────────────


def strip_inline_comment(value: str) -> str:
    """Remove a trailing ` # comment` from an unquoted .env value."""
    out = []
    quote = ""
    for index, char in enumerate(value):
        if quote:
            if char == quote:
                quote = ""
            out.append(char)
            continue
        if char in ("'", '"') and (index == 0 or value[index - 1] in (" ", "\t", "=")):
            quote = char
            continue
        if char == "#" and index > 0 and value[index - 1] in (" ", "\t"):
            break
        out.append(char)
    return "".join(out).strip()


def load_dotenv_keys(keys: tuple[str, ...]) -> None:
    """
    Populate `keys` from a .env in the current directory, or any parent.

    Existing environment variables always win: a shell export is a deliberate
    choice and must not be shadowed by a stray file.
    """
    if all(os.environ.get(key) for key in keys):
        return

    here = Path.cwd().resolve()
    for directory in (here, *here.parents):
        candidate = directory / ".env"
        if not candidate.is_file():
            continue
        try:
            text = candidate.read_text(encoding="utf-8", errors="replace")
        except OSError:
            return
        for line in text.splitlines():
            stripped = line.strip()
            if not stripped or stripped.startswith("#") or "=" not in stripped:
                continue
            name, _, raw = stripped.partition("=")
            name = name.strip()
            if name not in keys or os.environ.get(name):
                continue
            value = strip_inline_comment(raw.strip())
            if len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]
            if value:
                os.environ[name] = value
        return


def get_token() -> str:
    """Return the MinerU bearer token, or exit 2 with guidance."""
    load_dotenv_keys(TOKEN_ENV_KEYS)
    for key in TOKEN_ENV_KEYS:
        value = os.environ.get(key)
        if value and value.strip():
            return value.strip()
    fail(
        "MinerU API token is not configured. Set MINERU_API_TOKEN to a token "
        "from https://mineru.net, or pass --from-zip with an existing MinerU "
        "result archive to skip the API entirely.",
        2,
    )
    return ""  # unreachable


def get_base_url(override: str | None = None) -> str:
    """Return the MinerU API root without a trailing slash."""
    if override and override.strip():
        return override.strip().rstrip("/")
    load_dotenv_keys(BASE_URL_ENV_KEYS)
    for key in BASE_URL_ENV_KEYS:
        value = os.environ.get(key)
        if value and value.strip():
            return value.strip().rstrip("/")
    return DEFAULT_BASE_URL


# ────────────────────────────────────────────────────────────────
# http
# ────────────────────────────────────────────────────────────────


class ApiError(RuntimeError):
    """A MinerU API call returned an error payload or a transport failure."""


def http_json(url: str, *, method: str = "GET", body: object | None = None,
              token: str | None = None, timeout: float = 60.0) -> dict:
    """Call a JSON endpoint and return the decoded object."""
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = urllib.request.Request(url, data=data, method=method)
    request.add_header("Accept", "application/json")
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            payload = response.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise ApiError(f"HTTP {exc.code} from {url}: {detail[:400]}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"cannot reach {url}: {exc.reason}") from exc

    try:
        decoded = json.loads(payload)
    except json.JSONDecodeError as exc:
        raise ApiError(f"{url} did not return JSON: {payload[:200]}") from exc
    if not isinstance(decoded, dict):
        raise ApiError(f"{url} returned {type(decoded).__name__}, expected an object")
    return decoded


def api_error_message(payload: dict, fallback: str) -> str:
    """Extract a human message from a MinerU error envelope."""
    for key in ("msg", "message", "error", "err_msg"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    data = payload.get("data")
    if isinstance(data, dict):
        for key in ("msg", "message", "error"):
            value = data.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    code = payload.get("code")
    return f"{fallback} (code={code})" if code is not None else fallback


def upload_file(upload_url: str, path: Path) -> None:
    """PUT the raw bytes to MinerU's presigned URL. No Authorization header."""
    size = path.stat().st_size
    request = urllib.request.Request(upload_url, data=path.read_bytes(), method="PUT")
    request.add_header("Content-Type", "application/octet-stream")
    request.add_header("Content-Length", str(size))
    try:
        with urllib.request.urlopen(request, timeout=300.0) as response:
            if response.status not in (200, 201, 204):
                raise ApiError(f"upload returned HTTP {response.status}")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace") if exc.fp else ""
        raise ApiError(f"upload failed with HTTP {exc.code}: {detail[:300]}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"upload failed: {exc.reason}") from exc


def download_file(url: str, destination: Path) -> None:
    """Stream a URL to disk."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(url, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=300.0) as response, \
                open(destination, "wb") as handle:
            while True:
                chunk = response.read(1 << 16)
                if not chunk:
                    break
                handle.write(chunk)
    except urllib.error.HTTPError as exc:
        raise ApiError(f"download failed with HTTP {exc.code}: {url}") from exc
    except urllib.error.URLError as exc:
        raise ApiError(f"download failed: {exc.reason}") from exc


# ────────────────────────────────────────────────────────────────
# MinerU batch flow
# ────────────────────────────────────────────────────────────────


def request_upload_slot(
    base_url: str,
    token: str,
    path: Path,
    *,
    is_ocr: bool,
    language: str,
    enable_formula: bool,
    enable_table: bool,
) -> tuple[str, str]:
    """
    Ask MinerU for a batch id and a presigned upload URL.

    Returns (batch_id, upload_url).
    """
    payload = {
        "enable_formula": enable_formula,
        "enable_table": enable_table,
        "language": language,
        "files": [
            {
                "name": path.name,
                "is_ocr": is_ocr,
                "data_id": uuid.uuid4().hex[:16],
            }
        ],
    }
    response = http_json(f"{base_url}/file-urls/batch", method="POST", body=payload, token=token)
    data = response.get("data")
    if not isinstance(data, dict):
        raise ApiError(api_error_message(response, "MinerU did not return upload URLs"))
    batch_id = data.get("batch_id")
    urls = data.get("file_urls")
    if not isinstance(batch_id, str) or not batch_id:
        raise ApiError(api_error_message(response, "MinerU returned no batch_id"))
    if not isinstance(urls, list) or not urls:
        raise ApiError(api_error_message(response, "MinerU returned no upload URL"))
    first = urls[0]
    upload_url = first if isinstance(first, str) else (first or {}).get("url", "")
    if not isinstance(upload_url, str) or not upload_url:
        raise ApiError("MinerU returned an unusable upload URL")
    return batch_id, upload_url


def poll_for_result(base_url: str, token: str, batch_id: str, *,
                    poll_interval: float, timeout: float) -> str:
    """Poll the batch endpoint until it is done, then return the zip URL."""
    deadline = time.monotonic() + max(timeout, 1.0)
    url = f"{base_url}/extract-results/batch/{batch_id}"
    last_state = ""

    while True:
        if time.monotonic() > deadline:
            raise ApiError(
                f"timed out after {timeout:.0f}s waiting for MinerU batch {batch_id} "
                f"(last state: {last_state or 'unknown'}). Raise --timeout for a long document."
            )
        response = http_json(url, token=token)
        data = response.get("data")
        results = data.get("extract_result") if isinstance(data, dict) else None
        if not isinstance(results, list) or not results:
            raise ApiError(api_error_message(response, "MinerU returned no extraction results"))

        entry = results[0] if isinstance(results[0], dict) else {}
        state = str(entry.get("state") or "").strip().lower()
        if state != last_state:
            log(f"[INFO] MinerU state: {state or 'unknown'}")
            last_state = state

        if state in ("done", "success", "succeeded", "finished"):
            zip_url = entry.get("full_zip_url") or entry.get("zip_url") or ""
            if not isinstance(zip_url, str) or not zip_url:
                raise ApiError("MinerU finished but returned no result archive URL")
            return zip_url
        if state in ("failed", "fail", "error"):
            raise ApiError(f"MinerU extraction failed: {entry.get('err_msg') or entry.get('msg') or 'no detail'}")
        if state in ("pending", "running", "converting", "waiting", "queued", ""):
            time.sleep(max(poll_interval, 0.5))
            continue
        # An unrecognised state is not fatal on its own; keep polling and let
        # the deadline decide, rather than aborting a long conversion.
        time.sleep(max(poll_interval, 0.5))


def extract_archive(zip_url: str, work_dir: Path) -> Path:
    """Download the result archive and extract it into `work_dir`."""
    archive = work_dir / "mineru-result.zip"
    download_file(zip_url, archive)
    if archive.stat().st_size == 0:
        raise ApiError("the MinerU result archive is empty")

    target = work_dir / "bundle"
    target.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(archive) as handle:
        for member in handle.infolist():
            # Zip-slip guard: never let an archive entry escape the target.
            name = member.filename.replace("\\", "/")
            if name.startswith("/") or ".." in PurePosixPath(name).parts:
                continue
            handle.extract(member, target)
    return target


# ────────────────────────────────────────────────────────────────
# normalization
# ────────────────────────────────────────────────────────────────


def pick_markdown(bundle: Path) -> Path:
    """Choose the document Markdown out of a MinerU bundle."""
    candidates = [
        path
        for path in bundle.rglob("*.md")
        if not path.name.startswith("_") and "images" not in path.relative_to(bundle).parts[:1]
    ]
    if not candidates:
        candidates = [path for path in bundle.rglob("*.md")]
    if not candidates:
        raise ApiError(f"no Markdown file found inside the MinerU bundle at {bundle}")

    # Prefer a top-level file, then the largest (the body, not a stray readme).
    candidates.sort(key=lambda p: (len(p.relative_to(bundle).parts), -p.stat().st_size))
    return candidates[0]


def find_image_root(bundle: Path, markdown_path: Path) -> Path | None:
    """Locate the directory holding MinerU's extracted images."""
    sibling = markdown_path.parent / "images"
    if sibling.is_dir():
        return sibling
    for candidate in bundle.rglob("images"):
        if candidate.is_dir():
            return candidate
    for candidate in bundle.rglob("*"):
        if candidate.is_dir() and any(
            child.suffix.lower() in IMAGE_SUFFIXES for child in candidate.iterdir()
        ):
            return candidate
    return None


def normalize(bundle: Path, output: Path) -> dict:
    """
    Write `<output>` plus `<output>_files/` from an extracted MinerU bundle.

    Image links in the Markdown are rewritten to the sibling `_files/`
    directory so the document stays self-contained and the upstream pipeline
    (which looks for `<stem>_files/`) finds the figures where it expects them.
    """
    markdown_source = pick_markdown(bundle)
    text = markdown_source.read_text(encoding="utf-8", errors="replace")

    output.parent.mkdir(parents=True, exist_ok=True)
    assets = output.parent / f"{output.stem}_files"

    image_root = find_image_root(bundle, markdown_source)
    copied: list[dict] = []

    if image_root is not None:
        assets.mkdir(parents=True, exist_ok=True)
        for source in sorted(image_root.rglob("*")):
            if not source.is_file() or source.suffix.lower() not in IMAGE_SUFFIXES:
                continue
            destination = assets / source.name
            destination.write_bytes(source.read_bytes())
            copied.append(
                {
                    "filename": source.name,
                    "bytes": destination.stat().st_size,
                }
            )

    # MinerU emits links like `images/abc.jpg`, `./images/abc.jpg`, or an
    # absolute path. Normalize every form to `../<stem>_files/<name>` so the
    # reference is stable no matter where the bundle was unpacked.
    def rewrite(match: re.Match) -> str:
        alt, target = match.group(1), match.group(2)
        name = PurePosixPath(target.replace("\\", "/")).name
        if name == "":
            return match.group(0)
        return f"![{alt}](../{output.stem}_files/{name})"

    text = re.sub(r"!\[([^\]]*)\]\(([^)]+)\)", rewrite, text)

    output.write_text(text if text.endswith("\n") else f"{text}\n", encoding="utf-8")

    manifest = {
        "schema": "dsh-ppt-master-plus.image-manifest.v1",
        "source": "mineru",
        "markdown": output.name,
        "assetDirectory": assets.name,
        "images": copied,
    }
    if copied:
        (assets / "image_manifest.json").write_text(
            json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    return {
        "markdown": str(output.resolve()),
        "assetDirectory": str(assets.resolve()) if copied else None,
        "imageCount": len(copied),
        "characters": len(text),
        "sourceMarkdown": str(markdown_source),
    }


# ────────────────────────────────────────────────────────────────
# CLI
# ────────────────────────────────────────────────────────────────


def default_output_path(input_path: Path) -> Path:
    """Mirror upstream's default: `<input dir>/<stem>.md`."""
    return input_path.with_suffix(".md")


def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser."""
    parser = argparse.ArgumentParser(
        prog="mineru_ingest.py",
        description=(
            "Convert a scientific document to Markdown via MinerU, in the shape the "
            "ppt-master pipeline consumes (<stem>.md + <stem>_files/)."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python3 mineru_ingest.py paper.pdf -o projects/demo/sources/paper.md
  python3 mineru_ingest.py paper.pdf --is-ocr
  python3 mineru_ingest.py mineru_result.zip --from-zip -o sources/paper.md
  python3 mineru_ingest.py thesis.pdf -o sources/thesis.md --language en --json
""",
    )
    parser.add_argument("input", help="Source document, or a MinerU result .zip with --from-zip.")
    parser.add_argument("-o", "--output", help="Output Markdown path. Default: <input dir>/<stem>.md")
    parser.add_argument(
        "--from-zip",
        action="store_true",
        help="Treat the input as an already-downloaded MinerU result archive and skip the API.",
    )
    parser.add_argument("--is-ocr", action="store_true", help="Force OCR (scanned PDFs).")
    parser.add_argument(
        "--language",
        default="auto",
        help="Document language hint passed to MinerU (e.g. auto, en, ch, japan). Default: auto",
    )
    parser.add_argument("--no-formula", action="store_true", help="Disable MinerU formula recognition.")
    parser.add_argument("--no-table", action="store_true", help="Disable MinerU table recognition.")
    parser.add_argument(
        "--base-url", help=f"MinerU API root. Default: ${BASE_URL_ENV_KEYS[0]} or {DEFAULT_BASE_URL}"
    )
    parser.add_argument(
        "--poll-interval",
        type=float,
        default=DEFAULT_POLL_INTERVAL_SECONDS,
        help=f"Seconds between status polls. Default: {DEFAULT_POLL_INTERVAL_SECONDS}",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SECONDS,
        help=f"Seconds to wait for conversion. Default: {DEFAULT_TIMEOUT_SECONDS}",
    )
    parser.add_argument("--json", action="store_true", help="Print a machine-readable result.")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Entry point."""
    parser = build_parser()
    args = parser.parse_args(argv)

    input_path = Path(args.input).expanduser()
    if not input_path.is_file():
        fail(f"input not found: {input_path}", 2)

    output = Path(args.output).expanduser() if args.output else default_output_path(input_path)
    if output.suffix.lower() != ".md":
        output = output.with_suffix(".md")

    if not args.from_zip and input_path.suffix.lower() not in SUPPORTED_SUFFIXES:
        log(
            f"[WARN] {input_path.suffix or '(no extension)'} is outside the documented MinerU "
            f"set {sorted(SUPPORTED_SUFFIXES)}; uploading anyway."
        )

    import tempfile

    try:
        with tempfile.TemporaryDirectory(prefix="dsh-ppt-mineru-") as raw_work:
            work = Path(raw_work)

            if args.from_zip:
                if not zipfile.is_zipfile(input_path):
                    fail(f"--from-zip expects a .zip archive; {input_path} is not one", 2)
                log(f"[>>] extracting {input_path.name}")
                bundle = work / "bundle"
                bundle.mkdir(parents=True, exist_ok=True)
                with zipfile.ZipFile(input_path) as handle:
                    for member in handle.infolist():
                        name = member.filename.replace("\\", "/")
                        if name.startswith("/") or ".." in PurePosixPath(name).parts:
                            continue
                        handle.extract(member, bundle)
            else:
                token = get_token()
                base_url = get_base_url(args.base_url)
                log(f"[>>] MinerU {base_url} ← {input_path.name} ({input_path.stat().st_size:,} bytes)")
                batch_id, upload_url = request_upload_slot(
                    base_url,
                    token,
                    input_path,
                    is_ocr=args.is_ocr,
                    language=args.language,
                    enable_formula=not args.no_formula,
                    enable_table=not args.no_table,
                )
                log(f"[>>] uploading (batch {batch_id})")
                upload_file(upload_url, input_path)
                log("[>>] waiting for conversion")
                zip_url = poll_for_result(
                    base_url,
                    token,
                    batch_id,
                    poll_interval=args.poll_interval,
                    timeout=args.timeout,
                )
                log("[>>] downloading result archive")
                bundle = extract_archive(zip_url, work)

            result = normalize(bundle, output)

    except ApiError as exc:
        fail(str(exc), 1)
        return 1
    except OSError as exc:
        fail(f"file system error: {exc}", 1)
        return 1

    log(f"[OK] Saved Markdown to: {output}")
    if result["imageCount"]:
        log(f"   Wrote {result['imageCount']} figure(s) -> {result['assetDirectory']}")

    if args.json:
        print(json.dumps({"ok": True, **result}, ensure_ascii=False))
    else:
        print(f"OUTPUT: {result['markdown']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
