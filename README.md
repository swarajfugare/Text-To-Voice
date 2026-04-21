# TextVoice AI

Modern Marathi text-to-speech web application with two generation paths:

- `Studio Real Voice`: a new reference-audio cloning mode for much more human output
- `Fast Neural`: the original quick Marathi preview mode

## Why This New Version Sounds Better

The earlier version used a standard neural Marathi TTS voice. That can be smooth, but it still sounds recognizably AI.

If you want the output to feel closer to a real Marathi woman speaking, you need a real voice reference clip. This upgraded app adds a studio cloning mode that uses an open-source Marathi voice-cloning pipeline with your uploaded WAV sample.

## Features

- Marathi Unicode text input with a 2,000 character limit
- New `Studio Real Voice` mode for more human Marathi output
- Reference WAV upload flow for voice cloning
- Fast fallback Marathi neural voices
- MP3 generation, preview, pause, and download
- Local generation history in the browser
- Optional pronunciation hints for difficult Marathi words
- Responsive modern UI
- Deployable full-stack Node app, with optional local Python studio pipeline

## Tech Stack

- Frontend: HTML, CSS, vanilla JavaScript
- Backend: Node.js, Express
- Fast engine: `node-edge-tts`
- Studio engine: `MahaTTS` via Python bridge

## Engines

### 1. Studio Real Voice

- Best option for human-like output
- Requires a clean WAV sample of a real Marathi speaker
- Best for the exact problem you raised: the voice sounding too AI-generated

### 2. Fast Neural

- Works immediately
- Faster than studio mode
- Still sounds more synthetic than voice cloning

## Project Structure

```text
.
├── backend/
│   └── server.js
├── frontend/
│   ├── app.js
│   ├── config.js
│   ├── index.html
│   └── styles.css
├── generated/
├── studio/
│   ├── maha_clone.py
│   └── requirements.txt
├── uploads/
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## Local Setup

### Base app setup

1. Install Node dependencies:

   ```bash
   npm install
   ```

2. Copy the environment file:

   ```bash
   cp .env.example .env
   ```

3. Start the app:

   ```bash
   npm run dev
   ```

4. Open:

   ```text
   http://localhost:3001
   ```

### Studio Real Voice setup

The studio engine is optional but recommended if you want the voice to sound much more real.

1. Create and activate a Python environment:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. Install studio dependencies:

   ```bash
   pip install -r studio/requirements.txt
   ```

3. Keep `PYTHON_BIN=python3` in `.env`, or point it to your virtualenv Python if needed.

4. In the UI, select `Studio Real Voice`.

5. Upload a clean Marathi woman WAV reference clip:

   - 6 to 20 seconds
   - One speaker only
   - Very low background noise
   - Natural speaking pace

6. Generate the audio.

7. If a word still sounds wrong, use the `Pronunciation hints` box:

   ```text
   शब्द=उच्चार
   ```

   Example:

   ```text
   API=ए पी आय
   ऑर्डर=ऑरडर
   ```

### Studio troubleshooting

- The first `Studio Real Voice` run can take a long time because the Marathi model is downloaded locally.
- The app now validates the Marathi model cache before loading it and re-downloads only the broken file if needed.
- If studio mode says it cannot download a valid model file, make sure you have a stable internet connection and enough free disk space.
- If you want to reset the broken text-to-semantic checkpoint manually, delete `~/.cache/maha_tts/models/Smolie-in/t2s_best.pt` and generate again.

## Quality Guidance

If the voice still sounds artificial, the main fix is almost always the reference clip quality:

- Use a real human sample, not an existing AI sample
- Use clean WAV audio
- Avoid echo, music, and room noise
- Use natural Marathi speech, not exaggerated delivery

The better the reference clip, the more human the result will feel.

## API Endpoints

### `GET /api/health`

Returns API health status.

### `GET /api/voices`

Returns supported engines, Marathi voices, and the character limit.

### `POST /api/tts`

This endpoint now expects `multipart/form-data`.

Fields:

- `text`
- `language`
- `engine`
- `voice`
- `rate`
- `pitch`
- `referenceAudio` for studio mode only

## Deployment

### Easiest deployment

Deploy the full project as a Node service on Render or Railway.

- Build command: `npm install`
- Start command: `npm start`

This runs the UI and API from one app.

### Studio deployment note

The studio voice mode depends on Python plus the MahaTTS stack. For deployment, use a service or machine where:

- Python is available
- `pip install -r studio/requirements.txt` can run
- model downloads are allowed
- more RAM/CPU or a GPU is available for better speed

### Split frontend/backend deployment

If you want static frontend hosting:

1. Deploy the backend.
2. Update `frontend/config.js`:

   ```js
   window.APP_CONFIG = {
     apiBaseUrl: 'https://your-backend.onrender.com',
   };
   ```

3. Set `CORS_ORIGINS` on the backend:

   ```text
   CORS_ORIGINS=https://your-app.netlify.app
   ```

4. Deploy the `frontend/` folder to Netlify or Vercel.

## Notes

- Generated audio is cleaned automatically after `AUDIO_TTL_HOURS`
- Browser history is saved in `localStorage`
- Studio mode can be much slower than fast mode
- CPU works, but GPU is strongly preferred for the best experience

## Current Recommendation

If your goal is specifically “make it sound like a real Marathi woman”:

1. Use `Studio Real Voice`
2. Upload a clean WAV sample of a real Marathi woman voice
3. Keep text natural and conversational

That is the correct free path for improving this app beyond the generic AI-sounding voice.
