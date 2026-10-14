# AquaAdvisory project demo

- **AquaAdvisory_Demo_3min.mp4**: three-minute 1920 x 1080 walkthrough, H.264 video and English AAC narration, with burned-in captions and chapter metadata.
- **AquaAdvisory_Demo.srt**: separate English captions.
- **chapters.txt**: chapter timestamps.
- **storyboard.json**: editable narration and scene timings.

The footage shows the locally running application and its existing dataset on 14 October 2026. External browser requests were blocked during recording, so the map section uses locally rendered plot boundaries and 3D views. No review feedback was submitted. No application source files were changed.

The narration uses the installed Microsoft Zira voice. The demo presents estimated irrigation quantities as prototype decision support and includes the geographic-validation limitation shown by the application.

## Rebuild

Start the existing API on port 8000, then run from the project root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File demo_video/narrate.ps1
.venv/Scripts/python.exe demo_video/capture.py
.venv/Scripts/python.exe demo_video/render.py
```

Dependencies added to the project virtual environment: `playwright` and `imageio-ffmpeg`. Capture uses installed Chrome and Playwright's FFmpeg recorder. `capture.py` blocks all non-local browser requests. All intermediate assets are retained for editing.
