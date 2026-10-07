---
layout_id: academic_defense
kind: layout
category: scenario
summary: A structure-only 16:9 system for research decks — thesis defense, group meeting, journal club and conference talk — with a formula-tolerant content area and a figure-led page.
keywords: [academic, research, thesis, defense, paper, formula, conference]
canvas_format: ppt169
canvas_width: 1280
canvas_height: 720
canvas_viewbox: "0 0 1280 720"
replication_mode: standard
native_structure_mode: structured
page_count: 7
page_types:
  - cover
  - outline
  - section
  - content
  - two_column
  - figure_full
  - ending
placeholders:
  01_cover: ["{{TITLE}}", "{{SUBTITLE}}", "{{AUTHOR}}", "{{AFFILIATION}}", "{{DATE}}"]
  02_outline: ["{{PAGE_TITLE}}", "{{ITEM_1}}", "{{ITEM_2}}", "{{ITEM_3}}", "{{ITEM_4}}", "{{ITEM_5}}", "{{ITEM_6}}", "{{FOOTER_NOTE}}", "{{PAGE_NUM}}"]
  03_section: ["{{CHAPTER_NUM}}", "{{CHAPTER_TITLE}}", "{{CHAPTER_DESC}}", "{{PAGE_NUM}}"]
  04_content: ["{{PAGE_TITLE}}", "{{CONTENT_AREA}}", "{{KEY_MESSAGE}}", "{{SOURCE}}", "{{FOOTER_NOTE}}", "{{PAGE_NUM}}"]
  05_two_column: ["{{PAGE_TITLE}}", "{{LEFT_HEADING}}", "{{LEFT_CONTENT}}", "{{RIGHT_HEADING}}", "{{RIGHT_CONTENT}}", "{{KEY_MESSAGE}}", "{{SOURCE}}", "{{FOOTER_NOTE}}", "{{PAGE_NUM}}"]
  06_figure_full: ["{{PAGE_TITLE}}", "{{FIGURE_CAPTION}}", "{{CONTENT_AREA}}", "{{SOURCE}}", "{{FOOTER_NOTE}}", "{{PAGE_NUM}}"]
  07_ending: ["{{TITLE}}", "{{SUBTITLE}}", "{{CONTACT}}", "{{DATE}}"]
---

# Academic Defense — Design Specification

A structure-only layout system shaped by how research is actually presented. It
carries no identity: the palette values below are neutral preview values, and
typeface, final type scale, logo and voice are resolved downstream from a Brand,
a Deck, or the confirmation stage.

## IV. Signature Design Elements

**Two Masters, one rhythm.** A dark cover Master (`academic_defense_cover_master`)
carries the title and the closing page; a light body Master
(`academic_defense_body_master`) carries everything between them. The switch
marks the boundary between "framing" and "argument" without any decoration
saying so.

**Neutral preview palette.** Structure only; these are prototype values.

| Role | Value | Used for |
| --- | --- | --- |
| Cover ground | `#1E293B` | Cover and ending background |
| Body ground | `#FFFFFF` | Body page background |
| Rule | `#E2E8F0` | Header and footer hairlines |
| Primary text | `#1E293B` | Titles on light ground |
| Body text | `#475569` | Body content |
| Muted text | `#94A3B8` | Footer, page number, captions |
| Evidence bar | `#F1F5F9` | Key-message strip ground |
| Accent mark | `#64748B` | Cover accent rules, section numeral |

**Evidence-led page furniture.** Body pages reserve a strip above the footer for
a *key message* and a *source* line. A research deck's claim and its provenance
belong on the page, not only in the speaker's mouth — and reserving the space
structurally means it survives a hurried authoring pass rather than being
dropped when content runs long.

**Formula-tolerant content area.** `04_content` and `06_figure_full` give the
body a tall, uninterrupted region (464 px and 226 px respectively) so a block
formula marker — whose native ascent and descent exceed its flat preview — has
room to reserve its height without colliding with the key-message strip. The
inline case is handled inside prose; this is the layout's job only for block
math. See the SAT-sibling `ppt-master-sci` reference
`references/formula-planning.md`.

**One idea per page, one comparison per page.** `05_two_column` exists because
research presentation is dominated by matched pairs — method versus baseline,
before versus after, ours versus prior work. It is symmetric by construction so
neither side reads as subordinate.

**Figure-led page.** `06_figure_full` gives a figure the full content width above
a caption block, because in a research talk the figure *is* the argument and
prose is its annotation.

## V. Page Roster

| # | File | Layout key | `data-pptx-layout-name` | Picker name | Content shape | Slot behavior |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `01_cover.svg` | `cover` | Cover | Title page | Title, subtitle, author, affiliation, date | Title is the only heavy weight; affiliation sits directly under the author so the two read as one credit block |
| 2 | `02_outline.svg` | `outline` | Outline | Outline | Page title plus up to six numbered items | Six fixed rows; unused rows are dropped, not re-spaced, so the outline does not visually inflate |
| 3 | `03_section.svg` | `section` | Section | Section divider | Chapter numeral, title, one-line description | Numeral is layout art and not editable; it is the only place the accent colour appears at scale |
| 4 | `04_content.svg` | `content` | Title and Content | Content | Page title, one continuous block, key message, source | Body region is deliberately single-column and tall; a block formula reserves its own native height inside it |
| 5 | `05_two_column.svg` | `two_column` | Two Column | Two column | Page title, two headed columns, key message, source | Columns are equal width with a hairline divider; each column carries its own heading so neither is an orphan |
| 6 | `06_figure_full.svg` | `figure_full` | Figure | Figure page | Page title, full-width figure zone, caption, annotation, source | Figure zone is layout-owned width with no placeholder; the caption and annotation are editable so the reading of the figure is stated, not implied |
| 7 | `07_ending.svg` | `ending` | Ending | Closing | Title, subtitle, contact, date | Mirrors the cover Master so the deck closes on the frame it opened with |

## VII. Placeholder Overrides

None. Every page uses canonical placeholder names with no per-template override
map beyond the `placeholders:` frontmatter above.
