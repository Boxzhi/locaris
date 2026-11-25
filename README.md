# Locaris · 位置中心

![Locaris](assets/logo.svg)

Home Assistant 独立位置中心。实时位置、历史轨迹、设备管理、运行策略；仅管理员访问，被动读取已有 GPS 定位。历史数据保留 30 天。地图及地址解析使用高德服务。

> v0.2.1-preview 是独立迁移候选分支，尚未正式发布。不要作为现有 HACS 安装的常规更新。主分支仍保留原集成。

## 迁移与回退

详见 [MIGRATION.md](MIGRATION.md)。卸载旧集成后重新添加 Locaris，首次启动安全复制旧 SQLite 数据库至 /config/locaris/location.db，保留旧库作为手动回退备份，不直接编辑 HA 内部配置。

## 安装验收

下载 [迁移候选分支 ZIP](https://github.com/Boxzhi/locaris/archive/refs/heads/locaris-migration.zip)，按照迁移文档备份并卸载旧集成后，将其中 `custom_components/locaris/` 完整复制至 HA 配置目录，再重启并添加 Locaris。此分支尚不作为 HACS 常规更新使用。

## 品牌资源

assets/ 保存北极星 SVG，custom_components/locaris/brand/ 已包含八张经过自动化尺寸及透明通道检查的 PNG，无需额外安装或生成。开发者可执行 `python scripts/build_brand.py` 重新构建。

## 测试

`python -m unittest discover -s tests -p 'test_*.py'`

历史预览日志：[CHANGELOG-preview.md](CHANGELOG-preview.md)。
