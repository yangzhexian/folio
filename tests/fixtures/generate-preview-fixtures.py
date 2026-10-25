"""Regenerate synthetic preview fixtures; images require Pillow, PDF is self-contained."""

from pathlib import Path
from PIL import Image, ImageDraw

directory = Path(__file__).resolve().parent

for name, size, background, color in (
    ("landscape.png", (1200, 900), "#eef2e9", "#54715c"),
    ("portrait.jpg", (900, 1200), "#eaf0f6", "#4d6b8b"),
):
    image = Image.new("RGB", size, background)
    draw = ImageDraw.Draw(image)
    width, height = size
    draw.rounded_rectangle((70, 70, width - 70, height - 70), radius=32, fill="white")
    draw.rectangle((110, 110, width - 110, 210), fill=color)
    draw.ellipse((110, 260, 330, 480), fill=color)
    for row in range(4):
        draw.rectangle((380, 280 + row * 55, width - 110, 300 + row * 55), fill=background)
    draw.text((110, height - 150), "FOLIO SYNTHETIC PREVIEW FIXTURE", fill=color)
    image.save(directory / name)

streams = [
    b"q 0.92 0.96 0.92 rg 0 0 600 800 re f 0.25 0.45 0.3 rg 60 500 480 180 re f Q\nBT /F1 28 Tf 60 720 Td (Folio synthetic PDF - Page 1) Tj ET\n",
    b"q 0.92 0.94 0.98 rg 0 0 600 800 re f 0.25 0.35 0.65 rg 60 300 300 340 re f Q\nBT /F1 28 Tf 60 720 Td (Folio synthetic PDF - Page 2) Tj ET\n",
]
objects = [
    b"<< /Type /Catalog /Pages 2 0 R >>",
    b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 5 0 R >>",
    b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    *(b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"endstream" for stream in streams),
    b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
]
pdf = bytearray(b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n")
offsets = [0]
for number, value in enumerate(objects, start=1):
    offsets.append(len(pdf))
    pdf.extend(f"{number} 0 obj\n".encode() + value + b"\nendobj\n")
xref = len(pdf)
pdf.extend(f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode())
for offset in offsets[1:]:
    pdf.extend(f"{offset:010d} 00000 n \n".encode())
pdf.extend(f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
(directory / "two-pages.pdf").write_bytes(pdf)
(directory / "broken.pdf").write_bytes(b"%PDF-1.7\nThis synthetic PDF intentionally has no objects or page tree.\n%%EOF\n")
