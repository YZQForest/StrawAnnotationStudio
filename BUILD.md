# StrawAnnotationStudio 构建

源码标注只需要 Python 标准库。需要 Windows exe 时，在 Windows 10/11 64 位系统安装 Python 3.12+ 后双击 `build.bat`。脚本创建虚拟环境、安装 PyInstaller、执行标注测试并打包 HTML。

产物为 `dist/StrawAnnotationStudio/StrawAnnotationStudio.exe`，必须连同 `_internal` 和说明文件一起分发。启动后保留控制台窗口，浏览器打开本机标注页面；关闭服务可按 Ctrl+C。命令行参数与 `annotate.py` 相同。

无需 FFmpeg、PySide6 或抽帧仓库。也可在各自操作系统执行 `python -m PyInstaller --noconfirm --clean StrawAnnotationStudio.spec`；PyInstaller 不支持跨系统生成 Windows exe。本次没有 Windows 真机验收或发布已验证的 Windows 二进制。
