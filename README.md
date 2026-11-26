# Locaris · 位置中心

![Locaris](assets/logo.svg)

[![Release](https://img.shields.io/github/v/release/Boxzhi/locaris?include_prereleases)](https://github.com/Boxzhi/locaris/releases)
[![CI](https://github.com/Boxzhi/locaris/actions/workflows/validate.yml/badge.svg)](https://github.com/Boxzhi/locaris/actions/workflows/validate.yml)

Home Assistant 独立位置中心，使用高德地图展示设备已有 GPS 定位与历史轨迹。

当前版本：**v1.0.0-rc.2**（正式候选版，真实 HA 环境验收通过后发布稳定版）。

## 功能

- 实时位置：已管理的 GPS 设备、地址、定位精度及最近可确认的定位变化时间；地图自动适配、安全边距、设备聚合。
- 历史轨迹：按设备与日期查询定位变化，支持地址分组、轨迹和疑似跳点提示；仅连接已记录坐标，不代表真实行走路线。
- 设备管理：自动发现 GPS 设备，独立控制管理与历史记录授权。
- 设置：发现、实时刷新、历史补查、轨迹间隔策略及卸载数据清理选项。
- 标准、卫星、深色地图；适配手机、平板和桌面。

## 安装与配置

1. 在 HACS → 自定义仓库中添加 `https://github.com/Boxzhi/locaris`，类型为集成（Integration）。
2. 下载 Locaris。候选版本需在 HACS 中选择预发布版本。重启 Home Assistant。
3. 在设置 → 设备与服务 → 添加集成中搜索 Locaris。
4. 在[高德开放平台](https://lbs.amap.com/)创建应用，准备 Web 端（JS API）Key、JS API 安全密钥及 Web 服务 Key，填写全部三项凭据。
5. 从侧边栏打开「位置中心」，仅管理员可访问。

重新配置：设置 → 设备与服务 → Locaris → 更多菜单 → 重新配置。重新填写三个凭据，集成将重新加载，不删除现有历史、管理状态或运行策略。完成后重新加载位置中心页面。配置流程检查凭据非空，是否有效由实际高德请求确认。

## 使用说明

### 实时位置

Locaris 被动读取 HA 已有的 GPS device_tracker 实体，不主动请求手机定位。列表时间为经纬度或 GPS 精度最后可确认的变化时间，不等同于 GPS 采样时间。已授权设备启动时直接从 Locaris 自身数据库恢复时间，无需等待 Recorder；历史写入及补查后重新尝试恢复未知时间。相邻历史定位不同时可确认已观察到的变化，时间并非 GPS 真实采样时刻；单独的启用时快照不作为变化时间。无历史授权的设备仅在内存维护该时间；重启后不能确认时显示「定位时间未知」。

### 历史轨迹

历史记录默认关闭，启用后记录首次有效位置及后续经纬度或精度变化，不保存电量等无关属性更新，不按日重复写入。首次启用时若已有有效位置，可记录一次明确标注的启用时位置（观察时间，不是新的 GPS 采样）；历史补查可能将重复基准去除。可按授权补查 HA Recorder 已有数据。暂停后不补查暂停期间数据，已有历史保留。

无变化日期仅引用保留期及当前授权范围内的此前位置，不写入、不计数，也不代表全天停留。历史数据保留 30 天；超过期限的定位不会永久保留作为基准。Recorder 未保存的位置无法补查。

时间格式：当天 HH:mm:ss，昨日「昨日 HH:mm:ss」，今年更早 MM-DD HH:mm:ss，跨年 YYYY-MM-DD HH:mm:ss。日期选择器始终 YYYY-MM-DD，日历当天显示「今」。日期采用浏览终端本地时区。

### 运行策略

默认设备发现 10 分钟、实时刷新 30 秒、历史补查 60 分钟、轨迹间隔 30 分钟。均可在设置中调整。实时状态变化触发更快刷新；历史界面按记录版本静默更新，今日约 10 秒、历史日期约 60 秒、同步期间约 5 秒检查。未变化时不重复读取 SQLite 列表。

## 隐私与存储

- 仅管理员访问；请仅对获得位置共享许可的设备启用历史记录。
- 本地数据库位于 `/config/locaris/location.db`，历史及地址缓存保留 30 天。未开启记录的实时地址仅在内存缓存，不写入位置历史。
- 地图由高德 Web JS SDK 提供；显示地图时会与高德通信，按需地址解析将待解析坐标发送至高德 Web 服务。请了解高德的隐私政策及服务条款。
- JS API 安全密钥及 Web 服务 Key 由服务端使用；不会在配置接口中直接返回。勿公开分享 HA 配置或数据库备份。
- 独立安装，不导入其他集成的数据库，不修改 HA Recorder。

## 更新与卸载

HACS 更新、HA 重启、禁用或重新加载集成均保留本地数据。候选版升级前建议备份数据库。

默认卸载时保留数据。若需永久清理，先在位置中心 → 设置 → 数据管理开启「删除集成时清除本地数据」，再从 HA 删除配置项，最后通过 HACS 卸载并重启。清理仅限 `/config/locaris/`，不会删除 HA Recorder、其他集成数据或备份。仅删除 HACS 文件不能保证清理钩子被调用。

## 常见问题

- 地图加载失败：检查三个高德凭据、网络连通性，重新配置后刷新位置中心；必要时使用页面提供的兼容模式。
- 位置更新慢：核对 HA 实体经纬度、精度和更新时间。Locaris 不负责触发手机 GPS。
- 历史为空：检查记录授权、Recorder 保留范围和同步状态；当天无变化时可能只有参考位置。
- 更新后版本未变化：重启 HA 并重新加载页面。

## 测试与反馈

`python -m unittest discover -s tests -p 'test_*.py'`

`node --test tests/test_panel_refresh.cjs tests/test_camera.cjs`

候选版 CI 包含 Python/JavaScript 回归、版本一致性及品牌资源检查；真实 HA/HACS、各终端和高德地图效果仍需验收。问题请通过 [GitHub Issues](https://github.com/Boxzhi/locaris/issues) 反馈，不要提交含真实定位或凭据的日志。

[更新记录](https://github.com/Boxzhi/locaris/releases) · [开源协议](LICENSE)
