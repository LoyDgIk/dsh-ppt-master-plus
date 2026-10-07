# Data and page archetypes

Two sections, plus the decision that most affects what a data page can do
afterwards.

## §D — Data archetypes

This section is deliberately thin, because **upstream already owns quantitative
charts** and one rule should have one owner.

### D.1 Defer to upstream

Upstream ships 33 canonical references in `templates/charts/`, catalogued in
`templates/charts/chart-vocabulary.md` by encoded relationship, with the
authoring contract in `references/executor-chart.md`. Read those; they are the
authority and they are current.

| If the page encodes… | Use upstream's reference |
| --- | --- |
| Change over time | `chart/line_chart`, `chart/area_chart`, `chart/stacked_area_chart`, `chart/dual_axis_line_chart`, `chart/stock_chart`, `chart/waterfall_chart` |
| Category comparison and rank | `chart/column_chart`, `chart/horizontal_bar_chart`, `chart/grouped_bar_chart`, `chart/stacked_bar_chart`, `chart/butterfly_chart`, `chart/dumbbell_chart`, `chart/pareto_chart` |
| Target and progress | `chart/bullet_chart`, `chart/progress_bar_chart`, `chart/gauge_chart` |
| Distribution and multivariable | `chart/histogram_chart`, `chart/box_plot_chart`, `chart/scatter_chart`, `chart/bubble_chart`, `chart/heatmap_chart`, `chart/radar_chart`, `chart/matrix_2x2` |
| Part-to-whole and hierarchy | `chart/pie_chart`, `chart/donut_chart`, `chart/pie_of_pie_chart`, `chart/bar_of_pie_chart`, `chart/treemap_chart`, `chart/sunburst_chart` |
| Flow, schedule, weighted text | `chart/funnel_chart`, `chart/sankey_chart`, `chart/gantt_chart`, `chart/word_cloud` |

That is 33 of the forms a business deck needs. **Do not re-describe them here** —
a restated catalog is one upstream release away from being wrong.

### D.2 Forms upstream does not index

These are value-encoding forms absent from upstream's 33. They are still
*quantitative*, so they inherit upstream's value-driven authoring contract
(`references/executor-chart.md` §1): the geometry must be computed from the
values, not drawn by eye.

| key | 名称 | Answers | Data shape |
| --- | --- | --- | --- |
| `lollipop` | 棒棒糖图 | Rank with less ink than a bar chart | 4–12 categories, one value each |
| `waffle` | 华夫图 | What share, counted rather than measured? | A share out of a fixed grid (10×10 or 20×5) |
| `radial_bar` | 径向柱图 | Rank around a circle to save width | 6–16 categories on a radial axis |
| `calendar_heat` | 日历热力 | When does activity concentrate? | Dated values over weeks/months |
| `small_multiples` | 小多图 | Same chart, many segments — where do they differ? | 4–12 panels sharing one scale |
| `cohort_retention` | 同期群 | How does each cohort behave over time? | Cohorts × periods, one value per cell |
| `likert` | 李克特量表 | How does sentiment distribute? | 4–7 ordered response levels per item, summing to 100% |
| `deviation_bar` | 偏差图 | Who is above and below the reference? | Signed values against a stated baseline |
| `range_bar` | 区间图 | What range does each item span? | min / max (optionally a midpoint) per item |
| `liquid_level` | 液位图 | How full, as a physical metaphor? | One bounded value plus its capacity |
| `fan_forecast` | 扇形预测 | What is the range of possible futures? | Historical series + widening future interval |
| `control_chart` | 控制图 | Is this process behaving, or drifting? | Ordered values + centre line + control limits |
| `punch_card` | 打卡图 | When do events occur by hour and day? | Day × hour occurrence counts |
| `sparkline_table` | 火花表 | Trend inside a table row | Rows × a short ordered series each |
| `bullet_row` | 子弹行 | Many targets and actuals in little space | Rows × (actual, target, bands) |

**Six of these have a natural upstream neighbour** — a `deviation_bar` is a
`bar_chart` with a signed baseline; a `range_bar` is a `dumbbell_chart` with
no midpoint; a `coat`-style `small_multiples` panel is a repeated
`line_chart`. When a neighbour exists, prefer it and use upstream's reference:
fewer forms means less to get wrong.

### D.3 Page furniture that is not a chart

| key | 名称 | Answers | Data shape |
| --- | --- | --- | --- |
| `kpi_dashboard` | KPI 看板 | What is the state of the business at a glance? | 3–6 KPIs, each with value, unit, direction, and a comparison |
| `number_wall` | 数字墙 | How big is this, emphatically? | 3–8 large figures, each with a one-line meaning |
| `kpi_with_trend` | 指标趋势卡 | Is this metric moving well? | Value + prior period + a short series |
| `data_dictionary` | 数据口径 | How is this metric defined? | Metric, definition, source, refresh cadence, owner |
| `benchmark_strip` | 对标条 | How do we compare to the market? | Our value and peer values on one scale |

`data_dictionary` is the one to push for and the one most often skipped. A KPI
page whose figures have no stated definition, source or refresh cadence is not
reporting; it is decorating.

## §E — Page archetypes

Standard report pages. These are not charts; they are the pages a deck needs
around them.

| key | 名称 | Answers | Data shape |
| --- | --- | --- | --- |
| `cover` | 封面 | What is this deck? | Title, subtitle, author, date |
| `agenda` | 议程 | What will we cover? | 3–6 items, in delivery order |
| `toc` | 目录 | What is the structure? | Sections with page references |
| `section_divider` | 章节页 | Where are we? | Section number, title, one-line description |
| `feature_cards` | 特性卡 | What does each capability do? | 4–10 cards, equal weight, each name + one line |
| `numbered_list` | 清单 | What are the items? | 3–8 items with brief bodies |
| `checklist` | 行动清单 | What must be done, by whom, by when? | Action, owner, due date, status |
| `team_roster` | 团队页 | Who is involved? | People with role and one relevant credential |
| `role_matrix` | 角色矩阵 | Who does what across stages? | Roles × stages, RACI letters or symbols |
| `customer_voices` | 客户声音 | What do users actually say? | 3–6 quotes + attribution + context |
| `logos_wall` | 客户墙 | Who trusts us? | Logos, with sector and count |
| `faq` | FAQ | What will they ask? | Question–answer pairs, hardest first |
| `glossary` | 术语表 | What do these terms mean here? | Term + definition, alphabetised |
| `principles` | 原则 | What guides our decisions? | 3–7 principles, each with a trade-off |
| `annual_timeline` | 年度大事 | What happened this year? | Dated events, most significant marked |
| `resource_request` | 资源申请 | What do we need, and for what? | Ask, purpose, return, timing |
| `contact` | 联系页 | How do we reach you? | Contact details, placeholders for personal data |
| `closing` | 结尾页 | How does it end? | Closing statement + next step |
| `appendix` | 附录 | What backs the claims? | References, methodology, data notes |
| `attribution` | 来源页 | Where did the material come from? | Source, licence, and per-slide credits |

---

## Native chart or drawn geometry

The most consequential choice on a data page, and the one most often made by
accident. Upstream supports both; they are not equivalent.

| | **Native PowerPoint chart** | **Drawn geometry** |
| --- | --- | --- |
| What it is | A real chart object with an embedded workbook | Shapes and text positioned from the values |
| Data edits | Edit the sheet, the chart redraws | Redraw by hand, or re-run the pipeline |
| Reader can re-analyse | Yes — they can change a series | No; it is a picture made of shapes |
| Renders in WPS / LibreOffice / Keynote | Version-dependent | Identical everywhere |
| Exact visual control | Bounded by the chart engine | Complete |
| Best for | Figures the audience will interrogate; data that will be updated | Designed pages, precise composition, a fixed published artifact |

Upstream's own note applies here: the native path needs
`--native-charts-and-tables`, and a typed `chart`/`table` slot is filled by its
native-replacement marker.

**Ask, or decide deliberately.** The failure is not choosing one — it is
producing a drawn bar chart for an audience that expected to filter the data, or
a native chart for a page whose composition needed exact control.

A useful default: **native for the two or three charts the argument turns on,
drawn for the rest.** That keeps the interrogable figures alive without paying
the composition cost on every page.

### A note on "editable"

The reference chart library for this skill is built from **shape geometry** —
thousands of custom paths per slide, and no native chart objects at all. Its
"100% editable" claim is true in the shape sense: every element is a PowerPoint
shape or text box and can be moved, recoloured and retyped.

That is a legitimate choice for a **published, fixed** chart library. It is a
poor choice when the audience will want the underlying numbers, because there is
no data behind the picture. Make the choice on purpose; see the table above.
