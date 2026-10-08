/**
 * DaVinci Resolve Studio 21 AI Remixer - Audio Engine
 * Synchronized 4-Stem Web Audio API Engine with Mute, Solo, Volume & Real-time VU Meters
 */

class FairlightAudioEngine {
  constructor() {
    this.audioCtx = null;
    this.audioBuffers = {
      vocals: null,
      drums: null,
      bass: null,
      other: null
    };
    this.sources = {
      vocals: null,
      drums: null,
      bass: null,
      other: null
    };
    this.gainNodes = {
      vocals: null,
      drums: null,
      bass: null,
      other: null
    };
    this.muteNodes = {
      vocals: null,
      drums: null,
      bass: null,
      other: null
    };
    this.analysers = {
      vocals: null,
      drums: null,
      bass: null,
      other: null
    };

    this.masterGainNode = null;
    this.masterAnalyser = null;

    // Track states
    this.volume = { vocals: 1.0, drums: 1.0, bass: 1.0, other: 1.0 };
    this.muted = { vocals: false, drums: false, bass: false, other: false };
    this.soloed = { vocals: false, drums: false, bass: false, other: false };
    this.masterVolume = 1.0;

    // Playback state
    this.isPlaying = false;
    this.isLooping = false;
    this.startTime = 0;
    this.pauseOffset = 0;
    this.duration = 0;
    this.isLoaded = false;

    // Callbacks
    this.onTimeUpdate = null;
    this.onPlaybackEnd = null;
    this.onVUMeterUpdate = null;

    this.animationFrameId = null;
  }

  initAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      this.audioCtx = new AudioContextClass();

      // Master Gain & Analyser
      this.masterGainNode = this.audioCtx.createGain();
      this.masterGainNode.gain.value = this.masterVolume;

      this.masterAnalyser = this.audioCtx.createAnalyser();
      this.masterAnalyser.fftSize = 256;
      this.masterAnalyser.smoothingTimeConstant = 0.8;

      this.masterGainNode.connect(this.masterAnalyser);
      this.masterAnalyser.connect(this.audioCtx.destination);

      // Create stem nodes
      ['vocals', 'drums', 'bass', 'other'].forEach((stem) => {
        const gainNode = this.audioCtx.createGain();
        gainNode.gain.value = this.volume[stem];

        const muteNode = this.audioCtx.createGain();
        muteNode.gain.value = 1.0;

        const analyser = this.audioCtx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.8;

        gainNode.connect(muteNode);
        muteNode.connect(analyser);
        analyser.connect(this.masterGainNode);

        this.gainNodes[stem] = gainNode;
        this.muteNodes[stem] = muteNode;
        this.analysers[stem] = analyser;
      });
    }

    if (this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
  }

  async loadStems(jobId, onProgress) {
    this.initAudioContext();
    this.stop();
    this.isLoaded = false;
    this.pauseOffset = 0;

    const stems = ['vocals', 'drums', 'bass', 'other'];
    let loadedCount = 0;

    const loadPromises = stems.map(async (stem) => {
      const url = `/api/stems/${jobId}/${stem}?t=${Date.now()}`;
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to load ${stem} stem (HTTP ${response.status})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioCtx.decodeAudioData(arrayBuffer);
      this.audioBuffers[stem] = audioBuffer;
      loadedCount++;
      if (onProgress) {
        onProgress(Math.round((loadedCount / stems.length) * 100));
      }
      return audioBuffer;
    });

    await Promise.all(loadPromises);

    // Duration is maximum of stems
    this.duration = Math.max(
      this.audioBuffers.vocals.duration,
      this.audioBuffers.drums.duration,
      this.audioBuffers.bass.duration,
      this.audioBuffers.other.duration
    );

    this.isLoaded = true;
    this.updateGains();
    return this.duration;
  }

  play() {
    if (!this.isLoaded) return;
    this.initAudioContext();

    if (this.isPlaying) return;

    if (this.pauseOffset >= this.duration) {
      this.pauseOffset = 0;
    }

    const now = this.audioCtx.currentTime;
    this.startTime = now - this.pauseOffset;

    ['vocals', 'drums', 'bass', 'other'].forEach((stem) => {
      const source = this.audioCtx.createBufferSource();
      source.buffer = this.audioBuffers[stem];
      source.connect(this.gainNodes[stem]);

      source.start(0, this.pauseOffset);
      this.sources[stem] = source;
    });

    // Detect track end on vocals source
    if (this.sources.vocals) {
      this.sources.vocals.onended = () => {
        if (this.isPlaying && this.getCurrentTime() >= this.duration - 0.1) {
          if (this.isLooping) {
            this.pauseOffset = 0;
            this.stopSources();
            this.isPlaying = false;
            this.play();
          } else {
            this.stop();
            if (this.onPlaybackEnd) this.onPlaybackEnd();
          }
        }
      };
    }

    this.isPlaying = true;
    this.startAnimationLoop();
  }

  pause() {
    if (!this.isPlaying) return;
    this.pauseOffset = this.getCurrentTime();
    this.stopSources();
    this.isPlaying = false;
    this.stopAnimationLoop();
  }

  stop() {
    this.stopSources();
    this.isPlaying = false;
    this.pauseOffset = 0;
    this.stopAnimationLoop();
    if (this.onTimeUpdate) this.onTimeUpdate(0, this.duration);
  }

  seek(targetTime) {
    const clamped = Math.max(0, Math.min(this.duration, targetTime));
    const wasPlaying = this.isPlaying;

    if (this.isPlaying) {
      this.stopSources();
      this.isPlaying = false;
    }

    this.pauseOffset = clamped;

    if (wasPlaying) {
      this.play();
    } else {
      if (this.onTimeUpdate) this.onTimeUpdate(this.pauseOffset, this.duration);
    }
  }

  stopSources() {
    ['vocals', 'drums', 'bass', 'other'].forEach((stem) => {
      if (this.sources[stem]) {
        try {
          this.sources[stem].stop();
          this.sources[stem].disconnect();
        } catch (e) {}
        this.sources[stem] = null;
      }
    });
  }

  getCurrentTime() {
    if (!this.isLoaded) return 0;
    if (this.isPlaying && this.audioCtx) {
      const elapsed = this.audioCtx.currentTime - this.startTime;
      return Math.min(this.duration, Math.max(0, elapsed));
    }
    return this.pauseOffset;
  }

  setMute(stem, isMuted) {
    this.muted[stem] = isMuted;
    this.updateGains();
  }

  setSolo(stem, isSoloed) {
    this.soloed[stem] = isSoloed;
    this.updateGains();
  }

  setVolume(stem, value) {
    this.volume[stem] = Math.max(0, Math.min(2.0, value));
    if (this.gainNodes[stem] && this.audioCtx) {
      this.gainNodes[stem].gain.setValueAtTime(this.volume[stem], this.audioCtx.currentTime);
    }
  }

  setMasterVolume(value) {
    this.masterVolume = Math.max(0, Math.min(2.0, value));
    if (this.masterGainNode && this.audioCtx) {
      this.masterGainNode.gain.setValueAtTime(this.masterVolume, this.audioCtx.currentTime);
    }
  }

  updateGains() {
    if (!this.audioCtx) return;

    const hasAnySolo = Object.values(this.soloed).some((s) => s);

    ['vocals', 'drums', 'bass', 'other'].forEach((stem) => {
      const muteNode = this.muteNodes[stem];
      if (!muteNode) return;

      let effectiveGain = 1.0;

      if (hasAnySolo) {
        // In Solo mode: only soloed stems play unless they are explicitly muted
        if (!this.soloed[stem] || this.muted[stem]) {
          effectiveGain = 0.0;
        }
      } else {
        // Normal mode: muted stems are silenced
        if (this.muted[stem]) {
          effectiveGain = 0.0;
        }
      }

      muteNode.gain.setValueAtTime(effectiveGain, this.audioCtx.currentTime);
    });
  }

  startAnimationLoop() {
    this.stopAnimationLoop();

    const loop = () => {
      if (this.isPlaying) {
        const currentTime = this.getCurrentTime();
        if (this.onTimeUpdate) {
          this.onTimeUpdate(currentTime, this.duration);
        }

        // Calculate peak meters for each stem & master
        if (this.onVUMeterUpdate) {
          const meterData = {
            vocals: this.calculateLevel(this.analysers.vocals, this.muted.vocals),
            drums: this.calculateLevel(this.analysers.drums, this.muted.drums),
            bass: this.calculateLevel(this.analysers.bass, this.muted.bass),
            other: this.calculateLevel(this.analysers.other, this.muted.other),
            master: this.calculateLevel(this.masterAnalyser, false)
          };
          this.onVUMeterUpdate(meterData);
        }

        this.animationFrameId = requestAnimationFrame(loop);
      }
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  stopAnimationLoop() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  calculateLevel(analyser, isMuted) {
    if (!analyser || isMuted || !this.isPlaying) return 0;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < bufferLength; i++) {
      const val = (dataArray[i] - 128) / 128;
      sum += val * val;
    }
    const rms = Math.sqrt(sum / bufferLength);
    // Return normalized peak (0.0 to 1.0) with gentle boost for visual response
    return Math.min(1.0, rms * 3.5);
  }
}

// Export instance
window.fairlightEngine = new FairlightAudioEngine();
