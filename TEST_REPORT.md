# StrawAnnotationStudio 验证报告

日期：2026-11-04（Asia/Shanghai），独立仓库 v2.2.0。

- 标注数据包与本机服务测试：9/9 通过。包含训练映射、覆盖率核算、草稿/完成门、损坏检测、路径越界、独立导出和令牌校验。
- 抽帧桥接入口能发现本仓库，独立子进程正常提供网页和 catalog，输出路径正确。
- Python 语法检查通过；原数据 schema 和浏览器存储键保持兼容。
- 本轮未重跑完整浏览器交互测试、Windows 构建或 Windows 真机测试。

历史 v2.1 曾通过 9 项 Python 测试和 12 项合成浏览器流程。原始记录保留于 StrawFrameStudio 历史提交 `53804b9b2a212ba797b0c914c55ee9e2a2f17109`，不作为本轮新测。

## 2.3.0 — 2026-11-07

- Python unit suite: 9 tests passed in the editing environment.
- JavaScript syntax check and git whitespace check passed.
- `node tests/annotation_logic.cjs` passed: exercises actual frontend fill, coverage, navigation and summary code; verifies labels survive background fill, uncertain coverage stays null and zero-valued frame/time fields survive export.
- Browser smoke suite updated for safe fill, review navigation and export confirmation. This run could NOT execute browser workflows: Chromium launch failed with `socket() failed: Operation not permitted`. No claim of completed visual or cross-platform validation for 2.3.0.
- All tests use synthetic data, not verified human research labels. macOS/Windows launcher and real annotation throughput still require local use.
