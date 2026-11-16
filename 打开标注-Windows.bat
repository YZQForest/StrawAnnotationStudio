@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "标注工具\开始标注.html" (
  echo 找不到标注工具文件夹。请完整解压，并保持启动文件与文件夹相邻。
  pause
  exit /b 1
)
start "" "%~dp0标注工具\开始标注.html"
