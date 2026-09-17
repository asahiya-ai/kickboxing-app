// GAS への POST と、合鍵（トークン）の保存。
// Content-Type を text/plain にしてプリフライトを避ける。
window.KickApi = {
  KEY: 'kick_v2_token',
  token() { try { return localStorage.getItem(this.KEY) || ''; } catch (e) { return ''; } },
  setToken(t) { try { t ? localStorage.setItem(this.KEY, t) : localStorage.removeItem(this.KEY); } catch (e) {} },
  async call(action, params) {
    const body = Object.assign({ action, token: this.token() }, params || {});
    let res;
    try {
      res = await fetch(CONFIG.GAS_URL, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(body) });
    } catch (e) {
      return { ok: false, message: '通信できませんでした。電波の良いところでもう一度お試しください' };
    }
    if (!res.ok) return { ok: false, message: '通信に失敗しました（' + res.status + '）' };
    const json = await res.json();
    if (json.needLogin) this.setToken('');
    return json;
  },
};
