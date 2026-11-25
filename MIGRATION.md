# Locaris 迁移候选方案 · v0.2.1-preview

本分支用于迁移验收，尚未完成真实 HA/HACS 安装回归。main 保持 v0.1.57-preview。不要将本分支作为旧 HACS 集成的普通升级版本。

## 迁移策略

采用用户确认的卸载旧集成、重新添加 Locaris 的方案。不直接编辑 HA 内部 .storage，不自动迁移密钥，不兼容旧面板、旧 WebSocket。新集成拒绝在旧 Domain luxe_location_probe 仍有配置项时启动。

- 新数据库：`/config/locaris/location.db`。
- 旧数据库：`/config/luxe_location/location.db`，迁移完成后保留为手动备份。
- 首次启动且新库不存在时，用 SQLite backup API 将旧库（含已提交的 WAL 数据）复制到新目录的临时文件。
- 校验 integrity_check、原有六张表和 foreign_key_check，随后在同目录原子发布，禁止覆盖现有目标文件。
- 迁移失败不创建空白替代库，不删除源库；旧库或新库存在孤立 WAL/SHM/journal 文件时阻止初始化。新旧库都不存在时正常全新安装。
- 现有目标库不重复迁移。保留原表名（probe_*）、数据格式及运行策略等元数据，不做危险的表重命名。数据库保留期仍为 30 天；旧目录作为静态备份不再自动清理，也可能含有超期定位数据。
- 浏览器偏好及 WebGL 会话键统一为 locaris.*。顶部标题栏恢复默认显示，地图 WebGL 自动纠正重新检测，不改变核心图层切换逻辑。
- 备份发布要求目标文件系统支持硬链接及目录 fsync（HA/Linux）。数据库复制操作的进度回调有 30 秒截止保护；完整性检查另需执行时间。

## 验收环境操作步骤

1. 创建完整 HA 备份，保存原有三项高德密钥。停止旧集成写入后备份整个 /config/luxe_location/ 目录，含可能存在的 WAL/SHM；不要将密钥或数据库上传到 GitHub。
2. 在 HA 集成页面移除旧配置项，卸载旧 HACS 集成代码，重启 HA。确认旧集成未运行。不要删除旧数据目录。
3. 下载 locaris-migration 分支，复制 custom_components/locaris/ 至 HA 的 /config/custom_components/locaris/。将已经确认的八个 PNG 品牌文件放在 brand/ 子目录；若从源码生成，则在开发环境安装 CairoSVG 并执行 python scripts/build_brand.py 后再复制。不要在 HA 运行时安装额外绘图库。
4. 重启 HA，添加 Locaris，重新填写高德三个密钥。首次初始化自动复制旧数据库。
5. 确认新目录数据库存在、历史点及设备/排除状态、地址缓存、运行策略正常。注意启动后正常清理会删除超期数据、Recorder 补查也可能产生新数据，记录数不必始终完全相等。
6. 验证重启不重复导入、不覆盖新数据；确认实时、历史地图以及 HA App 深色地图正常。
7. 验收通过后将旧目录作为受保护的短期回退备份；之后由用户明确确认再手动删除，不由 Locaris 自动删除。切勿再次添加旧集成或同时使用两个集成。

## 回退

先停止并移除 Locaris 配置项及代码，保留两个数据库目录，重启 HA。恢复 v0.1.57-preview 并添加旧集成，使用原目录备份。旧库不会自动包含 Locaris 迁移后产生的新历史；若需要保留这些记录，先备份新旧库，再评估离线反向 SQLite 备份，不能直接覆盖现有库。请不要删除新库后重新启动而无意中恢复已过时的旧库。

## 发布状态

- 迁移分支独立，GitHub 仓库尚未更名，main 未更新。
- SVG 与开发期 PNG 构建脚本已提交；实际 PNG 二进制尚未提交，测试安装需复制 brand/。
- 测试：python -m unittest discover -s tests -p 'test_*.py'。迁移独立测试覆盖 WAL、全新安装、重复迁移、损坏库、不完整 schema、外键异常、残留 sidecar、空目标、超时及竞争发布。尚未完成真实 HA/HACS 回归。
