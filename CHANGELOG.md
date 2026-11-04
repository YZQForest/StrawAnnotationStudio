# 变更记录

## 2.2.0 · 2026-11-04

- 从 StrawFrameExtractor 提交 `53804b9b2a212ba797b0c914c55ee9e2a2f17109` 拆出独立标注仓库，原始历史保留于改名后的 StrawFrameStudio。
- Python 包名为 `strawannotate`，新增独立构建配置、入口和说明；网页使用新名称，移除特定科研目录的固定图片数量提示。
- 保留两栏工作流、自动保存、空白复标、原图字节、掩码编码和 `straw-annotation/2` 数据格式。原数据包无需转换。
