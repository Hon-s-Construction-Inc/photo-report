// Thin client for the Apps Script backend. No secrets live here.
(function () {
  'use strict';
  var TOKEN_KEY = 'hci_pr_token';
  var USER_KEY = 'hci_pr_user';

  function call(action, payload) {
    var url = window.APP_CONFIG.API_URL;
    if (!/^https:\/\/script\.google\.com\//.test(url)) {
      return Promise.reject(Object.assign(new Error('The app is not connected to its backend yet (js/config.js).'), { code: 'config' }));
    }
    var body = JSON.stringify(Object.assign({ action: action, token: localStorage.getItem(TOKEN_KEY) || '' }, payload || {}));
    // text/plain keeps this a "simple" request, so the browser skips a CORS preflight that Apps Script cannot answer.
    return fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: body, redirect: 'follow' })
      .then(function (res) { return res.json(); })
      .then(function (data) {
        if (!data.ok) throw Object.assign(new Error(data.message || data.error || 'Request failed'), { code: data.error || 'server' });
        return data;
      });
  }

  window.API = {
    call: call,
    saveSession: function (token, user) { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); },
    clearSession: function () { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); },
    hasSession: function () { return !!localStorage.getItem(TOKEN_KEY); },
    savedUser: function () { try { return JSON.parse(localStorage.getItem(USER_KEY)); } catch (e) { return null; } }
  };
})();
