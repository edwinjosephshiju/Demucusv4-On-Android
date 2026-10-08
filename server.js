const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const AdmZip = require('adm-zip');

const app = express();
const PORT = process.env.PORT || 3000;

// Directories
const BASE_DIR = __dirname;
const UPLOADS_DIR = path.join(BASE_DIR, 'uploads');
const OUTPUTS_DIR = path.join(BASE_DIR, 'outputs');
const JOBS_FILE = path.join(OUTPUTS_DIR, 'jobs.json');

// Ensure directories exist
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
if (!fs.existsSync(OUTPUTS_DIR)) fs.mkdirSync(OUTPUTS_DIR, { recursive: true });

// Middleware
app.use(express.json());
app.use(express.static(path.join(BASE_DIR, 'public'), {
  etag: false,
  maxAge: 0,
  setHeaders: (res) => {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
}));

// Jobs state
let jobs = {};
if (fs.existsSync(JOBS_FILE)) {
  try {
    jobs = JSON.parse(fs.readFileSync(JOBS_FILE, 'utf8'));
  } catch (err) {
    console.error('Error loading jobs.json:', err);
    jobs = {};
  }
}

function saveJobs() {
  try {
    fs.writeFileSync(JOBS_FILE, JSON.stringify(jobs, null, 2));
  } catch (err) {
    console.error('Error saving jobs.json:', err);
  }
}

// Active SSE client connections per job
const sseClients = {};

function notifySSE(jobId, data) {
  if (sseClients[jobId]) {
    const payload = `data: ${JSON.stringify(data)}\n\n`;
    sseClients[jobId].forEach((res) => {
      try {
        res.write(payload);
      } catch (e) {}
    });
  }
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const cleanName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${cleanName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 250 * 1024 * 1024 }, // 250 MB
  fileFilter: (req, file, cb) => {
    const allowed = /\.(wav|mp3|flac|m4a|aac|ogg|opus|aiff|alac)$/i;
    if (file.originalname.match(allowed) || file.mimetype.startsWith('audio/')) {
      cb(null, true);
    } else {
      cb(new Error('Only audio files are allowed (.wav, .mp3, .flac, .m4a, .ogg, etc.)'));
    }
  }
});

// Helper to sanitize path base names
function getTrackBaseName(filePath) {
  const base = path.basename(filePath);
  return base.substring(0, base.lastIndexOf('.')) || base;
}

// Start Demucs Separation Process
function runDemucs(jobId) {
  const job = jobs[jobId];
  if (!job) return;

  job.status = 'processing';
  job.progress = 5;
  job.message = 'Initializing Demucs v4 engine...';
  job.startedAt = new Date().toISOString();
  saveJobs();
  notifySSE(jobId, job);

  const outJobDir = path.join(OUTPUTS_DIR, jobId);
  if (!fs.existsSync(outJobDir)) fs.mkdirSync(outJobDir, { recursive: true });

  const inputFilePath = job.filePath;
  const shifts = job.shifts || 0; // 0 for fast single-pass, 1 for demucs default

  // Arguments for demucs v4
  // We use CPU on Termux, htdemucs model (v4 4-stems: vocals, drums, bass, other)
  const demucsArgs = [
    '-m', 'demucs',
    '-n', 'htdemucs',
    '-d', 'cpu',
    '--shifts', String(shifts),
    '--overlap', '0.25',
    '-o', outJobDir,
    inputFilePath
  ];

  console.log(`[Job ${jobId}] Running: python3 ${demucsArgs.join(' ')}`);

  const proc = spawn('python3', demucsArgs, {
    cwd: BASE_DIR,
    env: { ...process.env, PYTHONUNBUFFERED: '1' }
  });

  job.pid = proc.pid;

  let buffer = '';

  const handleData = (chunk) => {
    const text = chunk.toString();
    buffer += text;
    job.logs.push(text);
    if (job.logs.length > 150) job.logs.shift();

    // Check for Demucs tqdm progress pattern: " 45%|████..." or "45.0%"
    // Example: " 25%|█████▌                | 1.46/5.85 [00:11<00:34,  7.87s/seconds]"
    const progressMatches = [...text.matchAll(/(\d{1,3})%\|/g)];
    if (progressMatches.length > 0) {
      const lastPercent = parseInt(progressMatches[progressMatches.length - 1][1], 10);
      if (!isNaN(lastPercent)) {
        // Map 0-100% of separation to 10% - 95% total progress
        job.progress = Math.min(95, Math.max(10, Math.round(10 + (lastPercent * 0.85))));
        job.message = `Separating stems (${lastPercent}% completed)...`;
        notifySSE(jobId, job);
      }
    } else if (text.includes('Selected model') || text.includes('Loading')) {
      job.progress = 10;
      job.message = 'Loading Demucs v4 (htdemucs) weights...';
      notifySSE(jobId, job);
    } else if (text.includes('Separating track')) {
      job.progress = 15;
      job.message = 'Decomposing audio into frequency & waveform bands...';
      notifySSE(jobId, job);
    }
  };

  proc.stdout.on('data', handleData);
  proc.stderr.on('data', handleData);

  proc.on('close', (code) => {
    console.log(`[Job ${jobId}] Finished with code ${code}`);

    if (code === 0) {
      // Find output directory: outJobDir/htdemucs/<basename>/
      const baseName = getTrackBaseName(inputFilePath);
      const stemFolder = path.join(outJobDir, 'htdemucs', baseName);

      const expectedStems = ['vocals', 'drums', 'bass', 'other'];
      const stemFiles = {};
      let allFound = true;

      for (const stem of expectedStems) {
        const stemPath = path.join(stemFolder, `${stem}.wav`);
        if (fs.existsSync(stemPath)) {
          stemFiles[stem] = stemPath;
        } else {
          allFound = false;
        }
      }

      if (allFound) {
        job.status = 'completed';
        job.progress = 100;
        job.message = 'Separation complete. Stems ready for remixing.';
        job.completedAt = new Date().toISOString();
        job.stems = {
          vocals: `/api/stems/${jobId}/vocals`,
          drums: `/api/stems/${jobId}/drums`,
          bass: `/api/stems/${jobId}/bass`,
          other: `/api/stems/${jobId}/other`
        };
        job.stemFolder = stemFolder;
      } else {
        job.status = 'failed';
        job.error = `Could not locate all 4 stem files in ${stemFolder}`;
        job.message = 'Processing finished but output files are missing.';
      }
    } else {
      job.status = 'failed';
      job.error = `Demucs process exited with code ${code}. Check logs for details.`;
      job.message = 'Error during Demucs processing.';
    }

    saveJobs();
    notifySSE(jobId, job);
  });

  proc.on('error', (err) => {
    console.error(`[Job ${jobId}] Spawn error:`, err);
    job.status = 'failed';
    job.error = err.message;
    job.message = 'Failed to execute Python process.';
    saveJobs();
    notifySSE(jobId, job);
  });
}

// ----------------- API ROUTES -----------------

// System information
app.get('/api/system', (req, res) => {
  res.json({
    platform: 'Android Termux (Linux ARM64)',
    engine: 'Demucs v4 (Hybrid Transformer htdemucs)',
    stems: ['Vocals', 'Drums', 'Bass', 'Instruments/Other'],
    serverTime: new Date().toISOString()
  });
});

// Upload and launch separation
app.post('/api/upload', upload.single('audio'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No audio file provided.' });
  }

  const shifts = parseInt(req.body.shifts, 10) === 1 ? 1 : 0;
  const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

  jobs[jobId] = {
    id: jobId,
    originalName: req.file.originalname,
    fileName: req.file.filename,
    filePath: req.file.path,
    fileSize: req.file.size,
    shifts: shifts,
    status: 'queued',
    progress: 0,
    message: 'Queued for Demucs v4 processing...',
    logs: [],
    createdAt: new Date().toISOString()
  };

  saveJobs();

  // Run separation asynchronously
  setTimeout(() => runDemucs(jobId), 100);

  res.status(201).json({
    success: true,
    jobId,
    message: 'File uploaded and separation started.'
  });
});

// List all jobs
app.get('/api/jobs', (req, res) => {
  const jobList = Object.values(jobs).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  res.json(jobList);
});

// Single job status
app.get('/api/jobs/:id', (req, res) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Job not found.' });
  res.json(job);
});

// Real-time SSE updates for a job
app.get('/api/jobs/:id/events', (req, res) => {
  const jobId = req.params.id;
  const job = jobs[jobId];
  if (!job) return res.status(404).end();

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });

  if (!sseClients[jobId]) sseClients[jobId] = [];
  sseClients[jobId].push(res);

  // Send initial state immediately
  res.write(`data: ${JSON.stringify(job)}\n\n`);

  req.on('close', () => {
    if (sseClients[jobId]) {
      sseClients[jobId] = sseClients[jobId].filter((client) => client !== res);
    }
  });
});

// Stream audio for stem or original
app.get('/api/stems/:id/:stem', (req, res) => {
  const { id, stem } = req.params;
  const job = jobs[id];
  if (!job) return res.status(404).send('Job not found.');

  let targetPath;
  if (stem === 'original') {
    targetPath = job.filePath;
  } else {
    if (!job.stemFolder) return res.status(404).send('Stems not ready.');
    targetPath = path.join(job.stemFolder, `${stem}.wav`);
  }

  if (!fs.existsSync(targetPath)) {
    return res.status(404).send('Stem audio file not found on disk.');
  }

  const stat = fs.statSync(targetPath);
  const fileSize = stat.size;
  const range = req.headers.range;

  // Stream with HTTP Range support for seamless browser seeking
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = end - start + 1;
    const file = fs.createReadStream(targetPath, { start, end });
    const head = {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': stem === 'original' ? 'audio/mpeg' : 'audio/wav',
    };
    res.writeHead(206, head);
    file.pipe(res);
  } else {
    const head = {
      'Content-Length': fileSize,
      'Content-Type': stem === 'original' ? 'audio/mpeg' : 'audio/wav',
      'Accept-Ranges': 'bytes'
    };
    res.writeHead(200, head);
    fs.createReadStream(targetPath).pipe(res);
  }
});

// Direct Download Single Stem
app.get('/api/download/:id/:stem', (req, res) => {
  const { id, stem } = req.params;
  const job = jobs[id];
  if (!job || !job.stemFolder) return res.status(404).send('Job or stems not found.');

  const stemPath = path.join(job.stemFolder, `${stem}.wav`);
  if (!fs.existsSync(stemPath)) return res.status(404).send('File not found.');

  const downloadName = `${path.parse(job.originalName).name}_${stem}.wav`;
  res.download(stemPath, downloadName);
});

// Direct Download All Stems as ZIP
app.get('/api/download-all/:id', (req, res) => {
  const { id } = req.params;
  const job = jobs[id];
  if (!job || !job.stemFolder) return res.status(404).send('Job or stems not ready.');

  try {
    const zip = new AdmZip();
    const cleanBase = path.parse(job.originalName).name;
    const stems = ['vocals', 'drums', 'bass', 'other'];

    for (const stem of stems) {
      const stemFile = path.join(job.stemFolder, `${stem}.wav`);
      if (fs.existsSync(stemFile)) {
        zip.addLocalFile(stemFile, '', `${cleanBase}_${stem}.wav`);
      }
    }

    const zipBuffer = zip.toBuffer();
    const zipName = `${cleanBase}_4stems_demucs.zip`;

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${zipName}"`,
      'Content-Length': zipBuffer.length
    });
    res.send(zipBuffer);
  } catch (err) {
    console.error('ZIP generation error:', err);
    res.status(500).send('Failed to package stems into ZIP.');
  }
});

// Delete a job
app.delete('/api/jobs/:id', (req, res) => {
  const { id } = req.params;
  const job = jobs[id];
  if (!job) return res.status(404).json({ error: 'Job not found.' });

  try {
    // Delete original file if exists
    if (job.filePath && fs.existsSync(job.filePath)) {
      fs.unlinkSync(job.filePath);
    }
    // Delete output directory
    const outJobDir = path.join(OUTPUTS_DIR, id);
    if (fs.existsSync(outJobDir)) {
      fs.rmSync(outJobDir, { recursive: true, force: true });
    }
    delete jobs[id];
    saveJobs();
    res.json({ success: true, message: 'Job deleted successfully.' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Start Express Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`=======================================================`);
  console.log(`  DaVinci Resolve AI Remixer (Demucs v4) Dashboard`);
  console.log(`  Listening on http://localhost:${PORT}`);
  console.log(`  Host: Android Termux (ARM64 CPU Engine)`);
  console.log(`=======================================================`);
});
