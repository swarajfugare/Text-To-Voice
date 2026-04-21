#!/usr/bin/env python3
import argparse
import json
import re
import sys
import tempfile
import time
import unicodedata
import zipfile
from pathlib import Path


def print_error(message: str, exit_code: int = 1) -> None:
    print(json.dumps({"ok": False, "error": message}), file=sys.stderr)
    raise SystemExit(exit_code)


try:
    import fcntl
    import librosa
    import lameenc
    import numpy as np
    import requests
    import soundfile as sf
    import torch
    import maha_tts.inference as maha_inference
    from maha_tts import config, infer_tts
    from maha_tts.text.symbols import text_enc
except Exception:
    print_error(
        "Studio mode dependencies are missing. Install them with `pip install -r studio/requirements.txt`."
    )


MODEL_NAME = "Smolie-in"
SUPPORTED_LANGUAGE = "marathi"
MODEL_CACHE_DIR = Path.home() / ".cache" / "maha_tts" / "models"
MODEL_LOCK_PATH = Path(tempfile.gettempdir()) / "textvoice-maha_tts-model-download.lock"
DOWNLOAD_RETRIES = 3
DOWNLOAD_CHUNK_SIZE = 1024 * 1024
LOCK_TIMEOUT_SECONDS = 15 * 60
ZERO_WIDTH_RE = re.compile(r"[\u200B-\u200D\uFEFF]+")
WHITESPACE_RE = re.compile(r"\s+")
PUNCTUATION_SPACING_RE = re.compile(r"\s*([,.!?।])\s*")
PAUSE_PUNCTUATION_RE = re.compile(r"[;:]+")
NUMBER_RE = re.compile(r"[0-9०-९]+")
SENTENCE_SPLIT_RE = re.compile(r"(?<=[।.!?])\s+")
CLAUSE_SPLIT_RE = re.compile(r"(?<=,)\s+")
SUPPORTED_TEXT_TOKENS = {
    token
    for token in text_enc.keys()
    if token not in {"<S>", "<E>", "<PAD>"}
}
MARATHI_DIGIT_WORDS = {
    "0": "शून्य",
    "1": "एक",
    "2": "दोन",
    "3": "तीन",
    "4": "चार",
    "5": "पाच",
    "6": "सहा",
    "7": "सात",
    "8": "आठ",
    "9": "नऊ",
    "०": "शून्य",
    "१": "एक",
    "२": "दोन",
    "३": "तीन",
    "४": "चार",
    "५": "पाच",
    "६": "सहा",
    "७": "सात",
    "८": "आठ",
    "९": "नऊ",
}
MARATHI_SYMBOL_WORDS = {
    "&": " आणि ",
    "@": " अॅट ",
    "%": " टक्के ",
    "+": " प्लस ",
    "=": " बरोबर ",
    "/": " स्लॅश ",
    "₹": " रुपये ",
    "$": " डॉलर ",
    "€": " युरो ",
    "#": " क्रमांक ",
}
MAX_CHUNK_CHARACTERS = 140
PAUSE_BETWEEN_CHUNKS_SECONDS = 0.18
MODEL_MANIFEST = {
    MODEL_NAME: {
        "s2a_latest.pt": {
            "url": maha_inference.model_dirs[MODEL_NAME][0],
            "validator": "zip",
        },
        "t2s_best.pt": {
            "url": maha_inference.model_dirs[MODEL_NAME][1],
            "validator": "zip",
        },
    },
    "hifigan": {
        "g_02500000": {
            "url": maha_inference.model_dirs["hifigan"][0],
            "validator": "torch",
        },
        "config.json": {
            "url": maha_inference.model_dirs["hifigan"][1],
            "validator": "json",
        },
    },
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate Marathi voice clones with MahaTTS.")
    parser.add_argument("--text", required=True, help="Marathi text to synthesize.")
    parser.add_argument("--language", default=SUPPORTED_LANGUAGE, help="Language key for MahaTTS.")
    parser.add_argument("--reference", required=True, help="Path to a clean WAV reference clip.")
    parser.add_argument("--output", required=True, help="Path to write the generated MP3.")
    return parser.parse_args()


def ensure_inputs(args: argparse.Namespace) -> tuple[Path, Path]:
    reference_path = Path(args.reference).expanduser().resolve()
    output_path = Path(args.output).expanduser().resolve()

    if not reference_path.exists():
        print_error("Reference WAV file was not found.")

    if reference_path.suffix.lower() != ".wav":
        print_error("Studio mode currently supports only WAV reference files.")

    output_path.parent.mkdir(parents=True, exist_ok=True)
    return reference_path, output_path


def get_device() -> torch.device:
    return torch.device("cuda" if torch.cuda.is_available() else "cpu")


def load_studio_models(device: torch.device):
    ensure_model_artifacts()
    return maha_inference.load_models(MODEL_NAME, device)


def ensure_model_artifacts() -> None:
    MODEL_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    with acquire_cache_lock():
        for model_dir, files in MODEL_MANIFEST.items():
            for filename, spec in files.items():
                ensure_model_file(
                    MODEL_CACHE_DIR / model_dir / filename,
                    spec["url"],
                    spec["validator"],
                )


class acquire_cache_lock:
    def __enter__(self):
        self.lock_file = MODEL_LOCK_PATH.open("w")
        deadline = time.time() + LOCK_TIMEOUT_SECONDS

        while True:
            try:
                fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                return self
            except BlockingIOError:
                if time.time() >= deadline:
                    self.lock_file.close()
                    print_error(
                        "Studio model download is locked by another running generation. Wait for it to finish and try again."
                    )
                time.sleep(1)

    def __exit__(self, exc_type, exc, exc_tb):
        fcntl.flock(self.lock_file.fileno(), fcntl.LOCK_UN)
        self.lock_file.close()


def ensure_model_file(path: Path, url: str, validator: str) -> None:
    if is_valid_model_file(path, validator):
        return

    if path.exists():
        path.unlink()

    download_and_validate_file(url, path, validator)


def is_valid_model_file(path: Path, validator: str) -> bool:
    if not path.exists():
        return False

    if path.stat().st_size == 0:
        return False

    try:
        if validator == "json":
            json.loads(path.read_text(encoding="utf-8"))
        elif validator == "zip":
            with zipfile.ZipFile(path, "r") as archive:
                if not archive.namelist():
                    return False
        elif validator == "torch":
            torch.load(str(path), map_location="cpu")
        else:
            return False
    except Exception:
        return False

    return True


def download_and_validate_file(url: str, destination: Path, validator: str) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path = destination.with_name(f"{destination.name}.part")

    last_error = None
    for attempt in range(1, DOWNLOAD_RETRIES + 1):
        try:
            if temp_path.exists():
                temp_path.unlink()

            with requests.get(url, stream=True, timeout=(20, 300)) as response:
                response.raise_for_status()
                expected_bytes = int(response.headers.get("content-length", "0") or 0)
                received_bytes = 0

                with temp_path.open("wb") as output_file:
                    for chunk in response.iter_content(chunk_size=DOWNLOAD_CHUNK_SIZE):
                        if not chunk:
                            continue
                        output_file.write(chunk)
                        received_bytes += len(chunk)

            if expected_bytes and received_bytes != expected_bytes:
                raise RuntimeError(
                    f"downloaded {received_bytes} bytes but expected {expected_bytes} bytes"
                )

            if not is_valid_model_file(temp_path, validator):
                raise RuntimeError("the downloaded file is still invalid or incomplete")

            temp_path.replace(destination)
            return
        except Exception as exc:
            last_error = exc
            if temp_path.exists():
                temp_path.unlink()
            if attempt < DOWNLOAD_RETRIES:
                time.sleep(attempt * 2)

    print_error(
        f"Unable to download a valid Marathi studio model file ({destination.name}). "
        f"Check your internet connection and disk space, then try again. Details: {last_error}"
    )


def build_language_tensor(language: str, device: torch.device):
    if language not in config.lang_index:
        print_error(f"Unsupported MahaTTS language key: {language}")

    return torch.tensor(config.lang_index[language]).to(device).unsqueeze(0)


def expand_marathi_digits(match: re.Match[str]) -> str:
    return " ".join(MARATHI_DIGIT_WORDS.get(character, character) for character in match.group(0))


def normalize_marathi_text(text: str) -> str:
    normalized = unicodedata.normalize("NFC", text or "")
    normalized = ZERO_WIDTH_RE.sub("", normalized)

    for symbol, replacement in MARATHI_SYMBOL_WORDS.items():
        normalized = normalized.replace(symbol, replacement)

    normalized = NUMBER_RE.sub(expand_marathi_digits, normalized)
    normalized = normalized.replace("“", '"').replace("”", '"')
    normalized = normalized.replace("‘", "'").replace("’", "'")
    normalized = normalized.replace("–", " ").replace("—", " ")
    normalized = normalized.replace("…", "... ")
    normalized = normalized.replace("\r", " ").replace("\n", " । ")
    normalized = PAUSE_PUNCTUATION_RE.sub(" । ", normalized)
    normalized = PUNCTUATION_SPACING_RE.sub(r"\1 ", normalized)
    normalized = "".join(
        character if character in SUPPORTED_TEXT_TOKENS else " "
        for character in normalized
    )
    normalized = WHITESPACE_RE.sub(" ", normalized).strip()
    return normalized


def split_long_segment(segment: str, max_chars: int) -> list[str]:
    if len(segment) <= max_chars:
        return [segment]

    clause_parts = [part.strip() for part in CLAUSE_SPLIT_RE.split(segment) if part.strip()]
    if len(clause_parts) > 1:
        chunks: list[str] = []
        current = ""

        for clause in clause_parts:
            candidate = f"{current} {clause}".strip() if current else clause
            if current and len(candidate) > max_chars:
                chunks.append(current)
                current = clause
            else:
                current = candidate

        if current:
            chunks.append(current)

        return chunks

    words = segment.split()
    chunks = []
    current = ""

    for word in words:
        candidate = f"{current} {word}".strip() if current else word
        if current and len(candidate) > max_chars:
            chunks.append(current)
            current = word
        else:
            current = candidate

    if current:
        chunks.append(current)

    return chunks


def split_synthesis_text(text: str, max_chars: int = MAX_CHUNK_CHARACTERS) -> list[str]:
    if not text:
        return []

    sentences = [part.strip() for part in SENTENCE_SPLIT_RE.split(text) if part.strip()]
    if not sentences:
        sentences = [text.strip()]

    chunks: list[str] = []
    current = ""

    for sentence in sentences:
        for part in split_long_segment(sentence, max_chars):
            candidate = f"{current} {part}".strip() if current else part
            if current and len(candidate) > max_chars:
                chunks.append(current)
                current = part
            else:
                current = candidate

    if current:
        chunks.append(current)

    return chunks


def prepare_reference_audio(reference_path: Path) -> Path:
    try:
        audio, sample_rate = sf.read(str(reference_path), dtype="float32")
    except Exception as exc:
        print_error(f"Unable to read the uploaded WAV reference file. Details: {exc}")

    audio_array = np.asarray(audio)
    if audio_array.size == 0:
        print_error("The uploaded WAV reference file is empty.")

    if audio_array.ndim == 2:
        audio_array = audio_array.mean(axis=1)

    audio_array = np.asarray(audio_array).squeeze()
    if audio_array.ndim != 1:
        print_error("The uploaded WAV reference file could not be converted to mono audio.")

    target_sample_rate = int(config.sampling_rate)
    if int(sample_rate) != target_sample_rate:
        audio_array = librosa.resample(
            audio_array,
            orig_sr=int(sample_rate),
            target_sr=target_sample_rate,
        )
        sample_rate = target_sample_rate

    peak = float(np.max(np.abs(audio_array))) if audio_array.size else 0.0
    if peak > 1.0:
        audio_array = audio_array / peak

    with tempfile.NamedTemporaryFile(delete=False, suffix=".wav") as temp_file:
        prepared_reference = Path(temp_file.name)

    sf.write(str(prepared_reference), audio_array, int(sample_rate), subtype="PCM_16")
    return prepared_reference


def normalize_audio(audio: np.ndarray) -> np.ndarray:
    array = np.asarray(audio).squeeze()
    if array.ndim != 1:
        print_error("Generated audio has an unexpected shape.")

    if np.issubdtype(array.dtype, np.floating):
        peak = float(np.max(np.abs(array))) if array.size else 1.0
        peak = peak if peak > 0 else 1.0
        array = np.clip(array / peak, -1.0, 1.0)
        array = (array * 32767).astype(np.int16)
    else:
        array = array.astype(np.int16)

    return np.ascontiguousarray(array)


def write_mp3(audio: np.ndarray, sample_rate: int, output_path: Path) -> None:
    pcm_audio = normalize_audio(audio)

    encoder = lameenc.Encoder()
    encoder.set_bit_rate(128)
    encoder.set_in_sample_rate(sample_rate)
    encoder.set_channels(1)
    encoder.set_quality(2)

    mp3_payload = encoder.encode(pcm_audio.tobytes())
    mp3_payload += encoder.flush()

    with output_path.open("wb") as output_file:
        output_file.write(mp3_payload)


def synthesize_chunked_audio(
    text: str,
    reference_path: Path,
    diffuser,
    diff_model,
    ts_model,
    vocoder,
    language_tensor,
) -> tuple[np.ndarray, int, int]:
    chunks = split_synthesis_text(text)
    if not chunks:
        print_error("No Marathi text chunks were available for synthesis.")

    combined_audio: list[np.ndarray] = []
    sample_rate: int | None = None

    for index, chunk in enumerate(chunks):
        chunk_audio, chunk_sample_rate = infer_tts(
            chunk,
            [str(reference_path)],
            diffuser,
            diff_model,
            ts_model,
            vocoder,
            language_tensor,
        )

        chunk_array = np.asarray(chunk_audio, dtype=np.float32).squeeze()
        if chunk_array.ndim != 1:
            print_error("Studio synthesis produced an unexpected chunk shape.")

        sample_rate = int(chunk_sample_rate)
        if index > 0:
            combined_audio.append(
                np.zeros(int(sample_rate * PAUSE_BETWEEN_CHUNKS_SECONDS), dtype=np.float32)
            )
        combined_audio.append(chunk_array)

    if sample_rate is None:
        print_error("Studio synthesis did not return a valid sampling rate.")

    return np.concatenate(combined_audio), sample_rate, len(chunks)


def main() -> None:
    args = parse_args()
    reference_path, output_path = ensure_inputs(args)
    device = get_device()
    language = args.language or SUPPORTED_LANGUAGE
    prepared_reference = prepare_reference_audio(reference_path)
    synthesis_text = normalize_marathi_text(args.text)

    if not synthesis_text:
        print_error(
            "The provided text could not be normalized into supported Marathi speech. Remove unusual symbols and try again."
        )

    try:
        maha_inference.english_cleaners = normalize_marathi_text
        diff_model, ts_model, vocoder, diffuser = load_studio_models(device)
        language_tensor = build_language_tensor(language, device)

        audio, sample_rate, chunk_count = synthesize_chunked_audio(
            synthesis_text,
            prepared_reference,
            diffuser,
            diff_model,
            ts_model,
            vocoder,
            language_tensor,
        )
        write_mp3(audio, int(sample_rate), output_path)
    except Exception as exc:
        print_error(
            f"Studio synthesis failed. Confirm MahaTTS installed correctly and your WAV sample is clean. Details: {exc}"
        )
    finally:
        if prepared_reference.exists():
            prepared_reference.unlink()

    print(
        json.dumps(
            {
                "ok": True,
                "model": MODEL_NAME,
                "device": str(device),
                "output": str(output_path),
                "language": language,
                "chunks": chunk_count,
            }
        )
    )


if __name__ == "__main__":
    main()
