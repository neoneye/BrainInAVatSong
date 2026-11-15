# Word timestamps for assets/song.mp3 with faster-whisper. Run: uv run --with faster-whisper python tools/whisper_words.py
import json
from faster_whisper import WhisperModel
m = WhisperModel("mobiuslabsgmbh/faster-whisper-large-v3-turbo", device="cpu", compute_type="int8")
prompt = open("assets/lyrics.txt").read()
import re
prompt = re.sub(r"\[.*?\]", "", prompt)[:800]
segs, info = m.transcribe("assets/song.mp3", language="en", word_timestamps=True, initial_prompt=prompt, vad_filter=False, condition_on_previous_text=False)
out = []
for s in segs:
    for w in s.words:
        out.append([w.word.strip(), round(w.start, 2), round(w.end, 2), round(w.probability, 2)])
    print(round(s.start, 1), s.text, flush=True)
json.dump(out, open("docs/timing/whisper_words.json", "w"))
