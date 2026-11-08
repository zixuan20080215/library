# 离线 Agent 规则维护

本说明对应单文件 HTML 版本。服务器版的 Python 规则助手、真实 DeepSeek 接口见[架构与接口](架构与接口.md)。当前验收与后续工作见[开发程度评估](开发程度评估与验收.md)。

## 修改入口

| 文件 | 职责 |
| --- | --- |
| [web/offline-dialogue-rules.js](../web/offline-dialogue-rules.js) | `maxTurns`、统一兜底、指定话题触发词及公开来源、离线知识覆盖项和补充问答 |
| [web/offline-chat.js](../web/offline-chat.js) | 规则优先级、会话计数、查书追问、时段与条件解析、反馈补充、业务工具调用 |
| [web/offline-backend.js](../web/offline-backend.js) | 书目检索、时段筛选、本地操作与 API 适配、localStorage 存储 |
| [web/assistant.js](../web/assistant.js) | 对话显示、角色切换、轮数栏、重新开始、结果卡和公开资料链接 |
| [agent_backend/demo_knowledge.py](../agent_backend/demo_knowledge.py) | 打包时共用的 42 类基础知识；服务器专属表述由离线规则覆盖 |
| [agent_backend/institution_profiles.py](../agent_backend/institution_profiles.py) 与 [简介 JSON](../江苏大学图书馆资料/学校与图书馆简介.json) | 学校与图书馆简介的内容、来源、日期和两端共用触发规则；独立于 42 类基础问答 |
| [scripts/build_offline.py](../scripts/build_offline.py) | 内嵌三份运行 CSV、基础知识、离线脚本、前端模块、CSS 与图片，生成 HTML 和 ZIP |
| [scripts/offline_dialogue_test.cjs](../scripts/offline_dialogue_test.cjs) | Node 规则回归，使用导入数据与实际离线业务逻辑，无浏览器依赖 |
| [scripts/offline_test.cjs](../scripts/offline_test.cjs) | 断网浏览器集成、轮数与重开、业务流程、手机布局 |

不要直接修改发布用 HTML 内的脚本。先改 `web/` 源码，再重新打包，以免下一次构建覆盖改动。

学校和图书馆简介在构建时从临时 SQLite 的 `institution_profiles` 导出为 `DATA.institution_profiles`，规则同时导出为 `profile_queries` 和 `profile_exclusion`。可以问“介绍一下江苏大学”“那图书馆呢”；查询通过 `get_institution_profile` 工具返回，回答保留来源与日期，来源卡片仅在点击时联网。具体数据维护见[数据维护](数据维护.md#学校与图书馆简介)。

## 会话和轮数

`offlineChat(message, sessionId, characterId)` 返回与网页 `/api/chat` 类似的结构，并增加以下字段。

| 字段 | 含义 |
| --- | --- |
| `turn_count` | 本会话已处理的有效问答数，最多 10 |
| `max_turns` | 当前上限，来自 `offlineDialogueRules.maxTurns` |
| `limit_reached` | 本次是否由于已用完轮数而被拦截。第 10 轮仍为 `false`，第 11 次起为 `true` |
| `response_kind` | 调试用回复分类，如 `books`、`seat_clarify`、`feedback_preview`、`fallback`、`political_reference`、`limit` |
| `sources` | 固定公开资料回复的标题和 HTTPS 链接，仅按需显示，不主动请求 |

计数由引擎执行，在任何关键词匹配和业务工具之前检查上限。第 11 次及之后返回同一限制文案，计数保持 10，工具与待确认操作为空。空白或超过 4,000 字符的无效输入会报错，不计数。知识回复、问候、能力兜底和要求补充条件的回答均算一轮。

新建对话会丢弃前端的旧 `session_id`、消息和卡片引用，下次请求创建新会话。切换角色只影响展示与姓名，不重置计数。业务确认由独立接口处理，不占对话轮数。已经确认的业务数据继续保存在当前浏览器。

上下文在页面内存保存，30 分钟无更新过期，最多保留 32 个会话；刷新页面从新对话开始。该上限用于演示交互，不是可以防止用户改网页代码的服务端配额系统。

## 路由顺序与上下文

处理顺序为输入校验 → 会话限额 → 指定话题固定资料 → 问候与控制回复 → 记录编号及操作 → 反馈整理 → 具体查书与候选追问 → 选座与补充条件 → 知识库 → 能力兜底。

知识库的命中结果会提前参与意图区分，防止“反馈进度”被当作新反馈、“我的预约”被当作重新查座。“怎么预约”“如何取消”“签到规则”属于说明，不直接执行业务。

| 上下文 | 用途 | 例子 |
| --- | --- | --- |
| `intent`、`awaiting` | 当前任务和待补充字段 | “我想找书”后可以只说主题 |
| `books`、`bookQuery`、`bookOffset`、`selectedBook` | 当前批次与选中书目 | “第二本是谁写的”“它在哪里”“换一批” |
| `timeDraft`、`times`、`seatFilters`、`seats` | 分步补时间、调整筛选并查询 | “明天下午”→“两点开始”→“用两个小时”→“换成三楼” |
| `feedbackDraft` | 反馈描述和位置 | “插座坏了”→“在三楼北区”→“地点改成二楼” |
| `lastRecord`、`lastPending` | 编号续查与提醒点击确认卡 | “FB-编号”→“状态呢”；文字“确认”只提示点击卡片 |

支持今天、明天、后天与中英文数字时刻，采用上海时区。只支持同一天、有效的起止时段，单次预约最多 8 小时。修改时段失败会清空旧的可预约候选，不能继续按旧序号生成预约。电子阅览室同时位于 2 楼和 3 楼，按房间名筛选时必须结合楼层，不能假定名称唯一。

插座、靠窗和安静属性仍有未知值；规则可识别偏好但不能把未知属性当成满足。“不要插座”“设施不限”在演示中表示去掉对应筛选条件。准备业务操作只生成确认卡，不能把文字“确认”转换成直接提交。

## 增加问答或处理规则

知识性说明优先添加到 `extraKnowledge`，采用与基础库相同的 `id`、`keywords` 权重、可选 `patterns` 和 `answer`/`dynamic` 格式。需要改写服务器版说法时使用 `overrides`，避免给离线用户错误的数据库或 Key 指引。

需要保留上下文或执行查询时，在 `offline-chat.js` 中加入相应分支；业务查询及预览仍通过 `call()`，以便页面拿到一致的工具结果。禁止让助手直接调用 `confirmAction`。新增规则应同时包含一条正常问句、一条追问以及一条容易误匹配的问句测试。

不要仅因为包含“书”“教育”等字就把开放问题当成馆藏查询。真正不支持的问题应进入统一兜底；官方资料未收录时应说明未知。书目详情只使用导入字段，不根据书名生成内容摘要。

## 指定话题的固定资料

触发规则集中在 `political.patterns`；回复、来源标题及链接集中在 `political.answer` 与 `political.sources`。输入先做 Unicode NFKC 归一化，再匹配显式词语。规则不会仅凭“中国”“民主”“自由”等普通词触发。带书名、ISBN 或明确查书意图的请求继续检索；同时要求评论或评价的混合请求优先返回固定资料。

页面明确说明使用预设资料，全文在离线文件内，点击来源才需要联网。内容采用以下来源，避免把旧简历当成实时状态。

- 核心价值观的三个层面与基本内容采用教育部转载的 2013 年文件。[公开原文](https://www.moe.gov.cn/jyb_xwfb/s5147/201312/t20131224_161114.html)
- 简历摘要依据新华社 2023 年 3 月 10 日稿件，页面提供最高人民法院转载版本。[公开简历](https://www.court.gov.cn/xinshidai/xiangqing/392241.html)

这组词语不能保证识别所有同音字、隐喻和绕写，也没有通用政治事实问答能力。修改后必须复测正常的政治历史类书目检索。来源域名如有变动，同时更新 `assistant.js` 内来源链接允许列表。

## 构建与验证

在项目根目录执行。Node 规则测试不需要 Playwright；浏览器测试的安装与本机 Edge 配置见[开发与发布](开发与发布.md)。

```powershell
python -B -X utf8 scripts/build_offline.py
node scripts/offline_dialogue_test.cjs
node scripts/offline_test.cjs
python -B -X utf8 scripts/package_demo.py
```

构建生成同名 HTML、离线 ZIP 和使用说明。浏览器测试会检查当前离线脚本已内嵌到 HTML，避免只修改源码、忘记重建；测试使用独立浏览器上下文，主动断网，不会修改日常演示记录。规则测试用固定时钟复现日期和超时行为。

维护后核对[对话报告](../网页预览/离线对话验证结果.json)和[浏览器报告](../网页预览/离线版验证结果.json)的测试时间及命令退出码。旧的成功报告不能代替新版本验收。发布时保留 HTML 文件名和路径，有助于保留浏览器按本地路径保存的业务记录。
