# XGuard Reply Filter

[![安装脚本](https://img.shields.io/badge/安装脚本-Greasy%20Fork-670000?style=flat-square)](https://greasyfork.org/scripts/581651)
[![Greasy Fork 版本](https://img.shields.io/greasyfork/v/581651?style=flat-square&label=version)](https://greasyfork.org/scripts/581651)
[![Greasy Fork 安装量](https://img.shields.io/greasyfork/dt/581651?style=flat-square&label=installs)](https://greasyfork.org/scripts/581651)
[![GitHub](https://img.shields.io/badge/GitHub-仓库-24292f?style=flat-square&logo=github)](https://github.com/codertesla/XGuard-Reply-Filter)
[![License: MIT](https://img.shields.io/badge/License-MIT-2ea44f?style=flat-square)](LICENSE)

XGuard 推特评论净化器是一个用于 X/Twitter 的油猴脚本，按**显示名关键词**和**评论内容关键词**批量隐藏推文下方的垃圾回复。

针对个别账号，请直接使用 X 官方的 Mute / Block；本脚本专注关键词批量过滤。

## 功能

- 安装即用：自动订阅远程关键词列表，批量隐藏垃圾回复
- 本地可补充显示名 / 评论关键词（每行一条）
- 手动更新远程规则时，会反馈新增 / 移除了多少条
- 默认跳过推文详情页主推文，只匹配回复本身，避免误伤
- 支持直接隐藏或占位可展开两种模式

## 安装

推荐从 Greasy Fork 安装：

```text
https://greasyfork.org/scripts/581651
```

也可以安装 GitHub Raw 脚本：

```text
https://raw.githubusercontent.com/codertesla/XGuard-Reply-Filter/main/x-comment-spam-filter.user.js
```

## 默认远程规则

脚本默认订阅本仓库的两个关键词列表：

```text
https://raw.githubusercontent.com/codertesla/XGuard-Reply-Filter/main/lists/name-keywords.txt
https://raw.githubusercontent.com/codertesla/XGuard-Reply-Filter/main/lists/comment-keywords.txt
```

规则文件格式很简单：每行一条，空行和 `#` 开头的注释会被忽略。

## 维护规则

- `lists/name-keywords.txt`：匹配显示名关键词
- `lists/comment-keywords.txt`：匹配评论内容关键词

建议分开维护：显示名规则更适合垃圾号身份特征，评论规则更适合话术与引流文案。关键词过短或过宽（例如单字）容易误杀，新增时请尽量具体。

## 使用

安装后脚本会自动拉取远程规则并过滤评论。油猴菜单只有两项：

- **打开设置**：启用开关、隐藏模式、本地关键词、自定义远程 URL
- **更新远程规则**：立刻刷新订阅，并提示新增 / 移除条数

设置面板里可直接编辑本地关键词；`Ctrl/Cmd + Enter` 快速保存。占位模式下可点击隐藏提示临时展开单条回复。

## 注意

公开列表可能带来误杀风险。遇到误伤时，可暂时关闭「远程规则」，或把相关关键词从订阅列表中移除。

## 许可证

MIT
