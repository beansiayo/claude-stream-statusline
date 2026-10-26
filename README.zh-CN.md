# Claude Stream Statusline

[English](README.md) | **简体中文**

一个紧凑的 Claude Code 单行状态栏：模型、思考强度、目录、Git 分支、上下文、输出 token、缓存命中率，以及基于流式事件计时的生成速度。

```text
✻ Example Model · high · ~/project · ⎇ main │ ctx █───────── 81k/1M 8.1% │ out 600 │ cache 72k (89%) │ 200 tok/s
```

上面是布局示意，非性能基准。窗口变窄时会逐步省略信息。浅色和深色终端使用不同配色；速度低于 50 tok/s 显示黄色，达到 50 显示绿色。

## 兼容性

- Node.js 24 或以上，无 npm 依赖，无需 `npm install`。
- 安装脚本支持 macOS / Linux；Windows 暂不支持。
- 状态栏使用 Claude Code 的 `statusLine` JSON 输入。
- **测速是可选插件，依赖 `turn.step` hooks module API**：包括流式 `text` / `thinking` / `input` / `tool` / `stop`、`performance.now()`、`$.env.get`、`$.fs.write`。原型在本机 Claude Code 2.1.310 上运行过；这不代表所有渠道或同版本发行包都提供这些接口。安装前运行下面的插件校验。不支持这些接口时，只安装基础状态栏，速度显示 `—`，不会用日志估算冒充实测。
- 本仓库的可移植版本经过模拟流、渲染和隔离安装测试；不宣称已经在所有平台上实测。

## 安装

下载 ZIP 并解压，或从 GitHub 克隆本仓库，然后在项目根目录执行：

```sh
node --version
node scripts/install.cjs
```

安装器只修改用户配置中的 `statusLine`，保留其他配置。首次安装备份原始设置和原有状态栏，重复安装不覆盖首次备份。备份只保存在本机配置目录，不在仓库中。安装路径是：

```text
${CLAUDE_CONFIG_DIR:-~/.claude}/claude-stream-statusline/
```

安装时使用当前 Node 可执行文件的绝对路径；若之后移动或卸载 Node，需要重跑安装。

### 启用实测速度

先检查当前 CLI 是否接受插件接口，再安装到用户范围：

```sh
claude plugin validate ./plugins/stream-speed
claude plugin install stream-speed --marketplace "$PWD" --scope user
```

校验失败时不要继续插件安装；基础状态栏可以单独使用。目录上架相关的 README、图标提示与 hooks API 校验错误是两回事，本项目仅使用本地 marketplace。

安装后重启 Claude Code；恢复旧会话可用 `claude --resume`。完成一次回复后开始显示速度。不要同时加载多个同名 `stream-speed` 插件来源（包括开发会话的热加载副本）。若已有旧版个人测速插件，先在 `/plugin` 中关闭旧来源再安装本项目。

本地 marketplace 使用当前仓库目录作为源，后续更新前请保留该目录。

### 自定义配置目录

为状态栏安装和 Claude Code 启动设置同一个环境变量：

```sh
export CLAUDE_CONFIG_DIR="$HOME/.claude-custom"
node scripts/install.cjs
claude plugin install stream-speed --marketplace "$PWD" --scope user
claude
```

`--config-dir DIR` 仅指定安装器操作的目录；它不会替你设置后续 Claude 进程的环境变量。

## 指标含义

| 项目 | 含义 |
| --- | --- |
| `ctx 81k/1M 8.1%` | 最近请求的输入 token（含缓存）/ 模型容量；非整个会话累计输入 |
| 上下文进度条 | 与旁边百分比共用分母；满格不保证马上压缩 |
| `out` | 最近请求报告的输出 token |
| `cache` | 最近请求缓存读取 token 及其占输入的比例；无数据用 `—` |
| `tok/s` | 最近一次成功完成且有有效测量数据的回复吞吐率 |

测速公式：

```text
API 报告的输出 token 数 / (收到 stop 事件时间 − 首个非空输出事件时间)
```

输出事件包括文本、思考、工具名与工具参数。排除首个输出前的等待时间，不包含客户端随后执行工具的时间。它是客户端观察到的流式吞吐率，受网络缓冲、思考是否完整流出、服务端工具和 token 统计口径影响，不是服务端 GPU 的纯解码速度。只有收到完成事件与最终 usage 才更新，**不是逐 token 实时速率**。计算口径参考 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-chat/src/client/contract/turn-metrics.ts)，未复制其源代码。

新请求进行中保留上一条结果；请求结束后替换为本次采样状态：满足采样条件的数值标为 `tok/s`（客户端接收吞吐率），明显集中到达显示 `n/a tok/s (burst)`，输出片段分布不足显示 `n/a tok/s (sparse)`，缺少 usage 或中断显示 `— tok/s`。不会再用旧数字替代本次不可测的结果。旧版 version 1 采样会被忽略，等待新版插件写入新结果。每个会话使用独立文件，子代理不会覆盖主会话的数据。

数值采样至少需要三个非空输出事件、首末输出到达跨度不少于 0.5 秒，以及至少两个不小于 20 毫秒的相邻事件间隔。这是保守的采样启发规则，不能证明上游没有缓冲：正常短回复可能被拒绝，较长的缓冲批次也可能通过。不设置任意速度上限。插件只记录片段数和计时摘要，不保存输出内容。要获得可靠的上游生成速度，仍需要服务端计时或确认链路逐段透传，客户端检查无法还原丢失的上游时序。

## 配置

把需要的变量合并到自己的 `settings.json` 的 `env` 中，**不要覆盖整个文件**：

```json
{
  "env": {
    "STATUSLINE_SCHEME": "dark",
    "STATUSLINE_FAST_TPS": "50"
  }
}
```

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `STATUSLINE_SCHEME` | 自动 | `light` / `dark`；自动依次检查 COLORFGBG、macOS 外观，其他环境回退浅色 |
| `STATUSLINE_FAST_TPS` | `50` | 速度显示值达到此阈值时绿色，否则黄色 |
| `STATUSLINE_CTX_WINDOW` | 输入 JSON 的容量 | 手动覆盖展示的模型容量，不修改模型实际限制 |
| `STATUSLINE_COMPACT_ESTIMATE` | 关闭 | 设为 `1` 显示压缩阈值估算，并按估算分母计算进度 |

### 可选：压缩阈值估算

如果用户设置了数值型 `autoCompactWindow`，开启估算后可显示：

```text
ctx ███─────── 81k/~239k/1M 33.9%
```

`~239k` 的波浪号表示估算。公式参考 CLI 2.1.309：配置窗口限制在模型容量内，减 20k 输出预留，再减 13k 缓冲；若有 `CLAUDE_AUTOCOMPACT_PCT_OVERRIDE`，取对应比例阈值与前述结果的较小者。

该逻辑只读取环境变量、用户级 `settings.json` 的当前模型配置（仅支持原 ID 与去掉方括号后缀）及顶层数值配置；不完整复现项目设置合并、模型别名、实验、输出上限和关闭自动压缩等运行状态。`auto` 或没有数值配置时不推算。**因此它不承诺与内置自动压缩倒计时完全一致。** 本项目不会为用户设置 272k，也不会修改任何压缩配置。

## 开关、更新与卸载

```sh
# 暂时恢复原来的状态栏（没有原状态栏则隐藏）
node scripts/toggle.cjs disable
node scripts/toggle.cjs enable

# 获取仓库新版后重新安装状态栏，并更新测速插件
node scripts/install.cjs
claude plugin marketplace update stream-statusline-local
claude plugin update stream-speed@stream-statusline-local --scope user

# 卸载（插件安装过才需要第一条）
claude plugin uninstall stream-speed@stream-statusline-local --scope user
node scripts/uninstall.cjs
```

插件更新后重启会话。卸载器仅在当前状态栏仍属于本项目时恢复原值；若你后来换了别的状态栏，会保留你的修改。用户设置里的其他字段保持不变。卸载器不删除 `stream-speed/` 采样目录，也不删除 marketplace 注册；需要时可用 `claude plugin marketplace remove stream-statusline-local` 移除注册，并自行删除配置目录下的 `stream-speed/`。

Ghostty 用户可以自行绑定开关脚本；本项目不会改终端配置或安装名为 `sl` 的全局命令。

## 数据与权限

插件只在本机保存会话 ID、输出 token 数、耗时与计算结果，不保存回复正文、请求内容、密钥，也不发起额外网络请求。状态栏会读取工作目录的 Git HEAD、用户设置中的压缩配置以及测速文件。不要把自己的设置备份或采样目录上传到 GitHub。

## 开发与发布

```sh
npm test
claude plugin validate ./plugins/stream-speed
```

测试使用临时目录和模拟流，不发送模型请求，不改真实用户配置。项目包括 GitHub Actions（Node 24，macOS / Linux）测试工作流。

仓库名建议为 `claude-stream-statusline`。上传整个项目即可，不需要上传 `~/.claude`。这是独立社区项目，不隶属于 Anthropic 或 DeepSeek。MIT 许可，见 [LICENSE](LICENSE)。
