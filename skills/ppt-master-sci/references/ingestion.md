# Scientific source ingestion (MinerU)

## Why this step exists

Upstream's `scripts/source_to_md.py` dispatches a PDF to
`source_to_md/pdf_to_md.py`, which reads the PDF's text layer. On a
single-column, text-only PDF that is fine and you should just use it.

On the documents this skill targets it is not fine:

| Failure mode | What it costs downstream |
| --- | --- |
| Two-column layout read in stream order | Sentences interleave; the outline is nonsense |
| Display math flattened or dropped | Formulas cannot be planned, let alone made editable |
| Tables linearised | Chart values and comparison tables are wrong |
| Scanned pages with no text layer | Empty or near-empty output |
| Vector figures not separated | Figures cannot be referenced per slide |

MinerU (v3.1+) reconstructs reading order, tables and LaTeX. Since the deck's
content, its chart values and its formula markers all derive from this Markdown,
ingestion quality sets the ceiling for everything after it.

## Command

```bash
python3 <skill>/scripts/mineru_ingest.py <input> -o <project_path>/sources/<stem>.md
```

`<input>` may be PDF, DOCX, PPTX, XLSX, or an image. The script is
format-agnostic: it uploads what it is given and lets MinerU detect the type.

### Flags

| Flag | Effect |
| --- | --- |
| `-o, --output` | Output Markdown path. Default `<input dir>/<stem>.md`. Always ends in `.md`. |
| `--is-ocr` | Force OCR. Use for scanned PDFs and image-only pages. |
| `--language` | Language hint: `auto` (default), `en`, `ch`, `japan`, … |
| `--no-formula` | Disable formula recognition. Only if formulas are known absent. |
| `--no-table` | Disable table recognition. Rarely correct for a paper. |
| `--from-zip` | Treat `<input>` as an existing MinerU result archive; no API call. |
| `--base-url` | Override the API root. |
| `--poll-interval` | Seconds between status polls. Default 2. |
| `--timeout` | Seconds to wait for conversion. Default 300; raise for a long thesis. |
| `--json` | Print one JSON object instead of the `OUTPUT:` line. |

## Environment

Resolved in this order, first hit wins:

| Variable | Purpose |
| --- | --- |
| `DSH_MINERU_API_TOKEN` | Published by the `dsh-ppt-master-plus` plugin on every model shell call, resolved from the key saved in its settings page. **Prefer this** — it is the only path that needs no shell setup. |
| `MINERU_API_TOKEN` | Bearer token you export yourself. **Required** (via one of these names) unless `--from-zip`. |
| `MINERU_API_KEY`, `MINERU_TOKEN` | Accepted aliases. |
| `MINERU_API_BASE_URL`, `MINERU_BASE_URL` | API root. Default `https://mineru.net/api/v4`. |

A `.env` in the working directory or any parent is read for these keys, but an
already-set environment variable always wins. Get a token from
<https://mineru.net>.

### Configuring the token

**Preferred — in the app.** Open **插件 → dsh-ppt-master-plus** and paste the key.
It is stored in DSH's credential service (not a file), and the plugin republishes
it as `DSH_MINERU_API_TOKEN` on each shell call, so the script picks it up with
no further setup.

Only the official MinerU cloud API is supported; there is no provider picker and
no self-hosted base URL to configure.

**Fallback — from the shell.** If the plugin is not installed, export it:

```bash
export MINERU_API_TOKEN=...        # or put it in a .env file
```

Note that writing it into a `.env` leaves a plaintext secret on disk, which is
why the settings page is preferred.

## Outputs

```text
<project_path>/sources/<stem>.md              # the document
<project_path>/sources/<stem>_files/          # figures, when any were found
<project_path>/sources/<stem>_files/image_manifest.json
```

The `_files/` sibling is upstream's own convention — upstream already expects
`<stem>_files/image_manifest.json` beside a converted source, so the ingested
document lands in the shape the rest of the pipeline reads.

Image references are rewritten to `../<stem>_files/<name>` regardless of how
MinerU emitted them (`images/x.png`, `./images/x.png`, an absolute path), so the
Markdown is position-independent.

stdout carries exactly one line, `OUTPUT: <absolute path>`. That matches
upstream's `source_to_md.py`, so a caller can parse either tool the same way.
Diagnostics go to stderr.

## Failure handling

| Exit | Meaning | What to do |
| --- | --- | --- |
| 0 | Converted | Continue to the formula plan |
| 2 | Usage or configuration error | Usually a missing token — read the message |
| 1 | API, network, or IO failure | Report it; do not silently downgrade |

The script never silently degrades. If Ingestion cannot run, **say so** and let
the user choose:

1. save a key in **插件 → dsh-ppt-master-plus**, then re-run (the plugin publishes
   it as `DSH_MINERU_API_TOKEN` on the next shell call);
2. export `MINERU_API_TOKEN` yourself, if the plugin is not installed;
3. provide an existing MinerU archive and use `--from-zip`;
4. accept upstream's `pdf_to_md.py` *knowingly*, with its known weaknesses.

Presenting option 3 as equivalent to MinerU is the failure mode to avoid: the
downstream formula plan and table values will be materially worse.

## Offline path — `--from-zip`

Fully offline and worth preferring when an archive already exists (a re-run, a
shared result, a locked-down machine):

```bash
python3 <skill>/scripts/mineru_ingest.py mineru_result.zip --from-zip \
  -o <project_path>/sources/paper.md
```

Archive entries are extracted with a zip-slip guard; entries whose path escapes
the extraction root are skipped.

## After ingestion

- Do **not** hand-edit the generated Markdown beyond fixing obvious OCR slips.
  The figure links and `image_manifest.json` are machine-owned.
- Keep the original file. Upstream's artifact contract treats converted-source
  originals under `sources/` as an archive, and the conversion profile sidecar
  as a pipeline artifact — not slide content.
- `sources/*_files/image_manifest.json` is a sidecar, not content. Upstream's
  own read policy excludes it from the content scan, so leave it alone.
- Next step: [formula planning](./formula-planning.md).
