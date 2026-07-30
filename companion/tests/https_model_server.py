"""Minimal TLS file server used only by the Windows companion release gate."""

from __future__ import annotations

import argparse
import functools
import http.server
import ssl
from pathlib import Path


class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, _format: str, *_args: object) -> None:
        return


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, required=True)
    parser.add_argument("--certificate", type=Path, required=True)
    parser.add_argument("--key", type=Path, required=True)
    parser.add_argument("--port", type=int, default=18443)
    args = parser.parse_args()

    handler = functools.partial(QuietHandler, directory=str(args.root.resolve()))
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(args.certificate, args.key)
    server.socket = context.wrap_socket(server.socket, server_side=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
