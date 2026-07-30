"""Worker entry point used by development and PyInstaller."""

import uvicorn


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=17842,
        access_log=False,
        server_header=False,
        workers=1,
    )
