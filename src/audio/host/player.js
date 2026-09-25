/* 文字PVメーカー v2 — original work. Playback clock: the song through Web Audio, or a silent clock without a song (§4.13). */
MV.def('audio/host/player', [], () => {
  'use strict';

  const END_SLACK = 0.004;          // seconds: a position this close to the end counts as the end

  function perfSeconds() { return performance.now() / 1000; }

  // createPlayer({ buffer | null, duration }) → Player (§4.13). Song time runs from `from` at `rate` while playing. With a
  // song, time follows what is being heard: the AudioContext output timestamp maps the page clock to the audio clock, so
  // the preview never runs ahead of the sound by the output latency. Without a song the page clock drives it.
  function createPlayer(opts) {
    const o = opts || {};
    let buffer = o.buffer || null;
    let duration = Math.max(0, o.duration || (buffer ? buffer.duration : 0));
    let ctx = null;
    let gain = null;
    let source = null;
    let playing = false;
    let rate = 1;
    let muted = false;
    let from = 0;                   // song time where the current run started (or the paused position)
    let startAt = 0;                // clock time (audio or page seconds) of `from`
    let endTimer = null;
    const listeners = { state: new Set(), ended: new Set() };

    function emit(kind) {
      const info = { playing, t: api.now(), rate, muted };
      for (const fn of Array.from(listeners[kind])) fn(info);
    }

    function audioContext() {
      if (!ctx) {
        ctx = new AudioContext({ latencyHint: 'interactive' });
        gain = ctx.createGain();
        gain.gain.value = muted ? 0 : 1;
        gain.connect(ctx.destination);
      }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }

    // Audio-clock time being heard at page time `pageMs` (a performance.now()-style timestamp).
    function heardAt(pageMs) {
      const stamp = typeof ctx.getOutputTimestamp === 'function' ? ctx.getOutputTimestamp() : null;
      if (stamp && stamp.performanceTime > 0) return stamp.contextTime + (pageMs - stamp.performanceTime) / 1000;
      const latency = ctx.outputLatency || ctx.baseLatency || 0;
      return ctx.currentTime - latency + (pageMs - performance.now()) / 1000;
    }

    function clockAt(pageMs) {
      return buffer && ctx ? heardAt(pageMs) : pageMs / 1000;
    }

    function songAt(clock) {
      const t = from + Math.max(0, clock - startAt) * rate;
      return Math.min(t, duration);
    }

    function stopSource() {
      if (!source) return;
      source.onended = null;
      try { source.stop(); } catch (err) { /* already stopped */ }
      source.disconnect();
      source = null;
    }

    function clearEnd() {
      if (endTimer !== null) clearTimeout(endTimer);
      endTimer = null;
    }

    function armEnd() {
      clearEnd();
      const left = (duration - api.now()) / rate;
      endTimer = setTimeout(checkEnd, Math.max(0, left * 1000));
    }

    function checkEnd() {
      endTimer = null;
      if (!playing) return;
      if (api.now() < duration - END_SLACK) { armEnd(); return; }
      stopSource();
      playing = false;
      from = duration;
      emit('state');
      emit('ended');
    }

    function start(t) {
      stopSource();
      from = Math.max(0, Math.min(t, duration));
      if (buffer) {
        const c = audioContext();
        startAt = c.currentTime;
        if (from < buffer.duration) {
          source = c.createBufferSource();
          source.buffer = buffer;
          source.playbackRate.value = rate;
          source.connect(gain);
          source.start(0, from);
        }
      } else {
        startAt = perfSeconds();
      }
      playing = true;
      armEnd();
    }

    const api = {
      get playing() { return playing; },
      get muted() { return muted; },
      get duration() { return duration; },
      get rate() { return rate; },
      set rate(v) {
        const next = Math.max(0.25, Math.min(4, Number(v) || 1));
        if (next === rate) return;
        const t = api.now();
        rate = next;
        if (playing) start(t); else from = t;
        emit('state');
      },
      // play(from?): from the given time, else from the current position (from 0 again when at the end).
      play(t) {
        const pos = t === undefined ? api.now() : t;
        start(pos >= duration - END_SLACK && t === undefined ? 0 : pos);
        emit('state');
      },
      pause() {
        if (!playing) return;
        from = api.now();
        stopSource();
        clearEnd();
        playing = false;
        emit('state');
      },
      seek(t) {
        const pos = Math.max(0, Math.min(Number(t) || 0, duration));
        if (playing) start(pos); else from = pos;
        emit('state');
      },
      now() {
        return playing ? songAt(clockAt(performance.now())) : from;
      },
      // outputTimeOf(event.timeStamp) → the song time that was being heard when the event happened (tap sync).
      outputTimeOf(eventTimeStamp) {
        if (!playing) return from;
        return songAt(clockAt(eventTimeStamp));
      },
      setMuted(b) {
        muted = !!b;
        if (gain) gain.gain.value = muted ? 0 : 1;
        emit('state');
      },
      on(kind, fn) {
        if (!listeners[kind]) throw new TypeError('player.on: unknown event ' + kind);
        listeners[kind].add(fn);
        return () => listeners[kind].delete(fn);
      },
      // load({ buffer, duration }): swaps the song or the video length; playback stops at the current position.
      load(next) {
        const pos = api.now();
        stopSource();
        clearEnd();
        playing = false;
        buffer = (next && next.buffer) || null;
        duration = Math.max(0, (next && next.duration) || (buffer ? buffer.duration : 0));
        from = Math.min(pos, duration);
        emit('state');
      },
      dispose() {
        stopSource();
        clearEnd();
        playing = false;
        listeners.state.clear();
        listeners.ended.clear();
        if (ctx) ctx.close().catch(() => {});
        ctx = null;
        gain = null;
      },
    };
    return api;
  }

  return { createPlayer };
});
