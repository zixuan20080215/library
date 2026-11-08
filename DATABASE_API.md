# 数据服务适配协议 v1

_本项目预留协议，不是江苏大学已公开或已接入的业务API。实现入口：data_gateway.py。_

## 🔌 接入约定

将来若有可使用的数据库或业务系统，由授权的数据服务将其转换为本协议。所有操作使用HTTPS POST，路径为LIBRARY_API_BASE_URL加上/library/v1/及下表路径。请求体与响应体均为UTF-8 JSON对象，凭证通过Authorization: Bearer发送，不能回传至前端。

SQLite数据访问与HTTPS适配实现相同的方法集合。要接入MySQL或PostgreSQL，可以另外实现这些方法，再在create_repository中选择对应适配器；当前并未安装这些数据库的驱动，也未验证校方系统连接。

## 📋 操作列表

| 路径后缀 | 请求字段 | 响应主体 |
|---|---|---|
| books/list | limit | items书目数组 |
| books/search | query、limit | items候选数组、retrieval检索方式 |
| books/locate | book_id | 书目ID、题名、楼层、区域、索书号、书架与来源 |
| seats/map | owner、start_at、end_at | items座位数组、实际查询时段 |
| seats/search | start_at、end_at、limit及筛选条件 | items候选座位、实际查询时段 |
| bookings/get | owner、booking_id | 当前读者的预约记录 |
| readers/services | owner | bookings与tickets两个数组 |
| tickets/get | owner、ticket_id | 当前读者的问题、回复及办理历史 |
| actions/prepare | owner、kind、payload | action_id、preview、requires_confirmation、expires_at |
| actions/confirm | owner、action_id | 实际执行后的预约或问题记录 |
| overview | owner | 书目、座位、使用与问题统计 |
| staff/tickets | 无 | items问题数组 |
| tickets/update | owner、ticket_id、operation、reply、staff | 更新后的问题及办理历史 |
| staff/seats/update | seat_id、disabled | ID与停用状态 |

owner由已登录的后端上下文绑定。当前只有固定本地演示身份；真实数据服务不得仅凭任意传入owner或staff布尔字段授予权限，应结合数据服务凭证与真实登录授权验证操作。staff字段描述操作场景，不能作为权限证明。

## 📚 书目返回结构

```json
{
  "items": [
    {
      "id": "BOOK-001",
      "title": "题名",
      "author": "作者",
      "isbn": "ISBN 或空字符串",
      "publisher": "出版社或空字符串",
      "summary": "相关简介片段",
      "subjects": "教育|人工智能",
      "call_number": "索书号或空字符串",
      "floor": 3,
      "zone": "已核实的馆藏区域",
      "shelf_id": "已核实的书架标识或空字符串",
      "source": "数据来源",
      "is_demo": false,
      "updated_at": "2026-10-29T14:00:00+08:00",
      "availability": "unknown",
      "reference": "book:BOOK-001"
    }
  ],
  "retrieval": "由数据服务说明，例如hybrid"
}
```

图书字段为字符串，floor可为整数或null，is_demo为布尔值。没有的数据保留空字符串或null，不补造。可借状态必须来自实际业务查询，静态导入时为unknown。检索每次最多返回5条，并裁剪简介；禁止通过此接口返回完整馆藏或无关读者信息。

## 📊 座位、预约与状态

座位记录包含 `id`、`seat_number`、`floor`、`zone`、`has_power`、`near_window`、`quiet_zone`、`row_no`、`col_no`、`disabled`、`status` 和 `my_booking_id`。`id` 在不同阅览室之间也唯一，`seat_number` 保留原始编号，例如 `C902`。设施字段为布尔值或 0/1，资料缺失时为 `null`。`status` 取 `available`、`reserved`、`checked_in` 或 `unavailable`。当前读者可获取自己在该座位的预约编号。

时段采用含时区的 ISO 8601 字符串，例如 `2026-10-30T14:00:00+08:00`。预约返回 `id`、`seat_id`、`seat_number`、`zone`、`start_at`、`end_at`、`status` 和 `is_demo`。数据服务负责检查时段冲突并更新状态。

kind支持reserve、check_in、cancel、release和feedback。prepare仅生成短时有效的待确认记录；confirm必须校验身份、有效期、停用与时间冲突，并保持幂等。确认失败必须返回错误，不能先返回成功再丢弃记录。

示例待确认响应：

```json
{
  "action_id": "不可猜测的操作标识",
  "kind": "reserve",
  "preview": {
    "seat_id": "SEAT-001",
    "start_at": "2026-10-30T14:00:00+08:00",
    "end_at": "2026-10-30T16:00:00+08:00"
  },
  "requires_confirmation": true,
  "expires_at": "2026-10-30T13:55:00+08:00",
  "is_demo": false
}
```

## 📝 事务与统计

问题返回id、category、location、description、status、created_at、updated_at、reply、history、is_demo、officially_submitted。history数组每项含status、actor、note、created_at。仅在官方业务系统实际接收时，才能将officially_submitted设为true。

状态流转为pending→processing→replied→closed。馆员accept将待受理改为处理中，reply需填写处理回复；读者confirm将待确认改为已办结，reopen则回到处理中。每步记录实际操作与时间。

overview返回books_total、seats_total、in_use、reserved、pending_tickets、total_tickets、utilization、hourly_bookings、is_demo。utilization按当前使用中座位/全部座位计算，hourly_bookings每项为hour与count。统计须来自实际记录，不预填增长率或效果数据。

错误建议返回HTTP 4xx/5xx及error字段。当前适配器会将失败显示为数据服务错误，不静默切回演示数据，避免把接口故障当成真实无结果。

