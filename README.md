# Locaris · 位置中心

![Locaris](assets/logo.svg)

Home Assistant 独立位置中心。实时位置、历史轨迹、设备管理、运行策略；仅管理员访问，被动读取已有 GPS 定位。历史数据保留 30 天。地图及地址解析使用高德服务。

> v0.2.0-preview 是独立迁移候选分支，尚未正式发布。不要作为现有 HACS 安装的常规更新。主分支仍保留原集成。

## 迁移与回退

详见 [MIGRATION.md](MIGRATION.md)。现阶段采用明确的人工迁移流程，不直接编辑 HA 的 .storage 配置。数据库继续使用 /config/luxe_location/location.db。

## 品牌资源

assets/ 保存已经确认的北极星 SVG。发布前执行 `python scripts/build_brand.py`（开发环境需 CairoSVG），并提交生成的 brand/ PNG。当前候选分支不包含生成的 PNG，不能作为品牌图标最终验收版本。

## 测试

`python -m unittest discover -s tests -p 'test_*.py'`

历史预览日志：[CHANGELOG-preview.md](CHANGELOG-preview.md)。
