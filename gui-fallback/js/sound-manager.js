// sound-manager.js — Web Audio API sound manager for Blueprints GUI
// xarta-node Blueprints GUI
//
// Singleton IIFE: SoundManager
//   SoundManager.init()              — call once on DOMContentLoaded
//   SoundManager.setEnabled(bool)    — enable/disable playback
//   SoundManager.play(url)           — play a sound by URL (no-op if disabled or missing)
//   SoundManager.preload(url)        — preload and cache an AudioBuffer
//
// Sound files are at /fallback-ui/assets/sounds/*.{wav,mp3,ogg,flac,webm}
// Global enable/disable is controlled by the 'fe.sound_enabled' setting in the
// settings table (fetched via getFrontendSetting, cached in localStorage).
//
// AudioContext must be resumed on a user gesture. The first click/keydown after
// page load will attempt to resume if the context was auto-suspended.

'use strict';

const SoundManager = (() => {
    let _ctx = null;
    let _gainNode = null;
    let _enabled = false;
    let _volume = 0.8;
    let _cache = {};    // { url: AudioBuffer }
    let _loading = {};  // { url: Promise<void> }  — dedup concurrent loads
    let _previewSource = null;
    let _previewUrl = '';
    let _previewOffset = 0;
    let _previewStartedAt = 0;
    let _previewPlaying = false;
    let _previewButton = null;
    let _previewToken = 0;
    let _lifecycleWired = false;

    function _getCtx() {
        if (!_ctx) {
            try {
                _ctx = new (window.AudioContext || window.webkitAudioContext)();
            } catch (e) {
                console.warn('[SoundManager] AudioContext not available:', e);
            }
        }
        return _ctx;
    }

    // Resume AudioContext if suspended (browsers block until user gesture)
    function _resumeCtx() {
        const ctx = _getCtx();
        if (ctx && ctx.state === 'suspended') {
            ctx.resume().catch(() => {});
        }
    }

    // Returns the shared GainNode (created once per AudioContext)
    function _getGainNode() {
        const ctx = _getCtx();
        if (!ctx) return null;
        if (!_gainNode) {
            _gainNode = ctx.createGain();
            _gainNode.gain.value = _volume;
            _gainNode.connect(ctx.destination);
        }
        return _gainNode;
    }

    // Wire up a one-time resume-on-first-interaction handler
    function _setupResumeOnGesture() {
        const handler = () => {
            _resumeCtx();
            document.removeEventListener('click', handler, true);
            document.removeEventListener('keydown', handler, true);
        };
        document.addEventListener('click', handler, true);
        document.addEventListener('keydown', handler, true);
    }

    function _setPreviewButtonState(button, state) {
        if (!button || !button.isConnected) return;
        if (state === 'playing') {
            button.textContent = '⏸';
            button.title = 'Pause preview';
            button.setAttribute('aria-pressed', 'true');
            button.dataset.previewState = 'playing';
            return;
        }
        if (state === 'paused') {
            button.textContent = '▶';
            button.title = 'Resume preview';
            button.setAttribute('aria-pressed', 'false');
            button.dataset.previewState = 'paused';
            return;
        }
        button.textContent = '▶';
        button.title = 'Preview sound';
        button.setAttribute('aria-pressed', 'false');
        button.dataset.previewState = 'idle';
    }

    function _disconnectPreviewSource() {
        if (!_previewSource) return;
        try { _previewSource.onended = null; } catch (e) {}
        try { _previewSource.stop(0); } catch (e) {}
        try { _previewSource.disconnect(); } catch (e) {}
        _previewSource = null;
    }

    function _resetPreviewState(buttonState) {
        const button = _previewButton;
        _disconnectPreviewSource();
        _previewUrl = '';
        _previewOffset = 0;
        _previewStartedAt = 0;
        _previewPlaying = false;
        _previewButton = null;
        _previewToken += 1;
        _setPreviewButtonState(button, buttonState || 'idle');
    }

    function _pausePreview() {
        const ctx = _getCtx();
        if (!ctx || !_previewPlaying) return;
        _previewOffset = Math.max(0, ctx.currentTime - _previewStartedAt);
        _previewPlaying = false;
        _disconnectPreviewSource();
        _setPreviewButtonState(_previewButton, 'paused');
    }

    function _clearBrokenPreview(button) {
        if (_previewButton === button) {
            _previewUrl = '';
            _previewOffset = 0;
            _previewStartedAt = 0;
            _previewPlaying = false;
            _previewButton = null;
        }
        _setPreviewButtonState(button, 'idle');
    }

    async function _startPreview(url, button, offset) {
        const ctx = _getCtx();
        if (!ctx || !url) {
            _clearBrokenPreview(button);
            return;
        }

        _resumeCtx();
        const gainNode = _getGainNode();
        const token = ++_previewToken;

        _previewUrl = url;
        _previewOffset = Math.max(0, offset || 0);
        _previewStartedAt = 0;
        _previewPlaying = false;

        if (_previewButton && _previewButton !== button) {
            _setPreviewButtonState(_previewButton, 'idle');
        }
        _previewButton = button || null;
        _setPreviewButtonState(_previewButton, 'playing');

        if (!_cache[url]) {
            await _loading[url] || this.preload(url);
        }

        if (_previewToken !== token || _previewUrl !== url || _previewButton !== (button || null)) {
            return;
        }

        const buffer = _cache[url];
        if (!buffer) {
            _clearBrokenPreview(button);
            return;
        }

        const resumeOffset = Math.min(_previewOffset, Math.max(0, buffer.duration - 0.01));

        try {
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(gainNode || ctx.destination);
            source.onended = () => {
                if (_previewSource !== source) return;
                try { source.disconnect(); } catch (e) {}
                _previewSource = null;
                _previewUrl = '';
                _previewOffset = 0;
                _previewStartedAt = 0;
                _previewPlaying = false;
                const activeButton = _previewButton;
                _previewButton = null;
                _setPreviewButtonState(activeButton, 'idle');
            };
            _previewSource = source;
            _previewStartedAt = ctx.currentTime - resumeOffset;
            _previewPlaying = true;
            source.start(0, resumeOffset);
        } catch (e) {
            _clearBrokenPreview(button);
        }
    }

    function _setupLifecycleCleanup() {
        if (_lifecycleWired) return;
        _lifecycleWired = true;
        window.addEventListener('pagehide', () => {
            _resetPreviewState('idle');
        });
        window.addEventListener('beforeunload', () => {
            _resetPreviewState('idle');
        });
    }

    return {
        init() {
            // Read the setting from localStorage cache (set by loadFrontendSettings)
            if (typeof getFrontendSetting === 'function') {
                _enabled = getFrontendSetting('sound_enabled', 'false') === 'true';
            }
            // Read volume from localStorage (tab-local only — not synced to backend)
            const stored = parseFloat(localStorage.getItem('fe.sound_volume') ?? '0.8');
            _volume = isNaN(stored) ? 0.8 : Math.max(0, Math.min(1, stored));
            _setupResumeOnGesture();
            _setupLifecycleCleanup();
        },

        setVolume(v) {
            _volume = Math.max(0, Math.min(1, v));
            if (_gainNode) _gainNode.gain.value = _volume;
        },

        getVolume() {
            return _volume;
        },

        setEnabled(v) {
            _enabled = Boolean(v);
        },

        async preload(url) {
            if (!url) return;
            if (_cache[url]) return;
            if (_loading[url]) return _loading[url];

            const ctx = _getCtx();
            if (!ctx) return;

            _loading[url] = (async () => {
                try {
                    const resp = await fetch(url);
                    if (!resp.ok) return;   // silent fail — asset may not exist yet
                    const buf = await resp.arrayBuffer();
                    _cache[url] = await ctx.decodeAudioData(buf);
                } catch (e) {
                    // Silently ignore missing or undecodable assets
                } finally {
                    delete _loading[url];
                }
            })();
            return _loading[url];
        },

        play(url) {
            if (!_enabled || !url) return;
            this._playNow(url);
        },

        // preview() bypasses the sound_enabled flag — for test/preview buttons in settings.
        preview(url) {
            if (!url) return;
            this.previewToggle(url);
        },

        previewToggle(url, opts) {
            if (!url) return;
            const button = (opts || {}).button || null;
            const sameChoice = _previewUrl === url && _previewButton === button;

            if (sameChoice && _previewPlaying) {
                _pausePreview();
                return;
            }

            if (sameChoice && !_previewPlaying && _previewOffset > 0) {
                void _startPreview.call(this, url, button, _previewOffset);
                return;
            }

            _resetPreviewState('idle');
            void _startPreview.call(this, url, button, 0);
        },

        stopPreview() {
            _resetPreviewState('idle');
        },

        _playNow(url) {
            const ctx = _getCtx();
            if (!ctx) return;
            _resumeCtx();

            const gainNode = _getGainNode();

            if (_cache[url]) {
                try {
                    const source = ctx.createBufferSource();
                    source.buffer = _cache[url];
                    source.connect(gainNode || ctx.destination);
                    source.start(0);
                } catch (e) {
                    // Silently ignore playback errors
                }
            } else {
                // Preload then play
                this.preload(url).then(() => {
                    if (_cache[url]) {
                        try {
                            const source = ctx.createBufferSource();
                            source.buffer = _cache[url];
                            source.connect(gainNode || ctx.destination);
                            source.start(0);
                        } catch (e) {}
                    }
                });
            }
        },
    };
})();
