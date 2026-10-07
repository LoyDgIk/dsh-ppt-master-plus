# dsh-ppt-master-plus

把 [ppt-master](https://github.com/hugohe3/ppt-master) 封装为可安装的
DeepSeek Harness 插件，并在**不改动上游任何一个文件**的前提下，叠加科研／学术能力。

整个设计只取决于一个决定：上游是 **git submodule**，既不是 vendored 副本，也不是 fork。

```text
dsh-ppt-master-plus/
├── index.js                 DSH 入口：skills provider + MinerU 凭据桥
├── dsh/client.js            浏览器半边：MinerU API Key 设置页
├── cordis.patch.yml         挂载插件的 bundle patch
├── upstream.lock.json       锁定的上游 commit
├── .gitmodules              → vendor/ppt-master
├── skills/                  ← 唯一的技能目录。一个根，没有特例
│   ├── ppt-master/          ← 链接 → vendor/ppt-master/skills/ppt-master（生成）
│   ├── ppt-master-sci/      ← 科研前端（MinerU、公式、学术版式）
│   └── ppt-master-charts/   ← 图表/图示选择与视觉纪律
├── vendor/
│   └── ppt-master/          ← git submodule。只读，永不修改
├── scripts/
│   ├── upstream.mjs         init / check / sync / verify / status
│   └── cli.mjs              doctor / skills
└── tests/                   94 个测试，含「上游保持干净」的不变量
```

`skills/ppt-master` 是指向 submodule 的**链接**，由 `npm run upstream:init` 生成并已加入
`.gitignore`。文件仍然只存在于 submodule 里（不复制、不重复），但每个技能都在同一个地方被找到，
没有哪个是特例。

## 为什么必须是 submodule

三个参考项目走了三条不同的路。只有一条能扛住上游发版。

| 做法 | 问题 |
| --- | --- |
| **内联副本**（[pn1024/dsh-ppt-master](https://github.com/pn1024/dsh-ppt-master)） | 约 13000 个上游文件变成「你的」文件。「同步」等于手工 diff + merge。 |
| **Fork 后直接改**（[hongyi652/ppt-master-sci-fork](https://github.com/hongyi652/ppt-master-sci-fork)） | 上游每改一次就是一次合并冲突，永远如此。 |
| **git submodule + 叠加层**（本插件） | `git submodule update --remote`。上游始终是上游。 |

在这里，上游只是一份**引用**，锁定在 `upstream.lock.json` 里——每次同步的 diff 都能看到它变了什么。
扩展层是一个**独立技能**，上游对它一无所知。

### 同步上游

```bash
npm run upstream:check     # 上游是否领先？exit 2 = 有漂移
npm run upstream:sync      # 快进 pin，并把 submodule 指针与 lock 一起 stage
npm run upstream:verify    # 证明上游干净（exit 2 = 不变量已破）
```

`sync` 在上游工作区有本地改动时会**拒绝执行**。这不是洁癖：submodule 一旦脏，
「我们从不修改上游」这条不变量就已经破了，此时快进要么静默丢改动，要么以难懂的方式失败。
它同时把 gitlink 和 lock 文件一起 staged，让这次升级成为**一个可审阅的 diff**。

`verify` 是这条声明的可执行版本，检查三件事：checkout 位于锁定的 commit、没有本地改动、
父仓库在 `vendor/` 下除了 gitlink 什么都没跟踪。CI 可以据此卡门，
`tests/upstream.test.mjs` 跑的就是同一组检查。

## 安装

```bash
# 作为 DSH bundle
dsh plugin install dsh-ppt-master-plus      # 或加进 profile 的 bundles

# 从源码
git clone --recurse-submodules <本仓库>
cd dsh-ppt-master-plus
npm run upstream:init      # 幂等；拉取锁定的 commit
npm run doctor
```

`--recurse-submodules` 一步拿到上游。若克隆时没带，`npm run upstream:init`
会按锁定 commit 把工作区落下来。

## 插件注册了什么

一个 `ctx.skills.registerProvider()`，把两个根目录投影到 `ctx.skills`：

| 技能 | 文件实际在哪 | 注册方式 |
| --- | --- | --- |
| `ppt-master` | submodule（经链接） | 与磁盘内容**逐字节一致**，不注入前言 |
| `ppt-master-sci` | `skills/ppt-master-sci/` | 附带一段运行时前言，公布上游路径 |
| `ppt-master-charts` | `skills/ppt-master-charts/` | 同上 |

一个 provider、**一个目录**、三个技能。

三个细节是承重的：

- **只有一个根目录。** 早先的设计把 `vendor/ppt-master/skills` 和 `skills/` 并列扫描，并给上游技能
  换了一个 `source`。DSH **会丢弃 `source` 不认识的技能**——不报错、不打日志。于是插件看起来
  装好了、一切正常，而 `ppt-master` 在技能中心里根本找不到。现在只有一个目录、所有技能共用
  同一个 `source`（`bundled`），并有测试把它钉住。
- **上游依然原样注册**——不注入前言、不改路径。有测试断言字节相等，因为一旦重写渗进上游投影，
  `git submodule update --remote` 就不再是干净快进，本插件也就等于「不小心变成了 fork」。
- **技能属于哪棵树，是从文件系统读出来的。** provider 解析每个技能目录的真实路径，
  判断它是否落在 `vendor/` 里；是则为上游的。没有第二份需要同步维护的清单。

用 provider 而不是 N 次 `register()`：上游某次 `update --remote` 增删了技能时，
这里一行代码都不用改。

## SCI 层

`ppt-master-sci` 是**独立技能**，不是补丁。它提供科研前端，把更好的输入交给上游。

| 组件 | 作用 |
| --- | --- |
| `scripts/mineru_ingest.py` | 科研 PDF/DOCX → 上游本来就在消费的 Markdown 形态（`<stem>.md` + `<stem>_files/`），走 [MinerU](https://github.com/opendatalab/MinerU)。不依赖任何第三方 Python 包。 |
| `scripts/formula_manifest.py` | 把 LaTeX 抽成可审阅的 `formula_manifest.json`：稳定 id、inline/block 分类，并针对上游编译所用的 Microsoft 365 LaTeX 配置做预检。 |
| `scripts/latex_preview.py` | *可选*的 LaTeX → SVG 预览，仅供目视校对。需要 MiKTeX/TeX Live + `dvisvgm`。 |
| `assets/template-library/` | 学术版式包（7 页），以**未注册的 explicit 工作区根**选用——无需注册，所以不会向上游写入任何东西。 |
| `references/` | 摄取契约、公式流程、学术 deck 结构、版式用法。 |

### 关于公式：sci-fork 已经落后于上游

sci-fork 把 LaTeX 渲染成 **SVG 图片**，并改了上游的质量检查器来给它们定尺寸。
当前上游做得更好：它通过自己的标记把 LaTeX 编译成**原生、可编辑的 Office Math**，
并且 `references/native-formula.md` 明确禁止走图片分支：

> 绝不用 PNG 替代，绝不把结构化数学压平成普通文本，绝不手写 OMML，绝不让原始 LaTeX 露出。

因此本插件把公式导向上游的**原生标记**，只把 LaTeX → SVG 保留为明确标注的
**预览**步骤。照搬 fork 的图片路径反而是一次倒退。

### 关于摄取：说实话

MinerU 是托管 API，需要 `MINERU_API_TOKEN`（在 <https://mineru.net> 申请）。
没有 token 或网络时，`--from-zip` 可以完全离线处理已有的 MinerU 归档。

两者都不可用时，本技能会**明说**，并把上游自带的 `pdf_to_md.py` 作为一个
「已知更弱」的选项交给用户选择。把文本层抽取包装得和 MinerU 等价，
正是本插件要避免的失效模式：下游的公式清单与表格数值都会明显更差。

## 图表层

`ppt-master-charts` 填的是上游**自己声明的**空白。上游有 33 个**定量**图表参考，
按「编码的信息关系」编目；而非定量的一切，上游是这么说的：

> 定性结构属于 Slide-local Executor 的方法，**不是一个编目**。

于是金字塔、蜂窝、鱼骨、组织树、泳道、飞轮、维恩交集……全靠临场发挥——
而临场发挥正是 deck 开始变得「像套模板换字」的地方。

| 组件 | 作用 |
| --- | --- |
| `references/archetype-catalog.md` | 结构／流程／对比三类约 110 个定性形式，每条注明它编码的关系、所需的**数据形态**、以及何时不该用 |
| `references/data-archetypes.md` | 数据类与页面类形式，以及与上游 33 个参考的**桥接**——它们仍归上游，单一归属 |
| `references/selection.md` | 从「一句话结论」→ 意图 → 原型的路由，附 13 条具名反模式 |
| `references/craft-rules.md` | 与风格无关的视觉纪律 |
| `references/style-profiles.md` | 如何推导主题配置 |
| `references/library-build.md` | 建「图表库」而非做一份 deck |
| `scripts/chart_plan.py` | 校验 `chart_plan.json`：原型是否存在、数据形态是否成立、数字是否自洽、纪律计数 |
| `assets/style-profiles/` | 两份示例配置 |

### 「数字必须算得上」——做成机械闸

数据页上最有破坏力的缺陷，是页面**写出的**数字和它下面的图对不上。
观众一旦抓到一次，就不再相信后面任何一个数。

上游的建议和本技能的设计参考都把它当**叮嘱**处理（"出图前自己复核一遍"）。
本插件把它变成**闸门**：

```bash
python3 skills/ppt-master-charts/scripts/chart_plan.py projects/demo/chart_plan.json --fail-on-issue
```

页面上**写出的**每一个数字——百分比、倍数、合计、差值——都会用这一页自己的数据重算：

```text
ERROR [p01] '整体转化 12%': states 12% but 成单/1000 = 18%.  (claim-1)
ERROR [p01] a funnel encodes loss through ordered stages, but values increase
            at position 2 (100 → 420). Change the form or the data — do not bend
            the data.  (shape-not-monotonic)
```

它同时拒绝数据撑不起的形式：递增数据画漏斗、没有交集的维恩、没命名坐标轴的象限、
权重加不到 1 的加权评分、没有回边的闭环。

### 风格是配置，不是写死

这是让技能**可复用**而不是「一种样子」的关键。

本技能的设计参考把风格写死：一套配色、一种字体、一个画布，逐页当作规则陈述。
这对**已发布的成品**是对的，对**技能**是错的——那样的技能只会和它遇到的每个品牌打架。

所以形式不含风格，样子放在可替换的配置里：

| | |
| --- | --- |
| `neutral-default.json` | **默认**，刻意无彩 |
| `blue-gray-business.json` | `reference-sample` 示例配置，用来展示「一份完整配置长什么样」。明确不是本插件的主风格，其中每个值都应当被替换 |

解析优先级：用户提供的品牌工作区 → 指定配置 → 依 brief 推导的配置 → `neutral-default`。
原型编目里没有任何一处写出颜色，并且有一个明确的检验标准：换掉配置后，
每一个原型仍然可选。

## 配置

只有一个设置项：MinerU API Key。打开 **插件 → dsh-ppt-master-plus** 粘贴即可。

| | |
| --- | --- |
| **接口地址** | `https://mineru.net/api/v4` —— 仅官方云服务。没有 Provider 选择，也没有本地部署地址。 |
| **存储位置** | DSH 凭据服务，凭据引用名 `MINERU_API_TOKEN`。不落文件，也不会回显到页面上。 |
| **如何生效** | 宿主半边在**每次模型 Shell 调用**时把它发布为 `DSH_MINERU_API_TOKEN`，`mineru_ingest.py` 因此无需任何 shell 配置即可读到。 |

### 为什么除了页面还需要宿主半边

存了一个没人读的 Key 只是装饰。`mineru_ingest.py` 以普通子进程运行，只看得到自己的环境变量——
凭据服务里的一条记录本来永远到不了它手里。

所以插件注册了一个 `ctx.shellEnv` 贡献者（DSH 文档中为「模型 Shell 调用注入每次执行变量」的正式扩展点），
它解析该凭据引用并发布为 `DSH_MINERU_API_TOKEN`。有两个约束决定了实现：

- Shell 命名空间强制 `DSH_` 前缀，所以不能沿用原变量名发布；
- `shellEnv.collect` 是同步的，而凭据解析是异步的，因此贡献者返回「上次解析到的值」并在后台刷新，
  由 `credentials/reference-updated` 事件驱动。刷新**刻意不做合并**：一次仍在飞行中的解析绝不能吞掉更新的那次，
  否则保存后的 Key 会表现得「需要重启才生效」。

脚本优先读 `DSH_MINERU_API_TOKEN`，之后才是 `MINERU_API_TOKEN` 及其别名，
所以插件未安装时手动 export 依然可用。`.env` 是最后的退路——它会把明文密钥留在磁盘上，
而这正是设置页要避免的事。

## 验证

```bash
npm test                      # 91 个测试
npm run doctor                # 健康检查
npm run upstream:verify       # 上游干净且位于 pin 上
```

测试覆盖：provider 契约、frontmatter 解析器、SCI 脚本端到端
（构造一个 MinerU 归档并逐项断言）、图表校验器对**故意埋入的缺陷**逐条命中、
仓库不变量，以及版式包与上游工作区形态的一致性。
submodule 或 Python 缺失时相关用例会干净跳过。

## 环境要求

| | |
| --- | --- |
| Node | ≥ 20（实测 24） |
| DSH | ≥ 0.1.1-rc.1 |
| Python 3.9+ | 供两个技能的脚本使用（仅标准库） |
| `MINERU_API_TOKEN` | MinerU 摄取需要；用 `--from-zip` 时可选 |
| MiKTeX / TeX Live + `dvisvgm` | 可选，仅预览用 |

## 署名

上游 ppt-master 为 MIT，版权归 Hugo He；**它并不包含在本仓库中**——
以下载为 submodule 的形式获取，并自带其许可证。
两个参考插件，以及一份用作设计参考的第三方商业图表库，都只影响了设计思路；
它们的任何内容都没有被复制或再分发。
完整记录见 [`NOTICE`](./NOTICE)，其中列出了本插件与其参考对象的每一处有意分歧。

## 许可证

MIT — 见 [`LICENSE`](./LICENSE)。
