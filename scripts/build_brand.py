"""Build approved transparent brand PNGs. Development only: pip install cairosvg."""
from pathlib import Path
import cairosvg

ROOT = Path(__file__).resolve().parents[1]
BRAND = ROOT / "custom_components" / "locaris" / "brand"
BRAND.mkdir(parents=True, exist_ok=True)
for name in ("icon", "dark_icon", "logo", "dark_logo"):
    width = 944 if "logo" in name else 256
    for scale, suffix in ((1, ""), (2, "@2x")):
        cairosvg.svg2png(url=str(ROOT / "assets" / (name + ".svg")),
                         write_to=str(BRAND / (name + suffix + ".png")),
                         output_width=width * scale, output_height=256 * scale)
cairosvg.svg2png(url=str(ROOT / "assets" / "app_icon.svg"),
                 write_to=str(ROOT / "assets" / "app_icon.png"),
                 output_width=1024, output_height=1024)
