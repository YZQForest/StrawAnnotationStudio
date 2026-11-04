# StrawAnnotationStudio · 秸秆标注工作台

独立运行的离线人工像素标注工具：画笔、矩形、多边形、缩放平移、撤销重做、自动保存、独立复标与完整研究包导出。主流程为“填写标注者 → 铺背景和标注 → 完成检查 → 导出”。

本仓库从原 StrawFrameExtractor 的标注模块独立拆出，当前版本 **2.2.0**。视频抽帧由配套仓库 [StrawFrameStudio](https://github.com/YZQForest/StrawFrameStudio) 提供。本仓库不包含视频抽帧、科研原图或人工标签。

## 启动

安装 Python 3.12+，运行时无第三方 Python 依赖，无需 Qt、FFmpeg 或模型下载。

- Windows：双击 `annotate.bat`。
- macOS：双击 `打开标注工具.command`，或执行 `python3 annotate.py`。
- Linux：执行 `python3 annotate.py`。
- 无 Python：直接用现代浏览器打开 `src/strawannotate/web/index.html`，导入图片并下载 ZIP。

首次下载若 Mac 启动脚本没有执行权限，运行 `chmod +x 打开标注工具.command`。

```sh
python3 annotate.py --images "/path/to/run/images" --output "/path/to/annotations"
```

服务仅监听 `127.0.0.1:8765`，保留终端窗口。端口可用 `--port` 调整；`--no-open` 禁止自动打开浏览器。导入抽帧任务的 `images` 时，会自动读取同级 `metadata/metadata.csv` 的帧来源。也可用 `--catalog` 指定任务清单。未提供图片目录时，通过页面“更多”导入，不预置私有科研图片。

## 保留研究信息

导出包含原图（保持原始字节）、材料掩码、有效地面 ROI、训练掩码、元数据、CSV、检查声明、覆盖率上下界和逐文件 SHA-256。

- 材料：`0=背景、255=秸秆、128=材料不确定`；草稿另有 `64=未标`。
- 训练：`0=背景、1=秸秆、255=ignore`；草稿与完成项隔离。
- 不确定材料仍计入有效地面；完成检查分别保存地面范围、整幅检查和人工判断。
- 数据 schema 保持 `straw-annotation/2`，兼容原 v2.0/v2.1 研究包。

详细操作、快捷键和格式见 [标注说明](docs/ANNOTATION.md)。格式检查不等于人工标签质量认证。

## 迁移已有工程

先在旧版中“更多 → 备份全部进度”，再在新版本“恢复数据包”。本次保留浏览器数据库名和工程识别规则；相同浏览器、端口、图片/输出路径可继续使用原缓存。单 HTML 文件路径变化或更换浏览器时，请用导出包迁移，勿依赖自动缓存。

## 测试与构建

```sh
PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_annotation.py' -v
```

浏览器合成数据测试见 `tests/annotation_ui_smoke.cjs`，需另装 Playwright、pngjs 和测试浏览器。运行 `node tests/annotation_ui_smoke.cjs`；默认输出到临时目录，不写科研标签目录。

Windows 可执行程序构建见 [BUILD.md](BUILD.md)。当前验收范围见 [TEST_REPORT.md](TEST_REPORT.md)，拆分记录见 [CHANGELOG.md](CHANGELOG.md)。
