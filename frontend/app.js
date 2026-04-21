const MAX_HISTORY_ITEMS = 8;
const HISTORY_KEY = 'textvoice-marathi-history';

const fallbackEngines = [
  {
    id: 'studio-clone',
    displayName: 'Studio Real Voice',
    provider: 'MahaTTS',
    badge: 'Best quality',
    requiresReference: true,
    supportsVoiceSelection: false,
    supportsProsody: false,
    description:
      'Clone a real Marathi speaker from your uploaded WAV sample for the most human result.',
  },
  {
    id: 'fast-edge',
    displayName: 'Fast Neural',
    provider: 'Edge TTS',
    badge: 'Fast preview',
    requiresReference: false,
    supportsVoiceSelection: true,
    supportsProsody: true,
    description:
      'Quick Marathi preview with built-in neural voices. Useful for speed, but less natural.',
  },
];

const fallbackVoices = [
  {
    id: 'female',
    displayName: 'Aarohi Neural',
    gender: 'Female',
    description: 'Warm, expressive, and natural for conversational Marathi.',
  },
  {
    id: 'male',
    displayName: 'Manohar Neural',
    gender: 'Male',
    description: 'Balanced, clear, and steady for narration-style Marathi.',
  },
];

const apiBaseUrl = (window.APP_CONFIG && window.APP_CONFIG.apiBaseUrl
  ? window.APP_CONFIG.apiBaseUrl.trim()
  : ''
).replace(/\/$/, '');

const form = document.getElementById('ttsForm');
const textInput = document.getElementById('textInput');
const languageSelect = document.getElementById('languageSelect');
const charCounter = document.getElementById('charCounter');
const engineOptions = document.getElementById('engineOptions');
const engineHelper = document.getElementById('engineHelper');
const pronunciationHints = document.getElementById('pronunciationHints');
const voiceOptions = document.getElementById('voiceOptions');
const voiceField = document.getElementById('voiceField');
const settingsGrid = document.getElementById('settingsGrid');
const referenceSection = document.getElementById('referenceSection');
const referenceAudio = document.getElementById('referenceAudio');
const referenceFilename = document.getElementById('referenceFilename');
const statusBadge = document.getElementById('statusBadge');
const generateButton = document.getElementById('generateButton');
const speedControl = document.getElementById('speedControl');
const speedValue = document.getElementById('speedValue');
const pitchControl = document.getElementById('pitchControl');
const pitchValue = document.getElementById('pitchValue');
const prosodySection = document.getElementById('prosodySection');
const audioPlayer = document.getElementById('audioPlayer');
const playerSection = document.getElementById('playerSection');
const emptyState = document.getElementById('emptyState');
const audioTitle = document.getElementById('audioTitle');
const audioSubtitle = document.getElementById('audioSubtitle');
const playButton = document.getElementById('playButton');
const pauseButton = document.getElementById('pauseButton');
const downloadButton = document.getElementById('downloadButton');
const historyList = document.getElementById('historyList');
const clearHistoryButton = document.getElementById('clearHistoryButton');
const progressPanel = document.getElementById('progressPanel');
const progressTitle = document.getElementById('progressTitle');
const progressPercent = document.getElementById('progressPercent');
const progressFill = document.getElementById('progressFill');
const progressMessage = document.getElementById('progressMessage');
const progressSteps = document.getElementById('progressSteps');

let engines = [...fallbackEngines];
let voices = [...fallbackVoices];
let defaultEngineId = 'studio-clone';
let currentAudio = null;
let progressRuntime = null;
const REQUEST_TIMEOUT_MS = {
  'studio-clone': 16 * 60 * 1000,
  'fast-edge': 45 * 1000,
};

const PROGRESS_PRESETS = {
  'studio-clone': [
    {
      title: 'Uploading request',
      message: 'Uploading your Marathi text and WAV reference sample.',
      percent: 18,
      waitMs: 1600,
    },
    {
      title: 'Validating reference',
      message: 'Checking Marathi settings and your reference audio quality.',
      percent: 34,
      waitMs: 2600,
    },
    {
      title: 'Loading Marathi model',
      message: 'Loading the Smolie-in studio model. The first run can take longer while model files download.',
      percent: 58,
      waitMs: 9000,
    },
    {
      title: 'Synthesizing real voice',
      message: 'Generating a more human-like Marathi voice clone from the uploaded sample.',
      percent: 84,
      waitMs: 9000,
    },
    {
      title: 'Waiting for final audio',
      message: 'The server is encoding the MP3 and returning the finished audio file.',
      percent: 96,
      waitMs: 7000,
    },
  ],
  'fast-edge': [
    {
      title: 'Uploading request',
      message: 'Sending Marathi text to the fast neural engine.',
      percent: 22,
      waitMs: 1200,
    },
    {
      title: 'Loading neural voice',
      message: 'Preparing the selected Marathi preview voice.',
      percent: 48,
      waitMs: 1800,
    },
    {
      title: 'Generating audio',
      message: 'Creating MP3 speech from the Marathi text.',
      percent: 80,
      waitMs: 2200,
    },
    {
      title: 'Waiting for final audio',
      message: 'The server is finishing the MP3 and returning the playback link.',
      percent: 96,
      waitMs: 1600,
    },
  ],
};

bootstrap();

async function bootstrap() {
  renderEngineOptions(engines, defaultEngineId);
  renderVoiceOptions(voices);
  updateCounter();
  updateSpeedLabel();
  updatePitchLabel();
  updateReferenceFilename();
  updateEngineUI();
  renderHistory();
  bindEvents();

  try {
    const response = await fetch(buildApiUrl('/api/voices'));
    if (!response.ok) {
      throw new Error('Unable to load voice metadata');
    }

    const data = await response.json();

    if (Array.isArray(data.engines) && data.engines.length) {
      engines = data.engines;
    }

    if (Array.isArray(data.voices) && data.voices.length) {
      voices = data.voices;
    }

    defaultEngineId = data.defaultEngine || defaultEngineId;
    renderEngineOptions(engines, defaultEngineId);
    renderVoiceOptions(voices);
    updateEngineUI();
  } catch (_error) {
    setStatus('Offline metadata mode', 'muted');
  }
}

function bindEvents() {
  textInput.addEventListener('input', updateCounter);
  speedControl.addEventListener('input', updateSpeedLabel);
  pitchControl.addEventListener('input', updatePitchLabel);
  referenceAudio.addEventListener('change', updateReferenceFilename);

  form.addEventListener('submit', handleGenerateVoice);

  document.querySelectorAll('[data-sample]').forEach((button) => {
    button.addEventListener('click', () => {
      textInput.value = button.dataset.sample || '';
      updateCounter();
      textInput.focus();
    });
  });

  document.addEventListener('change', (event) => {
    if (event.target && event.target.name === 'engine') {
      updateEngineUI();
    }
  });

  playButton.addEventListener('click', async () => {
    if (audioPlayer.src) {
      await audioPlayer.play();
    }
  });

  pauseButton.addEventListener('click', () => {
    audioPlayer.pause();
  });

  downloadButton.addEventListener('click', () => {
    if (currentAudio) {
      downloadAudio(currentAudio.audioUrl, currentAudio.filename);
    }
  });

  audioPlayer.addEventListener('play', () => {
    setStatus('Playing preview', 'success');
  });

  audioPlayer.addEventListener('pause', () => {
    if (currentAudio) {
      setStatus('Preview paused', 'muted');
    }
  });

  audioPlayer.addEventListener('ended', () => {
    setStatus('Preview finished', 'success');
  });

  clearHistoryButton.addEventListener('click', () => {
    window.localStorage.removeItem(HISTORY_KEY);
    renderHistory();
    setStatus('History cleared', 'muted');
  });
}

async function handleGenerateVoice(event) {
  event.preventDefault();

  const text = textInput.value.trim();
  if (!text) {
    setStatus('Please enter Marathi text', 'error');
    textInput.focus();
    return;
  }

  const selectedEngine = getSelectedEngineConfig();
  if (!selectedEngine) {
    setStatus('Select a rendering engine first', 'error');
    return;
  }

  const hintText = pronunciationHints.value.trim();

  const referenceFile = referenceAudio.files && referenceAudio.files[0] ? referenceAudio.files[0] : null;
  if (selectedEngine.requiresReference && !referenceFile) {
    setStatus('Studio mode needs a Marathi woman WAV reference file', 'error');
    referenceAudio.focus();
    return;
  }

  if (referenceFile && !referenceFile.name.toLowerCase().endsWith('.wav')) {
    setStatus('Please upload a WAV reference file for studio mode', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('text', text);
  formData.append('language', languageSelect.value);
  formData.append('engine', selectedEngine.id);
  formData.append('voice', getSelectedVoice() || 'female');
  formData.append('rate', String(Number(speedControl.value)));
  formData.append('pitch', String(Number(pitchControl.value)));
  formData.append('pronunciationHints', hintText);

  if (referenceFile) {
    formData.append('referenceAudio', referenceFile);
  }

  toggleGenerating(true, selectedEngine);
  startProgress(selectedEngine);
  setStatus(
    selectedEngine.requiresReference
      ? 'Generating studio voice... this can take longer'
      : 'Generating Marathi voice...',
    'loading'
  );

  try {
    const response = await fetchWithTimeout(buildApiUrl('/api/tts'), {
      method: 'POST',
      body: formData,
    }, getRequestTimeout(selectedEngine));

    const data = await parseApiResponse(response);

    if (!response.ok) {
      throw new Error(data.error || data.message || 'Unable to generate audio');
    }

    currentAudio = {
      audioUrl: buildAbsoluteUrl(data.audioUrl),
      downloadUrl: buildAbsoluteUrl(data.downloadUrl),
      filename: data.filename,
      voice: data.voice,
      engine: data.engine,
      createdAt: data.createdAt,
      text,
      pronunciationHints: hintText,
      textLength: data.textLength,
      referenceName: referenceFile ? referenceFile.name : '',
    };

    audioPlayer.src = currentAudio.audioUrl;
    emptyState.classList.add('hidden');
    playerSection.classList.remove('hidden');
    audioTitle.textContent = `${data.engine.displayName} • ${data.voice.displayName}`;
    audioSubtitle.textContent = buildAudioSubtitle(data, referenceFile);

    saveHistory(currentAudio);
    renderHistory();
    completeProgress(
      'Voice ready',
      selectedEngine.requiresReference
        ? 'Your studio Marathi voice is ready to preview and download.'
        : 'Your Marathi voice is ready to preview and download.'
    );
    setStatus(
      selectedEngine.requiresReference ? 'Studio voice ready to preview' : 'Voice ready to play',
      'success'
    );
  } catch (error) {
    const message = resolveGenerationError(error, selectedEngine);
    failProgress(message);
    setStatus(message, 'error');
  } finally {
    toggleGenerating(false, selectedEngine);
  }
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      method: 'POST',
      ...options,
      signal: controller.signal,
    });
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function parseApiResponse(response) {
  const contentType = response.headers.get('content-type') || '';

  if (contentType.includes('application/json')) {
    try {
      return await response.json();
    } catch (_error) {
      return {
        error: `The server returned invalid JSON with status ${response.status}.`,
      };
    }
  }

  const text = await response.text();
  return {
    error: text.trim() || `Request failed with status ${response.status}`,
  };
}

function getRequestTimeout(selectedEngine) {
  return REQUEST_TIMEOUT_MS[selectedEngine?.id] || 60 * 1000;
}

function buildGenerationTimeoutMessage(selectedEngine) {
  if (selectedEngine?.id === 'studio-clone') {
    return 'Studio voice generation took too long. If this is the first run, let the Marathi model finish downloading, then try again.';
  }

  return 'Voice generation took too long. Please try again or shorten the Marathi text.';
}

function resolveGenerationError(error, selectedEngine) {
  if (error && error.name === 'AbortError') {
    return buildGenerationTimeoutMessage(selectedEngine);
  }

  if (error instanceof TypeError) {
    return 'Cannot reach the Marathi TTS server. Make sure the backend is running and port 3001 is free.';
  }

  if (error && typeof error.message === 'string' && error.message.trim()) {
    return error.message.trim();
  }

  return 'Failed to generate voice. Please try again.';
}

function renderEngineOptions(engineList, preferredEngineId) {
  const selectedEngine = getSelectedEngine() || preferredEngineId || engineList[0]?.id || '';

  engineOptions.innerHTML = engineList
    .map((engine, index) => {
      const checked =
        engine.id === selectedEngine || (!selectedEngine && index === 0) ? 'checked' : '';

      return `
        <div class="engine-option">
          <input id="engine-${engine.id}" type="radio" name="engine" value="${engine.id}" ${checked} />
          <label for="engine-${engine.id}">
            <div class="engine-head">
              <strong>${escapeHtml(engine.displayName)}</strong>
              <span class="engine-badge">${escapeHtml(engine.badge || engine.provider || '')}</span>
            </div>
            <p class="engine-description">${escapeHtml(engine.description || '')}</p>
            <span class="engine-provider">${escapeHtml(engine.provider || '')}</span>
          </label>
        </div>
      `;
    })
    .join('');
}

function renderVoiceOptions(voiceList) {
  const selectedVoice = getSelectedVoice();

  voiceOptions.innerHTML = voiceList
    .map((voice, index) => {
      const checked =
        voice.id === selectedVoice || (!selectedVoice && index === 0) ? 'checked' : '';

      return `
        <div class="voice-option">
          <input id="voice-${voice.id}" type="radio" name="voice" value="${voice.id}" ${checked} />
          <label for="voice-${voice.id}">
            <div class="voice-title">
              <strong>${escapeHtml(voice.displayName)}</strong>
              <span class="voice-badge">${escapeHtml(voice.gender)}</span>
            </div>
            <p class="voice-description">${escapeHtml(voice.description || '')}</p>
          </label>
        </div>
      `;
    })
    .join('');
}

function updateEngineUI() {
  const selectedEngine = getSelectedEngineConfig() || fallbackEngines[0];
  const needsReference = Boolean(selectedEngine.requiresReference);
  const supportsVoiceSelection = Boolean(selectedEngine.supportsVoiceSelection);
  const supportsProsody = Boolean(selectedEngine.supportsProsody);

  referenceSection.classList.toggle('hidden', !needsReference);
  voiceField.classList.toggle('hidden', !supportsVoiceSelection);
  settingsGrid.classList.toggle('single-column', !supportsVoiceSelection);
  prosodySection.classList.toggle('hidden', !supportsProsody);

  generateButton.querySelector('.button-text').textContent = needsReference
    ? 'Generate Real Voice'
    : 'Generate Voice';

  engineHelper.textContent = needsReference
    ? 'Studio mode sounds more human because it clones a real Marathi voice from your WAV sample.'
    : 'Fast mode is quicker and simpler, but it still sounds more synthetic than studio cloning.';

  setStatus(needsReference ? 'Studio mode selected' : 'Fast mode selected', 'muted');
}

function updateCounter() {
  const count = textInput.value.length;
  charCounter.textContent = `${count} / 2000`;
  charCounter.classList.toggle('warning', count >= 1600 && count < 1900);
  charCounter.classList.toggle('danger', count >= 1900);
}

function updateSpeedLabel() {
  const sliderValue = Number(speedControl.value);
  const multiplier = (1 + sliderValue / 100).toFixed(2);
  speedValue.textContent = `${multiplier}x`;
}

function updatePitchLabel() {
  const sliderValue = Number(pitchControl.value);
  const prefix = sliderValue > 0 ? '+' : '';
  pitchValue.textContent = `${prefix}${sliderValue}%`;
}

function updateReferenceFilename() {
  const file = referenceAudio.files && referenceAudio.files[0] ? referenceAudio.files[0] : null;
  referenceFilename.textContent = file
    ? `Selected reference: ${file.name}`
    : 'No reference file selected yet.';
}

function getSelectedVoice() {
  const selected = document.querySelector('input[name="voice"]:checked');
  return selected ? selected.value : '';
}

function getSelectedEngine() {
  const selected = document.querySelector('input[name="engine"]:checked');
  return selected ? selected.value : '';
}

function getSelectedEngineConfig() {
  const engineId = getSelectedEngine();
  return engines.find((engine) => engine.id === engineId) || null;
}

function toggleGenerating(isGenerating, selectedEngine) {
  generateButton.disabled = isGenerating;
  generateButton.querySelector('.button-text').textContent = isGenerating
    ? selectedEngine && selectedEngine.requiresReference
      ? 'Cloning Voice...'
      : 'Generating...'
    : selectedEngine && selectedEngine.requiresReference
      ? 'Generate Real Voice'
      : 'Generate Voice';
}

function setStatus(message, tone) {
  statusBadge.textContent = message;
  statusBadge.style.color =
    tone === 'success'
      ? '#72f4c5'
      : tone === 'error'
        ? '#ff8ba7'
        : tone === 'loading'
          ? '#7dd3fc'
        : '#acb6df';
}

function startProgress(selectedEngine) {
  clearProgressRuntime();

  const steps = PROGRESS_PRESETS[selectedEngine?.id] || PROGRESS_PRESETS['fast-edge'];
  progressRuntime = {
    steps,
    stageIndex: 0,
    percent: 4,
    stepTimer: null,
    percentTimer: null,
  };

  progressPanel.classList.remove('hidden');
  renderProgress({
    title: steps[0].title,
    message: steps[0].message,
    percent: progressRuntime.percent,
    stageIndex: progressRuntime.stageIndex,
    steps,
  });

  progressRuntime.percentTimer = window.setInterval(() => {
    if (!progressRuntime) {
      return;
    }

    const currentStep = progressRuntime.steps[progressRuntime.stageIndex];
    if (!currentStep) {
      return;
    }

    const targetPercent = currentStep.percent;
    if (progressRuntime.percent < targetPercent) {
      progressRuntime.percent += progressRuntime.percent < 70 ? 2 : 1;
      progressRuntime.percent = Math.min(progressRuntime.percent, targetPercent);
      renderProgress({
        title: currentStep.title,
        message: currentStep.message,
        percent: progressRuntime.percent,
        stageIndex: progressRuntime.stageIndex,
        steps: progressRuntime.steps,
      });
    }
  }, 260);

  queueNextProgressStep();
}

function queueNextProgressStep() {
  if (!progressRuntime) {
    return;
  }

  const currentStep = progressRuntime.steps[progressRuntime.stageIndex];
  if (!currentStep || progressRuntime.stageIndex >= progressRuntime.steps.length - 1) {
    return;
  }

  progressRuntime.stepTimer = window.setTimeout(() => {
    if (!progressRuntime) {
      return;
    }

    progressRuntime.stageIndex += 1;
    const nextStep = progressRuntime.steps[progressRuntime.stageIndex];

    renderProgress({
      title: nextStep.title,
      message: nextStep.message,
      percent: progressRuntime.percent,
      stageIndex: progressRuntime.stageIndex,
      steps: progressRuntime.steps,
    });

    queueNextProgressStep();
  }, currentStep.waitMs);
}

function completeProgress(title, message) {
  if (!progressRuntime) {
    progressPanel.classList.remove('hidden');
  }

  const steps = progressRuntime ? progressRuntime.steps : PROGRESS_PRESETS['fast-edge'];
  clearProgressRuntime();
  renderProgress({
    title,
    message,
    percent: 100,
    stageIndex: steps.length - 1,
    steps,
    forceAllComplete: true,
  });
}

function failProgress(message) {
  const steps = progressRuntime ? progressRuntime.steps : PROGRESS_PRESETS['fast-edge'];
  const stageIndex = progressRuntime ? progressRuntime.stageIndex : 0;
  clearProgressRuntime();

  renderProgress({
    title: 'Generation stopped',
    message,
    percent: Math.max(14, Math.min(94, Number(progressPercent.textContent.replace('%', '')) || 18)),
    stageIndex,
    steps,
  });
}

function clearProgressRuntime() {
  if (!progressRuntime) {
    return;
  }

  if (progressRuntime.percentTimer) {
    window.clearInterval(progressRuntime.percentTimer);
  }

  if (progressRuntime.stepTimer) {
    window.clearTimeout(progressRuntime.stepTimer);
  }

  progressRuntime = null;
}

function renderProgress({ title, message, percent, stageIndex, steps, forceAllComplete = false }) {
  progressPanel.classList.remove('hidden');
  progressTitle.textContent = title;
  progressMessage.textContent = message;
  progressPercent.textContent = `${Math.round(percent)}%`;
  progressFill.style.width = `${Math.max(0, Math.min(100, percent))}%`;

  progressSteps.innerHTML = steps
    .map((step, index) => {
      const classes = ['progress-step'];
      if (forceAllComplete || index < stageIndex) {
        classes.push('is-complete');
      } else if (index === stageIndex) {
        classes.push('is-active');
      }

      return `
        <div class="${classes.join(' ')}">
          <span class="progress-dot"></span>
          <span>${escapeHtml(step.title)}</span>
        </div>
      `;
    })
    .join('');
}

function saveHistory(item) {
  const history = getHistory();
  const nextHistory = [
    {
      ...item,
      previewText: item.text.length > 140 ? `${item.text.slice(0, 140)}...` : item.text,
    },
    ...history,
  ].slice(0, MAX_HISTORY_ITEMS);

  window.localStorage.setItem(HISTORY_KEY, JSON.stringify(nextHistory));
}

function getHistory() {
  try {
    const rawHistory = window.localStorage.getItem(HISTORY_KEY);
    return rawHistory ? JSON.parse(rawHistory) : [];
  } catch (_error) {
    return [];
  }
}

function renderHistory() {
  const history = getHistory();

  if (!history.length) {
    historyList.innerHTML =
      '<div class="history-empty">No saved audio yet. Generate your first Marathi voice clip.</div>';
    return;
  }

  historyList.innerHTML = history
    .map(
      (item, index) => `
        <article class="history-card">
          <div class="history-meta">
            <div>
              <strong>${escapeHtml(item.engine?.displayName || 'Voice Render')}</strong>
              <p class="history-time">${escapeHtml(formatDate(item.createdAt))}</p>
            </div>
            <span class="voice-badge">${escapeHtml(item.voice?.displayName || '')}</span>
          </div>
          <p class="history-text">${escapeHtml(item.previewText || '')}</p>
          <audio controls preload="none" src="${escapeHtml(item.audioUrl)}"></audio>
          <div class="history-actions">
            <button class="secondary-button" type="button" data-history-reuse="${index}">Use Again</button>
            <button class="secondary-button accent-button" type="button" data-history-download="${index}">
              Download
            </button>
          </div>
        </article>
      `
    )
    .join('');

  historyList.querySelectorAll('[data-history-reuse]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = history[Number(button.dataset.historyReuse)];
      if (!item) {
        return;
      }

      textInput.value = item.text;
      pronunciationHints.value = item.pronunciationHints || '';
      updateCounter();

      const engineInput = document.getElementById(`engine-${item.engine?.id}`);
      if (engineInput) {
        engineInput.checked = true;
      }

      const voiceInput = document.getElementById(`voice-${item.voice?.id}`);
      if (voiceInput) {
        voiceInput.checked = true;
      }

      updateEngineUI();
      textInput.focus();
      setStatus(
        item.engine?.requiresReference
          ? 'Text restored. Re-upload the reference WAV to regenerate.'
          : 'Loaded from history',
        'success'
      );
    });
  });

  historyList.querySelectorAll('[data-history-download]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = history[Number(button.dataset.historyDownload)];
      if (item) {
        downloadAudio(item.audioUrl, item.filename);
      }
    });
  });
}

async function downloadAudio(url, filename) {
  try {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error('Download failed');
    }

    const audioBlob = await response.blob();
    const objectUrl = window.URL.createObjectURL(audioBlob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename || `marathi-voice-${Date.now()}.mp3`;
    document.body.append(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(objectUrl);
    setStatus('Download started', 'success');
  } catch (_error) {
    setStatus('Unable to download this audio right now', 'error');
  }
}

function buildApiUrl(pathname) {
  if (!apiBaseUrl) {
    return pathname;
  }

  return `${apiBaseUrl}${pathname}`;
}

function buildAbsoluteUrl(pathname) {
  if (!pathname) {
    return '';
  }

  if (/^https?:\/\//i.test(pathname)) {
    return pathname;
  }

  if (apiBaseUrl) {
    return `${apiBaseUrl}${pathname}`;
  }

  return pathname;
}

function buildAudioSubtitle(data, referenceFile) {
  if (data.engine && data.engine.requiresReference) {
    return referenceFile
      ? `Reference clone • ${referenceFile.name} • ${data.textLength} characters`
      : `Reference clone • ${data.textLength} characters`;
  }

  return `${data.voice.gender} voice • ${data.textLength} characters`;
}

function formatDate(dateString) {
  if (!dateString) {
    return 'Just now';
  }

  const date = new Date(dateString);
  return new Intl.DateTimeFormat('en-IN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
