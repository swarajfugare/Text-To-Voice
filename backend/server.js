const fs = require('node:fs');
const fsPromises = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const cors = require('cors');
const dotenv = require('dotenv');
const express = require('express');
const multer = require('multer');
const { EdgeTTS } = require('node-edge-tts');

dotenv.config();

const execFileAsync = promisify(execFile);
const app = express();
const ROOT_DIR = path.resolve(__dirname, '..');
const FRONTEND_DIR = path.join(ROOT_DIR, 'frontend');
const GENERATED_DIR = path.join(ROOT_DIR, 'generated');
const UPLOADS_DIR = path.join(ROOT_DIR, 'uploads');
const PRONUNCIATION_LEXICON_PATH = path.join(__dirname, 'marathi-pronunciation-lexicon.json');
const STUDIO_SCRIPT = path.join(ROOT_DIR, 'studio', 'maha_clone.py');
const PROJECT_VENV_PYTHON = path.join(ROOT_DIR, '.venv', 'bin', 'python');
const STUDIO_MODELS_DIR = path.join(os.homedir(), '.cache', 'maha_tts', 'models');
const PORT = Number(process.env.PORT) || 3001;
const HOST = process.env.HOST || '0.0.0.0';
const PYTHON_BIN =
  process.env.PYTHON_BIN || (fs.existsSync(PROJECT_VENV_PYTHON) ? PROJECT_VENV_PYTHON : 'python3');
const MAX_CHARACTERS = 2000;
const AUDIO_TTL_HOURS = Number(process.env.AUDIO_TTL_HOURS) || 12;
const AUDIO_TTL_MS = AUDIO_TTL_HOURS * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const STUDIO_TIMEOUT_MS = 15 * 60 * 1000;
const MAX_PRONUNCIATION_HINTS = 20;
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/gu;
const MARATHI_DIGIT_WORDS = {
  0: 'शून्य',
  1: 'एक',
  2: 'दोन',
  3: 'तीन',
  4: 'चार',
  5: 'पाच',
  6: 'सहा',
  7: 'सात',
  8: 'आठ',
  9: 'नऊ',
  '०': 'शून्य',
  '१': 'एक',
  '२': 'दोन',
  '३': 'तीन',
  '४': 'चार',
  '५': 'पाच',
  '६': 'सहा',
  '७': 'सात',
  '८': 'आठ',
  '९': 'नऊ',
};
const MARATHI_SYMBOL_WORDS = new Map([
  ['&', ' आणि '],
  ['@', ' अॅट '],
  ['%', ' टक्के '],
  ['+', ' प्लस '],
  ['=', ' बरोबर '],
  ['/', ' स्लॅश '],
  ['₹', ' रुपये '],
  ['$', ' डॉलर '],
  ['€', ' युरो '],
  ['#', ' क्रमांक '],
]);
const DEFAULT_PRONUNCIATION_RULES = loadPronunciationLexicon();

const VOICES = {
  female: {
    id: 'female',
    label: 'Female - Aarohi Neural',
    displayName: 'Aarohi Neural',
    gender: 'Female',
    locale: 'mr-IN',
    voice: 'mr-IN-AarohiNeural',
    description: 'Warm, expressive, and natural for conversational Marathi.',
  },
  male: {
    id: 'male',
    label: 'Male - Manohar Neural',
    displayName: 'Manohar Neural',
    gender: 'Male',
    locale: 'mr-IN',
    voice: 'mr-IN-ManoharNeural',
    description: 'Balanced, clear, and steady for narration-style Marathi.',
  },
};

const ENGINES = {
  'studio-clone': {
    id: 'studio-clone',
    displayName: 'Studio Real Voice',
    provider: 'MahaTTS',
    badge: 'Best quality',
    requiresReference: true,
    supportsVoiceSelection: false,
    supportsProsody: false,
    description:
      'Clone a real Marathi speaker from your uploaded WAV sample for a much more human result.',
  },
  'fast-edge': {
    id: 'fast-edge',
    displayName: 'Fast Neural',
    provider: 'Edge TTS',
    badge: 'Fast preview',
    requiresReference: false,
    supportsVoiceSelection: true,
    supportsProsody: true,
    description:
      'Quick Marathi preview with neural voices. Faster, but more synthetic than studio cloning.',
  },
};

fs.mkdirSync(GENERATED_DIR, { recursive: true });
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, callback) => {
      callback(null, UPLOADS_DIR);
    },
    filename: (_req, file, callback) => {
      callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
    },
  }),
  limits: {
    fileSize: 25 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    const extension = path.extname(file.originalname).toLowerCase();
    const acceptedMimeTypes = new Set([
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
      'audio/vnd.wave',
    ]);

    if (extension === '.wav' || acceptedMimeTypes.has(file.mimetype)) {
      callback(null, true);
      return;
    }

    callback(buildVisibleError('Studio mode currently accepts only clean WAV reference files.', 400));
  },
});

const configuredOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || configuredOrigins.length === 0 || configuredOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('This frontend origin is not allowed by the API.'));
    },
  })
);

app.use(express.json({ limit: '1mb' }));
app.use('/audio', express.static(GENERATED_DIR, { maxAge: '1h' }));
app.use(express.static(FRONTEND_DIR));

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    voices: Object.keys(VOICES).length,
  });
});

app.get('/api/voices', (_req, res) => {
  res.json({
    defaultLanguage: 'mr-IN',
    defaultEngine: 'studio-clone',
    maxCharacters: MAX_CHARACTERS,
    engines: Object.values(ENGINES),
    voices: Object.values(VOICES),
  });
});

app.post('/api/tts', upload.single('referenceAudio'), async (req, res, next) => {
  const rawText = typeof req.body.text === 'string' ? req.body.text : '';
  const text = rawText.replace(/\r\n/g, '\n').trim();
  let pronunciationRules;

  try {
    pronunciationRules = buildPronunciationRules(req.body.pronunciationHints);
  } catch (error) {
    next(error);
    return;
  }

  const preparedText = applyPronunciationRules(text.normalize('NFC'), pronunciationRules);
  const normalizedText = normalizeMarathiText(preparedText);
  const selectedVoice = resolveVoice(req.body.voice);
  const selectedEngine = resolveEngine(req.body.engine);
  const rate = clampProsodyValue(req.body.rate, 40);
  const pitch = clampProsodyValue(req.body.pitch, 35);
  const language = req.body.language || 'mr-IN';
  const referenceAudio = req.file;

  if (!text) {
    res.status(400).json({ error: 'Please enter Marathi text to generate speech.' });
    return;
  }

  if (!normalizedText) {
    res.status(400).json({
      error: 'The text could not be normalized into supported Marathi speech. Please remove unusual symbols and try again.',
    });
    return;
  }

  if (text.length > MAX_CHARACTERS) {
    res.status(400).json({
      error: `Text is too long. Please keep it under ${MAX_CHARACTERS} characters.`,
    });
    return;
  }

  if (language !== 'mr-IN') {
    res.status(400).json({ error: 'This demo currently supports Marathi (India) only.' });
    return;
  }

  if (!selectedEngine) {
    res.status(400).json({ error: 'The selected synthesis engine is not available.' });
    return;
  }

  if (selectedEngine.supportsVoiceSelection && !selectedVoice) {
    res.status(400).json({ error: 'The selected Marathi voice is not available.' });
    return;
  }

  if (selectedEngine.requiresReference && !referenceAudio) {
    res.status(400).json({
      error:
        'Upload a clean WAV sample of a Marathi woman voice to use the Studio Real Voice engine.',
    });
    return;
  }

  try {
    const generation =
      selectedEngine.id === 'studio-clone'
        ? await generateStudioSpeech({
            text: normalizedText,
            language,
            referencePath: referenceAudio.path,
          })
        : await generateFastSpeech({
            text: normalizedText,
            language,
            voiceId: selectedVoice.id,
            rate,
            pitch,
          });

    res.json({
      message: 'Voice generated successfully.',
      audioUrl: generation.audioUrl,
      downloadUrl: generation.downloadUrl,
      filename: generation.filename,
      textLength: text.length,
      engine: generation.engine,
      voice: generation.voice,
      settings: {
        language,
        rate: generation.settings.rate,
        pitch: generation.settings.pitch,
      },
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  } finally {
    if (referenceAudio) {
      await safeUnlink(referenceAudio.path);
    }
  }
});

app.get('/', (_req, res) => {
  res.sendFile(path.join(FRONTEND_DIR, 'index.html'));
});

app.use((error, _req, res, _next) => {
  console.error('TTS generation error:', error);

  if (error instanceof multer.MulterError) {
    res.status(400).json({
      error: error.code === 'LIMIT_FILE_SIZE'
        ? 'Reference audio is too large. Please keep the WAV file under 25 MB.'
        : 'Unable to process the uploaded reference audio.',
    });
    return;
  }

  res.status(error.statusCode || 500).json({
    error:
      error && error.expose
        ? error.message
        : 'Unable to generate audio right now. Please try again in a moment.',
  });
});

cleanupGeneratedFiles().catch(() => {});
const cleanupTimer = setInterval(() => {
  cleanupGeneratedFiles().catch(() => {});
}, CLEANUP_INTERVAL_MS);

if (typeof cleanupTimer.unref === 'function') {
  cleanupTimer.unref();
}

function resolveVoice(voiceInput) {
  if (typeof voiceInput !== 'string') {
    return VOICES.female;
  }

  if (VOICES[voiceInput]) {
    return VOICES[voiceInput];
  }

  return Object.values(VOICES).find(
    (voice) => voice.voice === voiceInput || voice.id === voiceInput
  );
}

function resolveEngine(engineInput) {
  if (typeof engineInput !== 'string') {
    return ENGINES['studio-clone'];
  }

  return ENGINES[engineInput] || null;
}

function clampProsodyValue(value, clampLimit) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue) || numericValue === 0) {
    return 0;
  }

  return Math.max(-clampLimit, Math.min(clampLimit, numericValue));
}

function formatProsodyValue(value) {
  if (!value) {
    return 'default';
  }

  return `${value > 0 ? '+' : ''}${value}%`;
}

function loadPronunciationLexicon() {
  try {
    const rawLexicon = fs.readFileSync(PRONUNCIATION_LEXICON_PATH, 'utf8');
    const parsedLexicon = JSON.parse(rawLexicon);
    return normalizePronunciationRules(parsedLexicon);
  } catch (error) {
    console.warn('Failed to load Marathi pronunciation lexicon:', error.message);
    return [];
  }
}

function normalizePronunciationRules(input) {
  if (!input) {
    return [];
  }

  const candidates = Array.isArray(input)
    ? input
    : Object.entries(input).map(([source, spoken]) => ({ source, spoken }));

  return candidates
    .map((entry) => ({
      source: typeof entry.source === 'string' ? entry.source.trim() : '',
      spoken:
        typeof entry.spoken === 'string'
          ? entry.spoken.trim()
          : typeof entry.target === 'string'
            ? entry.target.trim()
            : '',
    }))
    .filter((entry) => entry.source && entry.spoken)
    .sort((left, right) => right.source.length - left.source.length);
}

function buildPronunciationRules(hintsInput) {
  const userRules = parsePronunciationHints(hintsInput);
  return [...DEFAULT_PRONUNCIATION_RULES, ...userRules].sort(
    (left, right) => right.source.length - left.source.length
  );
}

function parsePronunciationHints(hintsInput) {
  if (typeof hintsInput !== 'string' || !hintsInput.trim()) {
    return [];
  }

  const lines = hintsInput
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length > MAX_PRONUNCIATION_HINTS) {
    throw buildVisibleError(
      `Use up to ${MAX_PRONUNCIATION_HINTS} pronunciation hints at a time.`,
      400
    );
  }

  return lines.map((line) => {
    const match = line.match(/^(.*?)\s*(?:=>|->|=)\s*(.+)$/u);
    if (!match) {
      throw buildVisibleError(
        'Pronunciation hints must use one rule per line in the format `word=spoken form`.',
        400
      );
    }

    const source = match[1].trim();
    const spoken = match[2].trim();

    if (!source || !spoken) {
      throw buildVisibleError(
        'Pronunciation hints must include both the original word and the spoken form.',
        400
      );
    }

    return { source, spoken };
  });
}

function applyPronunciationRules(text, rules) {
  if (!text || !Array.isArray(rules) || rules.length === 0) {
    return text;
  }

  return rules.reduce(
    (currentText, rule) => applySinglePronunciationRule(currentText, rule.source, rule.spoken),
    text
  );
}

function applySinglePronunciationRule(text, source, spoken) {
  if (!text || !source || !spoken) {
    return text;
  }

  if (/^[A-Za-z0-9.+#-]+$/u.test(source)) {
    const escapedSource = escapeRegExp(source);
    return text.replace(
      new RegExp(`(^|[^\\p{L}\\p{N}])(${escapedSource})(?=$|[^\\p{L}\\p{N}])`, 'giu'),
      (_match, prefix) => `${prefix}${spoken}`
    );
  }

  return text.split(source).join(spoken);
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function normalizeMarathiDigits(text) {
  return Array.from(text)
    .map((character) => MARATHI_DIGIT_WORDS[character] || character)
    .join(' ');
}

function normalizeMarathiText(text) {
  if (typeof text !== 'string') {
    return '';
  }

  let normalized = text.normalize('NFC').replace(ZERO_WIDTH_PATTERN, '');

  for (const [symbol, replacement] of MARATHI_SYMBOL_WORDS.entries()) {
    normalized = normalized.split(symbol).join(replacement);
  }

  normalized = normalized
    .replace(/[0-9०-९]+/gu, (digits) => normalizeMarathiDigits(digits))
    .replace(/[\u2018\u2019]/gu, "'")
    .replace(/[\u201C\u201D]/gu, '"')
    .replace(/[\u2013\u2014]/gu, ' ')
    .replace(/[…]/gu, '... ')
    .replace(/[\r\n]+/gu, ' । ')
    .replace(/[;:]+/gu, ' । ')
    .replace(/\s*([,.!?।])\s*/gu, '$1 ')
    .replace(/\s+/gu, ' ')
    .trim();

  return normalized;
}

async function generateFastSpeech({
  text,
  language = 'mr-IN',
  voiceId = 'female',
  rate = 0,
  pitch = 0,
}) {
  const selectedVoice = resolveVoice(voiceId);

  if (!selectedVoice) {
    throw new Error('The selected Marathi voice is not available.');
  }

  const fileId = randomUUID();
  const filename = `${fileId}.mp3`;
  const outputPath = path.join(GENERATED_DIR, filename);
  const formattedRate = formatProsodyValue(rate);
  const formattedPitch = formatProsodyValue(pitch);

  try {
    const tts = new EdgeTTS({
      lang: language,
      voice: selectedVoice.voice,
      rate: formattedRate,
      pitch: formattedPitch,
      outputFormat: 'audio-24khz-96kbitrate-mono-mp3',
      timeout: 20000,
    });

    await tts.ttsPromise(text, outputPath);

    return {
      filename,
      audioUrl: `/audio/${filename}`,
      downloadUrl: `/audio/${filename}`,
      engine: ENGINES['fast-edge'],
      voice: selectedVoice,
      settings: {
        rate: formattedRate,
        pitch: formattedPitch,
      },
    };
  } catch (error) {
    await safeUnlink(outputPath);
    throw error;
  }
}

async function generateStudioSpeech({ text, language = 'mr-IN', referencePath }) {
  const fileId = randomUUID();
  const filename = `${fileId}.mp3`;
  const outputPath = path.join(GENERATED_DIR, filename);

  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const { stdout, stderr } = await execFileAsync(
        PYTHON_BIN,
        [
          STUDIO_SCRIPT,
          '--text',
          text,
          '--language',
          mapLocaleToStudioLanguage(language),
          '--reference',
          referencePath,
          '--output',
          outputPath,
        ],
        {
          cwd: ROOT_DIR,
          timeout: STUDIO_TIMEOUT_MS,
          maxBuffer: 10 * 1024 * 1024,
        }
      );

      if (!fs.existsSync(outputPath)) {
        throw buildVisibleError(
          stderr.trim() ||
            'Studio voice generation did not produce an audio file. Check the Python setup in studio/requirements.txt.',
          500
        );
      }

      const metadata = parseStudioMetadata(stdout);

      return {
        filename,
        audioUrl: `/audio/${filename}`,
        downloadUrl: `/audio/${filename}`,
        engine: {
          ...ENGINES['studio-clone'],
          model: metadata.model || 'Smolie-in',
          device: metadata.device || 'cpu',
        },
        voice: {
          id: 'reference-clone',
          label: 'Reference Voice Clone',
          displayName: 'Uploaded Marathi Reference',
          gender: 'Custom',
          locale: 'mr-IN',
          voice: 'mahatts-reference-clone',
          description:
            'Generated from your uploaded Marathi reference clip for a more human voice signature.',
        },
        settings: {
          rate: 'native',
          pitch: 'native',
        },
      };
    } catch (error) {
      await safeUnlink(outputPath);

      const normalizedError = normalizeStudioError(error);
      if (attempt === 1 && isCorruptStudioModelError(normalizedError.message)) {
        console.warn('Corrupted Marathi studio model cache detected. Resetting cache and retrying once.');
        await resetStudioModelCache();
        continue;
      }

      throw normalizedError;
    }
  }

  throw buildVisibleError('Studio mode failed after retrying the Marathi model cache repair.', 500);
}

async function cleanupGeneratedFiles() {
  const cutoff = Date.now() - AUDIO_TTL_MS;
  const entries = await fsPromises.readdir(GENERATED_DIR, { withFileTypes: true });

  await Promise.all(
    entries.map(async (entry) => {
      if (!entry.isFile()) {
        return;
      }

      const entryPath = path.join(GENERATED_DIR, entry.name);
      const stats = await fsPromises.stat(entryPath);

      if (stats.mtimeMs < cutoff) {
        await safeUnlink(entryPath);
      }
    })
  );
}

async function safeUnlink(filePath) {
  try {
    await fsPromises.unlink(filePath);
  } catch (error) {
    if (error && error.code !== 'ENOENT') {
      console.error(`Failed to remove ${filePath}:`, error);
    }
  }
}

async function resetStudioModelCache() {
  try {
    await fsPromises.rm(STUDIO_MODELS_DIR, { recursive: true, force: true });
  } catch (error) {
    console.error('Failed to reset the Marathi studio model cache:', error);
  }
}

function buildVisibleError(message, statusCode = 500) {
  const error = new Error(message);
  error.expose = true;
  error.statusCode = statusCode;
  return error;
}

function normalizeStudioError(error) {
  if (error && error.code === 'ENOENT') {
    return buildVisibleError(
      `Studio mode requires ${PYTHON_BIN} plus the dependencies in studio/requirements.txt.`,
      500
    );
  }

  if (error && error.killed) {
    return buildVisibleError(
      'Studio voice generation timed out. Use a shorter script or run the MahaTTS model on a faster machine/GPU.',
      500
    );
  }

  const stderr = error && typeof error.stderr === 'string' ? error.stderr.trim() : '';
  const stdout = error && typeof error.stdout === 'string' ? error.stdout.trim() : '';
  const combinedOutput = stderr || stdout;

  if (combinedOutput) {
    const parsed = parseStudioMetadata(combinedOutput);
    if (parsed.error) {
      return buildVisibleError(parsed.error, 500);
    }
  }

  if (isCorruptStudioModelError(combinedOutput || error?.message)) {
    return buildVisibleError(
      'The Marathi studio model cache was corrupted during download. The app reset the broken cache. Please generate again and let the model finish downloading on a stable connection.',
      500
    );
  }

  if (combinedOutput) {
    const lastLine = combinedOutput.split('\n').filter(Boolean).pop();
    if (lastLine) {
      return buildVisibleError(lastLine, 500);
    }
  }

  return buildVisibleError(
    'Studio mode failed. Complete the Python setup in studio/requirements.txt and try again.',
    500
  );
}

function isCorruptStudioModelError(message) {
  if (!message) {
    return false;
  }

  const normalizedMessage = String(message).toLowerCase();
  return [
    'pytorchstreamreader failed',
    'invalid header or archive is corrupted',
    'failed finding central directory',
    'archive is corrupted',
    'file data/',
    'failed to load pytorch model',
  ].some((pattern) => normalizedMessage.includes(pattern));
}

function parseStudioMetadata(output) {
  if (!output) {
    return {};
  }

  const lines = String(output)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      return JSON.parse(lines[index]);
    } catch (_error) {
      continue;
    }
  }

  return {};
}

function mapLocaleToStudioLanguage(language) {
  return language === 'mr-IN' ? 'marathi' : 'marathi';
}

function startServer() {
  const server = app.listen(PORT, HOST, () => {
    console.log(`Marathi TTS server running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  });

  server.on('error', (error) => {
    if (error && error.code === 'EADDRINUSE') {
      console.error(
        `Failed to start the Marathi TTS server: port ${PORT} is already in use. Stop the old Node process or change PORT in your .env file.`
      );
      return;
    }

    console.error('Failed to start the Marathi TTS server:', error);
  });

  return server;
}

if (require.main === module) {
  startServer();
}

module.exports = {
  app,
  cleanupGeneratedFiles,
  generateFastSpeech,
  generateStudioSpeech,
  MAX_CHARACTERS,
  startServer,
  ENGINES,
  VOICES,
};
