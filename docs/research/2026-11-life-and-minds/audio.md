### Generative audio research report (verified against live ElevenLabs and OpenRouter docs/APIs on 2026-11-02)

**Headline changes since the current code was written:** ElevenLabs now has **Eleven v4** (`eleven_v4`) and **`eleven_v4_turbo`**. Self-serve API plans are **billed in USD, not credits**. **OpenRouter now runs a TTS endpoint** (`POST /api/v1/audio/speech`) that includes the ElevenLabs models, but it only offers premade voices.

### 1. Sound Effects: `POST https://api.elevenlabs.io/v1/sound-generation`
Docs: https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert.md
- Body fields:
  - `text` (required)
  - `duration_seconds`: 0.5–30, or null to let the model choose
  - `prompt_influence`: 0–1, default 0.3
  - `loop`: bool, default false
  - `model_id`: `eleven_text_to_sound_v2` (default) or `eleven_text_to_sound_v3` (marked "Limited access"; better with vocal and musical sounds)
- Query params:
  - `output_format`, default `mp3_44100_128`. Options include `opus_48000_{32..192}`, `pcm_*`, `wav_*`. mp3 192 kbps needs Creator or higher; 44.1 kHz PCM/WAV needs Pro or higher.
  - `enable_logging`: setting it to false (zero retention) is Enterprise only.
- Price: **$0.12 per minute of audio, metered per generation** (https://elevenlabs.io/pricing/api). Included generations: Starter 150, Creator 605, Pro 3,000 (works out to about $0.033–0.04 per generation).
- The credit-plan tooltip uses different rules: 200 credits per auto-length generation, 40 credits per second when you set the duration, max 22 s. That is stale compared with the API's 30 s limit.
- **Gotcha:** don't deliver `loop:true` output as MP3. Encoder padding leaves a gap at the loop point. Request `wav_24000` or `opus`, or trim server-side.

### 2. Music: `POST https://api.elevenlabs.io/v1/music`
Docs: https://elevenlabs.io/docs/api-reference/music/compose.md
- Body fields:
  - `prompt` or `composition_plan`. You must send exactly one.
  - `music_length_ms`: 3,000–600,000. Only works with `prompt`.
  - `force_instrumental`: only works with `prompt`.
  - `model_id`: `music_v1` is the default, so **set `music_v2_5` explicitly**.
  - `seed`: cannot be combined with `prompt`.
  - Also: `finetune_id`, `respect_sections_durations`, `store_for_inpainting`, `sign_with_c2pa`.
- Plan format for v2/v2.5: `chunks[]` with `text` (e.g. "[Verse]", max 30 lines × 200 chars), `duration_ms` (3–120 s), `positive_styles`, `negative_styles`, `context_adherence` (low/med/high), and `conditioning_ref`. There is also a streaming guide.
- `output_format` defaults to `auto` (mp3_48000_192 for v2 models).
- Price: **$0.15/min**. Creator includes about 147 min.
- **Music concurrency by plan:** Free 0 (so effectively paid-only), Starter/Creator/Pro 2, Scale/Business 5.
- **Licence risk** (https://elevenlabs.io/music-terms):
  - Every self-serve plan covers "all online and offline commercial use **except film, TV, radio, and Studio Games**."
  - A **Studio Game** is any public, monetized game that isn't an Indie Game. An **Indie Game** has under $500k lifetime revenue *and* the developer earned under $1M from games last year. If you outgrow that, you get 60 days to move to Enterprise.
  - There are monthly download limits: Starter 30 min, Creator 250, Pro 500, Scale 1,500, Business 4,000.
  - You must not expose the music model to third parties ("Reseller"). Player-prompted music is borderline, so get a legal read.
- OpenRouter alternatives: `google/lyria-3-clip-preview` at $0.04 per 30 s clip and `google/lyria-3-pro-preview` at $0.08 per song.

### 3. Text-to-speech
Docs: https://elevenlabs.io/docs/overview/models.md

**Endpoints**
- `POST /v1/text-to-speech/{voice_id}`, and `/stream` for chunked output.
- Main fields: `text`, `model_id` (default `eleven_multilingual_v2`), `language_code`, `seed`, `previous_text`/`next_text`, `previous_request_ids`, `apply_text_normalization`, `output_format`.
- There is also a new `audio_effects` field: `environment_id` reverb, `distance`, `pan`, `filter_preset_id`, `background_noise_id`. **Don't bake reverb in if you spatialize client-side.**

**`voice_settings`**
- `stability`: 0.5
- `similarity_boost`: 0.75
- `style`: 0. Anything above 0 adds latency.
- `use_speaker_boost`: true
- `speed`: 1. The range is about 0.7–1.2 per secondary sources.

**Models**

| Model | Char limit | Latency (median) | $ per 1K chars |
|---|---|---|---|
| `eleven_v4` | 10,000 | — | 0.08 |
| `eleven_v4_turbo` | — | ~100 ms; audio tags supported | 0.04 |
| `eleven_v3` | 5,000 | — | 0.08 |
| `eleven_v3_conversational` | — | ~165 ms | 0.04 |
| `eleven_multilingual_v2` | 10,000 | — | 0.08 |
| `eleven_flash_v2_5` | 40,000 | ~75–100 ms; no audio tags | 0.04 |

- Audio tags such as `[groans] [whispers] [laughs] [sighs] [shouting]` work on v3/v4. Creature sounds like `[growls]` depend on the voice.

**WebSockets**
- `wss://api.elevenlabs.io/v1/text-to-speech/{id}/stream-input` and `/multi-stream-input`: Flash or Multilingual v2 only, **no v3/v4**. Only active generation time counts toward concurrency.
- v3/v4 stream over the **Text-to-Dialogue WebSocket** `wss://…/v1/text-to-dialogue/…`. Each open socket holds a dialogue session from a separate pool.

**Concurrency (Multilingual / Flash):** Free 2/4, Starter 3/6, Creator 5/10, Pro 10/20, Scale/Business 15/30. Watch the response headers `current-concurrent-requests` and `maximum-concurrent-requests`.

### 4. Voice Design (custom NPC voices)
1. Call `POST /v1/text-to-voice/design` with:
   - `voice_description` (required)
   - `model_id`: use `eleven_ttv_v3` (default is `eleven_multilingual_ttv_v2`)
   - `text` (100–1,000 chars) or `auto_generate_text:true`
   - `loudness`: -1..1, default 0.5; 0 ≈ -24 LUFS
   - `guidance_scale`: default 5; high values sound robotic
   - `seed`: same seed + same inputs gives the same voice
   - optional: `should_enhance`, `quality`, `stream_previews`, `reference_audio_base64`/`prompt_strength` (v3 only)
   
   It returns 3 `previews[]`, each with `generated_voice_id` and `audio_base_64`. **409** means a generation is already in progress.
2. Save the chosen one with `POST /v1/text-to-voice` using `voice_name`, `voice_description`, `generated_voice_id` (optional `labels`). It returns a `voice_id`.

- **Cost:** you pay only for the preview-text characters, once per batch of 3 (about $0.008–0.08). Saving a voice uses a **voice slot**: Free 3, Starter 10, Creator 30, Pro 160, Scale/Business 660 (secondary source; verify). Voice-operation quotas also exist.
- ElevenLabs explicitly advertises "ogres, witches… godlike being." A good prompt follows their guide's format: *"Ancient colossal giant made of molten lava, extremely deep, cavernous and resonant, slow deliberate rumbling pace, gravelly, booming, perfect audio quality."* Use matching slow, ominous preview text and guidance 3–5.
- Premade and shared voices: `GET /v1/voices` and `GET /v1/shared-voices?gender=&age=&accent=&use_cases=&descriptives=&category=&language=&search=&page_size≤100`.
- Policy: no impersonating real people, no child-like voices in the library. You are responsible for what players type, so run moderation before TTS.

### 5. Real-time conversation
- **ElevenAgents / Speech Engine:** $0.08/min + LLM (burst $0.16/min). Concurrent calls by plan: 4/6/10/20/30/40. WebRTC and WebSocket supported. Silence over 10 s is discounted 95%. There is also a "Realtime v1 Mini/Max" speech-to-speech model at $0.08/min + LLM, OpenAI-Realtime-compatible.
- **Do it yourself:** Scribe v2 realtime STT ($0.39/hour) → OpenRouter LLM → Flash or v4-turbo over WebSocket (about $0.04 per ~1 min of speech).
- **Recommendation:** don't use Agents for ambient NPC chatter. Do it yourself: push-to-talk or typed chat → LLM → TTS, cached per line. Agents' per-minute billing and call concurrency don't fit a multiplayer game. Only consider Agents for a headline "talk to the boss" feature.

### 6. Alternatives (prices per OpenRouter `/api/v1/models?output_modalities=speech`)

| Option | Price | Notes |
|---|---|---|
| OR `elevenlabs/eleven-v4`, `v3`, `multilingual-v2` | $0.08/1K chars | **21 premade voices only, no designed voice IDs** |
| OR `elevenlabs/eleven-v4-turbo`, `flash-v2.5` | $0.04/1K chars | same voice restriction |
| OR `google/gemini-3.8-flash-tts` | $0.50/M in, $9/M out tokens | 30 voices, per-turn `instructions` style prompts, **PCM only**, max 2 speakers; a 49 s clip cost $0.0074 |
| OR `gemini-3.8-flash-lite-tts` | cheaper | |
| OR `hexgrad/kokoro-82m` | $0.00062/1K chars | |
| OR `fish-audio/drama-3` | $0.002/1K chars | |
| OR `minimax/speech-2.8-hd` | $0.10/1K chars | |
| OR `openai/gpt-audio` | $64/M audio-out tokens | chat-completions audio |
| OR `openai/gpt-audio-mini` | $2.40/M | chat-completions audio |
| OpenAI direct `gpt-4o-mini-tts` | ≈$0.015/min ($0.60/M in, ~$12/M audio out) | has an `instructions` style field; not on OR (secondary source) |
| Cartesia Sonic 3 | ≈$0.037–0.05/1K chars | ~40–90 ms TTFA (secondary source) |

- Endpoint: `POST https://openrouter.ai/api/v1/audio/speech` with `{model, input (string or turns[]), voice, instructions, speed, response_format}`. Look up the cost of any request with `GET /api/v1/generation?id=`.

### 7. Web Audio best practice
- **Panning:** use `equalpower` by default on mobile; HRTF costs about 10× the CPU. Reserve HRTF for 1–3 nearby key sources (e.g. the speaking NPC), with a quality setting.
- **Distance models:** `inverse` for voices and creatures, with `refDistance` scaled to creature size; `linear` with `maxDistance` for ambient beds. Cap active voices at about 24 on mobile.
- **Reverb:** one shared ConvolverNode send bus per world/biome (cave, lava, hall) with short 1–2 s IRs on mobile. Not one per source.
- **Ducking:** separate buses for music, SFX and voice. When a voice line starts, use `setTargetAtTime` to drop music by -9 to -12 dB (~0.1 s attack, 0.6–1 s release). DynamicsCompressor can't sidechain.
- **Giant voices:**
  - Design the voice deep at the source and set `speed` around 0.8.
  - On the client, `playbackRate` 0.85–0.92 lowers pitch *and* formants. That is actually desirable for "huge," but it also slows playback.
  - `detune` on a buffer source behaves the same as `playbackRate`.
  - Pitch-shifting without changing speed needs an AudioWorklet (SoundTouch or Rubber Band WASM).
  - Add a lowshelf boost (~+6 dB at 120 Hz), mild WaveShaper grit, a sub-octave or rumble layer, and the cave convolver.
  - Use **SFX generation for non-verbal groans and roars**: better results and about $0.01 per 5 s.
- **Audio sprites:** pack UI and short SFX into one file and play slices with `start(when, offset, duration)`.
- **Caching:**
  - Server: key on hash(provider, model, voice_id, text, settings, format), store the audio plus `request_id` in object storage behind a CDN, and never regenerate a line that's already cached.
  - Client: Cache API or IndexedDB.
- **iOS:**
  - Use one AudioContext. Call `resume()` and play a 1-sample buffer inside the first `touchend`/`click`.
  - Handle the `interrupted` state and resume on `visibilitychange`.
  - `navigator.audioSession.type='playback'` (iOS 16.4+) ignores the mute switch but pauses the user's music, so make it opt-in.
- **Codecs:**
  - MP3 is the safe default for `decodeAudioData` everywhere.
  - Opus is better per byte. Feature-detect it with `canPlayType('audio/ogg; codecs=opus')` and fall back to MP3.
  - Use WAV/Opus for gapless loops.

### 8. Failures, billing and refunds
Docs: https://elevenlabs.io/docs/eleven-api/resources/errors.md

- Error bodies look like `{detail:{type, code, message, request_id, param}}`.

| Status | `code` values | Action |
|---|---|---|
| 400 | `validation_error`, `text_too_long`, `invalid_voice_settings` | fix the request |
| 401 | `invalid_api_key`, `missing_api_key` | check the key |
| 402 | `insufficient_credits` | **new code; older clients saw 401 with `quota_exceeded`, so handle both** |
| 403 | `feature_not_available`, `subscription_required`, `model_access_denied` (e.g. SFX v3) | plan or access issue |
| 409 | voice preview already in progress | retry |
| 422 | Pydantic `detail[]` list | validation failure |
| 429 | `rate_limit_exceeded` | exponential backoff |
| 429 | `concurrent_limit_exceeded` | queue the request; don't retry blindly |
| 429 | `system_busy` | backoff |
| 500/503 | `maintenance` etc. | backoff, alert |

- **Refunds:** there is no documented automatic API refund policy. Requests rejected before generation (4xx, 429) are presumably not billed. Partially streamed or WebSocket output is billed for the characters processed.
- **How to check:**
  - Snapshot `GET /v1/user/subscription` (`character_count`) before and after in an integration test.
  - Reconcile against `GET /v1/history` and the usage analytics dashboard.
  - Log `request_id` on every call and send it to support@elevenlabs.io for credit disputes.

### Recommendations
1. **Go direct to ElevenLabs** for designed NPC voices and SFX/music. **Use OpenRouter TTS** (Gemini Flash TTS or ElevenLabs premade voices) as a cheap fallback or bulk path behind the same interface.
2. **NPC voice strategy:**
   - Build a curated **archetype pool** of 20–60 designed voices (lava giant, fairy, robot…), because slots are 30 on Creator and 160 on Pro.
   - Have an LLM map each player NPC description to {archetype `voice_id`, `voice_settings`, client FX params, audio tags}.
   - Generate groans with the SFX API.
   - Use v3/v4 for pre-rendered barks and v4-turbo or Flash for live replies.
   - Cache everything.
3. **Plan:** Creator ($22) is the minimum for commercial use, 192 kbps and music. **Pro ($99)** gets 44.1 kHz WAV, 160 slots and concurrency 10/20.
4. **Hardening:**
   - Set `model_id` explicitly everywhere, otherwise you get the old defaults `music_v1` and `eleven_multilingual_v2`.
   - Use a per-type concurrency semaphore that matches the plan (music = 2).
   - Clamp `duration_seconds` and `music_length_ms`.
   - Set per-user daily spend caps and moderate prompts.
5. **Risks:**
   - The music "Studio Game" licence exclusion once the game is monetized above the indie thresholds.
   - The music reseller clause for player-prompted generation.
   - Voice-slot exhaustion.
   - iOS audio unlock.
   - Some secondary-source numbers (voice slots, speed range, Cartesia and OpenAI prices) need a check against the live dashboards.
6. **Next step:** run integration tests against the real API: one cheap call per endpoint, assert content-type and duration, and diff the account usage before and after.
