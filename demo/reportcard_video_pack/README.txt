WeftEnd Report Card Video Pack (curated demo fixtures)

Purpose
- Provide clean, synthetic artifacts for demo videos.
- Avoid personal files, paths, or sensitive identifiers.
- Produce predictable SAME / CHANGED / WITHHELD report-card outcomes.

How to use (Windows right-click flow)
1) Run the case_01_same file once.
2) Run the same file again to show STATUS: SAME.
3) Run case_02_changed_content/step_1/weftend_video_case02_subject.txt.
4) Run case_02_changed_content/step_2/weftend_video_case02_subject.txt.
   - Same filename, different content -> expected CHANGED prompt.
5) Run case_03_changed_structure/step_1/weftend_video_case03_bundle.
6) Run case_03_changed_structure/step_2/weftend_video_case03_bundle.
   - Same folder name, file set changed -> expected CHANGED prompt.
7) Run demo/native_app_stub/app.exe to show analysis-first WITHHELD behavior.

Notes
- Keep your recording crop on the report card and target folder only.
- Use these fixtures as-is; do not rename files/folders if you want the same target keys.
- If you previously used these same names, baseline state may already exist in Library.
  If needed, clear that specific target from your local WeftEnd Library before recording.

