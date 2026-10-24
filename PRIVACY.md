# 隐私说明（DeepSieve · AI 评论滤除）

基于开源项目 [dafeiyu-cleaner](https://github.com/liyupi/dafeiyu-cleaner)（MIT）修改，隐私约定与原版一致：

- 不收集任何数据，没有服务器，没有统计埋点
- 设置、名单、前科记忆、精判缓存都只保存在浏览器本地（`chrome.storage.local`）
- 不读取 Cookie，不调用 B 站任何写接口（不删除、不举报、不拉黑），所有「隐藏」都只发生在你自己的浏览器里
- 只有开启 DeepSeek 精判后，才会把可疑账号的昵称、等级、签名和最多 3 条评论发送到 `api.deepseek.com`，使用你自己配置的 API Key；结果在本机缓存 7 天
- 空间主页鉴定只调用 B 站两个无需签名的公开只读接口（资料卡、近期投稿列表）
