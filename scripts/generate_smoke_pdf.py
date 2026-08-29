from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen.canvas import Canvas


OUTPUT = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "reader-smoke-test.pdf"


def draw_page(canvas: Canvas, page_number: int, title: str, lines: list[str]) -> None:
    width, height = A4
    canvas.setFillColor(HexColor("#246A4A"))
    canvas.rect(0, height - 84, width, 84, fill=1, stroke=0)
    canvas.setFillColor(HexColor("#FFFFFF"))
    canvas.setFont("Helvetica-Bold", 18)
    canvas.drawString(52, height - 52, title)

    canvas.setFillColor(HexColor("#202522"))
    canvas.setFont("Helvetica", 12)
    y = height - 132
    for line in lines:
        canvas.drawString(58, y, line)
        y -= 26

    canvas.setStrokeColor(HexColor("#DDE4DF"))
    canvas.line(52, 58, width - 52, 58)
    canvas.setFillColor(HexColor("#6C746F"))
    canvas.setFont("Helvetica", 9)
    canvas.drawString(52, 40, "ScholarReader local integration fixture")
    canvas.drawRightString(width - 52, 40, f"Page {page_number} of 4")
    canvas.showPage()


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas = Canvas(str(OUTPUT), pagesize=A4, pageCompression=1)
    canvas.setTitle("ScholarReader Reader Smoke Test")
    draw_page(
        canvas,
        1,
        "PDF.js Integration Test",
        [
            "This document verifies Canvas Layer and selectable Text Layer rendering.",
            "Recognition rather than recall.",
            "The reader should restore this page and its zoom level after reopening.",
        ],
    )
    draw_page(
        canvas,
        2,
        "Search and Navigation",
        [
            "Fitts's Law predicts the time required to reach a target.",
            "Search should find the word target on this page.",
            "The word target appears twice so occurrence counting can be verified.",
        ],
    )
    draw_page(
        canvas,
        3,
        "Text Normalization Fixture",
        [
            "A PDF may split Human- at the end of a visual line.",
            "Computer Interaction continues on the following line.",
            "Later locator tests will normalize whitespace and hyphenation.",
        ],
    )
    draw_page(
        canvas,
        4,
        "Offline Core Verification",
        [
            "PDF reading, search, progress, favorites, tags, and notes remain local.",
            "AI providers are optional and cannot block the core reading workflow.",
            "End of ScholarReader reader smoke test.",
        ],
    )
    canvas.save()
    print(OUTPUT)


if __name__ == "__main__":
    main()
