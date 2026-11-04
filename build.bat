@echo off
setlocal
cd /d "%~dp0"
if not exist .venv\Scripts\python.exe (
  py -3 -m venv .venv
  if errorlevel 1 goto fail
)
.venv\Scripts\python.exe -m pip install -r requirements-dev.txt
if errorlevel 1 goto fail
set PYTHONPATH=src
.venv\Scripts\python.exe -m unittest discover -s tests -p test_annotation.py
if errorlevel 1 goto fail
.venv\Scripts\python.exe -m PyInstaller --noconfirm --clean StrawAnnotationStudio.spec
if errorlevel 1 goto fail
copy README.md dist\StrawAnnotationStudio\README.md >nul
copy BUILD.md dist\StrawAnnotationStudio\BUILD.md >nul
xcopy /e /i /y docs dist\StrawAnnotationStudio\docs
if errorlevel 1 goto fail
echo Ready: dist\StrawAnnotationStudio\StrawAnnotationStudio.exe
pause
exit /b 0
:fail
echo Build failed. Review the error above.
pause
exit /b 1
