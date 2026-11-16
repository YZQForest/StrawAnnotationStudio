#!/bin/sh
# Keep this file next to the complete 标注工具 folder.
cd -- "$(dirname -- "$0")" || exit 1
if [ ! -f "标注工具/开始标注.html" ]; then
  printf '%s\n' '找不到标注工具文件夹。请完整解压下载包，并保持启动文件与文件夹相邻。'
  read -r reply
  exit 1
fi
# Prefer Chrome for consistent local-file storage; otherwise use the default browser.
if [ -d '/Applications/Google Chrome.app' ]; then
  open -a 'Google Chrome' '标注工具/开始标注.html'
elif [ -d '/Applications/Microsoft Edge.app' ]; then
  open -a 'Microsoft Edge' '标注工具/开始标注.html'
else
  open '标注工具/开始标注.html'
fi
