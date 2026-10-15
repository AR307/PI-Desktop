# MirrorCoding 账号与模型路由

> 对照[英文源规格](/spec/03-runtime/21-mirrorcoding-account)。

MirrorCoding 授权由 Electron 主进程持有，通过 safeStorage 保存。Renderer 和 Node sidecar 只接收账号资料、模型目录与临时回环密钥，不接收 access token 或 refresh token。

## Provider 投影

目录同步保留历史会话使用的分组 Provider，并为每个授权账号建立稳定的账号 Provider。账号行保存可用模型、各组路由、实际倍率、生图能力和模型配置；ModelBinding.mirrorCodingGroupId 标识账号模型所选分组。

账号行是设置投影，不在输入区重复列出；分组行仍是历史会话明确的 providerId。账号模型的上下文、输出、温度、推理默认值和分组选择投影到分组行。刷新保留仍有效的选择；失效选择显示无效，等待用户重选。

## 请求路径

```text
session providerId + modelId
  -> Electron 解析账号绑定与明确分组
  -> 本机回环 relay 绑定
  -> MirrorCoding Bearer + 编码后的 X-Mirrorcoding-Group
  -> 目录声明的聊天或生图端点
```

每次请求校验模型、分组、端点及当前目录。错误后不切换模型、分组、端点或账号。非 MirrorCoding Provider 的认证和请求路径保持原样。

## 持久化与恢复

成功返回空目录会停用受管行；刷新失败保留最后成功目录。历史会话保留 Provider 身份。退出通过现有撤销流程清理凭证并停用受管行。

## 目录权限与协议

以 MC 客户端管理目录为准。聊天要求当前分组声明 text，生图要求 image 及生图能力。同 ID 在其他分组可用不代表当前分组获授权；modes、端点、Fast 和 auto 候选组分别保留，不合并组权限。

协议取当前组端点、根级 supported_endpoints 与 pi 已接通适配器的交集。已知模型的明确元数据允许时优先原生协议，其余依次为 Responses、Chat Completions、Anthropic、Gemini。名称不能授予端点权限，取代此前按 Claude 名称强制路由。SDK 路径映射为已发布路径，保留原始模型 ID、推理参数及分组，不在请求时替换。

## Fast

Fast 是会话下一轮配置，新会话默认关闭。Rust 与 provider/model 原子保存；主进程统一处理桌面与手机配置并通知变更。当前任务及工具续答使用启动快照，排队任务在实际启动时读取保存配置；手机重连读取运行快照。

仅目录明确允许所选模型、分组和 Chat 或 Responses 协议时可开启 Fast。切换模型或组关闭下一轮 Fast，必须再次主动开启；重选相同组合或只改推理等级不关闭。手机面板仅在应用时保存，取消不改变原值；同一次保存可以明确开启新组合的 Fast。

输入区以小型实心闪电表示已请求 Fast，提示和无障碍标签仍表示请求意图，不保证实际加速或自行计算加价。最终 pi payload 钩子组合原扩展，保留推理与限制，然后写入 service_tier: fast；关闭时省略。生图、标题、提示词增强和压缩不继承。relay 发送前复核能力。

Task.fast 独立于父会话，新任务默认关闭，resume 省略时保留子代理原值，显式值只改变该次续跑。先校验实际子模型授权与能力，平行子代理互不影响；工具续答和委派详情保留独立配置。模型缺失或 MC 错误不降速、不换模型或分组。

pi_fast_unavailable、model_or_group_unavailable 刷新目录并保留输入；invalid_service_tier 不重试；402 表示余额或订阅问题，不移除模型。保留现有 401 刷新及输出前 429/503 重试边界。诊断只记协议、模型、分组和档位，不含凭证或提示正文。
