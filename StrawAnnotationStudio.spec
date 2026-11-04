from pathlib import Path
root = Path(SPECPATH)
a = Analysis([str(root/'annotate.py')], pathex=[str(root/'src')], binaries=[], datas=[(str(root/'src/strawannotate/web/index.html'), 'strawannotate/web')], hiddenimports=[], hookspath=[], hooksconfig={}, runtime_hooks=[], excludes=[], noarchive=False)
pyz = PYZ(a.pure)
exe = EXE(pyz, a.scripts, [], exclude_binaries=True, name='StrawAnnotationStudio', debug=False, bootloader_ignore_signals=False, strip=False, upx=False, console=True)
coll = COLLECT(exe, a.binaries, a.datas, strip=False, upx=False, name='StrawAnnotationStudio')
