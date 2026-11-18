"""Builds the Counterparty Guard demo video (< 3 min): slides, terminal frames, screenshots, Windows TTS.

Usage: python media/make_video.py [shots folder, default media/shots]
"""
import subprocess
import sys
import wave
from pathlib import Path

import imageio_ffmpeg
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).parent
SHOTS = Path(sys.argv[1]) if len(sys.argv) > 1 else HERE / "shots"
WORK = HERE / "video-work"
WORK.mkdir(exist_ok=True)
FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
BG, INK, MUTED, BRAND = (12, 20, 18), (232, 240, 236), (150, 170, 160), (52, 211, 153)


def font(size, bold=False):
    for name in (["segoeuib.ttf", "arialbd.ttf"] if bold else ["segoeui.ttf", "arial.ttf"]):
        try:
            return ImageFont.truetype(name, size)
        except OSError:
            pass
    return ImageFont.load_default()


def slide(n, title, lines, kicker="COUNTERPARTY GUARD"):
    im = Image.new("RGB", (1920, 1080), BG)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle([140, 120, 200, 180], radius=14, fill=BRAND)
    d.text((230, 128), kicker, font=font(34, True), fill=BRAND)
    d.text((140, 230), title, font=font(74, True), fill=INK)
    y = 400
    for line in lines:
        d.ellipse([150, y + 22, 166, y + 38], fill=BRAND)
        d.text((190, y), line, font=font(44), fill=INK)
        y += 80
    p = WORK / f"slide-{n:02d}.png"
    im.save(p)
    return p


TERM_BG, OK, BAD = (10, 12, 20), (74, 222, 128), (248, 113, 113)


def terminal(n, title, lines):
    """Render terminal output as an image. lines: list of (text, color) or plain str."""
    im = Image.new("RGB", (1920, 1080), BG)
    d = ImageDraw.Draw(im)
    d.text((140, 90), title, font=font(52, True), fill=INK)
    d.rounded_rectangle([120, 190, 1800, 1000], radius=24, fill=TERM_BG)
    for k, c in enumerate([(248, 113, 113), (250, 204, 21), (74, 222, 128)]):
        d.ellipse([160 + k * 40, 220, 184 + k * 40, 244], fill=c)
    mono = None
    for name in ("consola.ttf", "cour.ttf"):
        try:
            mono = ImageFont.truetype(name, 34)
            break
        except OSError:
            pass
    y = 290
    for line in lines:
        text, color = (line, INK) if isinstance(line, str) else line
        d.text((170, y), text, font=mono or font(34), fill=color)
        y += 52
    p = WORK / f"term-{n:02d}.png"
    im.save(p)
    return p


K = "COUNTERPARTY GUARD  ·  Concordium Trusted Agents"
S1 = slide(1, "\u201cActive\u201d is not \u201ctrusted\u201d", [
    "AI agents now pay other agents over x402",
    "Before paying, check the payee is accountable",
    "Concordium Agent Registry (CIS-8004) + Verified badge",
    "Refuse before anything is signed",
], kicker=K)
S2 = slide(2, "What the guard checks", [
    "Registered and Active on CIS-8004",
    "Agent Card matches its on-chain SHA-256 anchor",
    "Valid Verified by Concordium badge",
    "payTo equals the agent wallet declared on chain",
    "Per-payment, per-counterparty and daily budgets",
], kicker=K)
T1 = terminal(1, "Our own agent #1254 on the testnet registry", [
    "$ node src/guard.mjs check 1254",
    ("ALLOW (score 100) \u00b7 token 1254", OK),
    ("  ok   active       Registered and Active on CIS-8004", OK),
    ("  ok   card_match   Agent Card matches its on-chain SHA-256", OK),
    ("  ok   badge        Valid Concordium Badge", OK),
    "",
    "register        tx 2b2b2c9c\u2026e29a",
    "setAgentWallet  tx d4412806\u2026bc70",
    "setAgentURI     tx cb893d8f\u2026d311",
])
T2 = terminal(2, "Live x402 payment on Concordium testnet", [
    "$ node examples/live.mjs",
    "buyer 3ftEtEq9\u2026u1ifQ   seller agent #1254 (4BqjC6\u2026QyPD)",
    "",
    "/report",
    ("  guard: ALLOW \u00b7 agent #1254 \u00b7 2 CCD", OK),
    ("  -> HTTP 200, settled on-chain: tx 0082eacf\u2026a3a6", OK),
    "",
    "/tampered   (same offer, payTo swapped to an attacker)",
    ("  guard: BLOCK (wallet_mismatch) \u00b7 agent #1254 \u00b7 2 CCD", BAD),
    ("  -> refused before signing", BAD),
])
S3 = slide(3, "Path to production", [
    "Drop-in hook for any x402 client (@x402/fetch)",
    "Policy per agent: badge required, caps, REVIEW queue",
    "Decision log for EU AI Act style record keeping",
    "Mainnet: same registry, real CCD and PLT stablecoins",
], kicker=K)
S4 = slide(4, "Try it", [
    "github.com/emilpz320-a11y/counterparty-guard",
    "emilpz320-a11y.github.io/counterparty-guard",
    "npm test  \u00b7  npm run demo  \u00b7  examples/live.mjs",
    "Thank you!",
], kicker=K)

D = lambda name: SHOTS / name
SEGMENTS = [
    (S1, "AI agents are starting to pay other agents over x402. But an agent that is registered and active is not necessarily one you should pay. Counterparty Guard checks the payee on Concordium before any payment is signed."),
    (D("dashboard.jpg"), "We scanned all one thousand two hundred fifty one agents on the Concordium testnet Agent Registry. Two hundred sixty nine are active, but seventy four percent of those fail at least one basic check. Only seventy one would pass."),
    (S2, "The guard checks five things: the agent is registered and active, its Agent Card matches the hash anchored on chain, it carries a valid Verified by Concordium badge, the payment goes to the wallet the agent declared on chain, and the amount fits the budgets."),
    (T1, "We registered our own seller agent, number twelve fifty four, on the C I S eight thousand and four registry: we published its Agent Card, anchored the card hash, and declared its payment wallet. It passes every check."),
    (T2, "Then we ran a real x402 payment on testnet. The guard runs inside the buyer's x402 client, before the Concordium scheme signs. The honest route is allowed and settles on chain. The same offer with the pay-to address swapped is blocked, and nothing is signed."),
    (D("ccdscan.jpg"), "Here is the settled payment on C C D Scan: two C C D from the buyer to the agent's wallet, as a sponsored transaction, so the buyer pays no fee."),
    (S3, "The path to production: it is a drop-in hook for any x402 client, with per agent policies, a review queue for new counterparties, and a decision log for record keeping. On mainnet it uses the same registry with real C C D and stablecoins."),
    (S4, "The code, tests and dashboard are on GitHub. Thank you."),
]

def tts(text: str, out: Path) -> float:
    out.with_suffix(".txt").write_text(text, encoding="utf-8")
    ps = (
        "Add-Type -AssemblyName System.Speech; "
        "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; "
        "try { $s.SelectVoice('Microsoft Zira Desktop') } catch {}; $s.Rate = 1; "
        f"$s.SetOutputToWaveFile('{out}'); "
        f"$s.Speak([IO.File]::ReadAllText('{out.with_suffix('.txt')}')); $s.Dispose()"
    )
    subprocess.run(["powershell", "-NoProfile", "-Command", ps], check=True)
    with wave.open(str(out)) as w:
        return w.getnframes() / w.getframerate()


parts = []
for i, (img, text) in enumerate(SEGMENTS):
    wav = WORK / f"seg{i:02d}.wav"
    dur = tts(text, wav) + 0.7
    mp4 = WORK / f"seg{i:02d}.mp4"
    vf = "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=0x0e1020,format=yuv420p"
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-loop", "1", "-framerate", "30", "-i", str(img), "-i", str(wav),
                    "-af", "apad", "-t", f"{dur:.2f}", "-vf", vf, "-c:v", "libx264", "-preset", "medium", "-crf", "23",
                    "-c:a", "aac", "-b:a", "128k", "-ar", "44100", str(mp4)], check=True)
    parts.append(mp4)
    print(f"segment {i}: {dur:.1f}s")

listing = WORK / "list.txt"
listing.write_text("".join(f"file '{p.as_posix()}'\n" for p in parts), encoding="utf-8")
out = HERE / "counterparty-guard-demo.mp4"
subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing), "-c", "copy", str(out)], check=True)
print("wrote", out)
