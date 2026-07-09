# XGuard Reply Filter

[![安装脚本](https://img.shields.io/badge/安装脚本-Greasy%20Fork-670000?style=flat-square)](https://greasyfork.org/scripts/581651)
[![Greasy Fork 版本](https://img.shields.io/greasyfork/v/581651?style=flat-square&label=version)](https://greasyfork.org/scripts/581651)
[![Greasy Fork 安装量](https://img.shields.io/greasyfork/dt/581651?style=flat-square&label=installs)](https://greasyfork.org/scripts/581651)
[![GitHub](https://img.shields.io/badge/GitHub-仓库-24292f?style=flat-square&logo=github)](https://github.com/codertesla/XGuard-Reply-Filter)
[![License: MIT](https://img.shields.io/badge/License-MIT-2ea44f?style=flat-square)](LICENSE)

XGuard 推特评论净化器是一个用于 X/Twitter 的油猴脚本，按**显示名关键词**和**评论内容关键词**批量隐藏推文下方的垃圾回复。

针对个别账号，请直接使用 X 官方的 Mute / Block；本脚本专注关键词批量过滤。

## 功能

- 按显示名、评论内容关键词隐藏垃圾回复
- 默认跳过推文详情页第一条主推文，避免误伤原帖
- 只匹配回复本身的显示名与正文，避免引用推文内容误伤
- 支持本地规则编辑与远程关键词订阅（每类可配置多个 URL）
- 远程规则默认每天自动更新一次；失败或遇 GitHub 429 会退避重试，并继续使用缓存
- 远程订阅支持部分成功更新，单个 URL 失败不会丢弃其他可用规则
- 默认规则来自远程列表，本地规则默认留空，减少重复和误解
- 支持直接隐藏或显示占位提示两种模式
- 设置面板精简为首屏可用：常用开关 + 双栏关键词，高级选项默认折叠
- 匹配时清理零宽字符，并对去空格/标点后的文本做二次匹配，降低常见绕过

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

安装脚本后，在油猴菜单里点击「打开过滤设置」：

- 本地规则可以直接在文本框中编辑，每行一条
- 远程订阅 URL 可以每行添加一个
- 点击「立即更新远程规则」可手动刷新缓存
- 点击「查看过滤统计」可直接查看当前页隐藏数、本次会话命中数和各类启用规则数
- `Ctrl/Cmd + Enter` 可快速保存设置
- 面板关闭前会提示未保存更改；占位模式下可点击隐藏提示临时展开单条回复

## 注意

公开列表可能带来误杀风险。遇到误伤时，可以先停用远程订阅，或把相关关键词从订阅列表中移除。

## 许可证

MIT
