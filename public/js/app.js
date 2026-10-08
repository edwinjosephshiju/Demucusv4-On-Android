/**
 * DaVinci Resolve Studio 21 AI Remixer - Controller
 * Connects UI controls to backend Demucs v4 and Fairlight audio engine
 */

document.addEventListener('DOMContentLoaded', () => {
  // DOM Elements
  const dropzone = document.getElementById('dropzone');
  const fileInput = document.getElementById('fileInput');
  const filePill = document.getElementById('filePill');
  const fileNameDisplay = document.getElementById('fileNameDisplay');
  const fileSizeDisplay = document.getElementById('fileSizeDisplay');
  const btnProcess = document.getElementById('btnProcess');
  const shiftsSelect = document.getElementById('shiftsSelect');

  // Progress Elements
  const renderProgressSection = document.getElementById('renderProgressSection');
  const progressStatusText = document.getElementById('progressStatusText');
  const progressPercent = document.getElementById('progressPercent');
  const progressBarFill = document.getElementById('progressBarFill');
  const renderLogs = document.getElementById('renderLogs');

  // Console Elements
  const activeTrackInfo = document.getElementById('activeTrackInfo');
  const timecodeDisplay = document.getElementById('timecodeDisplay');
  const scrubberSlider = document.getElementById('scrubberSlider');
  const durationDisplay = document.getElementById('durationDisplay');

  // Transport Buttons
  const btnPlay = document.getElementById('btnPlay');
  const btnStop = document.getElementById('btnStop');
  const btnReturnZero = document.getElementById('btnReturnZero');
  const btnLoop = document.getElementById('btnLoop');
  const masterVolumeSlider = document.getElementById('masterVolumeSlider');
  const masterDbReadout = document.getElementById('masterDbReadout');
  const btnResetMix = document.getElementById('btnResetMix');
  const btnDownloadAll = document.getElementById('btnDownloadAll');

  // State
  let selectedFile = null;
  let currentJobId = null;
  let activeEventSource = null;
  let isSeeking = false;

  // Stems list
  const STEMS = ['vocals', 'drums', 'bass', 'other'];

  // Initialize VU Meter LEDs
  initVUMeters();

  // -------------------------------------------------------------------------
  // 1. File Selection & Drag/Drop
  // -------------------------------------------------------------------------

  dropzone.addEventListener('click', () => fileInput.click());

  fileInput.addEventListener('change', (e) => {
    if (e.target.files && e.target.files[0]) {
      handleFileSelected(e.target.files[0]);
    }
  });

  ['dragenter', 'dragover'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach((eventName) => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileSelected(e.dataTransfer.files[0]);
    }
  });

  function handleFileSelected(file) {
    selectedFile = file;
    fileNameDisplay.textContent = file.name;
    fileSizeDisplay.textContent = `${(file.size / (1024 * 1024)).toFixed(2)} MB`;
    filePill.classList.add('visible');
    btnProcess.disabled = false;
  }

  // -------------------------------------------------------------------------
  // 2. Upload & Separation Trigger
  // -------------------------------------------------------------------------

  btnProcess.addEventListener('click', async () => {
    if (!selectedFile) return;

    btnProcess.disabled = true;
    renderProgressSection.classList.add('visible');
    progressStatusText.textContent = 'Uploading audio file to Termux...';
    progressPercent.textContent = '0%';
    progressBarFill.style.width = '0%';
    renderLogs.textContent = 'Starting Demucs v4 workflow...\n';

    const formData = new FormData();
    formData.append('audio', selectedFile);
    formData.append('shifts', shiftsSelect.value);

    try {
      const response = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Upload failed');
      }

      const data = await response.json();
      currentJobId = data.jobId;
      activeTrackInfo.textContent = `PROCESSING: ${selectedFile.name.toUpperCase()}`;
      connectJobEvents(currentJobId);
    } catch (err) {
      alert(`Error starting separation: ${err.message}`);
      btnProcess.disabled = false;
      renderProgressSection.classList.remove('visible');
    }
  });

  // -------------------------------------------------------------------------
  // 3. Real-time Status / SSE Updates
  // -------------------------------------------------------------------------

  function connectJobEvents(jobId) {
    if (activeEventSource) {
      activeEventSource.close();
    }

    activeEventSource = new EventSource(`/api/jobs/${jobId}/events`);

    activeEventSource.onmessage = (event) => {
      try {
        const job = JSON.parse(event.data);
        updateProgressUI(job);

        if (job.status === 'completed') {
          activeEventSource.close();
          activeEventSource = null;
          loadJobIntoConsole(job);
        } else if (job.status === 'failed') {
          activeEventSource.close();
          activeEventSource = null;
          progressStatusText.textContent = `FAILED: ${job.error || 'Unknown error'}`;
          btnProcess.disabled = false;
        }
      } catch (e) {
        console.error('Error parsing SSE event:', e);
      }
    };

    activeEventSource.onerror = () => {
      // Fallback polling if SSE disconnects
      pollJobStatus(jobId);
    };
  }

  async function pollJobStatus(jobId) {
    try {
      const res = await fetch(`/api/jobs/${jobId}`);
      if (res.ok) {
        const job = await res.json();
        updateProgressUI(job);
        if (job.status === 'completed') {
          loadJobIntoConsole(job);
        } else if (job.status === 'failed') {
          btnProcess.disabled = false;
        } else {
          setTimeout(() => pollJobStatus(jobId), 2000);
        }
      }
    } catch (e) {}
  }

  function updateProgressUI(job) {
    renderProgressSection.classList.add('visible');
    const pct = job.progress || 0;
    progressPercent.textContent = `${pct}%`;
    progressBarFill.style.width = `${pct}%`;
    progressStatusText.textContent = job.message || 'Processing...';

    if (job.logs && job.logs.length > 0) {
      renderLogs.textContent = job.logs.join('\n');
      renderLogs.scrollTop = renderLogs.scrollHeight;
    }
  }

  // -------------------------------------------------------------------------
  // 4. Loading Job & Initializing Stems in Fairlight Console
  // -------------------------------------------------------------------------

  async function loadJobIntoConsole(job) {
    currentJobId = job.id;
    activeTrackInfo.textContent = `A1: ${job.originalName.toUpperCase()} [4 STEMS READY]`;
    progressStatusText.textContent = 'Separation complete! Loading audio buffers...';

    // Show export all ZIP button
    btnDownloadAll.style.display = 'inline-flex';
    btnDownloadAll.href = `/api/download-all/${job.id}`;

    // Set individual stem download links
    STEMS.forEach((stem) => {
      const exportLink = document.getElementById(`export-${stem}`);
      if (exportLink) {
        exportLink.href = `/api/download/${job.id}/${stem}`;
      }
    });

    try {
      const duration = await window.fairlightEngine.loadStems(job.id, (loadedPct) => {
        progressStatusText.textContent = `Decoded audio stems: ${loadedPct}%`;
      });

      renderProgressSection.classList.remove('visible');
      btnProcess.disabled = false;

      // Update duration displays
      scrubberSlider.max = duration;
      scrubberSlider.value = 0;
      durationDisplay.textContent = formatDuration(duration);
      timecodeDisplay.textContent = '00:00:00:00';

      console.log(`Job ${job.id} loaded successfully. Duration: ${duration.toFixed(2)}s`);
    } catch (err) {
      alert(`Error decoding audio stems: ${err.message}`);
      progressStatusText.textContent = `Audio load error: ${err.message}`;
    }
  }

  // -------------------------------------------------------------------------
  // 5. Fairlight Channel Strip Controls: Mute, Solo, Faders
  // -------------------------------------------------------------------------

  // MUTE BUTTONS
  document.querySelectorAll('.btn-mute').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stem = btn.dataset.stem;
      const isMuted = !btn.classList.contains('active');

      if (isMuted) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }

      window.fairlightEngine.setMute(stem, isMuted);
    });
  });

  // SOLO BUTTONS
  document.querySelectorAll('.btn-solo').forEach((btn) => {
    btn.addEventListener('click', () => {
      const stem = btn.dataset.stem;
      const isSoloed = !btn.classList.contains('active');

      if (isSoloed) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }

      window.fairlightEngine.setSolo(stem, isSoloed);
    });
  });

  // VOLUME FADERS
  document.querySelectorAll('.fader-slider').forEach((slider) => {
    slider.addEventListener('input', (e) => {
      const stem = e.target.dataset.stem;
      const val = parseFloat(e.target.value);
      window.fairlightEngine.setVolume(stem, val);

      const dbDisplay = document.getElementById(`db-${stem}`);
      if (dbDisplay) {
        dbDisplay.textContent = gainToDb(val);
      }
    });
  });

  // MASTER VOLUME
  masterVolumeSlider.addEventListener('input', (e) => {
    const val = parseFloat(e.target.value);
    window.fairlightEngine.setMasterVolume(val);
    masterDbReadout.textContent = gainToDb(val);
  });

  // RESET MIX
  btnResetMix.addEventListener('click', () => {
    STEMS.forEach((stem) => {
      // Unmute
      const muteBtn = document.querySelector(`.btn-mute[data-stem="${stem}"]`);
      if (muteBtn) muteBtn.classList.remove('active');
      window.fairlightEngine.setMute(stem, false);

      // Unsolo
      const soloBtn = document.querySelector(`.btn-solo[data-stem="${stem}"]`);
      if (soloBtn) soloBtn.classList.remove('active');
      window.fairlightEngine.setSolo(stem, false);

      // Reset Fader to Unity (1.0 = 0.0 dB)
      const fader = document.getElementById(`fader-${stem}`);
      if (fader) fader.value = 1.0;
      window.fairlightEngine.setVolume(stem, 1.0);

      const db = document.getElementById(`db-${stem}`);
      if (db) db.textContent = '0.0 dB';
    });

    // Reset Master
    masterVolumeSlider.value = 1.0;
    window.fairlightEngine.setMasterVolume(1.0);
    masterDbReadout.textContent = '0.0 dB';
  });

  // -------------------------------------------------------------------------
  // 6. Master Transport Controls (Play, Pause, Stop, Seek)
  // -------------------------------------------------------------------------

  btnPlay.addEventListener('click', () => {
    if (!window.fairlightEngine.isLoaded) {
      if (selectedFile && !currentJobId) {
        alert('Please click "Separate Stems" first to generate the 4 stems.');
      } else {
        alert('No stems loaded. Please upload or select a track.');
      }
      return;
    }

    if (window.fairlightEngine.isPlaying) {
      window.fairlightEngine.pause();
      btnPlay.textContent = '▶';
      btnPlay.classList.remove('playing');
    } else {
      window.fairlightEngine.play();
      btnPlay.textContent = '❚❚';
      btnPlay.classList.add('playing');
    }
  });

  btnStop.addEventListener('click', () => {
    window.fairlightEngine.stop();
    btnPlay.textContent = '▶';
    btnPlay.classList.remove('playing');
    scrubberSlider.value = 0;
    timecodeDisplay.textContent = '00:00:00:00';
    clearAllVUMeters();
  });

  btnReturnZero.addEventListener('click', () => {
    window.fairlightEngine.seek(0);
  });

  btnLoop.addEventListener('click', () => {
    const isLooping = !window.fairlightEngine.isLooping;
    window.fairlightEngine.isLooping = isLooping;
    if (isLooping) {
      btnLoop.classList.add('active');
    } else {
      btnLoop.classList.remove('active');
    }
  });

  // Scrubber Seeking
  scrubberSlider.addEventListener('mousedown', () => { isSeeking = true; });
  scrubberSlider.addEventListener('touchstart', () => { isSeeking = true; });

  scrubberSlider.addEventListener('input', (e) => {
    const time = parseFloat(e.target.value);
    timecodeDisplay.textContent = formatTimecode(time);
  });

  scrubberSlider.addEventListener('change', (e) => {
    isSeeking = false;
    const time = parseFloat(e.target.value);
    window.fairlightEngine.seek(time);
  });

  // Audio Engine Timecode Update Callback
  window.fairlightEngine.onTimeUpdate = (currentTime, duration) => {
    if (!isSeeking) {
      scrubberSlider.value = currentTime;
      timecodeDisplay.textContent = formatTimecode(currentTime);
    }
  };

  window.fairlightEngine.onPlaybackEnd = () => {
    btnPlay.textContent = '▶';
    btnPlay.classList.remove('playing');
    clearAllVUMeters();
  };

  // -------------------------------------------------------------------------
  // 7. Dynamic 16-Segment LED VU Meters
  // -------------------------------------------------------------------------

  function initVUMeters() {
    STEMS.forEach((stem) => {
      const container = document.getElementById(`vu-${stem}`);
      if (!container) return;
      container.innerHTML = '';
      for (let i = 0; i < 16; i++) {
        const seg = document.createElement('div');
        seg.className = 'vu-led-segment';
        // Assign color tier: bottom 10 green, next 4 yellow, top 2 red
        if (i < 10) {
          seg.classList.add('green');
        } else if (i < 14) {
          seg.classList.add('yellow');
        } else {
          seg.classList.add('red');
        }
        container.appendChild(seg);
      }
    });
  }

  // VU Meter Update Callback from Audio Engine
  window.fairlightEngine.onVUMeterUpdate = (levels) => {
    STEMS.forEach((stem) => {
      const level = levels[stem] || 0;
      updateStemVUMeter(stem, level);
    });
  };

  function updateStemVUMeter(stem, normalizedLevel) {
    const container = document.getElementById(`vu-${stem}`);
    if (!container) return;
    const segments = container.children;
    const count = segments.length;
    const activeThreshold = Math.round(normalizedLevel * count);

    for (let i = 0; i < count; i++) {
      if (i < activeThreshold) {
        segments[i].classList.add('active');
      } else {
        segments[i].classList.remove('active');
      }
    }
  }

  function clearAllVUMeters() {
    STEMS.forEach((stem) => updateStemVUMeter(stem, 0));
  }



  // -------------------------------------------------------------------------
  // 9. Helpers: dB Conversion & DaVinci Timecode Formatting
  // -------------------------------------------------------------------------

  function gainToDb(gain) {
    if (gain <= 0.0001) return '-inf dB';
    const db = 20 * Math.log10(gain);
    const sign = db > 0 ? '+' : '';
    return `${sign}${db.toFixed(1)} dB`;
  }

  function formatDuration(seconds) {
    if (isNaN(seconds) || seconds < 0) return '00:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }

  // DaVinci Resolve 8-digit Timecode: HH:MM:SS:FF (at 24fps)
  function formatTimecode(totalSeconds) {
    if (isNaN(totalSeconds) || totalSeconds < 0) return '00:00:00:00';
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const frames = Math.floor((totalSeconds % 1) * 24);

    return [
      hours.toString().padStart(2, '0'),
      minutes.toString().padStart(2, '0'),
      seconds.toString().padStart(2, '0'),
      frames.toString().padStart(2, '0')
    ].join(':');
  }

});
