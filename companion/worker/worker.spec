# PyInstaller recipe for the signed worker payload. Large model/voice files are
# downloaded and verified separately; they are intentionally absent here.

from PyInstaller.utils.hooks import collect_all

pykokoro_data, pykokoro_binaries, pykokoro_hidden = collect_all("pykokoro")

analysis = Analysis(
    ["run.py"],
    pathex=[SPECPATH],
    binaries=pykokoro_binaries,
    datas=pykokoro_data,
    hiddenimports=pykokoro_hidden + ["main", "uvicorn.logging", "uvicorn.loops.auto"],
    noarchive=False,
)
archive = PYZ(analysis.pure)
executable = EXE(
    archive,
    analysis.scripts,
    analysis.binaries,
    analysis.datas,
    [],
    name="SpeakingLab.KokoroWorker",
    console=False,
)
