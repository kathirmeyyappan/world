"""kathir world on Modal. Deploy with `modal deploy -m infra.app`, iterate with `modal serve -m infra.app`.

Two pieces:
  lobby  a web function the static client calls to get a room session
  Room   a sessioned Server running the Node room server

Importing the submodules is what registers them on the App.
"""

from . import lobby, room  # noqa: F401
from .common import app  # noqa: F401
