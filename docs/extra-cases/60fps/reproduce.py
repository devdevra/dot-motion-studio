#!/usr/bin/env python3
"""Resample the frozen 24 FPS demos to 60 FPS; never synthesize new poses.

Run from any directory: python3 docs/extra-cases/60fps/reproduce.py
Requires Python 3, Pillow, FFmpeg with libx264, and ffprobe. All output stays here.
"""
from fractions import Fraction
from pathlib import Path
from PIL import Image, ImageDraw
import hashlib
import io
import json
import os
import re
import subprocess
import tempfile

HERE = Path(__file__).resolve().parent
FILTER = "fps=fps=60:start_time=0:round=up:eof_action=pass"
CASES = [
    {
        "name": "typography",
        "source": "../typography/typography-ko.mp4",
        "sourceSha256": "c5a95034e1542bf14df6af660a8a27e297172df8dc43d3b470402d1664d28122",
        "options": "../typography/typography-options.json",
        "renderScript": "../typography/render-video.py",
        "output": "typography-ko-60fps.mp4",
        "width": 720, "height": 720, "engineFps": 8, "sourcePoseFrames": 16,
        "presentation": "16 prepared typography frames, replayed at 8 FPS during 2-8 seconds; original titles and 24 FPS progress indicator preserved.",
    },
    {
        "name": "golf-swing",
        "source": "../golf-swing/golf-swing-ko.mp4",
        "sourceSha256": "9f9aec8679cfac11460cc8f2ba3d089546976e0b2fd282080eddb926b6eab31d",
        "options": "../golf-swing/golf-swing-options.json",
        "renderScript": "../golf-swing/render-demo.py",
        "output": "golf-swing-ko-60fps.mp4",
        "width": 1280, "height": 720, "engineFps": 2, "sourcePoseFrames": 8,
        "presentation": "8 AI-prepared poses. First pass: 0-4 s, 0.50 s/pose (2 poses/s). Second pass: 4-10 s, 0.75 s/pose (4/3 poses/s). All original presentation timing preserved.",
    },
]


def capture(args):
    return subprocess.check_output(args, stderr=subprocess.PIPE)


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def info(path):
    data = json.loads(capture([
        "ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format",
        "-of", "json", str(path),
    ]))
    videos = [s for s in data["streams"] if s["codec_type"] == "video"]
    assert len(videos) == 1 and len(data["streams"]) == 1, "Expected one silent video stream"
    stream = videos[0]
    return {
        "codec": stream["codec_name"], "profile": stream["profile"],
        "pixelFormat": stream["pix_fmt"], "width": stream["width"], "height": stream["height"],
        "rFrameRate": stream["r_frame_rate"], "avgFrameRate": stream["avg_frame_rate"],
        "timeBase": stream["time_base"], "encodedFrames": int(stream["nb_frames"]),
        "decodedFrames": int(stream["nb_read_frames"]),
        "streamDurationSeconds": stream["duration"], "durationSeconds": data["format"]["duration"],
        "audio": False,
    }


def assert_media(media, case, fps, frames):
    assert (media["width"], media["height"]) == (case["width"], case["height"])
    assert media["rFrameRate"] == media["avgFrameRate"] == f"{fps}/1"
    assert media["encodedFrames"] == media["decodedFrames"] == frames
    assert Fraction(media["durationSeconds"]) == Fraction(media["streamDurationSeconds"]) == 10
    assert media["codec"] == "h264" and media["pixelFormat"] == "yuv420p"


def frame_hashes(path, resample=False):
    args = ["ffmpeg", "-v", "error", "-i", str(path), "-map", "0:v:0", "-an"]
    if resample:
        args += ["-vf", FILTER, "-frames:v", "600"]
    args += ["-pix_fmt", "yuv420p", "-c:v", "rawvideo", "-threads", "1", "-f", "framemd5", "-"]
    lines = capture(args).decode().splitlines()
    return [line.rsplit(",", 1)[1].strip() for line in lines if line and not line.startswith("#")]


def inspect_timestamps(path):
    frames = json.loads(capture([
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_frames",
        "-show_entries", "frame=pts,duration", "-of", "json", str(path),
    ]))["frames"]
    assert len(frames) == 600
    tb = Fraction(info(path)["timeBase"])
    for index, frame in enumerate(frames):
        assert int(frame["pts"]) * tb == Fraction(index, 60), f"Non-CFR timestamp: {index}"
        assert int(frame["duration"]) * tb == Fraction(1, 60), f"Unexpected duration: {index}"
    return {"checkedFrames": 600, "allPtsEqualFrameIndexDiv60": True,
            "allFrameDurationsEqual1Div60": True, "firstPtsSeconds": "0",
            "lastPtsSecondsExact": "599/60", "endSecondsExact": "10"}


def image_at(path, frame):
    return Image.open(io.BytesIO(capture([
        "ffmpeg", "-v", "error", "-i", str(path), "-vf", f"select=eq(n\\,{frame})",
        "-frames:v", "1", "-f", "image2pipe", "-c:v", "png", "-threads", "1", "-",
    ]))).convert("RGB")


def review_image(case):
    # Two rows: exact input frame, then corresponding resampled output frame.
    selected = [0, 59, 120, 210, 240, 360, 480, 599]
    width = 320
    height = round(case["height"] * width / case["width"])
    tile_height = height + 45
    sheet = Image.new("RGB", (width * 4, tile_height * 4), "#edf1ed")
    draw = ImageDraw.Draw(sheet)
    samples = []
    for k, output_index in enumerate(selected):
        source_index = output_index * 2 // 5
        x, y = (k % 4) * width, (k // 4) * tile_height * 2
        for offset, path, index, label in [
            (0, case["source"], source_index, "24 FPS source"),
            (tile_height, case["output"], output_index, "60 FPS output"),
        ]:
            frame = image_at(path, index)
            frame.thumbnail((width, height), Image.Resampling.LANCZOS)
            draw.text((x + 8, y + offset + 6), f"{label} | frame {index:03d}", fill="#102721")
            draw.text((x + 8, y + offset + 23), f"Target time {output_index}/60 s", fill="#102721")
            sheet.paste(frame, (x, y + offset + 45))
        samples.append({"outputFrame": output_index, "sourceFrame": source_index})
    destination = f"{case['name']}-60fps-review.png"
    sheet.save(destination, optimize=True)
    return {"contactSheet": destination, "samples": samples,
            "layout": "4 columns; each pair of rows shows source above output. Full-resolution decode is checked separately."}


def build(case, tmp):
    assert sha(case["source"]) == case["sourceSha256"], f"Frozen source changed: {case['source']}"
    source_info = info(case["source"])
    assert_media(source_info, case, 24, 240)
    options = json.loads(Path(case["options"]).read_text())
    assert options["fps"] == case["engineFps"]
    assert options["source"]["count"] == case["sourcePoseFrames"]
    command = [
        "ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
        "-i", case["source"], "-map", "0:v:0", "-an", "-vf", FILTER,
        "-frames:v", "600", "-fps_mode", "cfr", "-c:v", "libx264",
        "-preset", "slow", "-crf", "18", "-profile:v", "high", "-level:v", "4.2",
        "-pix_fmt", "yuv420p", "-threads", "1", "-map_metadata", "-1",
        "-video_track_timescale", "15360", "-movflags", "+faststart", case["output"],
    ]
    subprocess.run(command, check=True)
    output_info = info(case["output"])
    assert_media(output_info, case, 60, 600)
    # Decode the entire bitstream with errors fatal, independently of ffprobe's frame count.
    subprocess.run([
        "ffmpeg", "-v", "error", "-xerror", "-err_detect", "explode", "-i", case["output"],
        "-map", "0:v:0", "-an", "-f", "null", "-",
    ], check=True)
    timing = inspect_timestamps(case["output"])
    source_hashes = frame_hashes(case["source"])
    held_hashes = frame_hashes(case["source"], True)
    assert len(source_hashes) == 240 and len(held_hashes) == 600
    mapping = [i * 2 // 5 for i in range(600)]
    assert all(held_hashes[i] == source_hashes[k] for i, k in enumerate(mapping))
    # Verify all encoded frames against that exact hold-only resampling, not just metadata.
    stats = str(tmp / f"{case['name']}-ssim.log")
    subprocess.run([
        "ffmpeg", "-v", "error", "-i", case["source"], "-i", case["output"],
        "-filter_complex", f"[0:v]{FILTER}[expected];[expected][1:v]ssim=stats_file={stats}",
        "-an", "-f", "null", "-",
    ], check=True)
    values = [float(v) for v in re.findall(r"All:([0-9.]+)", Path(stats).read_text())]
    assert len(values) == 600, f"Expected 600 SSIM checks, got {len(values)}"
    assert min(values) >= 0.99, f"Unexpected resampling mismatch: {min(values)}"
    visual = review_image(case)
    # Verify deterministic encoding by rebuilding to a temporary sibling and comparing bytes.
    repeat = tmp / case["output"]
    subprocess.run(command[:-1] + [str(repeat)], check=True)
    assert sha(repeat) == sha(case["output"]), "Same-version rerender was not byte-identical"
    assert sha(case["source"]) == case["sourceSha256"], "Original was modified"
    result = {
        "source": case["source"], "sourceBytes": Path(case["source"]).stat().st_size,
        "sourceSha256Before": case["sourceSha256"], "sourceSha256After": sha(case["source"]),
        "sourceUnchanged": True, "sourceMedia": source_info,
        "output": case["output"], "outputBytes": Path(case["output"]).stat().st_size,
        "outputSha256": sha(case["output"]), "outputMedia": output_info,
        "engineFps": case["engineFps"], "preparedSourceFrames": case["sourcePoseFrames"],
        "presentationFpsBefore": 24, "presentationFpsAfter": 60,
        "presentation": case["presentation"],
        "sourceEvidence": [case["options"], case["renderScript"]],
        "command": command,
        "verification": {
            "fullDecodePassed": True, "exactCfrTiming": timing,
            "resampling": {"filter": FILTER, "sourceIndexForOutputN": "floor(n * 24 / 60) = floor(2*n/5)",
                           "outputFrames": 600, "sourceFrames": 240, "holdPattern": [3, 2],
                           "all600ResamplerFramesPixelExactToMappedDecodedSource": True,
                           "opticalFlow": False, "frameBlending": False, "newPoses": False},
            "encodedOutputCorrespondence": {"method": "Per-frame YUV SSIM against exact held source frame sequence",
                                            "checkedFrames": 600, "minimumAll": min(values),
                                            "meanAll": round(sum(values)/len(values), 9),
                                            "thresholdAll": 0.99, "losslessEncode": False,
                                            "note": "H.264 re-encoding changes some decoded pixels; this is not a pixel-identical copy."},
            "sameVersionRebuildByteIdentical": True, "representativeVisualFrames": visual,
        },
    }
    print(json.dumps({"output": result["output"], "bytes": result["outputBytes"],
                      "sha256": result["outputSha256"], "minimumSSIM": min(values)}, ensure_ascii=False), flush=True)
    return result


def main():
    os.chdir(HERE)
    # Refuse to touch either output unless both input hashes match the frozen sources.
    for case in CASES:
        assert sha(case["source"]) == case["sourceSha256"]
    with tempfile.TemporaryDirectory(prefix=".verification-", dir=".") as directory:
        tmp = Path(directory)
        records = [build(case, tmp) for case in CASES]
    report = {
        "schemaVersion": 1,
        "scope": "Separate 60 FPS hold-only conversions of two frozen, silent 10-second presentation videos.",
        "ffmpegVersion": capture(["ffmpeg", "-version"]).decode().splitlines()[0],
        "limitations": ["No new source motion or AI poses are created.",
                        "60 FPS means 600 presentation frames in 10 seconds, using repeated source frames.",
                        "Original 24 FPS presentation changes remain quantized to the original timing, with up to 1/120 s delay on the 60 FPS grid.",
                        "H.264 CRF 18 is a new lossy encode; source MP4 files remain byte-identical.",
                        "Exact output bytes can differ with other FFmpeg/libx264 versions."],
        "videos": records,
        "files": {},
    }
    for path in sorted(HERE.iterdir()):
        if path.is_file() and path.name != "verification.json":
            report["files"][path.name] = {"bytes": path.stat().st_size, "sha256": sha(path)}
    Path("verification.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
