import service from '../../desktop/si-service.json' with { type: 'json' };

export function createWebSiClient({ browser = globalThis.window, serviceOrigin = service.url } = {}) {
  const url = new URL('/mission', serviceOrigin);
  if (url.protocol !== 'https:') throw new Error('The SI service requires HTTPS.');
  return {
    async propose(prompt, { signal } = {}) {
      const timeout = AbortSignal.timeout(70000);
      const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
      let response;
      try {
        response = await browser.fetch(url.href, { method: 'POST', credentials: 'omit',
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }), signal: requestSignal });
      } catch (error) {
        if (signal?.aborted) throw signal.reason;
        throw new Error('Unable to reach SI. Check your connection and try again.');
      }
      let body;
      try { body = await response.json(); } catch { throw new Error('The SI service returned an invalid response.'); }
      if (!response.ok) throw new Error(typeof body.error === 'string' && body.error.length < 200 ? body.error : 'The SI service is unavailable.');
      return body;
    },
  };
}
