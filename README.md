# DaVinci Resolve Studio 21 AI Remixer (Demucs v4 on Android Termux)

A Node.js web dashboard and audio console featuring **Meta Demucs v4 (htdemucs)** running on **Android Termux (ARM64)**, styled with an authentic **DaVinci Resolve Studio 21 (Fairlight)** audio remixer interface.

---

## 🎛 Features

- **Demucs v4 AI Stem Separation Engine**:
  - Uses Meta's Hybrid Transformer (`htdemucs`) model running natively on Termux ARM64 CPU.
  - Automatically isolates music into **4 separate stems**:
    1. **Vocals** (Lead & Backing Vocals)
    2. **Drums** (Percussion & Drums)
    3. **Bass** (Bass Guitar, Synth Bass, Sub)
    4. **Instruments / Other** (Guitars, Keys, Synths, FX)
  - Configurable processing mode: **Fast 1-Pass** (optimized for mobile CPU) or **High Fidelity 2-Pass**.

- **DaVinci Resolve Studio 21 Fairlight UI**:
  - Faithful dark industrial aesthetic (charcoal slate panels `#1e1e21`, 1px beveled borders, DaVinci 3-color petal logo).
  - **No Complex Timeline**: Avoids cumbersome DAW multitrack clip editing and zoom grids. Focuses on an intuitive, synchronized 4-channel mixer rack and precision transport scrubber.
  - **Tactile Mute `[M]` & Solo `[S]` Hardware Buttons**:
    - `[M]` glows bright **Red** (`#ff4d4d`) when muted.
    - `[S]` glows bright **Amber / Yellow** (`#f1c40f`) when soloed.
  - **Vertical Volume Faders & Real-time dB Display**:
    - Range from `+3.5 dB` down to `-inf dB`.
  - **Dynamic 16-Segment LED VU Meters**:
    - Segmented Green, Amber, and Red peak LEDs dynamically bounce to the stems' audio playback in real time via Web Audio API.
  - **Master Transport Bar**:
    - 8-digit DaVinci Resolve LED timecode display: `00:00:00:00` (Hours:Minutes:Seconds:Frames at 24fps).
    - Play `▶`, Pause `❚❚`, Stop `■`, Loop `🔁`, and Return-to-Start `|◀`.
    - Scrubber seek bar with zero-latency synchronization across all 4 stems.

- **Export & Session History**:
  - **Download Individual Stems**: Instant WAV download for any isolated track.
  - **Export All (.ZIP)**: Download all 4 separated stems packaged in a single ZIP file.
  - **Media Pool Session Manager**: Access previously separated songs without having to re-render.

---

## 🚀 How to Run

### 1. Start the Server
From Termux in this directory:
```bash
npm start
# or: node server.js
```

### 2. Access the Dashboard
Open your browser and navigate to:
- **On this Android device**: [http://localhost:3000](http://localhost:3000)
- **From another PC/phone on the same Wi-Fi**: `http://<YOUR_TERMUX_IP>:3000`

---

## 🛠 Architecture & Termux Optimization

1. **Python / PyTorch ARM64**:
   - Runs `python-torch` (2.14.1) and `python-torchaudio` (2.11.0) compiled natively for Termux `aarch64`.
   - Uses `ffmpeg` fallback for audio decoding and encoding to avoid C/Rust compiler dependencies on Android.
2. **Web Audio API**:
   - Decodes audio stems directly in the browser.
   - Synchronizes stem playback using `AudioContext.currentTime` and uses dedicated `GainNode` routing for click-free mute, solo, and volume adjustments.
3. **Real-time Server-Sent Events (SSE)**:
   - Streams Demucs tqdm progress and log messages live from Python to the browser.
