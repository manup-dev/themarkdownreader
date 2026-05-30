"""Console-script entrypoint for `jupyter md-reader`.

JupyterLab's `jupyter` CLI resolves `jupyter <name>` to a binary called
`jupyter-<name>` on PATH (the legacy convention from jupyter_core). So this
module is wired up via pyproject.toml as:

    [project.scripts]
    "jupyter-md-reader" = "jupyterlab_md_reader.cli:main"

Subcommands:

    jupyter md-reader doctor      Diagnose the local AI runtime (Ollama).
    jupyter md-reader version     Print the installed version.

The doctor subcommand is the user-facing answer to "Do I have to install
Ollama too?" — it tells them in plain text what's set up, what isn't, and
the exact commands to fix the gaps. We keep it dependency-free (stdlib only)
so it works inside any minimal venv that has the wheel installed.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import socket
import sys
import urllib.error
import urllib.request
from typing import Optional

from . import __version__

OLLAMA_DEFAULT_URL = "http://localhost:11434"
RECOMMENDED_MODEL = "qwen2.5:7b"
# Default daemon-probe timeout. 2s was too tight for cold-start Ollama on
# Windows / WSL2 (first request after sleep can take 3–5s); 5s is the
# Goldilocks value across the three OS we support.
DEFAULT_OLLAMA_TIMEOUT = 5.0

# ANSI colors — only emit on terminals that actually render them. Legacy
# cmd.exe on Windows pre-Win10 has isatty()=True but doesn't understand
# `\033[...m`, so we additionally gate on Windows Terminal / ANSICON markers
# when running on `nt`.
_USE_COLOR = sys.stdout.isatty() and (
    os.name != "nt"
    or os.environ.get("WT_SESSION")          # Windows Terminal
    or os.environ.get("ANSICON")             # ANSICON shim
    or os.environ.get("TERM_PROGRAM")        # VS Code integrated terminal
    or "xterm" in (os.environ.get("TERM") or "")
)


def _c(code: str, text: str) -> str:
    if not _USE_COLOR:
        return text
    return f"\033[{code}m{text}\033[0m"


def _ok(text: str) -> str:
    return _c("32", text)  # green


def _warn(text: str) -> str:
    return _c("33", text)  # yellow


def _err(text: str) -> str:
    return _c("31", text)  # red


def _dim(text: str) -> str:
    return _c("2", text)  # dim


def _check_executable(name: str) -> Optional[str]:
    """Return the absolute path to `name` if on PATH, else None."""
    return shutil.which(name)


def _is_safe_http_url(url: str) -> bool:
    """Lock urllib's universal scheme support down to http(s).

    `urllib.request.urlopen` happily follows ``file://``, ``ftp://`` and
    redirects to arbitrary URL schemes — passing ``--ollama-url
    file:///etc/passwd`` would otherwise read local files. The doctor is a
    user-facing CLI, so we whitelist scheme up front rather than rely on
    later checks.
    """
    return url.startswith(("http://", "https://"))


def _assert_safe_http_url(url: str) -> None:
    """Raise ValueError on non-http(s) URLs.

    Helpers below call this rather than silently returning a benign value
    when given a bad URL — silent failure hides programmer error from any
    future caller that forgets the outer entry-point check in
    :func:`cmd_doctor`. The user-facing CLI path still pre-validates and
    prints a friendly message; the raise here is the developer-facing
    safety net.
    """
    if not _is_safe_http_url(url):
        raise ValueError(f"Unsafe URL scheme: {url!r}")


def _check_ollama_reachable(url: str, timeout: float = DEFAULT_OLLAMA_TIMEOUT) -> bool:
    """Try GET /api/tags against the Ollama server."""
    _assert_safe_http_url(url)
    try:
        req = urllib.request.Request(f"{url.rstrip('/')}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return 200 <= resp.status < 300
    except (urllib.error.URLError, urllib.error.HTTPError, socket.timeout, ConnectionError, OSError):
        return False


def _list_ollama_models(url: str, timeout: float = DEFAULT_OLLAMA_TIMEOUT) -> list[str]:
    """Return list of installed Ollama model names, or [] on error.

    Defensive against a malformed/unexpected response shape: a rogue or
    misconfigured server could return JSON whose top level isn't a dict,
    whose ``"models"`` isn't a list, or whose entries aren't dicts. None
    of that is exploitable today (the result is only printed in the
    doctor summary), but defensive parsing prevents a future caller that
    iterates the names from crashing on AttributeError/TypeError.
    """
    _assert_safe_http_url(url)
    try:
        req = urllib.request.Request(f"{url.rstrip('/')}/api/tags", method="GET")
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, urllib.error.HTTPError, socket.timeout, ConnectionError, OSError, ValueError):
        return []
    if not isinstance(data, dict):
        return []
    models = data.get("models", [])
    if not isinstance(models, list):
        return []
    out: list[str] = []
    for m in models:
        if not isinstance(m, dict):
            continue
        name = m.get("name", "")
        if isinstance(name, str) and name:
            out.append(name)
    return out


def _print_summary(checks: list[tuple[str, bool, str]]) -> None:
    """Pretty-print the doctor summary table."""
    print()
    for label, ok, detail in checks:
        marker = _ok("  OK  ") if ok else _warn(" MISS ")
        print(f"[{marker}] {label}")
        if detail:
            print(f"         {_dim(detail)}")
    print()


def cmd_doctor(args: argparse.Namespace) -> int:
    """Diagnose local AI runtime. Exit 0 if WebLLM (zero-install) is enough."""
    ollama_url = args.ollama_url or OLLAMA_DEFAULT_URL
    if not _is_safe_http_url(ollama_url):
        print(_err(
            f"Refusing to probe Ollama via non-http(s) URL: {ollama_url!r}\n"
            f"Use a URL like http://localhost:11434 instead."
        ), file=sys.stderr)
        return 2
    print(_c("1", "Markdown Reader · Doctor"))
    print(_dim(f"Checking AI runtime (Ollama @ {ollama_url})…"))

    checks: list[tuple[str, bool, str]] = []

    # 1. Ollama CLI on PATH
    ollama_path = _check_executable("ollama")
    checks.append((
        "Ollama CLI on PATH",
        bool(ollama_path),
        ollama_path or "ollama binary not found — install: curl -fsSL https://ollama.com/install.sh | sh",
    ))

    # 2. Ollama daemon reachable
    reachable = _check_ollama_reachable(ollama_url)
    checks.append((
        f"Ollama daemon reachable at {ollama_url}",
        reachable,
        ("" if reachable else "daemon not running — start with: ollama serve"),
    ))

    # 3. Recommended model present
    models: list[str] = []
    model_ok = False
    detail = ""
    if reachable:
        models = _list_ollama_models(ollama_url)
        # Match prefix (qwen2.5:7b matches qwen2.5:7b-instruct-q4_0 etc).
        model_ok = any(m == RECOMMENDED_MODEL or m.startswith(RECOMMENDED_MODEL + "-") for m in models)
        if not model_ok:
            detail = f"recommended model not pulled — run: ollama pull {RECOMMENDED_MODEL}"
        elif models:
            detail = f"found: {', '.join(models[:5])}{'…' if len(models) > 5 else ''}"
    else:
        detail = "skipped — daemon unreachable"
    checks.append((
        f"Recommended model ({RECOMMENDED_MODEL}) installed",
        model_ok,
        detail,
    ))

    _print_summary(checks)

    # Overall verdict
    all_ok = all(ok for _, ok, _ in checks)
    if all_ok:
        print(_ok("All set — local AI (Ollama) is ready."))
        print(_dim("Open a .md file in JupyterLab and the extension will detect Ollama automatically."))
        return 0

    # WebLLM fallback message — what most users will hit on first install.
    print(_warn("Local AI (Ollama) is not fully set up."))
    print()
    print("That's fine — Markdown Reader defaults to WebLLM (in-browser, no install)")
    print("when embedded in JupyterLab. It downloads ~2GB on first use and runs")
    print("entirely on your machine via WebGPU.")
    print()
    print(_c("1", "To enable Ollama (faster, no download, supports larger models):"))
    print()
    if not ollama_path:
        print(f"  1. Install Ollama:  {_c('36', 'curl -fsSL https://ollama.com/install.sh | sh')}")
    if ollama_path and not reachable:
        print(f"  1. Start daemon:    {_c('36', 'ollama serve')}  {_dim('(in another terminal)')}")
    if reachable and not model_ok:
        print(f"  1. Pull model:      {_c('36', f'ollama pull {RECOMMENDED_MODEL}')}")
    else:
        next_step = 2 if (not ollama_path or not reachable) else 1
        print(f"  {next_step}. Pull model:      {_c('36', f'ollama pull {RECOMMENDED_MODEL}')}")
    print()
    print(_dim("Re-run `jupyter md-reader doctor` to verify."))
    # Exit 0 — WebLLM fallback is a valid configuration, doctor is informational.
    return 0


def cmd_version(_: argparse.Namespace) -> int:
    print(f"jupyterlab-md-reader {__version__}")
    return 0


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        prog="jupyter md-reader",
        description="Markdown Reader for JupyterLab — diagnostic and management commands.",
    )
    sub = parser.add_subparsers(dest="cmd")

    p_doctor = sub.add_parser("doctor", help="Diagnose local AI runtime (Ollama) and print fixes.")
    p_doctor.add_argument(
        "--ollama-url",
        default=OLLAMA_DEFAULT_URL,
        help=f"Ollama base URL (default: {OLLAMA_DEFAULT_URL})",
    )
    p_doctor.set_defaults(func=cmd_doctor)

    p_version = sub.add_parser("version", help="Print version.")
    p_version.set_defaults(func=cmd_version)

    args = parser.parse_args(argv)
    if not getattr(args, "func", None):
        parser.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
