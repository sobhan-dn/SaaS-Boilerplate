"""Vocabulary data for the French -> Persian PDF."""

from .a1 import LEVEL as A1
from .a2 import LEVEL as A2
from .b1 import LEVEL as B1
from .b2 import LEVEL as B2
from .appendices import APPENDICES
from .guide import GUIDE_NOTES, PRONUNCIATION_GUIDE

LEVELS = [A1, A2, B1, B2]

__all__ = ["LEVELS", "APPENDICES", "GUIDE_NOTES", "PRONUNCIATION_GUIDE"]
