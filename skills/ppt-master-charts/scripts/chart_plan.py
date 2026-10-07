#!/usr/bin/env python3
"""
dsh-ppt-master-plus — chart page plan validator.

Takes a `chart_plan.json` describing the pages of a deck (or a reusable chart
library) and checks the things a model reliably gets wrong when choosing and
specifying a visual form:

  1. **Archetype known.** Every page names a form from the catalog, or a
     `chart/<key>` reference owned by upstream.
  2. **Data-shape fit.** A funnel's stages must not increase; a waterfall's
     deltas must reconcile to its total; a share series must be non-negative;
     a quadrant needs both axes named; weights must sum. If the data cannot
     support the chosen form, say so before a slide is authored.
  3. **Arithmetic self-consistency.** Every figure a page *states* is recomputed
     from that page's own data. This is the design reference's rule ("结论里的
     数字必须能从数据算出来") turned into a gate instead of a good intention.
  4. **Craft counts.** Accent uses within the profile's limit, a stated
     conclusion present, every series item labelled.

Usage
    python3 chart_plan.py <project_path>/chart_plan.json
    python3 chart_plan.py chart_plan.json --json
    python3 chart_plan.py chart_plan.json --fail-on-issue      # CI gate
    python3 chart_plan.py chart_plan.json --profile blue-gray-business
    python3 chart_plan.py --init chart_plan.json               # write a skeleton

Contract
    stdout, human mode : a report; the last line is `RESULT: ok|warn|fail`
    stdout, --json     : one JSON object
    exit               : 0 clean · 1 issues found (with --fail-on-issue)
                         · 2 usage or IO error · 3 warnings only (with
                         --fail-on-issue)

Dependencies
    Python 3.9+ standard library only.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import sys
from pathlib import Path

PLAN_SCHEMA = "dsh-ppt-master-plus.chart-plan.v1"
PROFILE_SCHEMA = "dsh-ppt-master-plus.style-profile.v1"

HERE = Path(__file__).resolve().parent
SKILL_DIR = HERE.parent
PROFILE_DIR = SKILL_DIR / "assets" / "style-profiles"

# ────────────────────────────────────────────────────────────────
# knowledge: which archetypes exist, and what shape they require
# ────────────────────────────────────────────────────────────────

# Qualitative forms from references/archetype-catalog.md.
STRUCTURE_FORMS = {
    "radial_hub", "platform_stack", "honeycomb", "pyramid", "inverted_pyramid",
    "onion_layers", "iceberg", "umbrella", "jigsaw", "org_tree",
    "network_topology", "ecosystem_rings", "value_chain", "house_model",
    "pillar_columns", "three_legged_stool", "flywheel", "orbit", "gears",
    "bridge", "petal_model", "spiral", "mosaic", "modular_blocks",
    "tree_decomposition", "spectrum", "staircase", "satellite_constellation",
    "moat", "moat_layers", "lens", "nine_box", "totem", "venn",
}
PROCESS_FORMS = {
    "arrow_chain", "closed_loop", "chevron_process", "serpentine", "funnel",
    "dual_funnel", "hourglass", "timeline_h", "timeline_v",
    "dual_track_timeline", "swimlane", "decision_tree", "kanban", "stage_gate",
    "roadmap", "metro_map", "milestone_track", "lifecycle", "pdca",
    "value_stream", "waterfall_phases", "spiral_model", "five_whys", "sipoc",
    "escalation_ladder", "fork_merge", "branching_path", "relay_baton",
    "handoff_chain", "convergence", "countdown", "state_machine", "cpr_steps",
    "improvement_cycle", "numbered_steps",
}
COMPARISON_FORMS = {
    "side_by_side", "before_after", "current_vs_target", "swot", "option_cards",
    "scoring_matrix", "weighted_scorecard", "ranked_options", "pros_cons",
    "feature_table", "quadrant_2x2", "positioning_map", "bcg_matrix",
    "risk_matrix", "gap_analysis", "maturity_model", "harvey_balls",
    "strategy_canvas", "price_value_map", "pricing_tiers", "tco_comparison",
    "balance_scale", "trade_off_curve", "ab_test", "cost_benefit", "red_team",
    "build_buy_partner", "start_stop_continue", "do_nothing", "dimension_radar",
}
DATA_FORMS = {
    "lollipop", "waffle", "radial_bar", "calendar_heat", "small_multiples",
    "cohort_retention", "likert", "deviation_bar", "range_bar", "liquid_level",
    "fan_forecast", "control_chart", "punch_card", "sparkline_table",
    "bullet_row", "kpi_dashboard", "number_wall", "kpi_with_trend",
    "data_dictionary", "benchmark_strip",
}
PAGE_FORMS = {
    "cover", "agenda", "toc", "section_divider", "feature_cards",
    "numbered_list", "checklist", "team_roster", "role_matrix",
    "customer_voices", "logos_wall", "faq", "glossary", "principles",
    "annual_timeline", "resource_request", "contact", "closing", "appendix",
    "attribution",
}

CATALOG = STRUCTURE_FORMS | PROCESS_FORMS | COMPARISON_FORMS | DATA_FORMS | PAGE_FORMS

# Forms whose series is a progression and therefore must not increase.
NON_INCREASING_FORMS = {"funnel", "dual_funnel", "hourglass", "convergence", "cpr_steps"}
# Forms that require two named axes.
TWO_AXIS_FORMS = {"quadrant_2x2", "positioning_map", "bcg_matrix", "risk_matrix",
                  "price_value_map", "trade_off_curve", "nine_box"}
# Forms that require a genuine return edge.
LOOP_FORMS = {"closed_loop", "pdca", "flywheel", "improvement_cycle"}
# Forms whose stages must be ordered tiers.
TIER_FORMS = {"pyramid", "inverted_pyramid", "staircase", "maturity_model",
              "totem", "platform_stack", "onion_layers", "escalation_ladder"}
# Forms needing at least two parallel tracks/lanes.
MULTI_TRACK_FORMS = {"swimlane", "dual_track_timeline", "small_multiples",
                     "sparkline_table", "cohort_retention"}
# Forms comparing options across weighted criteria.
WEIGHTED_FORMS = {"scoring_matrix", "weighted_scorecard"}
# Share-based forms: parts should total ~100 when expressed as shares.
SHARE_FORMS = {"likert", "waffle", "pie_chart", "donut_chart", "waffle_chart"}

DEFAULT_MAX_ACCENTS = 2
DEFAULT_MIN_SIZE = 14

# ────────────────────────────────────────────────────────────────
# findings
# ────────────────────────────────────────────────────────────────


def configure_utf8_stdio() -> None:
    """
    Force UTF-8 on stdout/stderr.

    Windows consoles default to a legacy code page. Without this, diagnostics
    containing CJK labels or arrows arrive mangled whenever the output is
    redirected or captured rather than printed to a terminal — which is exactly
    how a CI job or a parent process consumes them. Mirrors the convention
    upstream uses for its own CLI scripts.
    """
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, OSError, ValueError):
            pass


class Report:
    """Collects findings and renders them."""
    def __init__(self) -> None:
        self.items: list[dict] = []

    def add(self, level: str, page: str, code: str, message: str) -> None:
        """Record one finding. level is 'error', 'warn' or 'info'."""
        self.items.append({"level": level, "page": page, "code": code, "message": message})

    def error(self, page: str, code: str, message: str) -> None:
        self.add("error", page, code, message)

    def warn(self, page: str, code: str, message: str) -> None:
        self.add("warn", page, code, message)

    def info(self, page: str, code: str, message: str) -> None:
        self.add("info", page, code, message)

    @property
    def errors(self) -> list[dict]:
        return [item for item in self.items if item["level"] == "error"]

    @property
    def warnings(self) -> list[dict]:
        return [item for item in self.items if item["level"] == "warn"]

    def render(self, use_color: bool) -> None:
        """Print the findings grouped by page."""
        glyph = {"error": "ERROR", "warn": "warn ", "info": "info "}
        order = {"error": 0, "warn": 1, "info": 2}
        for item in sorted(self.items, key=lambda i: (i["page"] or "", order[i["level"]])):
            page = f"[{item['page']}] " if item["page"] else ""
            print(f"  {glyph[item['level']]} {page}{item['message']}  ({item['code']})")
        if not self.items:
            print("  (no findings)")


# ────────────────────────────────────────────────────────────────
# helpers
# ────────────────────────────────────────────────────────────────


def close_enough(actual: float, expected: float, tolerance: float) -> bool:
    """Compare two numbers with an absolute tolerance."""
    return abs(actual - expected) <= max(tolerance, 1e-9)


def series_values(page: dict) -> list[float]:
    """Numeric values from a page's series, ignoring non-numeric entries."""
    out = []
    for item in page.get("series") or []:
        if isinstance(item, dict) and isinstance(item.get("value"), (int, float)):
            out.append(float(item["value"]))
    return out


def value_by_label(page: dict) -> dict[str, float]:
    """Map label → value for a page's series."""
    out: dict[str, float] = {}
    for item in page.get("series") or []:
        if isinstance(item, dict) and isinstance(item.get("value"), (int, float)):
            label = str(item.get("label") or "").strip()
            if label:
                out[label] = float(item["value"])
    return out


def fmt(number: float) -> str:
    """Format a number for a message."""
    if abs(number - round(number)) < 1e-9:
        return str(int(round(number)))
    return f"{number:g}"


def has_number(text: str) -> bool:
    """True when a string contains a digit."""
    return any(char.isdigit() for char in text or "")


# ────────────────────────────────────────────────────────────────
# checks
# ────────────────────────────────────────────────────────────────


def check_page_identity(page: dict, index: int, report: Report) -> str:
    """Check id/archetype/message presence. Returns the page label."""
    page_id = str(page.get("id") or f"page[{index}]")
    if not page.get("id"):
        report.warn(page_id, "no-id", "page has no id; using its index for reporting")
    if not page.get("archetype"):
        report.error(page_id, "no-archetype", "page names no archetype")
    if not page.get("message"):
        report.error(page_id, "no-message", "page has no one-sentence message")
    return page_id


def check_archetype(page: dict, page_id: str, report: Report) -> str:
    """Check the archetype is known. Returns it, lowercased."""
    archetype = str(page.get("archetype") or "").strip().lower()
    if archetype == "":
        return ""
    # Upstream-owned quantitative references pass through without shape checks.
    if archetype.startswith("chart/"):
        return archetype
    if archetype in CATALOG:
        return archetype
    report.error(
        page_id,
        "unknown-archetype",
        f"'{archetype}' is not in the catalog. Use a key from archetype-catalog.md or "
        f"data-archetypes.md, or an upstream reference as chart/<key>.",
    )
    return archetype


def check_message(page: dict, page_id: str, report: Report) -> None:
    """The message must be a claim, and its figures must be checkable."""
    message = str(page.get("message") or "")
    if message == "":
        return
    if not has_number(message):
        report.warn(
            page_id,
            "message-without-number",
            "the message carries no figure. A page whose claim has no number is often "
            "better as prose, or is missing the quantification that makes it a claim.",
        )
    topic_words = ("概览", "介绍", "情况", "overview", "introduction", "summary of", "关于")
    lowered = message.lower()
    for word in topic_words:
        if word in lowered:
            report.warn(
                page_id,
                "message-is-topic",
                f"the message reads like a topic ('{word}'): '{message[:48]}'. "
                "State what the audience should conclude instead.",
            )
            break


def check_shape(page: dict, archetype: str, page_id: str, report: Report) -> None:
    """Check the data can support the chosen form."""
    values = series_values(page)
    count = len(values)

    if archetype in NON_INCREASING_FORMS and count >= 2:
        for i in range(1, count):
            if values[i] > values[i - 1] + 1e-9:
                report.error(
                    page_id,
                    "shape-not-monotonic",
                    f"a {archetype} encodes loss through ordered stages, but values "
                    f"increase at position {i + 1} ({fmt(values[i - 1])} → {fmt(values[i])}). "
                    "Change the form or the data — do not bend the data.",
                )
                break

    if archetype in TIER_FORMS:
        tiers = page.get("tiers")
        if not isinstance(tiers, list) or len(tiers) < 3:
            report.error(
                page_id,
                "shape-needs-tiers",
                f"a {archetype} is an ordered hierarchy; supply 'tiers' with at least 3 "
                "ordered entries so the ordering is explicit.",
            )

    if archetype in TWO_AXIS_FORMS:
        axes = page.get("axes")
        if not isinstance(axes, list) or len(axes) < 2 or not all(str(a).strip() for a in axes[:2]):
            report.error(
                page_id,
                "shape-needs-axes",
                f"a {archetype} positions items on two dimensions; both axes must be "
                "named in 'axes' or the position is unreadable and unfalsifiable.",
            )

    if archetype in LOOP_FORMS and page.get("hasReturnEdge") is False:
        report.error(
            page_id,
            "shape-loop-without-return",
            f"a {archetype} asserts feedback; 'hasReturnEdge' is false. A ring drawn over a "
            "linear process claims causation that does not exist.",
        )

    if archetype in MULTI_TRACK_FORMS:
        tracks = page.get("tracks")
        if not isinstance(tracks, list) or len(tracks) < 2:
            report.error(
                page_id,
                "shape-needs-tracks",
                f"a {archetype} adds a dimension; supply 'tracks' with at least 2 entries, "
                "otherwise the extra dimension carries no information.",
            )

    if archetype in WEIGHTED_FORMS:
        weights = page.get("weights")
        if not isinstance(weights, dict) or len(weights) == 0:
            report.error(
                page_id,
                "shape-needs-weights",
                "a weighted score without weights is a tally masquerading as a decision.",
            )
        else:
            total = sum(float(w) for w in weights.values() if isinstance(w, (int, float)))
            if not close_enough(total, 1.0, 0.01) and not close_enough(total, 100.0, 0.5):
                report.error(
                    page_id,
                    "weights-do-not-sum",
                    f"weights total {fmt(total)}; they must sum to 1.0 or 100.",
                )

    if archetype == "venn":
        intersections = page.get("intersections")
        if not isinstance(intersections, list) or len(intersections) == 0:
            report.error(
                page_id,
                "shape-venn-empty",
                "a Venn whose intersection is unnamed is decoration. Supply 'intersections'.",
            )

    if archetype in SHARE_FORMS and page.get("valuesAreShares") is True and count >= 2:
        total = sum(values)
        if not close_enough(total, 100.0, 0.5):
            report.error(
                page_id,
                "shares-do-not-total",
                f"declared shares total {fmt(total)}%, not 100%. Parts must reconcile to the whole.",
            )

    # Non-negativity: only where a negative would be meaningless.
    if archetype in SHARE_FORMS | {"funnel", "dual_funnel", "waffle", "likert"}:
        for i, value in enumerate(values):
            if value < 0:
                report.error(
                    page_id,
                    "shape-negative",
                    f"position {i + 1} is negative ({fmt(value)}); parts and stage volumes "
                    "cannot be negative.",
                )
                break


def check_claims(page: dict, page_id: str, report: Report) -> None:
    """
    Recompute every figure the page states, from the page's own data.

    This is the check that matters most: an audience that catches one arithmetic
    inconsistency stops trusting every other number.
    """
    claims = page.get("claims")
    if not isinstance(claims, list) or len(claims) == 0:
        if series_values(page):
            report.warn(
                page_id,
                "no-claims",
                "the page carries data but states no claim about it. Add a 'claims' entry so "
                "the conclusion's figures are checked against the data.",
            )
        return

    by_label = value_by_label(page)
    values = series_values(page)

    for index, claim in enumerate(claims, start=1):
        if not isinstance(claim, dict):
            report.error(page_id, f"claim-{index}", "a claim must be an object")
            continue
        kind = str(claim.get("kind") or "").strip()
        text = str(claim.get("text") or kind or f"claim {index}")
        tolerance = float(claim.get("tolerance") or 0.5)
        expect = claim.get("expect")

        if kind == "sum":
            names = claim.get("of")
            if not isinstance(names, list) or len(names) == 0:
                report.error(page_id, f"claim-{index}", f"'{text}': a sum claim needs 'of': [labels]")
                continue
            missing = [n for n in names if n not in by_label]
            if missing:
                report.error(page_id, f"claim-{index}", f"'{text}': unknown series label(s) {missing}")
                continue
            actual = sum(by_label[n] for n in names)
            if expect is None:
                report.info(page_id, f"claim-{index}", f"'{text}': sums to {fmt(actual)}")
            elif not close_enough(actual, float(expect), tolerance):
                report.error(
                    page_id,
                    f"claim-{index}",
                    f"'{text}': states {fmt(float(expect))} but the data sums to {fmt(actual)}.",
                )

        elif kind == "share":
            name = claim.get("of")
            if not isinstance(name, str) or name not in by_label:
                report.error(page_id, f"claim-{index}", f"'{text}': share claim needs 'of': <label>")
                continue
            total = float(claim.get("total") or sum(values))
            if total == 0:
                report.error(page_id, f"claim-{index}", f"'{text}': cannot take a share of zero")
                continue
            actual = by_label[name] / total * 100.0
            if expect is None:
                report.info(page_id, f"claim-{index}", f"'{text}': {fmt(actual)}%")
            elif not close_enough(actual, float(expect), tolerance):
                report.error(
                    page_id,
                    f"claim-{index}",
                    f"'{text}': states {fmt(float(expect))}% but {name}/{fmt(total)} = {fmt(actual)}%.",
                )

        elif kind in ("delta", "ratio"):
            start_label, end_label = claim.get("from"), claim.get("to")
            if start_label not in by_label or end_label not in by_label:
                report.error(
                    page_id,
                    f"claim-{index}",
                    f"'{text}': needs 'from'/'to' naming series labels",
                )
                continue
            start, end = by_label[start_label], by_label[end_label]
            if kind == "delta":
                actual = end - start
            else:
                if start == 0:
                    report.error(page_id, f"claim-{index}", f"'{text}': ratio from zero is undefined")
                    continue
                actual = end / start
            if expect is None:
                report.info(page_id, f"claim-{index}", f"'{text}': {fmt(actual)}")
            elif not close_enough(actual, float(expect), tolerance):
                unit = "%" if not kind == "ratio" else "x"
                report.error(
                    page_id,
                    f"claim-{index}",
                    f"'{text}': states {fmt(float(expect))} but {kind} of the data is "
                    f"{fmt(actual)} (from {fmt(start)} to {fmt(end)}).",
                )

        elif kind == "count":
            if expect is None:
                report.info(page_id, f"claim-{index}", f"'{text}': {len(values)} item(s)")
            elif len(values) != int(expect):
                report.error(
                    page_id,
                    f"claim-{index}",
                    f"'{text}': states {int(expect)} items but the series has {len(values)}.",
                )

        elif kind == "monotonic":
            direction = str(claim.get("direction") or "non-increasing")
            pairs = list(zip(values, values[1:]))
            ok = all(a >= b - 1e-9 for a, b in pairs) if direction.startswith("non-inc") \
                else all(a <= b + 1e-9 for a, b in pairs)
            if not ok:
                report.error(page_id, f"claim-{index}", f"'{text}': the series is not {direction}.")

        elif kind == "total":
            actual = sum(values)
            if expect is None:
                report.info(page_id, f"claim-{index}", f"'{text}': total {fmt(actual)}")
            elif not close_enough(actual, float(expect), tolerance):
                report.error(
                    page_id,
                    f"claim-{index}",
                    f"'{text}': states {fmt(float(expect))} but the series totals {fmt(actual)}.",
                )

        else:
            report.warn(
                page_id,
                f"claim-{index}",
                f"'{text}': unknown claim kind '{kind}'. Supported: sum, share, delta, ratio, "
                "count, monotonic, total.",
            )


def check_craft(page: dict, page_id: str, report: Report, profile: dict) -> None:
    """The countable parts of craft rules 1, 2 and 4."""
    max_accents = int(profile.get("rules", {}).get("maxAccentUsesPerPage", DEFAULT_MAX_ACCENTS))
    accents = page.get("accentUses")
    if isinstance(accents, int):
        if accents > max_accents:
            report.error(
                page_id,
                "accent-overuse",
                f"{accents} accent uses; the profile allows {max_accents}. An accent that marks "
                "three things marks nothing — demote one.",
            )
    elif page.get("archetype") not in PAGE_FORMS:
        report.warn(
            page_id,
            "accent-unknown",
            "no 'accentUses' count; the accent limit cannot be checked on this page.",
        )

    series = page.get("series") or []
    if isinstance(series, list) and len(series) > 0:
        unlabelled = [
            i + 1 for i, item in enumerate(series)
            if not isinstance(item, dict) or not str(item.get("label") or "").strip()
        ]
        if unlabelled:
            report.error(
                page_id,
                "unlabelled-series",
                f"series position(s) {unlabelled} have no label. Every graphic element carries "
                "its own name where it stands; a legend makes the reader hunt.",
            )

    if not page.get("conclusion") and page.get("archetype") not in {"cover", "closing", "contact", "appendix"}:
        report.warn(
            page_id,
            "no-conclusion",
            "no 'conclusion' string. Every page should carry one statement the audience can "
            "read at a glance, even when it repeats the message in shorter form.",
        )


def check_library(pages: list[dict], report: Report) -> None:
    """Checks that apply to the plan as a whole."""
    if len(pages) == 0:
        report.error("", "empty-plan", "the plan contains no pages")
        return

    seen: dict[str, str] = {}
    for page in pages:
        if not isinstance(page, dict):
            continue
        page_id = str(page.get("id") or "")
        archetype = str(page.get("archetype") or "").lower()
        if archetype == "":
            continue
        if archetype in seen:
            report.warn(
                page_id,
                "archetype-reused",
                f"'{archetype}' is also used by page '{seen[archetype]}'. Reuse is fine for a "
                "long deck; in a chart library, repeated forms defeat the point.",
            )
        else:
            seen[archetype] = page_id

    ids = [str(p.get("id")) for p in pages if isinstance(p, dict) and p.get("id")]
    duplicates = {i for i in ids if ids.count(i) > 1}
    for duplicate in sorted(duplicates):
        report.error(duplicate, "duplicate-id", f"page id '{duplicate}' appears more than once")


# ────────────────────────────────────────────────────────────────
# profile
# ────────────────────────────────────────────────────────────────


def load_profile(name: str | None) -> tuple[dict, str | None]:
    """Load a style profile by id, or the neutral default."""
    if not name:
        name = "neutral-default"
    candidate = Path(name)
    if not candidate.is_file():
        candidate = PROFILE_DIR / f"{name}.json"
    if not candidate.is_file():
        available = sorted(p.stem for p in PROFILE_DIR.glob("*.json")) if PROFILE_DIR.is_dir() else []
        raise FileNotFoundError(
            f"style profile '{name}' not found. Available: {available or '(none)'}"
        )
    profile = json.loads(candidate.read_text(encoding="utf-8"))
    schema = profile.get("schema")
    if schema != PROFILE_SCHEMA:
        raise ValueError(f"{candidate} has schema '{schema}', expected '{PROFILE_SCHEMA}'")
    return profile, candidate.stem


def check_profile(profile: dict, report: Report) -> None:
    """Validate the profile against its own schema guarantees."""
    ramp = profile.get("palette", {}).get("primaryRamp")
    if not isinstance(ramp, list) or len(ramp) < 4:
        report.error("", "profile-ramp", "primaryRamp needs at least 4 ordered steps to encode series")
    for entry in ramp or []:
        if not isinstance(entry, str) or not entry.startswith("#"):
            report.error("", "profile-ramp-format", f"ramp entry '{entry}' is not a #hex colour")
            break

    min_size = profile.get("typography", {}).get("minSize")
    if not isinstance(min_size, (int, float)) or min_size < 10:
        report.error("", "profile-minsize", "typography.minSize must be set and at least 10")

    contrast = profile.get("rules", {}).get("minContrastRatio")
    if not isinstance(contrast, (int, float)) or contrast < 4.5:
        report.error(
            "",
            "profile-contrast",
            "rules.minContrastRatio must be at least 4.5 for body text",
        )

    # A profile must not carry form decisions.
    for banned in ("archetypes", "forms", "pages", "charts"):
        if banned in profile:
            report.error(
                "",
                "profile-carries-forms",
                f"the profile declares '{banned}'. A profile is style only; a form decision "
                "belongs in the catalog or in an upstream template workspace.",
            )


# ────────────────────────────────────────────────────────────────
# CLI
# ────────────────────────────────────────────────────────────────

SKELETON = {
    "schema": PLAN_SCHEMA,
    "profile": "neutral-default",
    "pages": [
        {
            "id": "p01",
            "archetype": "funnel",
            "message": "从线索到成单，转化率从 100% 收敛到 12%",
            "series": [
                {"label": "线索", "value": 1000},
                {"label": "商机", "value": 420},
                {"label": "报价", "value": 210},
                {"label": "成单", "value": 120},
            ],
            "claims": [
                {"kind": "share", "of": "成单", "total": 1000, "expect": 12,
                 "text": "整体转化 12%"},
            ],
            "conclusion": "每 8 条线索产生 1 个成单",
            "accentUses": 1,
            "styleProfile": "neutral-default",
        }
    ],
}


def build_parser() -> argparse.ArgumentParser:
    """Build the argument parser."""
    parser = argparse.ArgumentParser(
        prog="chart_plan.py",
        description=(
            "Validate a chart_plan.json: archetype knowledge, data-shape fit, arithmetic "
            "self-consistency of every stated figure, and countable craft rules."
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
examples:
  python3 chart_plan.py projects/demo/chart_plan.json
  python3 chart_plan.py chart_plan.json --json
  python3 chart_plan.py chart_plan.json --fail-on-issue
  python3 chart_plan.py chart_plan.json --profile blue-gray-business
  python3 chart_plan.py --init chart_plan.json
""",
    )
    parser.add_argument("plan", nargs="?", help="Path to chart_plan.json")
    parser.add_argument("--init", metavar="PATH", help="Write a skeleton plan to PATH and exit.")
    parser.add_argument("--profile", help="Style profile id or path. Default: neutral-default")
    parser.add_argument("--json", action="store_true", help="Print a machine-readable result.")
    parser.add_argument(
        "--fail-on-issue",
        action="store_true",
        help="Exit 1 on any error, 3 on warnings only (CI gate).",
    )
    parser.add_argument("--no-color", action="store_true", help="Disable ANSI colour.")
    return parser


def main(argv: list[str] | None = None) -> int:
    """Entry point."""
    configure_utf8_stdio()
    args = build_parser().parse_args(argv)

    if args.init:
        target = Path(args.init).expanduser()
        if target.exists():
            print(f"[ERROR] refusing to overwrite {target}", file=sys.stderr)
            return 2
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(SKELETON, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"[OK] wrote skeleton plan -> {target}")
        return 0

    if not args.plan:
        print("[ERROR] provide a plan path, or --init <path>", file=sys.stderr)
        return 2

    plan_path = Path(args.plan).expanduser()
    if not plan_path.is_file():
        print(f"[ERROR] plan not found: {plan_path}", file=sys.stderr)
        return 2

    try:
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        print(f"[ERROR] cannot read plan: {exc}", file=sys.stderr)
        return 2

    if not isinstance(plan, dict):
        print("[ERROR] the plan must be a JSON object", file=sys.stderr)
        return 2

    report = Report()

    if plan.get("schema") != PLAN_SCHEMA:
        report.warn(
            "",
            "plan-schema",
            f"schema is '{plan.get('schema')}', expected '{PLAN_SCHEMA}'. Continuing.",
        )

    profile_name = args.profile or plan.get("profile") or "neutral-default"
    try:
        profile, resolved = load_profile(profile_name)
    except (FileNotFoundError, ValueError, json.JSONDecodeError) as exc:
        print(f"[ERROR] {exc}", file=sys.stderr)
        return 2

    check_profile(profile, report)

    pages = plan.get("pages")
    if not isinstance(pages, list):
        print("[ERROR] the plan needs a 'pages' array", file=sys.stderr)
        return 2

    for index, page in enumerate(pages, start=1):
        if not isinstance(page, dict):
            report.error(f"page[{index}]", "bad-page", "a page must be an object")
            continue
        page_id = check_page_identity(page, index, report)
        archetype = check_archetype(page, page_id, report)
        check_message(page, page_id, report)
        if archetype and not archetype.startswith("chart/"):
            check_shape(page, archetype, page_id, report)
        check_claims(page, page_id, report)
        check_craft(page, page_id, report, profile)

    check_library([p for p in pages if isinstance(p, dict)], report)

    errors, warnings = len(report.errors), len(report.warnings)
    result = "fail" if errors else ("warn" if warnings else "ok")

    if args.json:
        print(json.dumps(
            {
                "ok": errors == 0,
                "result": result,
                "plan": str(plan_path.resolve()),
                "profile": resolved,
                "pages": len(pages),
                "errors": errors,
                "warnings": warnings,
                "findings": report.items,
            },
            ensure_ascii=False,
        ))
    else:
        print(f"chart plan: {plan_path.name}")
        print(f"profile   : {resolved}")
        print(f"pages     : {len(pages)}")
        print("")
        report.render(use_color=not args.no_color)
        print("")
        print(f"{errors} error(s), {warnings} warning(s)")
        print(f"RESULT: {result}")

    if args.fail_on_issue:
        if errors:
            return 1
        if warnings:
            return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
