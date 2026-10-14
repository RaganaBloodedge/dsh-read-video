# dsh-readvideo

> npm 包名是 `dsh-readvideo`，仓库名是 `dsh-read-video`。在 dsh 的插件页输入包名即可安装，
> 见「安装 · 方式一」。

DeepSeek Harness 插件：让模型"看"视频，但不把视频下载下来。

给一条视频直链，插件用 HTTP Range 只取目标时间附近的一小段字节 —— 取某一秒的帧，
或取某一段音频送去转写。整片 99% 的字节从头到尾不碰，磁盘上不会出现任何视频文件。

> **状态：骨架。** 只有 `video_probe`（URL 可跳读性探测）落地成了工具；取帧 /
> 取音频窗口 / 转写这三件事在 `spike/` 里验证通过，代码还没搬进插件。

---

## 为什么不是"下载后分析"

下载整片再抽帧，慢、占盘、碰版权，而且大部分字节从来没被用到。浏览器拖进度条时
并不下载整片，它发的是 `Range: bytes=...`。插件做的是同一件事。

视频容器里本来就带索引：

| 容器 | 索引在哪 | 有什么用 |
| --- | --- | --- |
| MP4 | `moov` 里的 sample table（`stts` / `stsc` / `stco` / `stsz`） | 第 t 秒的样本在第几个字节、有多长 |
| HLS | `m3u8` 分片清单 | 每个分片的时间范围与 URL 都列好了 |

拿到索引，一次 Range 请求就能只取目标区间。唯一的物理限制是帧间编码：要第 1800 秒
那一帧，得从它前面最近的 I 帧（一般 1~10 秒一个 GOP）开始解。所以"取一帧"实际取的是
"最近关键帧到目标帧"那一小段，不是整个文件。

---

## 实测数据

`spike/remote_seek_spike.py` 跑出来的。目标 `media.w3.org/2010/05/bunny/movie.mp4`：
`Content-Length: 249224577`（237.7 MB），时长 `00:09:56.48`。

计数方式是本地起一个**流式转发代理**，ffmpeg 指向它，代理把请求原样转给真实 CDN 并
精确记录真正转发出去的字节数 —— 数字是量出来的，不是估的。

| 操作 | 从服务器实拉 | 占整片 | 请求数 | 耗时 | 产出 |
| --- | --- | --- | --- | --- | --- |
| 取第 30 秒一帧 | 2.0 MB | 0.839% | 4 | 10.5 s | 112.8 KB JPEG |
| 取第 8 分钟一帧 | 1.7 MB | 0.707% | 4 | 10.5 s | 52.4 KB JPEG |
| 第 8 分钟起 20 秒音频 | 6.6 MB | 2.784% | 4 | 13.1 s | 625.1 KB WAV |

第 8 分钟对应文件里 185 MB 偏移，前面 176 MB 一个字节都没碰。

四条比数字本身更值得留意的：

1. **每次全新调用有约 1.3 MB 固定开销。** 这条片子是非 faststart：`mdat` 从第 40 字节
   铺到 237.2 MB，`moov` 索引在 237.2 MB 处也就是文件尾。所以每次都要先付
   "探测 + 取索引"这笔钱（192 KB + 441 KB + 704 KB）。同会话里多次取帧要复用，
   不能反复付。
2. **目标区域是开放式 Range（`bytes=X-`），靠 ffmpeg 拿到帧后主动断开才不收全量。**
   任何中间件都必须流式转发；先缓冲再回传会把"取一帧"放大成"拉完整个 range"。
3. **音频窗口比取帧贵一个量级**（6.6 MB 对 0.4 MB 目标区域）：muxed MP4 里音视频
   交织存放，取 20 秒音频必须扫过同样时长的视频数据。所以音频窗口要尽量短，
   "字幕轨优先"的台阶排序是对的。
4. **服务器不返回 `Accept-Ranges: bytes` 时跳读失效**，只能顺序读。这个用一次 HEAD
   就能提前测出来 —— `video_probe` 干的就是这件事。

---

## 成本台阶

能停在便宜的台阶上就别往上走：

| 台阶 | 手段 | 代价 |
| --- | --- | --- |
| 0 | 页面元数据：标题 / 时长 / 简介 / 章节 / 封面 `og:image` | 一次 HTML 抓取 |
| 1 | 字幕轨（`<track>` 的 `.vtt` / `.srt`） | 几 KB 拿到全文，完全不用 ASR |
| 2 | 单帧取证：给定 `t` → 最近关键帧起解一帧 | 几十~几百 KB |
| 3 | 音频窗口：给定 `[t1,t2]` → 只取该段音频 → WAV → 转写 | 20 秒约 6.6 MB |
| 4 | 粗采样扫描：每 30 秒 1 帧，拼成雪碧图一次送进模型 | 只在要"整体理解"时用 |
| 5 | 全量流式转写 | 只在明确要求、且接受耗时的时候 |

台阶 1 容易被忽略：**不少视频自带字幕轨，那"理解视频"这件事根本不用语音识别**，
取个几 KB 的文本文件就完了 —— 比 ASR 便宜三个数量级。

---

## 安装

### 方式一：从 npm 装（推荐）

桌面应用 → 插件页 → 添加插件 → 填 `dsh-readvideo` → 重启。

管理器做的事：`pnpm add dsh-readvideo` → 把它加进 profile 的 `dsh.profile.bundles` →
包自带的 `cordis.patch.yml` 作为 **bundle 层自动生效**。用户不用手写任何配置，装完的形态：

```
~/.dsh/profiles/desktop/
├── package.json                      # dependencies 与 dsh.profile.bundles 各多一行
├── cordis.patch.yml                  # 不用动
└── node_modules/dsh-readvideo/
    ├── cordis.patch.yml              # 挂载条目来自这里
    └── dist/index.js                 # 入口
```

**这个形态下插件不需要自带 `node_modules`** —— `@deepseek-ai/*` 那类 peer 由宿主自己解析
（`dsh-mnemon` 同样只声明 peer，装成包照跑）。已实测：把本包的 tarball 用桌面自带的 pnpm
装进一个干净 profile，启动日志零告警，`--dump-config` 里 `read-video` 恰好出现一次。

### 本地挂载才需要插件自带依赖

```bash
git clone https://github.com/RaganaBloodedge/dsh-read-video.git
cd dsh-read-video
npm install
```

**用绝对路径挂载**（`--patch`，或把条目写进 profile 的 `cordis.patch.yml`）时，入口文件在
`node_modules` 之外，Node 找不到 `@deepseek-ai/*`，所以插件必须自带 `node_modules`。
漏了这步，启动日志只给一句不含原因的 `read-video (file:///...): failed to import` ——
真原因要单独 import 才看得到：`ERR_MODULE_NOT_FOUND: Cannot find package '@deepseek-ai/dsh-tools'`。

`npm install` 会顺带跑 `prepare`（即 `tsc`），产出 `dist/`。

### 入口为什么分 `src` 与 `dist`

dsh 当年加载插件入口时走的是 Node 的类型剥离，而 **Node 拒绝对 `node_modules` 下的
`.ts` 文件剥类型**：

```
ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING
Stripping types is currently unsupported for files under node_modules
```

于是两条路分开：

| 加载方式 | 入口 | 原因 |
| --- | --- | --- |
| 本地开发 `--patch` | `src/index.ts` | 文件在 `node_modules` 之外，Node 能直接剥类型，不用先编译 |
| 装进 `node_modules`（包名 / GitHub 仓库 / 本地目录） | `dist/index.js` | 只能加载 `.js`，所以包入口是 `dist/index.js` |

`dist/` 进了仓库，所以从 GitHub 装下来不用自己编译也能跑；`prepare` 脚本则在
`npm install` 和 git 依赖场景下重新生成一份。两条都留着是为了少一个失败点。

### 方式二：绝对路径挂载进 profile（含桌面应用）

把 `cordis.example.yml` 里的 `- insert:` 块粘进
`~/.dsh/profiles/desktop/cordis.patch.yml`，把 `<REPO>` 换成本仓库的绝对路径，
然后重启应用。

desktop profile 被 Electron 独占管理，`dsh --profile desktop --dump-config` 会被直接
拒绝（"managed exclusively by the Electron application"），CLI 既不能 dump 也不能启动它。
另外 desktop profile 目前没有 `node_modules`，如果挂载时报 `failed to import`，
得先让 profile 能解析到本插件的依赖。

### 方式三：本地开发（CLI，改代码即生效）

```bash
cp cordis.example.yml cordis.local.yml     # 先把里面的 <REPO> 换成绝对路径
dsh --profile web --patch "<cordis.local.yml 的绝对路径>" --dump-config   # 只组合配置，最快自检
dsh --profile web --patch "<cordis.local.yml 的绝对路径>"                 # 真启动
```

`--dump-config` 输出里出现 `- id: read-video` 就是组合成功。

### 方式四：MCP server

**尚未实现。** `cordis.example.yml` 里的 `mcp-readvideo` 条目是占位，留着是为了记住
这条路要走 `@deepseek-ai/dsh-mcp-client`、且 `serverName` 得匹配 `[A-Za-z0-9_-]{1,32}`。

---

## 已知坑

都是实测踩出来的。违反了不报错，只是不生效：

| 症状 | 原因 | 处置 |
| --- | --- | --- |
| `1 entry did not activate` + `failed to import` | 插件目录没有 `node_modules` | `npm install` |
| `schema.required is not supported by the value schema DSL` | `output.schema` 的 object 层写了 `required: [...]` 数组 | 删掉，改成标在属性上 `required: true` |
| `patch: entry "x" not found` | 用了裸 patch 条目 | 包进 `- insert:` |
| 完全没日志、静默不生效 | `name` 写了相对路径 | 改成绝对路径（路径指向不存在的文件时，dsh 会明确报 `did not activate`，可据此判定） |
| `'pnpm' 不是内部或外部命令` | 没装 pnpm（桌面应用自带一份，CLI 走 PATH 找不到） | 先用 `--patch` |
| 装好后 import 报 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` | 包入口指向 `.ts`，而 Node 不剥 `node_modules` 下文件的类型 | 入口用 `dist/index.js`（见上面那节） |
| 按钮填 GitHub 地址后报 `Host key verification failed` / `Connection reset ... port 22` | pnpm 把 GitHub spec 一律解析成 `git+ssh://git@github.com/...`，而机器上没有 SSH key | 改用包名安装（见「发布到 npm」），别用仓库地址 |

`required` 那条值得单独说：它不是数组，而是标在**每个属性自己的 schema 上**
（`required: true`）。`parameters` 和 `output.schema` 用的是同一套 DSL。

---

## 「添加插件」按钮

桌面应用里那个「输入插件的包名、GitHub 仓库地址或本地目录路径」的按钮走的是
`@deepseek-ai/dsh-plugin-manager`。三种来源最后都落到 `pnpm add <spec>`，装完把包加进
profile 的 `dsh.profile.bundles`；包里的 `dsh.bundle.patch` 随 bundle 层自动生效，所以
**不需要写 profile 的 `cordis.patch.yml`**（实测装完 `dsh-mnemon` 后用户的 patch 文件
一个字节没变）。本地目录那一栏必须是绝对路径 —— 相对路径会被拒。

三种来源的实测结论：

| 来源 | 能不能装上 | 说明 |
| --- | --- | --- |
| **包名**（如 `dsh-mnemon`） | 能 | 走 `pnpm add <名>`，装完 `node_modules/<包名>` 正常生成。本仓库发到 npm 后即可用 `dsh-readvideo` |
| **GitHub 仓库地址** | 不能（默认机器） | `github:user/repo`、`https://github.com/...`、`git+https://...git` 三种写法都被 pnpm 改写成 `git+ssh://git@github.com/...`，没配 SSH key 直接 `Host key verification failed` / `Connection reset ... port 22`。本机 `git config --global` 无 `insteadOf` 规则，不是本地配置造成的 |
| **本地目录（绝对路径）** | 能，但该目录要先 `npm install` | 走 `pnpm add <路径>`，插件用自己的 `node_modules` 解析 `@deepseek-ai/*` |

**早前这一节写过两条错的，一并更正**：桌面自带的 pnpm 11.7.0 **会**正常建链接
（`pnpm add zod` → `node_modules/zod` 存在且 `require.resolve` 通过，实测复现不了"不建链接"）；
`pnpmCommand` 也**救不了** GitHub 那条路 —— 官方文档写明应用拥有的 profile「由启动器提供
内置包管理器调用方式，**它优先于 `pnpmCommand`**」，且「Desktop 包管理操作仍由 Desktop shell 负责」。

一句话：**按钮只对「包名」和「本地绝对路径」这两种来源可用**。想让别人输一个名字就装上，
就得发到 npm。

---

## 发布到 npm

包名就是安装名 —— 用户在插件页输入的字符串就是 npm 包名，所以让它能被 `dsh-readvideo`
装出来，要满足四件事：

1. `package.json` 里 `dsh.bundle.patch` 指向 `cordis.patch.yml`，其中的 `- insert:` 行用
   **包名**引用自己（不是绝对路径）；
2. `files` 必须含编译产物 `dist/` —— 安装 npm 包时**不会**跑 `prepare`，编译产物要自带；
3. `publishConfig.access = "public"`（否则不会被当成公开包）；
4. **peer 区间要能覆盖 dsh 的 rc 版本**：写成 `^0.1.7-rc.2 || ^0.2.0-rc.1` 这种形式。
   装之前管理器会做一次 peer 兼容性检查，写死成 `0.2.0-rc.2` 的话，dsh 一升级别人就装不上了
   —— 这是"别人装不上"最常见的原因。

发布：

```bash
npm login --registry https://registry.npmjs.org        # 或 export NODE_AUTH_TOKEN=<token>
npm publish --registry https://registry.npmjs.org
npm view dsh-readvideo version                         # 回读核对；npmmirror 随后自动同步
```

参照 `dsh-mnemon`（同架构、70 个版本）：它是 monorepo，用 changesets 管版本，CI 里
`NODE_AUTH_TOKEN` 逐层发布子包、**最后**发主包，并且每步都从 registry 装回来做 E2E 自检。
本项目是单包，上面四步就够。

---

## 目录

```
src/index.ts               插件入口，具名导出 name / inject / apply
dist/                      编译产物；装进 node_modules 时加载的是这里
tsconfig.json              erasableSyntaxOnly，保证源码也能被 Node 直接剥类型加载
cordis.patch.yml           发布用 bundle 层，用户 profile 里引用包名
cordis.example.yml         挂载清单模板（dsh 要求绝对路径，所以只能给模板）
spike/remote_seek_spike.py 可行性验证：量出远程 seek 实际拉了多少字节
spike/requirements.txt     spike 的依赖
```

## 外部依赖

- **ffmpeg**：spike 用的是 `imageio-ffmpeg` 自带的静态构建，`pip install` 即有，
  系统不用装。
- **Python**：目前只用在 spike 里量字节数，插件本体是 TypeScript。

## License

MIT
