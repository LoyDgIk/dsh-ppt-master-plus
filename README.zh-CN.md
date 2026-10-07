# dsh-ppt-master-plus

把 [ppt-master](https://github.com/hugohe3/ppt-master) 封装为可安装的
DeepSeek Harness 插件，并在**不改动上游任何一个文件**的前提下，叠加科研／学术能力。

整个设计只取决于一个决定：上游是 **git submodule**，既不是 vendored 副本，也不是 fork。

```text
dsh-ppt-master-plus/
├── index.js                 DSH 入口：一个 skills provider，两个根目录
├── cordis.patch.yml         挂载插件的 bundle patch
├── upstream.lock.json       锁定的上游 commit
├── .gitmodules              → vendor/ppt-master
├── vendor/
│   └── ppt-master/          ← git submodule。只读，永不修改
│       └── skills/ppt-master/    上游技能，原样注册
├── skills/
│   └── ppt-master-sci/      ← 本插件自己的技能（SCI 层）
├── scripts/
│   ├── upstream.mjs         init / check / sync / verify / status
│   └── cli.mjs              doctor / skills
└── tests/                   46 个测试，含「上游保持干净」的不变量
```

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

| 技能 | 根目录 | 注册方式 |
| --- | --- | --- |
| `ppt-master` | `vendor/ppt-master/skills/` | 与磁盘内容**逐字节一致**，`source: upstream` |
| `ppt-master-sci` | `skills/` | 附带一段运行时前言，公布上游路径 |

两个细节是承重的：

- **上游原样注册**——不注入前言、不改路径、不重写任何内容。有测试断言字节相等，
  因为一旦重写渗进上游投影，`git submodule update --remote` 就不再是干净快进，
  本插件也就等于「不小心变成了 fork」。
- **只有我们自己的技能带前言。** 我们的技能在另一棵树里，所以它被告知（可移动的）
  上游 checkout 在哪，而不是硬编码路径、等它一挪就断。

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

## 验证

```bash
npm test                      # 46 个测试
npm run doctor                # 健康检查
npm run upstream:verify       # 上游干净且位于 pin 上
```

测试覆盖：provider 契约、frontmatter 解析器、SCI 脚本端到端
（构造一个 MinerU 归档并逐项断言）、仓库不变量，以及版式包与上游工作区形态的一致性。
submodule 或 Python 缺失时相关用例会干净跳过。

## 环境要求

| | |
| --- | --- |
| Node | ≥ 20（实测 24） |
| DSH | ≥ 0.1.1-rc.1 |
| Python 3.9+ | 供 SCI 技能的脚本使用（仅标准库） |
| `MINERU_API_TOKEN` | MinerU 摄取需要；用 `--from-zip` 时可选 |
| MiKTeX / TeX Live + `dvisvgm` | 可选，仅预览用 |

## 署名

上游 ppt-master 为 MIT，版权归 Hugo He；**它并不包含在本仓库中**——
以下载为 submodule 的形式获取，并自带其许可证。
两个参考插件影响了设计思路，但未复制任何代码。
完整记录见 [`NOTICE`](./NOTICE)，其中列出了本插件与 sci-fork 的每一处有意分歧。

## 许可证

MIT — 见 [`LICENSE`](./LICENSE)。
