# LUXE Location · 位置中心

独立 Home Assistant 定位集成（开发中）。不依赖其他 LUXE 组件。

当前阶段：地图兼容性验证 v0.0.2。仅使用公开地标模拟数据，不采集真实设备定位，不建立数据库。测试版暂用域名 luxe_location_probe，正式版使用 luxe_location。

## 测试安装
HACS → 自定义仓库 → 输入 https://github.com/Boxzhi/luxe_location → 类型 Integration。当前为开发分支源码，尚未发布 Release；也可下载 main 源码并将 custom_components/luxe_location_probe 复制到 HA 的 custom_components 下，重启 HA 后添加 LUXE Location Map Probe 集成。

填写高德 Web JS API Key、安全密钥及 Web 服务 Key。测试阶段 JS 安全密钥会下发至管理员浏览器，仅用于临时验证；正式版本需安全代理。请勿提交任何真实密钥或位置数据。打开侧边栏「位置地图测试」，验证标准、卫星、深色地图、模拟轨迹、精度圈和地址解析。

## 规划
- 独立侧边栏 Custom Panel，管理员权限。
- 明确授权的 GPS 设备，被动事件采集，实时位置与历史轨迹。
- 独立 SQLite，最长滚动保留 30 天，授权后导入 Recorder 可用历史。
- 不修改家庭成员卡片及其他现有集成。
- 轨迹分段、精度筛选、原始数据保留、撤销共享及删除管理。
- 正式地图安全代理、跨平台测试及 HACS 发布。

v0.0.1 已在 Safari 验证 SDK 和底图加载，发现地图自动移动。v0.0.2 隔离地图容器布局、移除手动 resize 回调，增加中心坐标、尺寸和事件计数诊断；修复效果待实机验证。升级后重启 HA 并刷新页面，无需重新填写 Key。
