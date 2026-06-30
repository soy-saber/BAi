# BAi

> 一个多智能体协作平台 —— 让不同的 AI 智能体像一个团队那样协同工作。

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-20+-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5+-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)

> 中文说明 · [English](README.md)

## 这是什么？

BAi 把彼此孤立的 AI 智能体命令行工具（Claude Code、Codex、Gemini……）变成
一个团队，让它们协同工作 —— 而不用你在多个聊天窗口之间来回复制粘贴上下文。

它是位于每个智能体 CLI *之上* 的一层：把它们作为子进程拉起，把各自的流式
输出解析成统一的消息格式，把任务路由到合适的智能体，并让智能体之间能够互相
对话（例如 Claude 写代码、Codex 审查）。

## 为什么要做它？

这是一个学习项目。目标是从零搭一个最小但真实可用的版本，借此深入理解多智能体
编排在底层到底是怎么运作的 —— 进程管理、流解析、消息路由、持久化身份，以及
智能体之间的通信。

灵感来自 [Clowder AI](https://github.com/zts212653/clowder-ai)（MIT）。BAi 是
一个独立的、从零实现的项目；不复用 Clowder 的品牌、logo 或角色设计。

## 进度

一个端到端可用的多智能体平台，分阶段构建（每个阶段是一次提交，并在
[`docs/decisions/`](docs/decisions/) 中有对应的决策记录 ADR）：

- [x] **Stage 0** — 仓库脚手架 + 工具链
- [x] **Stage 1** — 单个智能体适配器（拉起 Claude CLI，解析输出流）
- [x] **Stage 2** — 第二个智能体（Codex/Gemini）接入同一套统一接口
- [x] **Stage 3** — 会话线程（threads）+ @提及路由
- [x] **Stage 4** — 持久化身份 + 共享记忆
- [x] **Stage 5** — A2A 消息 + 跨模型互审
- [x] **Stage 6** — 极简 Web UI
- [x] **Stage 7** — 第三个适配器（opencode）+ UI 中的实时流式状态
- [x] **Stage 8** — UI 中的渐进式（打字机）渲染
- [x] **Stage 9** — 每轮超时 + 取消（Stop 按钮）
- [x] **Stage 10** — 瞬时失败的退避重试
- [x] **Stage 11** — 自动记忆沉淀（决策/教训）
- [x] **Stage 12** — 更聪明的回忆 + 团队复盘（提炼出的洞见）
- [x] **Stage 13** — 第四个适配器（Gemini）接入同一套 `CliSpec`
- [x] **Stage 14** — 能力路由（无 @提及时自动选最合适的智能体）
- [x] **Stage 15** — 审查流水线（claude 审查 → 审查官把关 → 回退链）
- [x] **Stage 16** — UI 打磨 + @提及自动补全
- [x] **Stage 17** — 实战练习：一个由确定性裁判主持、智能体当选手的游戏
- [x] **Stage 18** — 聊天模式降级：用 `@file:` 给无工具模型喂上下文
- [x] **Stage 19** — 安全审计：一个智能体找出漏洞链路，另一个逐条验证
- [x] **Stage 20** — codex 模型覆盖（`BAI_CODEX_MODEL`）+ 运行时无工具能力提示
- [x] **Stage 21** — 只读 git 检查器：看智能体改了什么，UI 里逐文件看 diff
- [x] **Stage 22** — 从 UI 写 git：暂存/取消暂存文件、提交，全部需显式点击触发
- [x] **Stage 23** — diff 审查流水线：审查员评判工作区 diff，把关官给出 ship/hold
- [x] **Stage 24** — 每轮计时 + token 统计：每轮展示耗时，CLI 报告时附 token 数和花费
- [x] **Stage 25** — 可测试的 HTTP 层：路由函数导出并接收注入的依赖，无需真实 CLI 或工作区即可覆盖各端点

## 快速开始

```bash
# 前置：Node.js 20+，以及已安装并登录的 `claude` 和/或 `codex` CLI

npm install
npm run build

# 线程化、@提及路由的协作：
node dist/index.js new "auth refactor"          # -> 创建线程 a1b2c3d4
node dist/index.js send a1b2c3d4 "@claude design the API, then @codex review it"
node dist/index.js show a1b2c3d4                # 打印对话记录
node dist/index.js threads                      # 列出所有线程

# 用 @file: 给只会聊天（没有文件工具）的模型喂文件。BAi 读取文件并内联进去，
# 模型基于它推理并给出修改建议，再由 BAi（或有工具能力的智能体）落地。用
# BAI_CHAT_AGENTS 标记这类纯聊天智能体，例如当你的 `codex` CLI 绑定的是一个
# 纯聊天模型时：
#   BAI_CHAT_AGENTS=codex node dist/index.js serve
node dist/index.js send a1b2c3d4 "@codex review @file:src/server/app.js for bugs"

# 不改 ~/.codex/config.toml 就让 `codex` CLI 指向别的模型。BAI_CODEX_MODEL 会
# 注入 `codex exec -m <model>`（复用已配置的 provider）。codex 对已知的无工具
# 模型会自动降级为聊天模式，其余情况仍是有工具能力的智能体；若它跑完一轮一个
# 工具都没调，BAi 会提示你用 BAI_CHAT_AGENTS=codex 把它降级。
#   BAI_CODEX_MODEL=gpt-5.5 node dist/index.js serve

# 审查流水线 —— claude 审查，一个审查官把关，带回退链
#（claude → codex，若 codex 连不上则回退到 opencode）：
node dist/index.js audit a1b2c3d4 "src/server/server.ts"

# 安全审计 —— claude 找出漏洞链路（source → sink），然后 codex 逐条验证每条
# 链路是否真实存在、是否可被利用（codex 挂了就用 opencode）。用 @file: 喂代码，
# 这样即便验证方没有工具也能看到源码：
node dist/index.js secaudit a1b2c3d4 "@file:src/server/server.ts"

# Diff 审查 —— 审查工作区的改动：审查员评判 diff（正确性/回归/安全），把关官
# 给出 ship/hold。传文件名可限定范围，不传则审整棵工作树。读取 `git diff` 并
# 内联喂入：
node dist/index.js review a1b2c3d4 src/git.ts

# 练习游戏 —— 两个智能体下井字棋；裁判是确定性的代码：
node dist/index.js play claude codex

npm test     # 路由/存储/身份/A2A 单元测试（用假适配器，不调真实 CLI）

# 或者用 Web UI：
node dist/index.js serve     # http://localhost:3003
#   侧栏有一个 Git 面板 —— 展示本次会话里智能体改动过的文件；
#   点击某个文件看彩色 diff，用 +/− 暂存/取消暂存，然后提交索引。
#   "👁 Review changes" 会对工作树跑一遍 diff 审查流水线。
#   （GET /api/git/status、GET /api/git/diff?file=；POST /api/git/{stage,unstage,
#   commit} 以及 /api/threads/:id/review。写操作只作用于 git 已报告变更的路径；
#   不做 push/reset/-a。）
```

> Web UI 绑定在 localhost 且**没有任何鉴权**；它能拉起会修改文件、在工作目录
> 里执行命令的智能体。请只在本地使用。

Web UI 在智能体工作时实时推送状态 —— 哪个智能体在跑、它的工具调用、连接成功
还是失败 —— 而不用等整轮结束。每轮结束后会显示一行页脚，标出墙钟耗时，以及
（当 CLI 有报告时）token 数和花费（例如 `12.3s · 1.2k tok · $0.04`）；CLI 上
每轮下方也会打印同样的一行。

## 支持的智能体

每个智能体就是一份 `CliSpec`，跑在同一套 spawn/解析 的运行器之上；再加一个
智能体只是再写一份 spec。

| 智能体 | CLI | 备注 |
|-------|-----|-------|
| Claude | `claude` | `--permission-mode` / bypass 映射 |
| Codex | `codex` | `--sandbox` 模式映射 |
| opencode | `opencode` | 设置 `OPENCODE_MODEL`，例如 `opencode-go/deepseek-v4-flash` |

各 provider 的 API key 和 `OPENCODE_MODEL` 都从环境变量读取，绝不写入磁盘。
用名字 @提及某个智能体：`@claude`、`@codex`、`@opencode`。

一条消息用 `@提及` 来指派智能体；提及按书写顺序依次执行，所以"先设计再审查"
这样的流程能直接成立。每个线程是一段隔离的上下文，以一个纯 JSON 文件存放在
`data/threads/` 下。每个智能体都跑在统一的 `AgentAdapter` 接口背后，并真正在
当前目录下执行工作。

## 架构

_随着形态逐步清晰再补充文档。设计决策记录在 [`docs/decisions/`](docs/decisions/)。_

## 学到了什么

_一份随项目成长持续更新的洞见与坑点记录。_

## 许可证

[MIT](LICENSE)
