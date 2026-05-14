import base64
import io
import os
import subprocess
import tempfile
import time

import torch
import torchaudio
import soundfile as sf

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np

# Formats libsndfile / torchaudio's default backends can decode reliably on
# Windows. Anything else (mp3, m4a, aac, webm, opus inside containers, …) is
# routed through the bundled ffmpeg from imageio_ffmpeg first.
_NATIVE_AUDIO_EXTS = {".wav", ".flac", ".ogg"}

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
_BACKEND_DIR = os.path.dirname(_THIS_DIR)
_DOWNLOADS_DIR = os.path.join(_BACKEND_DIR, "models", "downloads")
os.makedirs(_DOWNLOADS_DIR, exist_ok=True)

_MODEL_CACHE: dict[str, object] = {}
_LAZY_MODULE_PATCHED = False
_TORCH_THREADS_CAPPED = False

# SepFormer is O(T^2) in attention. On CPU, anything past ~30s of audio
# becomes painfully slow AND eats all RAM. Default cap for the demo is 30s;
# override via env if you really want longer.
_MAX_INPUT_SECONDS = float(os.getenv("VOICE_MAX_INPUT_SECONDS", "30"))


def _cap_torch_threads() -> None:
    """Leave 2 CPU cores free so the OS / browser stay responsive while we infer."""
    global _TORCH_THREADS_CAPPED
    if _TORCH_THREADS_CAPPED:
        return
    try:
        cpu_count = os.cpu_count() or 4
        n_threads = max(1, cpu_count - 2)
        torch.set_num_threads(n_threads)
        # interop threads control parallelism between ops; cap aggressively too.
        try:
            torch.set_num_interop_threads(max(1, n_threads // 2))
        except RuntimeError:
            # set_num_interop_threads must be called before any parallel work;
            # if torch already locked it, skip silently.
            pass
        print(f"[voice] Torch threads capped to {n_threads} (of {cpu_count} cores)")
    except Exception as exc:
        print(f"[voice] Could not cap torch threads: {exc}")
    _TORCH_THREADS_CAPPED = True


def _patch_speechbrain_lazy_module() -> None:
    """Stop the werkzeug debug reloader from crashing on SpeechBrain's lazy modules.

    Why: speechbrain registers `speechbrain.k2_integration` and other lazy
    redirects directly into sys.modules. werkzeug's auto-reloader walks
    sys.modules each poll and reads `__file__`, which trips LazyModule.__getattr__
    and forces a real `import k2` — k2 isn't installed on Windows, so the
    reloader thread dies. We override __getattr__ to return None for dunders
    when the underlying module hasn't been loaded yet (matches the spirit of
    the existing inspect.py guard in SpeechBrain).
    """
    global _LAZY_MODULE_PATCHED
    if _LAZY_MODULE_PATCHED:
        return
    try:
        from speechbrain.utils.importutils import LazyModule
    except Exception:
        return

    # Only `__file__` is needed for the werkzeug reloader fix. Keeping the
    # patch narrow avoids interfering with legitimate lazy submodule imports
    # (which may legitimately rely on triggering a real import via __path__,
    # __spec__, etc.).
    _orig_getattr = LazyModule.__getattr__

    def _patched_getattr(self, attr):
        if attr == "__file__" and getattr(self, "lazy_module", None) is None:
            return None
        return _orig_getattr(self, attr)

    LazyModule.__getattr__ = _patched_getattr
    _LAZY_MODULE_PATCHED = True


# Model registry. `kind` tells us which SpeechBrain inference class + pipeline
# to use, and `sample_rate` is the rate we feed the model. Separation models
# emit N tracks; enhancement models emit 1 cleaned track.
_MODEL_REGISTRY = {
    "speechbrain/metricgan-plus-voicebank": {
        "kind": "enhancement_spectral",
        "sample_rate": 16000,
        "label": "MetricGAN+ — single-voice denoise (best for podcasts/lectures)",
        "architecture": "MetricGAN+",
        "dataset": "VoiceBank-DEMAND",
        "num_outputs": 1,
    },
    "speechbrain/mtl-mimic-voicebank": {
        "kind": "enhancement_waveform",
        "sample_rate": 16000,
        "label": "MTL Mimic — waveform denoise (single voice)",
        "architecture": "MTL Mimic",
        "dataset": "VoiceBank-DEMAND",
        "num_outputs": 1,
    },
    "speechbrain/sepformer-wsj02mix": {
        "kind": "separation_sepformer",
        "sample_rate": 8000,
        "label": "SepFormer (WSJ0-2Mix) — split 2 overlapping clean voices",
        "architecture": "SepFormer",
        "dataset": "WSJ0-2Mix",
        "num_outputs": 2,
    },
    "speechbrain/sepformer-whamr": {
        "kind": "separation_sepformer",
        "sample_rate": 8000,
        "label": "SepFormer (WHAMR!) — split 2 voices in noisy/reverberant audio",
        "architecture": "SepFormer",
        "dataset": "WHAMR!",
        "num_outputs": 2,
    },
}

_DEFAULT_MODEL = "speechbrain/metricgan-plus-voicebank"


def get_voice_models():
    return {
        "default": _DEFAULT_MODEL,
        "models": [
            {
                "id": mid,
                "available": True,
                "supports_reference": False,
                "label": meta["label"],
                "architecture": meta["architecture"],
                "dataset": meta["dataset"],
                "num_outputs": meta["num_outputs"],
                "kind": meta["kind"],
            }
            for mid, meta in _MODEL_REGISTRY.items()
        ],
    }


def _resolve_model_meta(model_name: str) -> dict:
    meta = _MODEL_REGISTRY.get(model_name)
    if meta is None:
        # Unknown model — assume legacy 2-speaker SepFormer at 8 kHz.
        return {
            "kind": "separation_sepformer",
            "sample_rate": 8000,
            "label": model_name,
            "num_outputs": 2,
        }
    return meta


def _load_model(model_name: str):
    cached = _MODEL_CACHE.get(model_name)
    if cached is not None:
        return cached

    _patch_speechbrain_lazy_module()

    from speechbrain.utils.fetching import LocalStrategy

    meta = _resolve_model_meta(model_name)
    run_opts = {"device": "cuda"} if torch.cuda.is_available() else {"device": "cpu"}
    savedir = os.path.join(_DOWNLOADS_DIR, model_name.replace("/", "_"))

    if meta["kind"] == "enhancement_spectral":
        from speechbrain.inference.enhancement import SpectralMaskEnhancement
        cls = SpectralMaskEnhancement
    elif meta["kind"] == "enhancement_waveform":
        from speechbrain.inference.enhancement import WaveformEnhancement
        cls = WaveformEnhancement
    else:
        from speechbrain.inference.separation import SepformerSeparation
        cls = SepformerSeparation

    # COPY (not SYMLINK) so Windows users without Developer Mode / admin
    # don't hit WinError 1314 when SpeechBrain tries to link HF cache files
    # into `savedir`.
    model = cls.from_hparams(
        source=model_name,
        savedir=savedir,
        run_opts=run_opts,
        local_strategy=LocalStrategy.COPY,
    )
    _MODEL_CACHE[model_name] = model
    return model


def _ffmpeg_to_wav(src_path: str, target_sr: int) -> str:
    """Decode an arbitrary audio/video file to a mono PCM WAV at target_sr.

    Uses the ffmpeg binary bundled by imageio_ffmpeg, so this works on Windows
    without a system-wide ffmpeg install.
    """
    from imageio_ffmpeg import get_ffmpeg_exe

    ffmpeg = get_ffmpeg_exe()
    fd, wav_path = tempfile.mkstemp(suffix=".wav", prefix="vsep_")
    os.close(fd)
    cmd = [
        ffmpeg, "-y",
        "-i", src_path,
        "-vn",
        "-ac", "1",
        "-ar", str(target_sr),
        "-f", "wav",
        wav_path,
    ]
    try:
        result = subprocess.run(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
    except FileNotFoundError as exc:
        raise RuntimeError(f"ffmpeg binary not available: {exc}") from exc

    if result.returncode != 0:
        try:
            os.remove(wav_path)
        except OSError:
            pass
        stderr_tail = result.stderr.decode("utf-8", errors="replace")[-600:]
        raise RuntimeError(f"ffmpeg failed to decode audio:\n{stderr_tail}")

    return wav_path


def _read_wav_as_tensor(wav_path: str) -> tuple[torch.Tensor, int]:
    """Read a WAV/FLAC/OGG file via soundfile and return (1, T)-or-(C, T) float32 tensor + sr.

    We avoid torchaudio.load because in torchaudio 2.x it routes through
    `torchcodec`, which on Windows fails to load its DLLs without system
    FFmpeg shared libraries installed. soundfile only needs libsndfile
    (bundled with the wheel) and handles WAV/FLAC/OGG cleanly.
    """
    data, sr = sf.read(wav_path, always_2d=True, dtype="float32")
    # soundfile gives (T, channels); torchaudio convention is (channels, T).
    waveform = torch.from_numpy(data.T.copy())
    return waveform, sr


def _load_audio_waveform(file_path: str, target_sr: int) -> tuple[torch.Tensor, str]:
    """Load any common audio file as (1, T) float32 tensor at target_sr.

    Returns (waveform, decoded_path) where decoded_path is either the original
    file or a temp WAV produced by ffmpeg. Callers should delete decoded_path
    when it differs from file_path.
    """
    ext = os.path.splitext(file_path)[1].lower()

    if ext in _NATIVE_AUDIO_EXTS:
        try:
            waveform, sr = _read_wav_as_tensor(file_path)
        except Exception as exc:
            print(f"[voice] soundfile read failed on {ext} file ({exc}); falling back to ffmpeg")
            decoded = _ffmpeg_to_wav(file_path, target_sr)
            waveform, sr = _read_wav_as_tensor(decoded)
            decoded_path = decoded
        else:
            decoded_path = file_path
    else:
        # mp3, m4a, aac, webm, mp4, opus, … — decode via ffmpeg.
        decoded = _ffmpeg_to_wav(file_path, target_sr)
        waveform, sr = _read_wav_as_tensor(decoded)
        decoded_path = decoded

    # Mono-mix and resample to model rate.
    if waveform.shape[0] > 1:
        waveform = waveform.mean(dim=0, keepdim=True)
    if sr != target_sr:
        waveform = torchaudio.transforms.Resample(sr, target_sr)(waveform)

    return waveform.float(), decoded_path


def _spectrogram_png(waveform: np.ndarray, sample_rate: int, title: str) -> str:
    """Render a log-mel-style spectrogram as a base64 PNG."""
    if waveform.ndim > 1:
        waveform = waveform.mean(axis=0)
    n_fft = 1024
    hop = 256
    spec = torch.stft(
        torch.from_numpy(waveform).float(),
        n_fft=n_fft,
        hop_length=hop,
        win_length=n_fft,
        window=torch.hann_window(n_fft),
        return_complex=True,
    )
    mag = spec.abs().numpy()
    db = 20.0 * np.log10(np.maximum(mag, 1e-6))

    fig, ax = plt.subplots(figsize=(6, 2.6), dpi=120)
    extent = [0, waveform.shape[-1] / sample_rate, 0, sample_rate / 2]
    ax.imshow(db, origin="lower", aspect="auto", cmap="magma", extent=extent)
    ax.set_xlabel("Time (s)")
    ax.set_ylabel("Hz")
    ax.set_title(title, fontsize=10)
    fig.tight_layout(pad=0.3)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return base64.b64encode(buf.read()).decode("utf-8")


def _compute_metrics(mixture: np.ndarray, sources: np.ndarray, target_idx: int) -> dict:
    """Energy-based dominance metrics that work without a reference signal.

    sources: shape (T, num_sources). mixture: shape (T,).
    """
    eps = 1e-12
    energies = (sources ** 2).sum(axis=0) + eps
    total = energies.sum()
    shares = (energies / total).tolist()

    similarities = []
    mix_norm = np.linalg.norm(mixture) + eps
    for i in range(sources.shape[1]):
        src = sources[:, i]
        denom = (np.linalg.norm(src) + eps) * mix_norm
        sim = float(np.dot(src, mixture) / denom)
        similarities.append(abs(sim))

    target_similarity = similarities[target_idx]
    if len(similarities) > 1:
        others = [s for j, s in enumerate(similarities) if j != target_idx]
        confidence_margin = float(target_similarity - max(others))
    else:
        confidence_margin = float(target_similarity)

    return {
        "similarities": [float(s) for s in similarities],
        "source_energy_shares": [float(s) for s in shares],
        "target_similarity": float(target_similarity),
        "confidence_margin": float(confidence_margin),
    }


def separate_voice(file_path: str, model_name: str, source_index: int):
    start_time = time.time()

    _cap_torch_threads()

    meta = _resolve_model_meta(model_name)
    kind = meta["kind"]
    sample_rate = int(meta["sample_rate"])

    model = _load_model(model_name)

    try:
        mixture_wave, decoded_path = _load_audio_waveform(file_path, sample_rate)
    except Exception as exc:
        raise RuntimeError(f"Failed to decode audio file: {exc}") from exc

    cleanup_decoded = decoded_path != file_path

    original_samples = mixture_wave.shape[-1]
    original_duration = original_samples / sample_rate
    max_samples = int(_MAX_INPUT_SECONDS * sample_rate)
    truncated = False
    if original_samples > max_samples:
        mixture_wave = mixture_wave[:, :max_samples].contiguous()
        truncated = True
        print(
            f"[voice] Input {original_duration:.1f}s > cap {_MAX_INPUT_SECONDS:.0f}s — "
            f"processing first {_MAX_INPUT_SECONDS:.0f}s only"
        )

    mix_peak = float(mixture_wave.abs().max().item())
    print(
        f"[voice] kind={kind} mixture shape={tuple(mixture_wave.shape)} "
        f"sr={sample_rate} peak={mix_peak:.4f}"
    )

    try:
        with torch.no_grad():
            mixture_input = mixture_wave.to(model.device)
            if kind in ("enhancement_spectral", "enhancement_waveform"):
                # Single-output denoiser. Output shape: (B, T).
                from speechbrain.utils.callchains import lengths_arg_exists

                if kind == "enhancement_spectral" and lengths_arg_exists(model.enhance_batch):
                    enhanced = model.enhance_batch(mixture_input, lengths=torch.tensor([1.0]))
                else:
                    enhanced = model.enhance_batch(mixture_input)
                # Normalize to [-1, 1] for consistent playback level.
                peak = enhanced.abs().max().clamp(min=1e-8)
                # Aim for -3 dBFS so we don't clip after rounding.
                est_sources = (enhanced / peak * 0.95).unsqueeze(-1)  # (B, T, 1)
                raw_peak = float(peak.item())
                print(
                    f"[voice] enhance_batch output shape={tuple(enhanced.shape)} "
                    f"raw_peak={raw_peak:.4f}"
                )
            else:
                # SepFormer separation. Output shape: (B, T, num_spks).
                est_sources_raw = model.separate_batch(mixture_input)
                raw_peak = float(est_sources_raw.abs().max().item())
                per_source_peaks = est_sources_raw.abs().amax(dim=1, keepdim=True).clamp(min=1e-8)
                est_sources = est_sources_raw / per_source_peaks
                print(
                    f"[voice] separate_batch output shape={tuple(est_sources_raw.shape)} "
                    f"raw_peak={raw_peak:.4f} per_source_peaks={per_source_peaks.flatten().tolist()}"
                )
    except Exception as exc:
        if cleanup_decoded and os.path.exists(decoded_path):
            try:
                os.remove(decoded_path)
            except OSError:
                pass
        raise RuntimeError(f"{kind} inference failed: {exc}") from exc

    if cleanup_decoded and os.path.exists(decoded_path):
        try:
            os.remove(decoded_path)
        except OSError:
            pass

    if est_sources.ndim != 3 or est_sources.shape[-1] < 1:
        raise RuntimeError(f"Unexpected separator output shape: {tuple(est_sources.shape)}")

    num_sources = est_sources.shape[-1]
    if source_index < 0 or source_index >= num_sources:
        source_index = 0

    sources_np = est_sources[0].detach().cpu().numpy()  # (T, num_sources)
    target_np = sources_np[:, source_index]

    mix_np = mixture_wave.squeeze(0).cpu().numpy()
    min_len = min(mix_np.shape[0], sources_np.shape[0])
    mix_trimmed = mix_np[:min_len]
    sources_trimmed = sources_np[:min_len, :]

    target_peak = float(np.max(np.abs(target_np))) if target_np.size else 0.0
    target_rms = float(np.sqrt(np.mean(target_np ** 2))) if target_np.size else 0.0
    print(
        f"[voice] target speaker {source_index}: shape={target_np.shape} "
        f"peak={target_peak:.4f} rms={target_rms:.4f}"
    )

    metrics = _compute_metrics(mix_trimmed, sources_trimmed, source_index)

    # Encode every separated source as its own 16-bit PCM WAV. This lets the
    # UI A/B between speakers without re-running the heavy SepFormer pass
    # (a clean podcast → one speaker is usually the dominant voice and the
    # other is residual noise / second speaker; only the user knows which).
    def _encode_source(track: np.ndarray) -> str:
        b = io.BytesIO()
        clipped = np.clip(track, -1.0, 1.0).astype(np.float32)
        sf.write(b, clipped, sample_rate, format="WAV", subtype="PCM_16")
        return base64.b64encode(b.getvalue()).decode("utf-8")

    sources_b64 = [_encode_source(sources_trimmed[:, i]) for i in range(num_sources)]
    source_stats = [
        {
            "peak": float(np.max(np.abs(sources_trimmed[:, i]))),
            "rms": float(np.sqrt(np.mean(sources_trimmed[:, i] ** 2))),
        }
        for i in range(num_sources)
    ]
    audio_b64 = sources_b64[source_index]
    print(
        f"[voice] WAV encoded: {len(audio_b64)*3//4} raw bytes (b64) for "
        f"{min_len/sample_rate:.2f}s. Source stats: {source_stats}"
    )

    viz = {}
    try:
        viz["mixture_spectrogram_png"] = _spectrogram_png(mix_trimmed, sample_rate, "Mixture")
        viz["target_spectrogram_png"] = _spectrogram_png(
            target_np[:min_len], sample_rate, f"Extracted speaker {source_index}"
        )
    except Exception as exc:
        viz["error"] = f"Visualization failed: {exc}"

    elapsed = time.time() - start_time

    return {
        "success": True,
        "audio_b64": audio_b64,
        "audio_format": "wav",
        "sample_rate": sample_rate,
        "model_used": model_name,
        "selected_source_index": int(source_index),
        "num_sources_detected": int(num_sources),
        "sources_b64": sources_b64,
        "source_stats": source_stats,
        "elapsed_seconds": float(elapsed),
        "input_duration_seconds": float(original_duration),
        "processed_seconds": float(min(original_duration, _MAX_INPUT_SECONDS)),
        "truncated": bool(truncated),
        "similarities": metrics["similarities"],
        "confidence_margin": metrics["confidence_margin"],
        "metrics": {
            "target_similarity": metrics["target_similarity"],
            "confidence_margin": metrics["confidence_margin"],
            "source_energy_shares": metrics["source_energy_shares"],
        },
        "viz": viz,
    }
