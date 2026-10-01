# 安卓伴侣与限定范围的桌面同步

> 对照[英文源规格](/spec/03-runtime/23-mobile-companion)。

手机使用同一 MC 账号及一次性配对码访问明确共享的项目或会话。项目共享包括后来归入的会话；单会话不扩展到其他会话。桌面必须运行且在线，执行与完整历史仍归桌面。

桌面右键可同步到移动端，账号设置管理配对码和设备授权，支持取消、重新生成及撤销。重启、手机令牌刷新保留共享；换账号断开连接。手机明确退出清理凭证和设备登记，再登录需重新登记与配对。新登记不能继承旧设备授权，旧授权由桌面管理器撤销。

手机提供登录及验证挑战、配对、项目和会话导航、历史分页、流式正文与思考、工具、计划、图片、审批、回答问题、发送和停止。可修改当前共享会话的智能体、计划、Goal、图片模式及模型、组、推理和已声明生图参数。权限仍归桌面；直接生图走 ImageService。不支持的源保持只读；不开放新建项目或会话、服务商管理、终端和文件浏览器。

顶部合并会话、电脑与连接状态，不额外占在线横栏。模型、模式、账号和配对使用可访问底部面板，破坏性操作使用居中确认。Android 返回先关闭最内层界面；实时快照不覆盖面板未应用选择。遵守安全区和减少动画设置。

附件分块传输，提交前转成桌面会话引用；下载只允许授权会话内附件。普通文件不能作为生图参考。Android 支持保存和分享图片；下载重试不再次生图。

聊天进入现有队列，手机 UUID 贯穿排队和持久用户消息，桌面重启后仍保留。忙碌的直接生图拒绝重复提交并保留草稿。两端展示相同持久消息。手机停止使用 turn/interrupt 中断运行或生图；turn/stop 保留 RACP 协作式停止语义。审批以首个有效决定为准，后续显示已处理。

计划与 Goal 审批在筹划结束后仍可见。手机重连或 Rust 尚在而 AgentHost 重建时，从 Rust 恢复待审批及原有效期，沿用既有处理流程。完整桌面重启后，待审批按 Rust 原逻辑变为中断，不可冒充仍待审批。

手机后台可挂起连接，前台或重连恢复状态和事件。确认丢失先查 message/status 的 running、queued、persisted 或 unknown，不自动重发不确定操作。撤销共享立即关闭手机流，不停止已运行桌面任务。

手机用 IndexedDB 按会话缓存约最近 500 条及持久事件游标，重开先显示缓存，再以 includeSnapshot: false 附加并从游标订阅增量。进程内重连使用现存内容。游标离开重放窗口、旧桌面未支持轻量状态或无缓存时读取完整快照重建缓存。退出、撤销和授权消失立即清理相应缓存。

保持 Renderer、preload、main、Rust 与 Node 分工。MC 仅管登录、设备、配对及在线转发；移动接入不开放原始 IPC、终端或任意文件。凭证不进入手机历史或桌面 sidecar。

session/list 可按授权过滤。快照含实际模型、组、模式、生图配置、计划、图片任务、队列摘要及压缩标记，区分运行快照与下一轮保存选择，分别记忆聊天和生图。session/modelCatalog 只暴露选择元数据，在打开、配置保存及 configurationChanged 通知时刷新。session/configure 原子校验模型与组，只写获授权会话。turn.activity 通知图片和配置变化后读取实时状态；历史走 Rust 分页，每次命令、订阅和发送重查项目归属。

connection/initialize 以 sessionState、itemContent 可选能力声明新接口。未声明时保留完整快照契约。session/state 只返回状态、计划、队列、游标、修订等，不含历史页；session/attach 的 includeSnapshot: false 返回该状态，避免每个流事件重下历史。

移动投影每字段上限 MOBILE_ITEM_CONTENT_LIMIT 为 64 KiB，防止超大消息超过 relay 帧限制。Rust 添加显示截断标记；session/item 按需分块读取完整 JSON，如 attachment/read，原始完整历史仍保存在桌面。

turn/cancel 删除排队任务；turn/prioritize 为立即发送，在运行时允许 steering 时加入当前任务（ADR 0265）。按 parentToolCallId 聚合子代理卡，按投影显示压缩分隔。

运行中可保存下一轮聊天模型与推理，当前请求和工具续答保持原启动配置。模式切换等待任务与审批空闲。MC 按模型再分组及实际计费元数据选择，其他服务商保留来源标识。生图参数限目录声明的尺寸、比例、质量和数量。

详见[MC 交接](/mirrorcoding-mobile-sync-requirements)与[架构决策](/adr/mobile-companion-relay)。本地受控验收、MC 团队验收及正式部署分别记录。

## 会话 Fast 与 Ultra

配置同时含独立的 ultra。当前快照显示有效原生推理，next/chat 保存偏好；子卡显示实际模型、组、等级；换模型或组关闭 Ultra，详见[Ultra 协作](ultra-collaboration.md)。

模型面板暂存 Fast、组和推理，一次 session/configure 保存。目录含 fastAvailable 与不可用原因；current、next、chat 均携带 Fast，current 取启动快照。图片不发 Fast，回聊天恢复独立选择。运行中更改下一轮生效；图片和辅助调用不继承。MC 只转发现有 RACP 帧，不增加服务端状态。
