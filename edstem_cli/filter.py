"""Thread filtering by category, type, and answered status."""

from __future__ import annotations


def filter_threads(threads, category=None, thread_type=None, answered=None):
    # type: (list, Optional[str], Optional[str], Optional[bool]) -> list
    """Filter threads by category, type, and/or answered status."""
    filtered = list(threads)

    if category:
        cat_lower = category.lower()
        filtered = [t for t in filtered if t.category.lower() == cat_lower]

    if thread_type:
        type_lower = thread_type.lower()
        filtered = [t for t in filtered if t.type.lower() == type_lower]

    if answered is not None:
        filtered = [t for t in filtered if t.is_answered == answered]

    return filtered
