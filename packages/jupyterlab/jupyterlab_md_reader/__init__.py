"""Public package entry. Version is sourced from the installed distribution
so we don't keep a hand-edited string in lockstep with ``package.json`` and
``plugin.ts``. The single source of truth is ``package.json``; the wheel
build inherits it via ``hatch.version.source = "nodejs"``.
"""

from importlib.metadata import PackageNotFoundError, version as _pkg_version

try:
    __version__ = _pkg_version("jupyterlab-md-reader")
except PackageNotFoundError:
    # Running from a source checkout that hasn't been pip-installed yet
    # (e.g. unit tests or `python -c "import jupyterlab_md_reader"` in a
    # bare clone). A placeholder keeps the import working; the real version
    # lands as soon as `pip install -e .` runs.
    __version__ = "0.0.0+local"


def _jupyter_labextension_paths():
    # dest MUST match the npm package name in labextension/package.json so
    # JupyterLab can resolve /lab/extensions/<name>/static/... at runtime.
    return [{"src": "labextension", "dest": "@md-reader/jupyterlab"}]
