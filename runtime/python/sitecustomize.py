"""Studio-owned Python kernels (Linux).

Historically this module hid Windows consoles via CREATE_NO_WINDOW. On Linux
no equivalent is required; the file remains so PYTHONPATH injection stays stable
and optional future kernel tweaks have a single entry point.
"""
