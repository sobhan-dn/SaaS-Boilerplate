#!/usr/bin/env python3
"""Builds the French -> Persian vocabulary PDF (levels A1 to B2).

Usage:  python3 build_pdf.py [output.pdf]
"""

from __future__ import annotations

import sys
from pathlib import Path

from fpdf import FPDF
from fpdf.enums import Align, XPos, YPos

from data import LEVELS, PRONUNCIATION_GUIDE, GUIDE_NOTES, APPENDICES

BASE = Path(__file__).resolve().parent
FONT_DIR = BASE / "fonts"

INK = (33, 37, 41)
MUTED = (108, 117, 125)
ACCENT = (12, 70, 130)
ACCENT_LIGHT = (222, 235, 247)
SECTION_BG = (238, 242, 246)
ZEBRA = (247, 249, 251)
LINE = (214, 220, 226)

LEVEL_COLORS = {
    "A1": (21, 115, 71),
    "A2": (16, 96, 138),
    "B1": (146, 84, 14),
    "B2": (140, 34, 60),
}

FA_DIGITS = str.maketrans("0123456789", "۰۱۲۳۴۵۶۷۸۹")


def fa_num(value) -> str:
    return str(value).translate(FA_DIGITS)


class VocabPDF(FPDF):
    def __init__(self):
        super().__init__(orientation="P", unit="mm", format="A4")
        self.set_margins(12, 14, 12)
        self.set_auto_page_break(True, margin=16)
        self.add_font("vazir", "", FONT_DIR / "Vazirmatn-Regular.ttf")
        self.add_font("vazir", "B", FONT_DIR / "Vazirmatn-Bold.ttf")
        self.set_font("vazir", "", 11)
        self.current_level = ""
        self.current_section = ""
        self.repeat_table_header = False
        self.chrome_enabled = False
        self.toc_pages = 1
        self.word_pages: dict[str, int] = {}

    # ---------- text helpers ----------

    def rtl(self):
        self.set_text_shaping(True, direction="rtl", script="Arab", language="fas")

    def ltr(self):
        self.set_text_shaping(True, direction="ltr", script="Latn", language="fra")

    def plain(self):
        self.set_text_shaping(False)

    def fit_size(self, text: str, width: float, size: float, minimum: float = 6.5) -> float:
        """Largest font size <= `size` at which `text` fits inside `width`."""
        style = self.font_style
        while size > minimum:
            self.set_font_size(size)
            if self.get_string_width(text) <= width - 2.6:
                break
            size -= 0.5
        self.set_font("vazir", style, size)
        return size

    # ---------- page furniture ----------

    def header(self):
        if not self.chrome_enabled:
            return
        color = LEVEL_COLORS.get(self.current_level, ACCENT)
        self.set_y(7)
        self.set_font("vazir", "B", 9)
        self.set_text_color(*color)
        self.ltr()
        self.cell(60, 5, f"Niveau {self.current_level}" if self.current_level else "", align=Align.L)
        self.rtl()
        self.set_text_color(*MUTED)
        self.set_x(-72)
        self.cell(60, 5, self.current_section, align=Align.R)
        self.plain()
        self.set_draw_color(*color)
        self.set_line_width(0.5)
        self.line(12, 12.6, 198, 12.6)
        self.set_line_width(0.2)
        self.set_y(16)
        if self.repeat_table_header:
            self.table_head()

    def footer(self):
        if not self.chrome_enabled:
            return
        self.set_y(-13)
        self.set_font("vazir", "", 8.5)
        self.set_text_color(*MUTED)
        self.rtl()
        self.cell(0, 5, f"صفحهٔ {fa_num(self.page_no())}", align=Align.C)
        self.plain()

    # ---------- building blocks ----------

    def cover(self, total_words: int):
        self.add_page()
        self.set_fill_color(*ACCENT)
        self.rect(0, 0, 210, 92, style="F")
        self.set_text_color(255, 255, 255)
        self.set_y(24)
        self.set_font("vazir", "B", 30)
        self.rtl()
        self.cell(0, 16, "واژه‌نامهٔ فرانسه به فارسی", new_x=XPos.LMARGIN, new_y=YPos.NEXT, align=Align.C)
        self.set_font("vazir", "", 17)
        self.cell(0, 11, "با تلفظ دقیق فارسی و معنی", new_x=XPos.LMARGIN, new_y=YPos.NEXT, align=Align.C)
        self.set_font("vazir", "B", 15)
        self.cell(0, 12, "از سطح A1 تا B2", new_x=XPos.LMARGIN, new_y=YPos.NEXT, align=Align.C)

        self.set_text_color(*INK)
        self.set_y(108)
        self.set_font("vazir", "", 13)
        self.cell(
            0,
            9,
            f"{fa_num(total_words)} واژه و عبارت پرکاربرد، دسته‌بندی‌شده بر پایهٔ چارچوب اروپایی CEFR",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
            align=Align.C,
        )
        self.ln(6)

        box_w = 42
        box_h = 30
        gap = 6
        start_x = (210 - (4 * box_w + 3 * gap)) / 2
        y = self.get_y()
        for i, level in enumerate(LEVELS):
            x = start_x + i * (box_w + gap)
            color = LEVEL_COLORS[level["code"]]
            self.set_fill_color(*color)
            self.rect(x, y, box_w, box_h, style="F")
            self.set_text_color(255, 255, 255)
            self.set_xy(x, y + 4)
            self.plain()
            self.set_font("vazir", "B", 16)
            self.cell(box_w, 8, level["code"], align=Align.C)
            self.set_xy(x, y + 13)
            self.rtl()
            self.set_font("vazir", "", 9.5)
            self.cell(box_w, 6, level["name_fa"], align=Align.C)
            self.set_xy(x, y + 19.5)
            self.cell(box_w, 6, f"{fa_num(count_words(level))} واژه", align=Align.C)

        self.set_y(y + box_h + 16)
        self.set_text_color(*INK)
        self.set_font("vazir", "", 11.5)
        self.rtl()
        for line in [
            "هر واژه در سه ستون آمده است: شکل نوشتاری فرانسه، تلفظ آن با حروف فارسی، و معنی.",
            "اسم‌ها همراه با حرف تعریف (le / la / les) آمده‌اند تا جنسیت دستوری آن‌ها روشن باشد.",
            "پیش از شروع، «راهنمای تلفظ» را بخوانید؛ چند صدای فرانسه در فارسی معادل دقیق ندارند.",
        ]:
            self.cell(0, 8, line, new_x=XPos.LMARGIN, new_y=YPos.NEXT, align=Align.R)

        self.set_y(-32)
        self.set_text_color(*MUTED)
        self.set_font("vazir", "", 9.5)
        self.cell(0, 6, "تهیه‌شده برای فارسی‌زبانانی که فرانسه می‌آموزند", align=Align.C)
        self.plain()

    def h1(self, text_fa: str, text_fr: str = ""):
        color = LEVEL_COLORS.get(self.current_level, ACCENT)
        self.set_fill_color(*color)
        self.rect(12, self.get_y(), 186, 13, style="F")
        y = self.get_y()
        self.set_text_color(255, 255, 255)
        self.set_xy(14, y)
        self.rtl()
        self.set_font("vazir", "B", 14)
        self.cell(150, 13, text_fa, align=Align.R)
        if text_fr:
            self.ltr()
            self.set_font("vazir", "", 10.5)
            self.set_xy(14, y)
            self.cell(80, 13, text_fr, align=Align.L)
        self.plain()
        self.set_text_color(*INK)
        self.set_y(y + 17)

    def level_divider(self, level: dict):
        self.chrome_enabled = False
        self.repeat_table_header = False
        self.add_page()
        color = LEVEL_COLORS[level["code"]]
        self.set_fill_color(*color)
        self.rect(0, 60, 210, 84, style="F")
        self.set_text_color(255, 255, 255)
        self.set_y(72)
        self.plain()
        self.set_font("vazir", "B", 46)
        self.cell(0, 24, level["code"], new_x=XPos.LMARGIN, new_y=YPos.NEXT, align=Align.C)
        self.rtl()
        self.set_font("vazir", "B", 18)
        self.cell(0, 12, level["name_fa"], new_x=XPos.LMARGIN, new_y=YPos.NEXT, align=Align.C)
        self.set_font("vazir", "", 12)
        self.cell(0, 10, level["blurb_fa"], new_x=XPos.LMARGIN, new_y=YPos.NEXT, align=Align.C)
        self.set_text_color(*INK)
        self.set_y(156)
        self.set_font("vazir", "", 11.5)
        self.cell(
            0,
            8,
            f"{fa_num(count_words(level))} واژه در {fa_num(len(level['sections']))} موضوع",
            new_x=XPos.LMARGIN,
            new_y=YPos.NEXT,
            align=Align.C,
        )
        self.ln(4)
        self.set_font("vazir", "", 10.5)
        titles = "  •  ".join(s["title_fa"] for s in level["sections"])
        self.set_text_color(*MUTED)
        self.multi_cell(150, 7, titles, align=Align.C, new_x=XPos.LMARGIN, new_y=YPos.NEXT,
                        padding=(0, 18))
        self.plain()
        self.set_text_color(*INK)
        self.chrome_enabled = True
        self.add_page()

    # ---------- vocabulary table ----------

    COL_FR = 62.0
    COL_PRON = 56.0
    COL_MEAN = 68.0
    ROW_H = 7.4

    def table_head(self):
        y = self.get_y()
        self.set_fill_color(*ACCENT_LIGHT)
        self.rect(12, y, self.COL_FR + self.COL_PRON + self.COL_MEAN, 8, style="F")
        self.set_text_color(*ACCENT)
        self.set_font("vazir", "B", 10)
        self.set_xy(12, y)
        self.ltr()
        self.cell(self.COL_FR, 8, "  Français", align=Align.L)
        self.rtl()
        self.cell(self.COL_PRON, 8, "تلفظ فارسی", align=Align.C)
        self.cell(self.COL_MEAN, 8, "معنی", align=Align.C)
        self.plain()
        self.set_text_color(*INK)
        self.set_draw_color(*LINE)
        self.set_y(y + 8)

    def section(self, section: dict, level_code: str):
        self.current_section = section["title_fa"]
        needed = 22 + 3 * self.ROW_H
        if self.get_y() + needed > 281:
            self.repeat_table_header = False
            self.add_page()
        self.repeat_table_header = False
        y = self.get_y()
        self.set_fill_color(*SECTION_BG)
        self.rect(12, y, 186, 10, style="F")
        color = LEVEL_COLORS[level_code]
        self.set_fill_color(*color)
        self.rect(12, y, 2.2, 10, style="F")
        self.set_xy(16, y)
        self.rtl()
        self.set_font("vazir", "B", 12)
        self.set_text_color(*INK)
        self.cell(120, 10, section["title_fa"], align=Align.R)
        if section.get("title_fr"):
            self.ltr()
            self.set_font("vazir", "", 9.5)
            self.set_text_color(*MUTED)
            self.set_xy(17, y)
            self.cell(80, 10, section["title_fr"], align=Align.L)
        self.plain()
        self.set_text_color(*INK)
        self.set_y(y + 13)
        self.table_head()
        self.repeat_table_header = True

        for i, (fr, pron, meaning) in enumerate(section["words"]):
            self.row(fr, pron, meaning, i)
        self.repeat_table_header = False
        self.ln(5)

    def row(self, fr: str, pron: str, meaning: str, index: int):
        h = self.ROW_H
        self.set_font("vazir", "", 11)
        if self.get_y() + h > self.h - self.b_margin:
            self.add_page()
        y = self.get_y()
        if index % 2 == 1:
            self.set_fill_color(*ZEBRA)
            self.rect(12, y, self.COL_FR + self.COL_PRON + self.COL_MEAN, h, style="F")
        self.set_draw_color(*LINE)
        self.line(12, y + h, 198, y + h)

        self.word_pages.setdefault(fr, self.page_no())

        self.set_xy(12, y)
        self.set_text_color(*INK)
        self.ltr()
        self.fit_size(fr, self.COL_FR - 3, 11)
        self.cell(self.COL_FR, h, "  " + fr, align=Align.L)

        self.rtl()
        self.set_text_color(*ACCENT)
        x = self.get_x()
        self.fit_size(pron, self.COL_PRON, 11.5)
        self.set_xy(x, y)
        self.cell(self.COL_PRON, h, pron, align=Align.C)

        self.set_text_color(*INK)
        x = self.get_x()
        self.fit_size(meaning, self.COL_MEAN, 11)
        self.set_xy(x, y)
        self.cell(self.COL_MEAN, h, meaning, align=Align.C)
        self.plain()
        self.set_font("vazir", "", 11)
        self.set_xy(12, y + h)

    # ---------- guide & appendices ----------

    def guide_pages(self, page_ready: bool = False):
        self.chrome_enabled = True
        self.current_level = ""
        self.current_section = "راهنمای تلفظ"
        if page_ready:
            self.header()
        else:
            self.add_page()
        self.h1("راهنمای خواندن این واژه‌نامه", "Guide de prononciation")
        self.rtl()
        self.set_font("vazir", "", 11)
        for note in GUIDE_NOTES:
            self.set_x(12)
            self.multi_cell(186, 7.2, note, align=Align.R, new_x=XPos.LMARGIN, new_y=YPos.NEXT)
            self.ln(1.6)
        self.plain()
        self.ln(3)

        self.add_page()
        self.h1("صداهای فرانسه و معادل فارسی آن‌ها", "Sons du français")
        widths = (28.0, 30.0, 40.0, 30.0, 58.0)
        headers = ("Écriture", "صدا", "نمونه", "تلفظ نمونه", "توضیح")
        y = self.get_y()
        self.set_fill_color(*ACCENT_LIGHT)
        self.rect(12, y, sum(widths), 8.5, style="F")
        self.set_text_color(*ACCENT)
        self.set_font("vazir", "B", 10)
        self.set_xy(12, y)
        for w, head in zip(widths, headers):
            if head == "Écriture":
                self.ltr()
            else:
                self.rtl()
            self.cell(w, 8.5, head, align=Align.C)
        self.plain()
        self.set_text_color(*INK)
        self.set_y(y + 8.5)

        for i, (spelling, sound, example, example_fa, note) in enumerate(PRONUNCIATION_GUIDE):
            h = 8.6
            self.set_font("vazir", "", 11)
            if self.get_y() + h > self.h - self.b_margin:
                self.add_page()
            y = self.get_y()
            if i % 2 == 1:
                self.set_fill_color(*ZEBRA)
                self.rect(12, y, sum(widths), h, style="F")
            self.set_draw_color(*LINE)
            self.line(12, y + h, 12 + sum(widths), y + h)
            self.set_xy(12, y)
            self.ltr()
            self.fit_size(spelling, widths[0], 11)
            self.cell(widths[0], h, spelling, align=Align.C)
            self.rtl()
            self.set_text_color(*ACCENT)
            x = self.get_x()
            self.fit_size(sound, widths[1], 11.5)
            self.set_xy(x, y)
            self.cell(widths[1], h, sound, align=Align.C)
            self.set_text_color(*INK)
            self.ltr()
            x = self.get_x()
            self.fit_size(example, widths[2], 10.5)
            self.set_xy(x, y)
            self.cell(widths[2], h, example, align=Align.C)
            self.rtl()
            self.set_text_color(*ACCENT)
            x = self.get_x()
            self.fit_size(example_fa, widths[3], 11)
            self.set_xy(x, y)
            self.cell(widths[3], h, example_fa, align=Align.C)
            self.set_text_color(*INK)
            x = self.get_x()
            self.fit_size(note, widths[4], 10)
            self.set_xy(x, y)
            self.cell(widths[4], h, note, align=Align.R)
            self.plain()
            self.set_xy(12, y + h)

    def appendix(self, appendix: dict):
        self.current_level = ""
        self.current_section = appendix["title_fa"]
        self.repeat_table_header = False
        self.add_page()
        self.h1(appendix["title_fa"], appendix.get("title_fr", ""))
        for section in appendix["sections"]:
            self.section(section, "B2")

    def index_pages(self):
        self.current_level = ""
        self.current_section = "فهرست الفبایی"
        self.repeat_table_header = False
        self.add_page()
        self.h1("فهرست الفبایی همهٔ واژه‌ها", "Index alphabétique")
        entries = sorted(self.word_pages.items(), key=lambda kv: sort_key(kv[0]))
        col_w = 62.0
        line_h = 5.2
        col = 0
        top = self.get_y()
        y = top
        letter = ""
        for word, page in entries:
            first = sort_key(word)[:1].upper()
            block = line_h
            if first != letter:
                block += line_h + 1.5
            if y + block > self.h - self.b_margin:
                col += 1
                if col > 2:
                    self.add_page()
                    col = 0
                    top = self.get_y()
                y = top
            x = 12 + col * col_w
            if first != letter:
                letter = first
                self.set_xy(x, y)
                self.set_font("vazir", "B", 11)
                self.set_text_color(*ACCENT)
                self.plain()
                self.cell(col_w, line_h + 1.5, letter, align=Align.L)
                y += line_h + 1.5
            self.set_xy(x, y)
            self.set_font("vazir", "", 8.6)
            self.set_text_color(*INK)
            self.ltr()
            label = word if self.get_string_width(word) < col_w - 12 else word[:30] + "…"
            self.cell(col_w - 10, line_h, label, align=Align.L)
            self.plain()
            self.set_font("vazir", "", 8.6)
            self.set_text_color(*MUTED)
            self.set_xy(x + col_w - 12, y)
            self.cell(10, line_h, fa_num(page), align=Align.R)
            self.set_text_color(*INK)
            y += line_h


def sort_key(word: str) -> str:
    import unicodedata

    stripped = word
    for article in ("le ", "la ", "les ", "l'", "un ", "une ", "des ", "se ", "s'"):
        if stripped.lower().startswith(article):
            stripped = stripped[len(article):]
            break
    normalized = unicodedata.normalize("NFKD", stripped)
    return "".join(c for c in normalized if not unicodedata.combining(c)).lower()


def count_words(level: dict) -> int:
    return sum(len(s["words"]) for s in level["sections"])


def check_glyphs() -> list[str]:
    """Report characters used in the data that the embedded font cannot render."""
    from fontTools.ttLib import TTFont

    cmap = TTFont(FONT_DIR / "Vazirmatn-Regular.ttf").getBestCmap()
    texts: list[str] = list(GUIDE_NOTES)
    for row in PRONUNCIATION_GUIDE:
        texts.extend(row)
    for level in LEVELS:
        texts.extend([level["name_fa"], level["blurb_fa"]])
        for section in level["sections"]:
            texts.extend([section["title_fa"], section.get("title_fr", "")])
            for entry in section["words"]:
                texts.extend(entry)
    for app in APPENDICES:
        texts.extend([app["title_fa"], app.get("title_fr", "")])
        for section in app["sections"]:
            texts.extend([section["title_fa"], section.get("title_fr", "")])
            for entry in section["words"]:
                texts.extend(entry)
    missing = {c for text in texts for c in text if ord(c) not in cmap and c != "\n"}
    return sorted(missing)


def check_duplicates() -> list[tuple[str, int]]:
    counter: dict[str, int] = {}
    for level in LEVELS:
        for section in level["sections"]:
            for fr, _, _ in section["words"]:
                counter[fr] = counter.get(fr, 0) + 1
    return sorted(((w, n) for w, n in counter.items() if n > 2), key=lambda kv: -kv[1])


def toc_page_count(outline_len_l0: int, outline_len_l1: int) -> int:
    height = outline_len_l0 * 9.6 + outline_len_l1 * 6.4 + 20
    return max(1, int(-(-height // 244)))


def render_toc(pdf: VocabPDF, outline):
    pdf.chrome_enabled = False
    start_page = pdf.page
    pdf.set_y(18)
    pdf.rtl()
    pdf.set_font("vazir", "B", 20)
    pdf.set_text_color(*ACCENT)
    pdf.cell(0, 14, "فهرست مطالب", new_x=XPos.LMARGIN, new_y=YPos.NEXT, align=Align.C)
    pdf.ln(4)
    for item in outline:
        if pdf.get_y() > 268:
            pdf.add_page()
            pdf.set_y(18)
        level = item.level
        pdf.set_font("vazir", "B" if level == 0 else "", 13 if level == 0 else 10.5)
        pdf.set_text_color(*(ACCENT if level == 0 else INK))
        indent = 6 + level * 8
        pdf.set_x(12)
        width = 186 - indent
        pdf.rtl()
        pdf.cell(width, 8.6 if level == 0 else 6.4, item.name, align=Align.R)
        pdf.set_font("vazir", "", 9.5)
        pdf.set_text_color(*MUTED)
        pdf.set_x(12)
        pdf.cell(20, 8.6 if level == 0 else 6.4, fa_num(item.page_number), align=Align.L)
        pdf.ln(8.6 if level == 0 else 6.4)
        if level == 0:
            pdf.ln(1)
    pdf.plain()
    pdf.set_text_color(*INK)
    while pdf.page - start_page + 1 < pdf.toc_pages:
        pdf.add_page()


def build(output: Path):
    pdf = VocabPDF()
    pdf.set_title("واژه‌نامهٔ فرانسه به فارسی — A1 تا B2")
    pdf.set_subject("French to Persian vocabulary with pronunciation, levels A1-B2")
    pdf.set_author("French Vocabulary Builder")
    pdf.set_lang("fa")

    total = sum(count_words(level) for level in LEVELS) + sum(
        len(s["words"]) for a in APPENDICES for s in a["sections"]
    )

    pdf.cover(total)

    n_top = len(LEVELS) + len(APPENDICES) + 1
    n_sub = sum(len(level["sections"]) for level in LEVELS) + sum(
        len(a["sections"]) for a in APPENDICES
    )
    pdf.toc_pages = toc_page_count(n_top, n_sub)

    pdf.chrome_enabled = False
    pdf.add_page()
    pdf.insert_toc_placeholder(render_toc, pages=pdf.toc_pages)

    pdf.guide_pages(page_ready=True)

    for level in LEVELS:
        pdf.current_level = level["code"]
        pdf.start_section(f"سطح {level['code']} — {level['name_fa']}", level=0)
        pdf.level_divider(level)
        for section in level["sections"]:
            pdf.start_section(section["title_fa"], level=1)
            pdf.section(section, level["code"])

    pdf.current_level = ""
    for app in APPENDICES:
        pdf.start_section(app["title_fa"], level=0)
        pdf.appendix(app)

    pdf.start_section("فهرست الفبایی واژه‌ها", level=0)
    pdf.index_pages()

    pdf.output(str(output))
    return pdf, total


def main():
    output = Path(sys.argv[1]) if len(sys.argv) > 1 else BASE / "Francais-Farsi-A1-B2.pdf"
    missing = check_glyphs()
    if missing:
        print("WARNING - characters missing from the font:", " ".join(missing))
    for word, count in check_duplicates():
        print(f"WARNING - '{word}' repeated {count} times across levels")
    pdf, total = build(output)
    print(f"wrote {output}  ({total} entries, {pdf.pages_count} pages)")


if __name__ == "__main__":
    main()
