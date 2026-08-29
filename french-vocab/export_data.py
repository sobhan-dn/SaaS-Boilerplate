#!/usr/bin/env python3
"""Exports the same vocabulary as CSV (spreadsheets) and TSV (Anki import).

Usage:  python3 export_data.py [output_directory]
"""

from __future__ import annotations

import csv
import sys
from pathlib import Path

from data import APPENDICES, LEVELS

BASE = Path(__file__).resolve().parent


def rows():
    for level in LEVELS:
        for section in level["sections"]:
            for fr, pron, meaning in section["words"]:
                yield level["code"], section["title_fa"], fr, pron, meaning
    for app in APPENDICES:
        for section in app["sections"]:
            for fr, pron, meaning in section["words"]:
                yield "annexe", section["title_fa"], fr, pron, meaning


def main():
    out_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE
    out_dir.mkdir(parents=True, exist_ok=True)
    data = list(rows())

    csv_path = out_dir / "francais-farsi-a1-b2.csv"
    with csv_path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.writer(handle)
        writer.writerow(["niveau", "theme", "francais", "prononciation_fa", "sens_fa"])
        writer.writerows(data)

    tsv_path = out_dir / "francais-farsi-a1-b2-anki.tsv"
    with tsv_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.writer(handle, delimiter="\t")
        for level, theme, fr, pron, meaning in data:
            writer.writerow([fr, f"{pron} — {meaning}", f"{level} :: {theme}"])

    print(f"wrote {csv_path} and {tsv_path} ({len(data)} rows)")


if __name__ == "__main__":
    main()
