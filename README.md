# Locaris · 位置中心

![Locaris](assets/logo.svg)

Home Assistant 独立位置中心。仅管理员访问，被动读取已有 GPS 定位。支持实时位置、历史轨迹、设备管理、运行策略。历史数据保留 30 天，地图及地址解析使用高德服务。

当前版本：v0.2.2-preview，正式版前验收版本。

## 安装

1. 在 HACS 的自定义仓库中添加 `https://github.com/Boxzhi/locaris`，类型选择集成（Integration）。
2. 下载 Locaris 并重启 Home Assistant。
3. 在设置 → 设备与服务 → 添加集成，搜索 Locaris，填写高德 Web JS API Key、JS API 安全密钥及 Web 服务 Key。

本版本是独立安装，不导入其他集成的配置或数据库。数据仅保存在 `/config/locaris/location.db`。首次开启设备历史记录时仍可按原有规则从 HA Recorder 补查现存定位。请仅为有位置共享许可的设备开启历史记录。

## 使用

- 侧边栏「位置中心」包含实时位置、历史轨迹、设备管理、设置。
- 标准、卫星和深色地图可在地图工具栏切换。
- 四项运行策略在设置中调整，历史保留固定 30 天。

## 品牌及测试

集成目录内 brand/ 已包含深浅主题 Icon、Logo 及高清 PNG。开发者可使用 `python scripts/build_brand.py` 重建图片（需 CairoSVG）。
运行测试：`python -m unittest discover -s tests -p 'test_*.py'`。

真实 HA/HACS 安装及移动端回归尚待验收，不属于正式稳定版。
