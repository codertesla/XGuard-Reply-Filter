# XGuard Reply Filter

[![安装脚本](https://img.shields.io/badge/安装脚本-Greasy%20Fork-670000?style=flat-square)](https://greasyfork.org/scripts/581651)
[![Greasy Fork 版本](https://img.shields.io/greasyfork/v/581651?style=flat-square&label=version)](https://greasyfork.org/scripts/581651)
[![Greasy Fork 安装量](https://img.shields.io/greasyfork/dt/581651?style=flat-square&label=installs)](https://greasyfork.org/scripts/581651)
[![GitHub](https://img.shields.io/badge/GitHub-仓库-24292f?style=flat-square&logo=github)](https://github.com/codertesla/XGuard-Reply-Filter)
[![License: MIT](https://img.shields.io/badge/License-MIT-2ea44f?style=flat-square)](LICENSE)

XGuard 推特评论净化器是一个用于 X/Twitter 的油猴脚本，可以按 `@用户名`、显示名关键词、评论内容关键词隐藏推文下方的垃圾回复。

## 功能

- 隐藏匹配规则的评论区回复
- 默认跳过推文详情页第一条主推文，避免误伤原帖
- 支持本地规则编辑
- 支持远程规则订阅，每类规则可配置多个 URL
- 远程规则会缓存，网络失败时继续使用上次成功缓存
- 远程订阅支持部分成功更新，单个 URL 失败不会丢弃其他可用规则
- 默认规则来自远程列表，本地规则默认留空，减少重复和误解
- 支持直接隐藏或显示占位提示两种模式
- 设置面板显示当前页隐藏数、本次会话命中数和启用规则数
- 详情页优先按当前 status ID 识别主推文，减少误伤原帖

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

脚本默认订阅本仓库的三个规则文件：

```text
https://raw.githubusercontent.com/codertesla/XGuard-Reply-Filter/main/lists/handles.txt
https://raw.githubusercontent.com/codertesla/XGuard-Reply-Filter/main/lists/name-keywords.txt
https://raw.githubusercontent.com/codertesla/XGuard-Reply-Filter/main/lists/comment-keywords.txt
```

规则文件格式很简单：每行一条，空行和 `#` 开头的注释会被忽略。

## 维护规则

- `lists/handles.txt`：精确匹配 `@用户名`
- `lists/name-keywords.txt`：匹配显示名关键词
- `lists/comment-keywords.txt`：匹配评论内容关键词

建议不要把三类规则混在同一个文件里，因为用户名是精确匹配，关键词是包含匹配，分开维护可以减少误杀。

## 使用

安装脚本后，在油猴菜单里点击「打开过滤设置」：

- 本地规则可以直接在文本框中编辑，每行一条
- 远程订阅 URL 可以每行添加一个
- 点击「立即更新远程规则」可手动刷新缓存
- `Ctrl/Cmd + Enter` 可快速保存设置
- 面板关闭前会提示未保存更改；占位模式下可点击隐藏提示临时展开单条回复

## 注意

公开列表可能带来误杀风险。遇到误伤时，可以先停用远程订阅，或把相关关键词从订阅列表中移除。

## 许可证

MIT
