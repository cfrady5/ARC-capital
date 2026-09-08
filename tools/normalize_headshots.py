#!/usr/bin/env python3
"""Normalize PGC team headshots to one consistent 4:5 portrait system.

For every source photo:
  1. Detect the face (and eyes where possible).
  2. Crop to 4:5 so the eye line sits at EYE_Y of the frame height and the
     head occupies the same proportion of the frame in every card.
  3. Match exposure so every face reads at the same brightness across the
     mismatched sources — studio grey, brick, foliage, dark bar.

Photos stay in natural color; no duotone or gradient treatment is applied.

Output: 720x900 WebP.
"""
import os
import cv2
import numpy as np
from PIL import Image

# Directory holding the original photos (not committed — they are the
# unprocessed source files). Override with PGC_HEADSHOT_SRC.
SRC_DIR = os.environ.get("PGC_HEADSHOT_SRC",
                         os.path.dirname(os.path.abspath(__file__)))
OUT_DIR = "/home/user/ARC-capital/assets/img"

# --- Framing constants (the whole point: identical across every card) ---
OUT_W, OUT_H = 720, 900          # 4:5
EYE_Y = 0.36                     # eye line at ~upper third
FACE_H_FRAC = 0.40               # face box height as a fraction of frame height

SOURCES = {
    "team-jeron-peoples.webp":     "headshots3/PGC Headshots/Jeron.jpg",
    "team-stu-dillon.webp":        "dillon-new.png",
    "team-john-holtkamp.webp":     "headshots3/PGC Headshots/Holtkamp Updated.png",
    "team-matthew-seaford.webp":   "headshots3/PGC Headshots/Seaford.jpg",
    "team-benjamin-griffin.webp":  "headshots3/PGC Headshots/Ben.jpg",
    "team-carter-wittendorf.webp": "headshots3/PGC Headshots/carter.png",
    "team-ava-hunt.webp":          "headshots3/PGC Headshots/Ava.jpg",
}

face_cc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
eye_cc = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_eye.xml")


def detect(img_bgr):
    """Return (face_x, face_y, face_w, face_h, eye_y) in pixels."""
    gray = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)
    gray = cv2.equalizeHist(gray)
    faces = face_cc.detectMultiScale(gray, scaleFactor=1.06, minNeighbors=6,
                                     minSize=(int(gray.shape[0] * 0.08),) * 2)
    if len(faces) == 0:
        faces = face_cc.detectMultiScale(gray, scaleFactor=1.03, minNeighbors=3)
    if len(faces) == 0:
        raise RuntimeError("no face found")
    # largest face
    x, y, w, h = max(faces, key=lambda f: f[2] * f[3])

    # Eye line: prefer detected eyes, else the canonical 0.4 of the face box.
    eye_y = y + 0.40 * h
    roi = gray[y:y + int(h * 0.65), x:x + w]
    eyes = eye_cc.detectMultiScale(roi, scaleFactor=1.05, minNeighbors=8)
    if len(eyes) >= 2:
        eyes = sorted(eyes, key=lambda e: e[2] * e[3], reverse=True)[:2]
        eye_y = y + np.mean([e[1] + e[3] / 2.0 for e in eyes])
    return x, y, w, h, eye_y


def match_exposure(pil_img, face_box, target=0.56):
    """Gamma-correct so the face reads at the same brightness in every card."""
    a = np.asarray(pil_img).astype(np.float32) / 255.0
    lum = 0.299 * a[..., 0] + 0.587 * a[..., 1] + 0.114 * a[..., 2]
    x0, y0, x1, y1 = face_box
    face = lum[y0:y1, x0:x1]
    mean = float(np.mean(face)) if face.size else float(np.mean(lum))
    mean = min(max(mean, 0.04), 0.96)
    gamma = float(np.clip(np.log(target) / np.log(mean), 0.62, 1.5))
    out = np.power(a, gamma)
    return Image.fromarray((np.clip(out, 0, 1) * 255).astype(np.uint8)), gamma


def process(src_rel, out_name):
    src = os.path.join(SRC_DIR, src_rel)
    bgr = cv2.imread(src)
    if bgr is None:
        raise RuntimeError(f"cannot read {src}")
    fx, fy, fw, fh, eye_y = detect(bgr)
    H, W = bgr.shape[:2]

    # Crop height so the face fills FACE_H_FRAC of it, then 4:5 width.
    crop_h = fh / FACE_H_FRAC
    crop_w = crop_h * (OUT_W / OUT_H)
    face_cx = fx + fw / 2.0

    top = eye_y - EYE_Y * crop_h
    left = face_cx - crop_w / 2.0

    # Keep the crop inside the source; shrink uniformly if it doesn't fit.
    scale = min(1.0, W / crop_w, H / crop_h)
    if scale < 1.0:
        crop_w *= scale
        crop_h *= scale
        top = eye_y - EYE_Y * crop_h
        left = face_cx - crop_w / 2.0
    left = max(0, min(left, W - crop_w))
    top = max(0, min(top, H - crop_h))

    pil = Image.open(src).convert("RGB")
    box = (int(round(left)), int(round(top)),
           int(round(left + crop_w)), int(round(top + crop_h)))
    img = pil.crop(box).resize((OUT_W, OUT_H), Image.LANCZOS)
    # face box mapped into output coordinates, for exposure matching
    sx, sy = OUT_W / crop_w, OUT_H / crop_h
    fb = (max(0, int((fx - left) * sx)), max(0, int((fy - top) * sy)),
          min(OUT_W, int((fx + fw - left) * sx)), min(OUT_H, int((fy + fh - top) * sy)))
    img, gamma = match_exposure(img, fb)
    img.save(os.path.join(OUT_DIR, out_name), "WEBP", quality=86, method=6)

    # Report where the eye line and face actually landed post-crop.
    eye_pct = (eye_y - top) / crop_h
    face_pct = fh / crop_h
    up = crop_w < OUT_W
    return (f"{out_name:32s} eye {eye_pct*100:4.1f}%  face {face_pct*100:4.1f}%  "
            f"gamma {gamma:4.2f}  src crop {int(crop_w)}x{int(crop_h)}"
            + ("  [UPSCALED]" if up else ""))


if __name__ == "__main__":
    for out_name, src_rel in SOURCES.items():
        try:
            print(process(src_rel, out_name))
        except Exception as e:
            print(f"{out_name:32s} FAILED: {e}")
