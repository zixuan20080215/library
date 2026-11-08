# 图书馆Agent后端原型

_Python 3.12标准库实现｜本地演示数据｜已含读者网页与馆员工作台｜尚未连接江大业务系统。_

启动与配置见 [运行与接入说明](../运行与接入说明.md)。接口、会话和工具的交接说明见 [架构与接口](../开发文档/架构与接口.md)，回归和打包见 [开发与发布](../开发文档/开发与发布.md)。

在项目根文件夹执行：

```powershell
python -X utf8 agent_backend\demo.py
python -X utf8 -m unittest discover -s agent_backend -p 'test_*.py' -v
```

首条命令运行离线业务流程，不调用模型；第二条运行本地测试。Windows受限沙箱若阻止SQLite写入系统临时目录，需在具有相应目录权限的本地终端运行。

首次将.env.example复制为.env，填写后端API Key，然后运行：

```powershell
python -X utf8 agent_backend\demo.py --ask '找人工智能与教育的入门书'
python -X utf8 agent_backend\server.py
```

以上两项分别为真实模型对话和本地网页/API服务。网页没有Key时使用明确标注的规则演示，填Key后自动使用DeepSeek。启动服务不会自行请求DeepSeek；聊天请求才会调用模型。填Key后需重启服务。API Key不能放在前端。初次复制配置后，之后直接修改.env，不重复覆盖。

| 文件 | 职责 |
|---|---|
| model_client.py | 配置读取、DeepSeek HTTPS请求、调用错误处理 |
| repository.py | 书目索引、CSV导入、演示数据库、预约与反馈事务 |
| tools.py | 工具协议、参数校验、结果裁剪、后端绑定读者身份 |
| agent.py | 有限次数的工具调用循环与服务端会话 |
| server.py | 127.0.0.1上的JSON API；每次启动生成X-Demo-Token |
| demo.py | 无Key演示、真实对话入口和CSV导入 |
| demo_agent.py | 无Key规则演示、中文时段解析、多轮上下文与业务确认卡 |
| demo_knowledge.py | 42类本地问答及关键词打分；官方政策未接入时明确说明边界 |
| books_template.csv | 可导入字段及虚构示例记录 |
| test_agent.py | 本地业务、规则对话和模拟模型调用测试 |

前端接入时，POST /api/chat发送message，可带此前返回的session_id。响应含answer、tool_results、pending_actions和usage。将工具结果渲染为事实卡片，将pending_actions渲染为确认卡；读者确认后用action_id调用POST /api/actions/confirm。每次POST都要带application/json和X-Demo-Token。

`confirm_action` 由独立的业务确认接口执行。上游校方数据接入经 `data_gateway.py` 选择适配器，接口契约见 [数据服务适配协议](DATABASE_API.md)。本地 `repository.py` 的 `search_books()` 使用 SQLite FTS5 检索。

当前已包含读者网页、馆员受理回复、读者确认办结与管理统计。本地演示身份不能直接用于多人部署。示例数据与自拟规则均不是学校实际情况。

