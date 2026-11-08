# 秸秆标注工作台 · StrawAnnotationStudio

给课题组使用的本地网页标注工具，当前版本 **2.3.0**。导入图片 → 描绘秸秆 → 检查 → 导出。图片和标注在本机处理，无需账号、GPU 或模型下载。

## 组员怎么打开

1. 点击仓库绿色 **Code → Download ZIP**，解压整个文件夹。
2. 双击根目录 **`打开标注网页.html`**，用桌面版 Chrome / Edge 等现代浏览器打开。
3. 顶部填写自己的姓名或固定代号，点击 **导入图片** 或 **导入文件夹**。

请保留完整文件夹，不要只取启动 HTML。纯网页版本的结果保存在浏览器下载目录。若浏览器限制文件页面的存储、哈希或解压功能，请用下方本机服务入口。

### 本机服务入口（已有 Python 时推荐）

安装 Python 3.12+，无需其他 Python 依赖：

- macOS：双击 `打开标注工具.command`。如无执行权限，在项目目录执行 `chmod +x 打开标注工具.command`。
- Windows：双击 `annotate.bat`。
- 或在项目目录运行 `python3 annotate.py`（Windows 可用 `python annotate.py`）。

浏览器自动打开 `http://127.0.0.1:8765`；使用期间保持终端窗口打开。默认导出位置是用户文档目录的 `StrawAnnotations`。页面成功导出后会显示具体位置。

## 一张图片怎么标

1. **初始化**：按需点“未标区填背景”。只填未标地面，不覆盖已有秸秆、争议和遮挡。
2. **描绘**：绿色标可辨认的玉米茎秆、枯叶、碎片及地表残留根茎；背景包含土壤、石块、活体杂草。用画笔或圈选，圈选 Enter / 双击闭合。
3. **难判处**：材料无法确定时选“不确定”；人物、工具等非地面遮挡才选“遮挡”。不要把阴影或难判材料直接排除，也不要填掉秸秆之间的土壤孔隙。
4. **检查**：点“逐区检查”按 512 原图像素分格放大，检查细碎片和边缘。“上一格”可返回。导航不自动声明检查通过，填背景也不代表没有漏标。
5. **完成**：检查整幅及有效地面后勾选完成检查，点“完成，下一张”。
6. **交付**：点击右上“导出结果”，把得到的**整个 ZIP** 交给负责人。未完成就下班时，用“更多 → 备份全部进度”，草稿也会保留。

常用快捷键：`1` 秸秆、`2` 背景、`3` 不确定；`B` 画笔、`P` 圈选；空格拖动；Ctrl/⌘+滚轮缩放；Ctrl/⌘+Z 撤销；Tab 切换原图。更多操作见 [标注说明](docs/ANNOTATION.md)。

## 结果怎么看、后续怎么用

一次导出一个完整数据包，本机服务还会保存解包目录。**先看 `summary.csv`**，每行一幅图，包含图片名、完成状态、覆盖率及上下界、视频/帧/时间信息和训练文件路径。`START_HERE.txt` 附快速说明。

| 内容 | 用途 |
|---|---|
| `images/` | 保持原始字节的图片 |
| `training_masks/` | 已完成项目的训练标签：0 背景、1 秸秆、255 忽略 |
| `human_masks/` | 材料标签：0 背景、255 秸秆、128 争议 |
| `valid_roi/` | 有效地面：255 有效、0 排除 |
| `metadata/`、`manifest.json` | 完整来源、身份、检查记录、像素统计及哈希 |
| `annotations.csv` | 详细汇总 |
| `drafts/`、`draft_training_masks/` | 备份中的草稿，不能作为正式标签 |

覆盖率按**有效地面像素**计算。存在争议时 `coverage_pp` 留空，并给上下界；空值不是 0，不应当作精确覆盖率真值。训练时忽略争议像素不意味着评价时可以缩小覆盖率分母。完成状态表示标注者提交，不等于已独立复核正确。

### 时序实验所需来源

从配套 [StrawFrameStudio](https://github.com/YZQForest/StrawFrameStudio) 抽帧目录启动，可自动读取同级 `metadata/metadata.csv`：

```sh
python3 annotate.py --images "/path/to/run/images" --output "/path/to/annotations"
```

也支持 `--catalog`。普通浏览器导入图片不会凭空恢复视频来源，缺失字段留空；需由负责人保留原始抽帧清单并核对关联。视频编号也不保证地面独立，训练/测试仍需按重复地面分组，工具不自动随机划分。

## 保存与多人协作

- 自动保存是**当前浏览器缓存**，不是磁盘归档。结束时导出或备份；不要清缓存后再找标签。
- 换电脑或浏览器：通过“更多 → 恢复数据包”继续。
- 每人使用自己的代号，按分配图片工作；不要互相覆盖结果。复标从“更多 → 新建独立复标 / 新工程”空白开始。
- 旧版升级前先备份 ZIP；保留 v2 数据格式和旧包恢复能力。没有科研原图或人工标签被提交到仓库。

## 开发与验证

```sh
PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_annotation.py' -v
node tests/annotation_logic.cjs
node tests/annotation_ui_smoke.cjs
```

浏览器测试另需 Playwright、pngjs 和 Chromium；可用 `ANNOTATION_CHROME` 指定浏览器。每次推送由 GitHub Actions 自动运行全部三项：Python 测试在 Linux、Windows、macOS 上运行，浏览器流程在 Linux Chromium 中运行（`.github/workflows/tests.yml`）。测试仅使用合成图。验证记录见 [TEST_REPORT.md](TEST_REPORT.md)，Windows 打包见 [BUILD.md](BUILD.md)。源码更新不会自动更新旧 exe。
