(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var TZ = CFG.TIMEZONE || 'America/Los_Angeles';
  var LABELS = ['Before Photo', 'After Photo', 'Progress Photo', 'Completion Photo', 'Demolition', 'Existing Condition', 'Damage'];

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var app = $('#app');

  // A job's display name: its JobTread "Project Long Name" when it has one, else the job name.
  // Opening or refreshing the app reads each list straight from JobTread once (not the copy the server saved).
  var freshLeft = { my: true, active: true, wo: true };
  function takeFresh(k) { var f = !!freshLeft[k]; freshLeft[k] = false; return f; }
  // Coming back to the app after a minute or more away (phone tab left open) does the same.
  var hiddenAt = 0;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (hiddenAt && Date.now() - hiddenAt > 60000 && state.view === 'search' && state.user) {
      freshLeft = { my: true, active: true, wo: true };
      try { syncMyJobs(); loadActiveJobs(true); loadWoJobs(true); } catch (e) { /* home not shown */ }
    }
    hiddenAt = 0;
  });
  function jn(j) { return (j && (API.longName(j.id) || j.longName)) || (j && j.name) || ''; }
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function norm(s) { return String(s).replace(/[  ]/g, ' '); }
  function fmtDateTime(iso) {
    return norm(new Date(iso).toLocaleString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }));
  }
  function fmtShort(iso) {
    return norm(new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric' }));
  }
  function dayKey(iso) {
    try { return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso)); } catch (e) { return ''; }
  }
  function fmtDay(iso) {
    return norm(new Date(iso).toLocaleDateString('en-US', { timeZone: TZ, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }));
  }
  function fmtToday() {
    return norm(new Date().toLocaleDateString('en-US', { timeZone: TZ, month: 'short', day: 'numeric', year: 'numeric' }));
  }
  function isoToday() {
    var p = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
    return p; // YYYY-MM-DD
  }
  function titleCase(s) {
    return String(s || '').toLowerCase().replace(/\b[a-z]/g, function (c) { return c.toUpperCase(); });
  }
  function safeFileName(s) { return String(s).replace(/[^\w .,&()#'-]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 100); }

  var toastTimer;
  function toast(msg) {
    var t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3200);
  }
  function overlay(on, text, pct) {
    $('#overlay').hidden = !on;
    if (text != null) $('#overlay-text').textContent = text;
    if (pct != null) $('#overlay-bar').style.width = Math.max(0, Math.min(100, pct)) + '%';
  }

  /* ------------------------------------------------------------------ state */
  var state = {
    view: 'login', loginStep: 'email', email: '', user: null,
    query: '', jobs: [], pickedJob: null, searchSeq: 0, deepJob: readDeepJob(),
    job: null, files: [], byId: {}, selected: [], sortDesc: true,
    sections: [], entries: {}, report: { title: '', author: '', dateText: '' }, activeSec: null, addNew: false, replacing: null,
    pdf: null, saved: false,
    up: null, myJobs: loadMyJobsCache(),
    groupBy: 'date', perms: null, isAdmin: false, filesJob: null, filesList: null, tasks: null, admin: null
  };
  // What this person may do here (set by an Admin). Until the server answers, everything shows.
  function can(k) { return !state.perms || state.perms[k] !== false; }
  function takePerms(r) { if (r && r.perms) { state.perms = r.perms; state.isAdmin = !!r.isAdmin; state.statusAllowed = r.statusAllowed || null; state.role = r.role || ''; API.saveAccess(r); } if (r && r.write) state.write = r.write; }
  function isPmRole() { return state.role === 'Project Manager' || state.role === 'Operations Manager'; }
  function canAssign() { return state.isAdmin || state.role === 'Operations Manager'; }
  // Can this person save to JobTread right now? Unknown until the server says; then every write control follows it.
  function canWrite() { return !state.write || state.write.ok !== false; }
  function writeWhy() { return (state.write && state.write.message) || 'Saving to JobTread is not available for you yet.'; }
  var sortables = [];

  /* ------------------------------------------------------------------ routing */
  // A link like .../photo-report/?job=22PdMdwxvZQW (for example from a JobTread job) opens that job's photos directly.
  function readDeepJob() {
    try { var j = new URLSearchParams(location.search).get('job'); return /^[A-Za-z0-9]{5,20}$/.test(j || '') ? j : null; } catch (e) { return null; }
  }
  function afterSignIn() {
    var id = state.deepJob; state.deepJob = null;
    go('search'); syncMyJobs();
    if (!id) return;
    try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ }
    pullJob({ id: id, name: '' });
  }

  function go(view) { state.view = view; render(); }

  function render() {
    destroySortables();
    document.body.classList.toggle('editing', state.view === 'editor');
    if (state.view === 'login') renderLogin();
    else if (state.view === 'search') renderSearch();
    else if (state.view === 'editor') renderEditor();
    else if (state.view === 'result') renderResult();
    else if (state.view === 'upload') renderUpload();
    else if (state.view === 'files') renderFiles();
    else if (state.view === 'tasks') renderTasks();
    else if (state.view === 'admin') renderAdmin();
    else if (state.view === 'help') renderHelp();
    else if (state.view === 'gallery') renderGallery();
    else if (state.view === 'todos') renderTodos();
    else if (state.view === 'newjob') renderNewJob();
    else if (state.view === 'movetemp') renderMoveTemp();
    else if (state.view === 'editjob') renderEditJob();
  }

  function handleError(err, msgEl) {
    if (err && err.code === 'auth') {
      API.clearSession(); state.user = null; state.loginStep = 'email';
      go('login'); setTimeout(function () { setMsg('Please sign in again.'); }, 0);
      return;
    }
    if (err && err.code === 'forbidden') { API.call('me').then(function (r) { takePerms(r); if (state.view === 'search') renderSearch(); }).catch(function () { /* ignore */ }); }
    var m = (err && err.message) || 'Something went wrong.';
    if (msgEl) msgEl.textContent = m; else toast(m);
  }
  function setMsg(text, ok) {
    var el = $('#msg'); if (!el) return;
    el.textContent = text || ''; el.className = 'msg' + (ok ? ' ok' : '');
  }

  /* ------------------------------------------------------------------ login */
  function renderLogin() {
    var codeStep = state.loginStep === 'code';
    app.innerHTML =
      '<main class="center"><div class="card login">' +
      '<img class="logo" src="icons/logo.jpg" alt="HCI">' +
      '<h1>HCI App</h1>' +
      (codeStep
        ? '<p class="muted">We sent a 6-digit code to<br><b>' + esc(state.email) + '</b></p>' +
          '<input id="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="------" aria-label="6-digit code">' +
          '<button class="btn primary" data-act="verify">Sign in</button>' +
          '<button class="link" data-act="useOther">Use a different email</button>'
        : '<p class="muted">Enter your work email and we will send you a sign-in code.</p>' +
          '<input id="email" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="you@company.com" aria-label="Email" value="' + esc(state.email) + '">' +
          '<button class="btn primary" data-act="sendCode">Send code</button>') +
      '<p id="msg" class="msg" role="alert"></p></div></main>';
    var f = $(codeStep ? '#code' : '#email'); if (f) f.focus();
  }

  function doSendCode() {
    var email = $('#email').value.trim();
    if (!email) return setMsg('Enter your email address.');
    setMsg('Sending...', true);
    API.call('requestCode', { email: email }).then(function () {
      state.email = email; state.loginStep = 'code'; renderLogin();
      setMsg('If this email has access, a code is on its way.', true);
    }).catch(function (e) { handleError(e, $('#msg')); });
  }

  function doVerify() {
    var code = $('#code').value.trim();
    if (code.replace(/\D/g, '').length !== 6) return setMsg('Enter the 6-digit code.');
    setMsg('Checking...', true);
    API.call('verifyCode', { email: state.email, code: code }).then(function (r) {
      API.saveSession(r.token, r.user); state.user = r.user; takePerms(r); afterSignIn();
    }).catch(function (e) { handleError(e, $('#msg')); });
  }

  /* ------------------------------------------------------------------ job search */
  function renderSearch() {
    app.innerHTML =
      '<header class="topbar"><img class="logo-sm" src="icons/logo.jpg" alt="HCI"><div class="grow"><div class="title">HCI App</div></div>' +
      '<span class="small muted userName">' + esc(state.user ? state.user.name : '') + '</span>' +
      (can('tasks') ? '<button class="btn small" data-act="tasks">&#9745; My tasks</button>' : '') +
      settingsMenu() + '</header>' +
      '<main class="home">' +
      '<div class="findrow"><label for="q">Find job</label><input id="q" type="search" autocomplete="off" autocapitalize="off" placeholder="House number and street, e.g. 1900 Gough" aria-label="Search jobs" value="' + esc(state.query) + '">' +
      '<div id="results" class="results drop"></div></div>' +
      '<div class="selbox" id="selbox"></div><div id="notebox"></div>' +
      '<div class="cols"><section class="col"><div class="lab labrow">My jobsite</div>' + listTools('my') + '<div id="myJobs"></div></section>' +
      '<section class="col act"><div class="lab labrow">Action</div><div class="ltools stf-spacer" aria-hidden="true"></div><div id="actionBox"></div></section>' +
      '<section class="col active"><div class="lab labrow">Non Green Tree WO jobs <b class="cnt" id="activeCnt"></b>' + '</div>' + listTools('active') + '<div id="activeJobs"></div></section>' +
      '<section class="col wo"><div class="lab labrow">Green Tree Work orders <b class="cnt" id="woCnt"></b>' + '</div>' + listTools('wo') + '<div id="woJobs"></div></section>' +
      '<section class="col tmp" id="tempCol" hidden><div class="lab labrow">Temporary jobs <b class="cnt" id="tempCnt"></b> <span class="small muted">&middot; new customers, not in JobTread yet</span></div><div id="tempJobs"></div></section></div></main>';
    renderResults(); renderMyJobs(); renderActions(); renderActiveJobs(); loadActiveJobs(); loadWoJobs(); loadTemps();
    if (!state.myJobs.length && !state.pickedJob) $('#q').focus();
  }

  // Private notes on a job: kept only on this device, for the signed-in person. Never sent to JobTread or the server.
  // KEEP THEM SAFE: keys start with "hci_pr_note_". No upgrade, sign-out or clean-up may remove them; only the person's
  // own "Delete note" does. Do not rename the key format (old notes would look lost).
  function noteKey(id) { return 'hci_pr_note_' + ((state.user && state.user.email) || '').toLowerCase() + '_' + id; }
  function noteGet(id) { try { var n = JSON.parse(localStorage.getItem(noteKey(id)) || 'null'); return n && n.text ? n : null; } catch (e) { return null; } }
  function noteSet(id, text) {
    try {
      if (String(text).trim()) localStorage.setItem(noteKey(id), JSON.stringify({ text: text, at: Date.now() }));
      else localStorage.removeItem(noteKey(id));
      return true;
    } catch (e) { return false; }
  }
  function noteMark(j) { return noteGet(j.id) ? ' <span class="hasnote" title="You have notes on this job">&#128221;</span>' : ''; }
  function renderNote() {
    var box = $('#notebox'); if (!box) return;
    var j = state.pickedJob;
    if (!j || !state.noteOpen) { box.innerHTML = ''; return; }
    var n = noteGet(j.id);
    box.innerHTML = '<div class="notecard"><textarea id="noteText" rows="5" placeholder="Notes for this job: gate code, who to call, what to bring...">' + esc(n ? n.text : '') + '</textarea>' +
      '<div class="notefoot"><span class="small muted" id="noteInfo">' + (n ? 'Saved ' + esc(fmtDateTime(new Date(n.at).toISOString())) + ' &middot; ' : '') + 'Only on this device, only for you. Not saved to JobTread.</span>' +
      (n ? '<button class="link small" data-act="noteDelete">Delete note</button>' : '') + '</div></div>';
  }

  // The right-hand half of the home screen: the selected job, then View / Upload buttons (only the ones this person may use).
  function renderActions() {
    var j = state.pickedJob, sb = $('#selbox'); if (!sb) return;
    sb.innerHTML = '<span class="lab">Working on:</span><div class="selname' + (j ? '' : ' none') + '">' + (j ? esc(jn(j)) +
      '<button class="btn small notebtn' + (noteGet(j.id) ? ' has' : '') + '" data-act="noteToggle" aria-expanded="' + !!state.noteOpen + '">&#128221; My notes</button>' + starBtn(j, true) : 'Find a job above, or tap one in any list below') + '</div>';
    renderNote();
    // The app draws its own menu (not the browser's <select>) so each row is tall enough for a gloved finger.
    var o = function (act, text, perm) { return perm ? '<button class="actopt" data-act="runAct" data-run="' + act + '">' + text + '</button>' : ''; };
    // Three places, each for looking AND adding: To-do list (+ Add a to-do), Files and plans (Upload),
    // Photos (Upload photos, Make a report).
    var tmp = j && j.temp;   // a temporary job only has photos until an Admin moves it to a real job
    var items = (tmp ? '' : o('goTodos', 'To-do list', can('todo')) + o('goFiles', 'Files and plans', can('files') || can('photos') || can('report') || can('upload'))) +
      o('goGallery', 'Photos', can('photos') || can('report') || can('upload')) +
      (tmp ? '' : o('goAssign', 'Assign project manager', canAssign()) + o('goEditJob', 'Edit job information', canAssign() && canWrite()));
    var box = $('#actionBox'); if (!box) return;
    if (!items) { box.innerHTML = '<p class="small muted">No actions are switched on for you yet. Ask an Admin.</p>'; return; }
    box.innerHTML = '<div class="actwrap"><button id="actionSel" class="actionsel" data-act="actMenu" aria-haspopup="menu" aria-expanded="false"' + (j ? '' : ' disabled') + '>' +
      (j ? 'Choose an action...' : 'Pick a job first') + '<span class="chev">&#9662;</span></button>' +
      '<div id="actMenu" class="actmenu" role="menu" hidden>' +
      items + '</div></div>' +
      '<p class="small muted">Pick what you want to do with the job you are working on.</p>' + (!canWrite() ? '<p class="small msg">' + esc(writeWhy()) + '</p>' : '');
  }
  function toggleActMenu() {
    var m = $('#actMenu'), b = $('#actionSel'); if (!m || !b || b.disabled) return;
    var open = m.hidden; closeMenus(); m.hidden = !open; b.setAttribute('aria-expanded', open);
  }

  function runAction(act) {
    var j = state.pickedJob; if (!j) return toast('Pick a job first.');
    switch (act) {
      case 'goTodos': return openTodos(j);
      case 'goAddTodo': return openTodos(j, true);
      case 'goFiles': return openFiles(j, 'search');
      case 'goGallery': return openGallery(j);
      case 'goUpload': return openUpload(j, 'search');
      case 'goReport': return pullJob(j);
      case 'goAssign': return openAssign(j);
      case 'goEditJob': return openEditJob(j);
    }
  }

  // Settings dropdown: Refresh, Help, (Users and access for Admins), Sign out.
  function settingsMenu() {
    return '<div class="dd"><button class="btn small" data-act="menu" aria-haspopup="true" aria-expanded="false">&#9881; Settings &#9662;</button>' +
      '<div class="ddm" hidden><button data-act="refreshApp">&#8635; Refresh</button>' +
      '<button data-act="help">? Help</button>' +
      '<button data-act="shareApp">&#128279; Share this app</button>' +
      (state.isAdmin ? '<button data-act="admin">&#128100; Users and access</button>' : '') +
      '<button data-act="signOut">Sign out</button></div></div>';
  }
  // → on a list row: the same actions as "Choose an action", opened right under that job (no jump to the top).
  function openRowMenu(listId, id) {
    var box = listId && document.getElementById(listId), src = $('#actMenu');
    var btn = box && $$('.gobtn', box).filter(function (b) { return b.dataset.id === id; })[0];
    var row = btn && btn.closest('.jobrow');
    if (!row || !src || !state.pickedJob) return;
    var m = $('#rowMenu');
    if (!m) { m = document.createElement('div'); m.id = 'rowMenu'; m.className = 'actmenu rowmenu'; m.setAttribute('role', 'menu'); document.body.appendChild(m); }
    m.innerHTML = '<div class="grp">' + esc(jn(state.pickedJob)) + '</div>' + src.innerHTML;
    m.hidden = false;
    var r = (row.querySelector('.jobcell') || row).getBoundingClientRect(), h = m.offsetHeight, vh = window.innerHeight;
    var below = true;   // always right under the job; the page nudges up a little if the menu runs off the bottom
    m.style.left = (r.left + window.scrollX) + 'px';
    m.style.width = Math.max(r.width, 240) + 'px';
    m.style.top = ((below ? r.bottom + 6 : r.top - h - 6) + window.scrollY) + 'px';
    var mr = m.getBoundingClientRect();   // keep it on screen on narrow phones
    if (mr.right > document.documentElement.clientWidth - 8) m.style.left = Math.max(8, document.documentElement.clientWidth - 8 - mr.width + window.scrollX) + 'px';
    if (below && mr.bottom > vh) window.scrollBy({ top: mr.bottom - vh + 12, behavior: 'smooth' });
  }
  // A list that scrolls inside itself would leave the menu floating in the wrong place, so it closes.
  document.addEventListener('scroll', function (e) { if (e.target !== document) { var m = $('#rowMenu'); if (m && !m.hidden && !m.contains(e.target)) m.hidden = true; } }, true);
  function closeMenus() {
    $$('.stf details[open]').forEach(function (d) { d.open = false; });
    $$('.ddm, .actmenu, .swapmenu').forEach(function (m) { m.hidden = true; });
    $$('.dd > .btn, #actionSel').forEach(function (b) { b.setAttribute('aria-expanded', 'false'); });
  }

  function newJobRow() {
    return can('newJob') && state.perms && state.perms.newJob === true ? '<button class="newjobrow" data-act="newJob">+ New (Temporary) Job<span class="small muted">Can\'t find it? Start it here and add photos now.</span></button>' : '';
  }
  function renderResults() {
    var box = $('#results'); if (!box) return;
    if (state.query.trim().length < 2) { box.innerHTML = ''; }
    else if (!state.jobs.length) { box.innerHTML = '<p class="muted">No jobs found. Try fewer words or just the house number.</p>' + newJobRow(); }
    else {
      var edit = canStatus();
      box.innerHTML = state.jobs.map(function (j) {
        var picked = state.pickedJob && state.pickedJob.id === j.id;
        var ph = phaseOf(j), st = stBubble(j, edit);
        return '<div class="jobrow hasgo' + (st ? ' hasst' : '') + '">' + starBtn(j) + '<div class="jobcell"><button class="job' + (picked ? ' picked' : '') + '" data-act="pick" data-id="' + esc(j.id) + '" aria-pressed="' + !!picked + '">' +
          '<span class="name">' + esc(jn(j)) + noteMark(j) + '</span>' + (ph ? '<span class="phase">' + esc(ph) + '</span>' : '') +
          '<span class="sub">Created ' + esc(fmtShort(j.createdAt)) + ' \u00b7 ' + (j.photoCount ? 'Has photos' : 'No photos') + '</span></button>' + st + goBtn(j) + '</div></div>';
      }).join('') + newJobRow();
    }
  }

  var searchTimer;
  function onSearchInput(value) {
    state.query = value;
    clearTimeout(searchTimer);
    if (value.trim().length < 2) { state.jobs = []; renderResults(); return; }
    searchTimer = setTimeout(function () {
      var seq = ++state.searchSeq;
      API.call('searchJobs', { q: value }).then(function (r) {
        if (seq !== state.searchSeq) return;
        state.jobs = r.jobs;
        if (state.pickedJob && !r.jobs.some(function (j) { return j.id === state.pickedJob.id; })) state.pickedJob = null;
        renderResults();
      }).catch(function (e) { handleError(e); });
    }, 300);
  }

  /* ------------------------------------------------------------------ My jobs (each person's own short list) */
  var MY_JOBS_KEY = 'hci_pr_myjobs';
  // Called while the state is being built, before MY_JOBS_KEY is assigned, so the key is written out here.
  function loadMyJobsCache() { try { return sortMyJobs(JSON.parse(localStorage.getItem('hci_pr_myjobs') || '[]') || []); } catch (e) { return []; } }
  function cacheMyJobs() { try { localStorage.setItem(MY_JOBS_KEY, JSON.stringify(state.myJobs)); } catch (e) { /* full */ } }
  function myJob(id) { return state.myJobs.filter(function (j) { return j.id === id; })[0] || null; }
  // My jobsite order: house number first (as a number), then the street name A to Z.
  function jobSortKey(name) {
    var m = /^\s*(\d+)\s*(.*)$/.exec(String(name || ''));
    return { n: m ? Number(m[1]) : Infinity, s: (m ? m[2] : String(name || '')).toLowerCase() };
  }
  // Job list order: house number ascending. Jobs whose Status is Complete or Complete Pending Final Payment go to the
  // bottom. In Work orders, A New Lead jobs come first. A job's Status is looked up from the Active and Work order lists.
  function phaseOf(j) {
    if (j.phase) return j.phase;
    var hit = (state.wo || []).concat(state.active || []).filter(function (x) { return x.id === j.id; })[0];
    return hit ? hit.phase : '';
  }
  function sortJobs(list, newLeadsFirst) {
    var rank = function (j) {
      var p = phaseOf(j);
      if (/^complete/i.test(p)) return 2;
      return newLeadsFirst && /new lead/i.test(p) ? 0 : 1;
    };
    return list.slice().sort(function (a, b) {
      var ka = jobSortKey(a.name), kb = jobSortKey(b.name);
      return rank(a) - rank(b) || ka.n - kb.n || ka.s.localeCompare(kb.s);
    });
  }
  function sortMyJobs(list) { return sortJobs(list, false); }
  function isMyJob(id) { return !!myJob(id); }
  // Add / in-list control. "+" adds the job to My jobsite; once it is there the control shows a tick and tapping it
  // asks before removing. full=true writes the words out (used on the Working on line).
  function starBtn(j, full) {
    if (!j || !j.id) return '';
    var on = isMyJob(j.id);
    // Add only. Once the job is in the list the small + disappears; the Working on line shows a plain label instead.
    // Removing is done only with the x in the list itself.
    return '<button class="star' + (on ? ' on' : ' add') + (full ? ' full' : '') + '" data-act="star" data-id="' + esc(j.id) + '" data-name="' + esc(j.name || '') + '" data-full="' + (full ? 1 : 0) + '"' + (on ? ' disabled' : '') + (on && !full ? ' hidden' : '') + ' aria-label="' + (on ? 'In My jobsite' : 'Add to My jobsite') + '" title="' + (on ? 'In My jobsite (remove it with the x in the list)' : 'Add to My jobsite') + '">' + starText(on, full) + '</button>';
  }
  function starText(on, full) { return on ? (full ? '&#10003; In My jobsite' : '&#10003;') : (full ? '+ Add to My jobsite' : '+'); }
  // The list lives on the server (per email), so every device shows the same one. A copy is kept here for instant display.
  // Merge the server's list with this device's copy. Nothing is ever dropped by an upgrade or a sign-in on another
  // device: a job on either side stays, and the merged list is written back if the server was missing any.
  function syncMyJobs() {
    API.call('getMyJobs', { fresh: takeFresh('my') }).then(function (r) {
      var server = r.jobs || [], seen = {}, merged = [];
      server.concat(state.myJobs).forEach(function (j) { if (j && j.id && !seen[j.id]) { seen[j.id] = true; merged.push({ id: j.id, name: j.name || '', longName: jn(j) !== j.name ? jn(j) : '' }); } });
      state.myJobs = sortMyJobs(merged); cacheMyJobs(); paintStars();
      if (merged.length > server.length) API.call('setMyJobs', { jobs: state.myJobs }).catch(function () { /* next time */ });
    }).catch(function () { /* keep the cached copy */ });
  }
  function saveMyJobs() {
    cacheMyJobs(); paintStars();
    API.call('setMyJobs', { jobs: state.myJobs }).catch(function (e) { if (e && e.code === 'auth') handleError(e); else toast('Could not save My jobs to the server. It is kept on this device.'); });
  }
  function toggleMyJob(id, name) {
    if (isMyJob(id)) { state.myJobs = state.myJobs.filter(function (j) { return j.id !== id; }); toast('Removed from My jobsite.'); }
    else {
      if (state.myJobs.length >= 30) return toast('My jobs holds up to 30 jobs. Remove one first.');
      state.myJobs.push({ id: id, name: name || (state.pickedJob && state.pickedJob.id === id ? state.pickedJob.name : '') });
      state.myJobs = sortMyJobs(state.myJobs); toast('Added to My jobsite.');
    }
    saveMyJobs();
  }
  function paintStars() {
    $$('.star:not(.unstar)').forEach(function (b) {
      var on = isMyJob(b.dataset.id), full = b.dataset.full === '1';
      b.classList.toggle('on', on); b.classList.toggle('add', !on); b.innerHTML = starText(on, full); b.disabled = on; b.hidden = on && !full;
      b.title = on ? 'In My jobsite (remove it with the x in the list)' : 'Add to My jobsite';
    });
    renderMyJobs(); renderActions(); renderActiveJobs(); renderWoJobs();
    if (state.view === 'upload' && state.up && !state.up.job) paintJobResults();
  }
  // A search box on each home list that only narrows that list (nothing is sent to the server).
  function listSearch(k) {
    var v = (state.listQ && state.listQ[k]) || '';
    return '<input type="search" class="listq" data-list="' + k + '" placeholder="Search this list" aria-label="Search this list" autocomplete="off" value="' + esc(v) + '">';
  }
  // Under each list title: a search box as wide as the list, with the Status filter at its right.
  function listTools(k) { return '<div class="ltools">' + listSearch(k) + '<div class="stf" id="stf-' + k + '"></div></div><div class="stchips" id="stc-' + k + '"></div>'; }
  // When only some Statuses are chosen, they show as chips under the search box; tap x to drop one, Clear for all.
  function statusChips(k) {
    var el = $('#stc-' + k); if (!el) return;
    var pick = state.listSt && state.listSt[k];
    if (!pick) { el.innerHTML = ''; return; }
    el.innerHTML = '<span class="small muted">Showing:</span>' +
      (pick.length ? pick.map(function (s) {
        return '<span class="stchip">' + esc(s) + '<button type="button" data-act="stfDrop" data-list="' + k + '" data-st="' + esc(s) + '" aria-label="Stop showing ' + esc(s) + '">&times;</button></span>';
      }).join('') : '<span class="small">no Status</span>') +
      '<button type="button" class="link small" data-act="stfClear" data-list="' + k + '">Show all</button>';
  }
  function rerenderList(k) { ({ my: renderMyJobs, active: renderActiveJobs, wo: renderWoJobs })[k](); }
  function listFilter(k, list) {
    if (!list) return list;
    var q = String((state.listQ && state.listQ[k]) || '').toLowerCase().trim();
    var pick = state.listSt && state.listSt[k];
    var words = q ? q.split(/\s+/) : [];
    return list.filter(function (j) {
      if (pick && pick.indexOf(phaseOf(j) || '(no Status)') < 0) return false;
      var hay = (jn(j) + ' ' + (j.name || '') + ' ' + (j.phase || '')).toLowerCase();
      return words.every(function (w) { return hay.indexOf(w) > -1; });
    });
  }
  function noMatch(k) {
    var q = state.listQ && state.listQ[k];
    return '<p class="small muted">No job in this list matches' + (q ? ' "' + esc(q) + '"' : '') + (state.listSt && state.listSt[k] ? ' the chosen Status' : '') + '.</p>';
  }
  // Status filter under each list: a drop list of check boxes, one per Status found in that list, plus All.
  function statusFilter(k, list) {
    var el = $('#stf-' + k); if (!el) return;
    var order = state.statusOptions || [];
    var seen = {};
    (list || []).forEach(function (j) { seen[phaseOf(j) || '(no Status)'] = true; });
    var opts = order.filter(function (o) { return seen[o]; }).concat(Object.keys(seen).filter(function (o) { return order.indexOf(o) < 0; }));
    var pick = state.listSt && state.listSt[k];
    statusChips(k);
    var sig = JSON.stringify([opts, pick]);
    if (el.dataset.sig === sig) return;           // unchanged: keep the drop list as it is (and open, if open)
    var wasOpen = !!el.querySelector('details[open]');
    el.dataset.sig = sig;
    var label = !pick ? 'All Statuses' : pick.length === 1 ? pick[0] : pick.length + ' Statuses';
    el.innerHTML = '<details class="stfd"' + (wasOpen ? ' open' : '') + '><summary><span class="small muted">Status:</span> <b>' + esc(label) + '</b> <span aria-hidden="true">\u25be</span></summary><div class="stfm">' +
      '<label class="perm"><input type="checkbox" class="stfchk" data-list="' + k + '" value="__all"' + (!pick ? ' checked' : '') + '><span><b>All</b></span></label>' +
      opts.map(function (o) {
        return '<label class="perm"><input type="checkbox" class="stfchk" data-list="' + k + '" value="' + esc(o) + '"' + (!pick || pick.indexOf(o) > -1 ? ' checked' : '') + '><span>' + esc(o) + '</span></label>';
      }).join('') + '</div></details>';
  }
  function onStatusFilter(t) {
    var k = t.dataset.list, all = $$('.stfchk').filter(function (c) { return c.dataset.list === k && c.value !== '__all'; });
    state.listSt = state.listSt || {};
    if (t.value === '__all') state.listSt[k] = t.checked ? null : [];
    else {
      var on = all.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      state.listSt[k] = on.length === all.length ? null : on;
    }
    ({ my: renderMyJobs, active: renderActiveJobs, wo: renderWoJobs })[k]();
  }
  function renderMyJobs() {
    var box = $('#myJobs'); if (!box) return;
    if (!state.myJobs.length) { box.innerHTML = '<p class="small muted">No jobs marked yet.</p>'; return; }
    statusFilter('my', state.myJobs);
    var shown = sortMyJobs(listFilter('my', state.myJobs));
    if (!shown.length) { box.innerHTML = noMatch('my'); return; }
    var edit = canStatus();
    box.innerHTML = '<div class="results">' + shown.map(function (j) {
      var picked = state.pickedJob && state.pickedJob.id === j.id;
      var x = '<button class="star unstar" data-act="unstar" data-id="' + esc(j.id) + '" data-name="' + esc(j.name || '') + '" aria-label="Remove from My jobsite" title="Remove from My jobsite">&times;</button>';
      var ph = phaseOf(j), st = stBubble(j, edit);
      return '<div class="jobrow hasgo' + (st ? ' hasst' : '') + '">' + x + '<div class="jobcell"><button class="job' + (picked ? ' picked' : '') + '" data-act="pick" data-id="' + esc(j.id) + '" aria-pressed="' + !!picked + '"><span class="name">' + esc(jn(j)) + noteMark(j) + '</span>' + (ph ? '<span class="phase">' + esc(ph) + '</span>' : '') + '</button>' + st + goBtn(j) + '</div></div>';
    }).join('') + '</div>';
  }

  /* ------------------------------------------------------------------ Active jobs (open jobs in the phases an Admin picked) */
  var activeAt = 0;
  function loadActiveJobs(force) {
    if (!force && state.active && Date.now() - activeAt < 120000) return;
    API.call('phaseJobs', { fresh: force || takeFresh('active') }).then(function (r) { state.active = r.jobs || []; activeAt = Date.now(); renderActiveJobs(); renderMyJobs(); })
      .catch(function (e) { if (e && e.code === 'auth') return handleError(e); state.active = state.active || []; state.activeFailed = true; renderActiveJobs(); });
  }
  // Work orders have their own list, so they are left out of Active jobs.
  function woIds() { var o = {}; (state.wo || []).forEach(function (j) { o[j.id] = true; }); return o; }
  function renderActiveJobs() {
    var box = $('#activeJobs'); if (!box) return;
    var wo = woIds(), list = state.active && state.active.filter(function (j) { return !wo[j.id]; });
    setCount('#activeCnt', state.activeFailed ? null : list);
    if (!list) { box.innerHTML = '<p class="small muted">Loading jobs...</p>'; return; }
    if (!list.length) { box.innerHTML = '<p class="small muted">' + (state.activeFailed ? 'Could not load the job list.' : 'No jobs in the chosen phases.') + '</p>'; return; }
    statusFilter('active', list);
    var shown = listFilter('active', list);
    box.innerHTML = shown.length ? jobListHtml(shown) : noMatch('active');
  }
  var woAt = 0;
  function loadWoJobs(force) {
    if (!force && state.wo && Date.now() - woAt < 120000) return;
    API.call('woJobs', { fresh: force || takeFresh('wo') }).then(function (r) { state.wo = r.jobs || []; if (r.statusOptions) state.statusOptions = r.statusOptions; woAt = Date.now(); state.woFailed = false; renderWoJobs(); renderActiveJobs(); renderMyJobs(); })
      .catch(function (e) { if (e && e.code === 'auth') return handleError(e); state.wo = state.wo || []; state.woFailed = true; renderWoJobs(); });
  }
  function renderWoJobs() {
    var box = $('#woJobs'); if (!box) return;
    setCount('#woCnt', state.woFailed ? null : state.wo);
    if (!state.wo) { box.innerHTML = '<p class="small muted">Loading work orders...</p>'; return; }
    if (!state.wo.length) { box.innerHTML = '<p class="small muted">' + (state.woFailed ? 'Could not load the work orders. If this stays, the latest Code.gs is not deployed yet.' : 'No open work orders.') + '</p>'; return; }
    statusFilter('wo', state.wo);
    var shown = listFilter('wo', state.wo);
    box.innerHTML = shown.length ? jobListHtml(shown, { byStatus: true }) : noMatch('wo');
  }
  function setCount(sel, list) { var el = $(sel); if (el) el.textContent = list ? '(' + list.length + ')' : ''; }
  // Who may change a job's Status here: the "status" switch (Admin screen) and a working JobTread key.
  function canStatus() { return !!(state.perms && state.perms.status === true && canWrite() && (state.statusOptions || []).length); }
  // Order by JobTread's Status order (A New Lead first), then by address.
  function byStatus(list) { return sortJobs(list, true); }
  function jobListHtml(list, opts) {
    var edit = canStatus();
    return '<div class="results">' + ((opts && opts.byStatus) ? byStatus(list) : sortMyJobs(list)).map(function (j) {
      var picked = state.pickedJob && state.pickedJob.id === j.id;
      var st = stBubble(j, edit), mine = !!st;
      return '<div class="jobrow hasgo' + (mine ? ' hasst' : '') + '">' + starBtn(j) + '<div class="jobcell"><button class="job' + (picked ? ' picked' : '') + '" data-act="pick" data-id="' + esc(j.id) + '" aria-pressed="' + !!picked + '">' +
        '<span class="name">' + esc(jn(j)) + noteMark(j) + '</span><span class="phase">' + esc(j.phase || '') + '</span></button>' + st + goBtn(j) + '</div></div>';
    }).join('') + '</div>';
  }
  // Only the Statuses an Admin allowed this person; a job outside them (or with no known Status) gets no picker.
  // A small ▾ bubble on the job card opens the Status list (a real, invisible <select> sits on top of it).
  function stBubble(j, edit) {
    var ph = phaseOf(j), allow = state.statusAllowed;
    if (!edit || !ph || (allow && allow.indexOf(ph) < 0)) return '';
    var opts = state.statusOptions.filter(function (o) { return !allow || allow.indexOf(o) > -1; });
    return '<span class="stbub" title="Change Status">\u25be<select class="stsel" data-id="' + esc(j.id) + '" aria-label="Change Status of ' + esc(jn(j)) + '">' +
      opts.map(function (o) { return '<option' + (o === ph ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
      (opts.indexOf(ph) < 0 ? '<option selected>' + esc(ph) + '</option>' : '') + '</select></span>';
  }
  // → on a job: pick it and open the Action menu straight away.
  function goBtn(j) { return '<button class="gobtn" data-act="goAct" data-id="' + esc(j.id) + '" title="Actions for this job" aria-label="Actions for ' + esc(jn(j)) + '">&#8594;</button>'; }
  function allKnownJobs() { return state.jobs.concat(state.myJobs, state.active || [], state.wo || [], state.temps || []); }
  function pickJob(id) {
    var pj = allKnownJobs().filter(function (j) { return j.id === id; })[0] || null;
    if (pj) pj = pj.temp ? pj : { id: pj.id, name: pj.name };
    state.pickedJob = pj;
    renderResults(); renderMyJobs(); renderActiveJobs(); renderWoJobs(); renderTemps(); renderActions();
  }
  function changeStatus(sel) {
    var id = sel.dataset.id, to = sel.value;
    var j = (state.wo || []).concat(state.active || [], state.jobs || []).filter(function (x) { return x.id === id; })[0];
    if (!j || j.phase === to) return;
    if (!confirm('Change the JobTread Status of\n' + jn(j) + '\n\nfrom "' + (j.phase || 'none') + '" to "' + to + '"?')) { sel.value = j.phase; return; }
    sel.disabled = true;
    API.call('setJobStatus', { jobId: id, status: to }).then(function (r) {
      (state.wo || []).concat(state.active || [], state.jobs || []).forEach(function (x) { if (x.id === id) x.phase = r.status; });
      toast('Status changed to ' + r.status + '.');
      renderResults(); renderWoJobs(); renderActiveJobs(); renderMyJobs(); loadActiveJobs(true);
    }).catch(function (e) { sel.disabled = false; sel.value = j.phase; handleError(e); });
  }

  /* ------------------------------------------------------------------ pull photos */
  function pullPhotos() { if (state.pickedJob) pullJob(state.pickedJob); }

  function pullJob(job) {
    overlay(true, 'Pulling photos...', 3);
    var all = [], page = null;
    function next() {
      return API.call('listPhotos', { jobId: job.id, page: page }).then(function (r) {
        if (!job.name && r.jobName) job.name = r.jobName;
        all = all.concat(r.files); page = r.nextPage;
        overlay(true, 'Pulled ' + all.length + ' of ' + r.count + ' photos...', r.count ? (all.length / r.count) * 100 : 100);
        if (page && all.length < 1500) return next();
      });
    }
    next().then(function () {
      overlay(false);
      if (!all.length) { toast('No photos found in this job\'s JobTread files yet.'); return; }
      openEditor(job, all);
    }).catch(function (e) { overlay(false); handleError(e); });
  }

  /* ------------------------------------------------------------------ editor */
  // Drafts belong to the person signed in, so a shared iPad never shows someone else's report or name.
  function draftKey() { return 'hci_pr_draft_' + ((state.user && state.user.email) || '').toLowerCase() + '_' + state.job.id; }
  function legacyDraftKey() { return 'hci_pr_draft_' + state.job.id; }

  function openEditor(job, files) {
    state.job = { id: job.id, name: job.name };
    state.files = files; state.byId = {}; files.forEach(function (f) { state.byId[f.id] = f; });
    state.selected = []; state.sortDesc = true; state.pdf = null; state.saved = false; state.replacing = null;
    state.sections = []; state.entries = {}; state.legacyDraft = false;
    state.report = {
      title: jn(job) + ' Photo Report',
      author: state.user ? titleCase(state.user.name) : '',
      dateText: fmtToday(),
      layout: 'stack'
    };
    try {
      var d = JSON.parse(localStorage.getItem(draftKey()) || 'null'), legacy = false;
      // A draft from before drafts were per person: keep its photos, but not the name in Prepared by.
      if (!d) { d = JSON.parse(localStorage.getItem(legacyDraftKey()) || 'null'); legacy = !!d; }
      state.legacyDraft = legacy;
      if (d && d.sections) {
        state.sections = d.sections.map(function (s) {
          return { title: s.title || '', note: s.note || '', fids: (s.fids || []).filter(function (id) { return state.byId[id]; }) };
        });
        state.entries = d.entries || {};
        if (d.report) { state.report.title = d.report.title || state.report.title; if (!legacy) state.report.author = d.report.author || state.report.author; }
        var wasSide = (d.report && d.report.layout === 'side') || (!(d.report && d.report.layout) && d.sections.some(function (x) { return x.layout === 'side'; }));
        state.report.layout = wasSide ? 'side' : 'stack';
        if (state.sections.length) setTimeout(function () { toast('Restored your unfinished report for this job.'); }, 300);
      }
    } catch (e) { /* ignore bad draft */ }
    if (!state.sections.length) state.sections = [newSection()];
    state.activeSec = state.sections[state.sections.length - 1]; state.addNew = false;
    go('editor');
  }

  function newSection() { return { title: '', note: '', fids: [] }; }
  // The "active" section is where the + button and Add put photos. Tapping anywhere in a section makes it active.
  function activeIdx() {
    var i = state.sections.indexOf(state.activeSec);
    return i > -1 ? i : state.sections.length - 1;
  }
  function setActive(si) {
    var sec = state.sections[si]; if (!sec) return;
    state.activeSec = sec; state.addNew = false;
    $$('#sections .sec').forEach(function (el) { el.classList.toggle('active', Number(el.dataset.sec) === si); });
    var sel = $('#targetSec'); if (sel) sel.value = String(si);
  }
  // A new report photo starts with the comment it was uploaded with, if any.
  function entry(fid) { return state.entries[fid] || (state.entries[fid] = { label: '', caption: (state.byId[fid] && state.byId[fid].note) || '' }); }
  // The label dropdown: Before Photo, After Photo, or Other (free text).
  function labelMode(e) {
    if (e.label === 'Before Photo' || e.label === 'After Photo') return e.label;
    return (e.other || e.label) ? '__other' : '';
  }
  function usedSet() { var s = {}; state.sections.forEach(function (sec) { sec.fids.forEach(function (f) { s[f] = true; }); }); return s; }
  function photoTotal() { return state.sections.reduce(function (n, s) { return n + s.fids.length; }, 0); }

  var saveTimer;
  function flushDraft() {
    clearTimeout(saveTimer);
    if (!state.job) return;
    try {
      localStorage.setItem(draftKey(), JSON.stringify({ sections: state.sections, entries: state.entries, report: state.report }));
      // The old shared draft now lives under this person's name, so it moves rather than showing for everyone.
      if (state.legacyDraft) { localStorage.removeItem(legacyDraftKey()); state.legacyDraft = false; }
    } catch (e) { /* storage full */ }
  }
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushDraft, 400);
  }

  // Reload the newest version of the app. In the editor it comes back to the same job with the draft restored.
  function refreshApp() {
    if (state.view === 'upload' && pendingCount() && !confirm('Some photos are not uploaded yet. Reload anyway and lose them?')) return;
    var inJob = state.job && (state.view === 'editor' || state.view === 'result');
    if (inJob) flushDraft();
    location.href = location.pathname + '?r=' + Date.now() + (inJob ? '&job=' + encodeURIComponent(state.job.id) : '');
  }

  // Share the app's link (share sheet on iPad/phone, otherwise copy to the clipboard). Only the link is shared,
// never a sign-in; the other person signs in with their own work email.
function appLink() { return location.origin + location.pathname; }
function shareApp() {
  var url = appLink(), text = 'HCI App - sign in with your work email: ' + url;
  if (navigator.share) {
    navigator.share({ title: 'HCI App', text: 'Sign in with your work email.', url: url })
      .catch(function (e) { if (e && e.name !== 'AbortError') copyLink(url); });
    return;
  }
  copyLink(url, text);
}
function copyLink(url) {
  var done = function () { toast('Link copied: ' + url); };
  var fail = function () { window.prompt('Copy this link:', url); };
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, fail);
  else fail();
}

function renderEditor() {
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="backToSearch">&larr; Jobs</button>' +
      '<div class="grow"><div class="title">' + esc(jn(state.job)) + '</div></div>' +
      '<span class="small muted">' + state.files.length + ' photos</span>' + starBtn(state.job) +
      (can('files') ? '<button class="btn small" data-act="editorFiles">Files</button>' : '') +
      settingsMenu() + '</header>' +
      '<div class="editor">' +
      '<section class="panel" aria-label="Photos"><header><h2 class="grow">Photos</h2>' +
      groupSwitch('groupLib') +
      '<button class="btn small" data-act="toggleSort">' + (state.sortDesc ? 'Newest first' : 'Oldest first') + '</button>' +
      '<button class="btn small" data-act="clearSel"><span class="long">Clear selection</span><span class="short">Clear</span></button></header>' +
      '<div class="lib" id="lib"></div>' +
      '<div class="addbar"><span id="selCount" class="small muted">Tap + to add a photo to the highlighted section.</span>' +
      '<label class="small muted" for="targetSec">Add to</label><select id="targetSec" aria-label="Add to section"></select>' +
      '<button class="btn small primary" data-act="addSel" id="addSelBtn">Add</button>' +
      '<button class="btn small" data-act="addPair" id="addPairBtn">Before + After</button>' +
      '<button class="btn small cancel-swap" data-act="cancelSwap" id="cancelSwapBtn" hidden>Cancel</button></div></section>' +
      '<section class="panel" aria-label="Report"><header><h2 class="grow">Report</h2>' +
      '<button class="btn small" data-act="addSection">+ Section</button></header>' +
      '<div class="rep-scroll"><div class="fields">' +
      '<label for="repTitle">Report title</label><input id="repTitle" value="' + esc(state.report.title) + '">' +
      '<label for="repAuthor">Prepared by</label><input id="repAuthor" value="' + esc(state.report.author) + '">' +
      '<div class="sec-layout" role="group" aria-label="Photo layout in the PDF"><span class="lab">PDF layout</span>' +
      layoutBtn('side', 'Side by side') + layoutBtn('stack', 'Stacked') + '</div></div>' +
      '<div id="sections"></div></div>' +
      '<div class="reportbar"><button class="btn primary" data-act="generate" id="genBtn">Generate PDF</button></div></section>' +
      '</div><datalist id="labels">' + LABELS.map(function (l) { return '<option value="' + esc(l) + '">'; }).join('') + '</datalist>';
    renderLibrary(); renderSections(); refreshBars();
  }

  function layoutBtn(v, text) {
    var on = (state.report.layout === 'side') === (v === 'side');
    return '<button class="seg' + (on ? ' on' : '') + '" data-act="setLayout" data-layout="' + v + '" aria-pressed="' + on + '"><i class="lay-ic ' + v + '"></i>' + text + '</button>';
  }

  // One switch for the whole report: every section uses the same PDF layout.
  function setLayout(v) {
    state.report.layout = v === 'side' ? 'side' : 'stack';
    $$('.sec-layout .seg').forEach(function (b) {
      var on = b.dataset.layout === state.report.layout;
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
    });
    renderSections(); changed();
  }

  function sortedFiles() {
    return state.files.slice().sort(function (a, b) {
      return state.sortDesc ? (a.createdAt < b.createdAt ? 1 : -1) : (a.createdAt < b.createdAt ? -1 : 1);
    });
  }

  // Grouping for photo grids: by day (default) or by JobTread file tag. A photo with several tags is shown under its
  // first tag in the company's usual order (Pre-construction, Demolition, In Progress ...); untagged photos come last.
  function primaryTag(f) {
    var tags = (f.tags || []).slice();
    if (!tags.length) return '';
    tags.sort(function (a, b) {
      var pa = PRIORITY_TAGS.indexOf(a), pb = PRIORITY_TAGS.indexOf(b);
      if (pa < 0) pa = 99; if (pb < 0) pb = 99;
      return pa - pb || a.localeCompare(b);
    });
    return tags[0];
  }
  function tagRank(t) { if (!t) return 1000; var i = PRIORITY_TAGS.indexOf(t); return i < 0 ? 100 : i; }
  // Returns [{ key, label, files }] in display order; files inside a group keep the date order passed in.
  function groupPhotos(files, by) {
    var groups = [], idx = {};
    files.forEach(function (f) {
      var key = by === 'tag' ? primaryTag(f) : dayKey(f.createdAt);
      if (!Object.prototype.hasOwnProperty.call(idx, key)) {
        idx[key] = groups.length;
        groups.push({ key: key, label: by === 'tag' ? (key || 'No tag') : fmtDay(f.createdAt), files: [] });
      }
      groups[idx[key]].files.push(f);
    });
    if (by === 'tag') groups.sort(function (a, b) { return tagRank(a.key) - tagRank(b.key) || a.key.localeCompare(b.key); });
    return groups;
  }
  function groupSwitch(act) {
    var tag = state.groupBy === 'tag';
    return '<div class="seggrp" role="group" aria-label="Group photos by"><button class="seg' + (tag ? '' : ' on') + '" data-act="' + act + '" data-by="date" aria-pressed="' + !tag + '">By date</button>' +
      '<button class="seg' + (tag ? ' on' : '') + '" data-act="' + act + '" data-by="tag" aria-pressed="' + tag + '">By tag</button></div>';
  }
  function headHtml(g) {
    return '<div class="day' + (state.groupBy === 'tag' ? ' taghead' : '') + '">' + esc(g.label) + '<span>' + g.files.length + ' photo' + (g.files.length === 1 ? '' : 's') + '</span></div>';
  }

  function renderLibrary() {
    var lib = $('#lib'); if (!lib) return;
    var used = usedSet();
    var tagMode = state.groupBy === 'tag';
    lib.innerHTML = groupPhotos(sortedFiles(), state.groupBy).map(function (g) { return headHtml(g) + g.files.map(function (f) {
      var idx = state.selected.indexOf(f.id);
      return '<div class="ph' + (idx > -1 ? ' sel' : '') + (used[f.id] ? ' in-report' : '') + (f.local ? ' local' : '') + '" data-fid="' + esc(f.id) + '" data-act="toggle">' +
        '<img loading="lazy" src="' + esc(f.thumb) + '" alt="' + esc(f.name) + '">' +
        '<span class="num">' + (idx > -1 ? idx + 1 : '') + '</span><span class="used">In report</span>' + (f.local ? '<span class="notjt">Not in JobTread yet</span>' : '') +
        '<button class="add1" data-act="addOne" aria-label="Add this photo to the report">+</button>' +
        '<button class="zoom" data-act="zoom" aria-label="Enlarge">&#10530;</button>' +
        '<span class="when">' + esc(fmtShort(f.createdAt)) + '</span></div>';
    }).join(''); }).join('');
    var s = Sortable.create(lib, {
      group: { name: 'photos', pull: 'clone', put: false }, sort: false, animation: 150, draggable: '.ph',
      delay: 160, delayOnTouchOnly: true, filter: '.zoom, .add1', preventOnFilter: false, onEnd: onLibEnd
    });
    sortables.push(s);
  }

  function renderSections() {
    var box = $('#sections'); if (!box) return;
    sortables = sortables.filter(function (s) {
      if (s.el && s.el.classList && s.el.classList.contains('sec-list')) { s.destroy(); return false; }
      return true;
    });
    box.innerHTML = state.sections.map(function (sec, si) {
      var side = state.report.layout === 'side';
      return '<div class="sec' + (si === activeIdx() ? ' active' : '') + '" data-sec="' + si + '">' +
        '<div class="sec-head"><input class="sec-title" data-si="' + si + '" placeholder="Section ' + (si + 1) + '" value="' + esc(sec.title) + '" aria-label="Section title">' +
        '<div class="tools"><span class="here">Adding here</span><button class="icon-btn" data-act="secUp" data-si="' + si + '" aria-label="Move up">&uarr;</button>' +
        '<button class="icon-btn" data-act="secDown" data-si="' + si + '" aria-label="Move down">&darr;</button>' +
        '<button class="icon-btn" data-act="secDel" data-si="' + si + '" aria-label="Delete section">&times;</button></div></div>' +
        '<div class="sec-note"><input class="sec-note-in" data-si="' + si + '" placeholder="Description (optional)" value="' + esc(sec.note) + '" aria-label="Section description"></div>' +
        '<ul class="sec-list' + (side ? ' side' : '') + '" data-sec="' + si + '">' + sec.fids.map(rowHtml).join('') + '</ul>' +
        (canShoot() ? '<div class="sec-add"><label class="btn small pick cam sec-cam" title="Take or choose a photo and add it to this section"><span>+ &#128247; Add photo to this section</span><input type="file" class="camSec" data-si="' + si + '" accept="image/*"></label></div>' : '') +
        '</div>';
    }).join('');
    $$('.sec-list', box).forEach(function (ul) {
      sortables.push(Sortable.create(ul, {
        group: { name: 'photos', pull: true, put: true }, animation: 150, handle: '.thumb',
        delay: 120, delayOnTouchOnly: true, ghostClass: 'sortable-ghost',
        onAdd: onListAdd, onUpdate: syncFromDom, onEnd: onRowEnd
      }));
    });
    refreshTargets();
  }

  // Camera controls inside the report are only shown when this person may upload to JobTread.
  function canShoot() { return can('upload') && canWrite(); }

  function rowHtml(fid) {
    var f = state.byId[fid]; if (!f) return '';
    var e = entry(fid);
    var mode = labelMode(e);
    // Replace menu: from the job's JobTread photos, a new picture, or a picture already on this device.
    var swapMenu = '<div class="swapmenu" hidden>' +
      '<button class="swapopt" data-act="swap" data-fid="' + esc(fid) + '">&#8646; From job photos (JobTread)</button>' +
      (canShoot() ? '<label class="swapopt"><span>&#128247; Take a new photo</span><input type="file" class="camSlot" data-fid="' + esc(fid) + '" accept="image/*" capture="environment"></label>' +
                    '<label class="swapopt"><span>&#128444; Choose from my photos</span><input type="file" class="camSlot" data-fid="' + esc(fid) + '" accept="image/*"></label>' : '') +
      '</div>';
    return '<li class="row' + (state.replacing === fid ? ' replacing' : '') + '" data-fid="' + esc(fid) + '">' +
      '<img class="thumb" src="' + esc(f.thumb) + '" alt="">' +
      '<div class="meta"><div class="slot"></div><select class="lbl-sel" data-fid="' + esc(fid) + '" aria-label="Photo label">' +
      '<option value=""' + (mode === '' ? ' selected' : '') + '>Label: choose...</option>' +
      '<option value="Before Photo"' + (mode === 'Before Photo' ? ' selected' : '') + '>Before Photo</option>' +
      '<option value="After Photo"' + (mode === 'After Photo' ? ' selected' : '') + '>After Photo</option>' +
      '<option value="__other"' + (mode === '__other' ? ' selected' : '') + '>Other (type your own)</option></select>' +
      '<input class="lbl" data-fid="' + esc(fid) + '" placeholder="Type your label"' + (mode === '__other' ? '' : ' hidden') + ' value="' + esc(e.label) + '" aria-label="Custom label">' +
      '<textarea class="cap" data-fid="' + esc(fid) + '" placeholder="Caption (optional)" aria-label="Caption">' + esc(e.caption) + '</textarea>' +
      '<div class="sub">' + esc(fmtDateTime(f.createdAt)) + (f.by ? ' &middot; ' + esc(f.by) : '') + (f.local ? ' &middot; <b class="notjt-txt">not in JobTread yet</b>' : '') + '</div></div>' +
      '<div class="rowbtns"><button class="icon-btn rm" data-act="rm" data-fid="' + esc(fid) + '" aria-label="Remove photo" title="Remove from the report">&times;</button>' +
      '<button class="icon-btn swap" data-act="swapMenu" data-fid="' + esc(fid) + '" aria-label="Replace this photo" aria-haspopup="menu" title="Replace photo">&#8646;</button>' + swapMenu + '</div></li>';
  }
  function toggleSwapMenu(btn) {
    var m = btn.parentNode.querySelector('.swapmenu'); if (!m) return;
    var open = m.hidden; closeMenus(); m.hidden = !open;
  }

  function refreshTargets() {
    var sel = $('#targetSec'); if (!sel) return;
    sel.innerHTML = state.sections.map(function (s, i) {
      return '<option value="' + i + '">' + esc(s.title || 'Section ' + (i + 1)) + '</option>';
    }).join('') + '<option value="new">New section</option>';
    sel.value = state.addNew ? 'new' : String(activeIdx());
  }

  function refreshBars() {
    if (state.replacing && !usedSet()[state.replacing]) state.replacing = null;
    var n = state.selected.length, rp = !!state.replacing;
    var c = $('#selCount');
    if (c) c.textContent = rp ? 'Replacing a photo: tap + on the new photo.' : n ? n + ' selected' : 'Tap + to add a photo to the highlighted section.';
    var lib = $('#lib'); if (lib) lib.classList.toggle('picking', rp);
    var cs = $('#cancelSwapBtn'); if (cs) cs.hidden = !rp;
    var ab = $('#addSelBtn'); if (ab) ab.hidden = rp;
    var pb = $('#addPairBtn'); if (pb) pb.hidden = rp;
    var a = $('#addSelBtn'); if (a) { a.disabled = !n; a.textContent = n ? 'Add ' + n : 'Add'; }
    var p = $('#addPairBtn'); if (p) p.disabled = n !== 2;
    var g = $('#genBtn'); if (g) { var t = photoTotal(); g.disabled = !t; g.textContent = t ? 'Generate PDF (' + t + ' photo' + (t === 1 ? '' : 's') + ')' : 'Generate PDF'; }
  }

  function refreshLibraryMarks() {
    var used = usedSet();
    $$('#lib .ph').forEach(function (el) {
      var fid = el.dataset.fid, idx = state.selected.indexOf(fid);
      el.classList.toggle('sel', idx > -1);
      el.classList.toggle('in-report', !!used[fid]);
      var num = $('.num', el); if (num) num.textContent = idx > -1 ? idx + 1 : '';
    });
  }

  function changed() { pruneLocal(); refreshLibraryMarks(); refreshBars(); refreshTargets(); saveDraft(); }
  // A device photo that is no longer in the report has nowhere else to live (it was never sent to JobTread), so it goes.
  function pruneLocal() {
    var used = usedSet(), gone = false;
    state.files = state.files.filter(function (f) {
      if (!f.local || used[f.id]) return true;
      try { URL.revokeObjectURL(f.thumb); } catch (e) { /* ignore */ }
      delete state.byId[f.id]; delete state.entries[f.id]; gone = true; return false;
    });
    if (gone) { state.selected = state.selected.filter(function (id) { return state.byId[id]; }); renderLibrary(); }
  }

  // Drop from the photo library into a section.
  function onListAdd(evt) {
    var fid = evt.item.dataset.fid;
    var fromSection = evt.from && evt.from.classList && evt.from.classList.contains('sec-list');
    var already = usedSet()[fid];
    // A photo dragged from another section is a move. Only a library photo that is already in the report is refused.
    if (already && !fromSection) { evt.item.remove(); toast('That photo is already in the report.'); return; }
    var dropped = state.sections[Number(evt.to.dataset.sec)]; if (dropped) { state.activeSec = dropped; state.addNew = false; }
    syncFromDom();
  }

  // The whole section box is a drop target, not only the thin photo list inside it. When a drag ends anywhere
  // over a section (its title, description, empty space, the add button), the photo goes into that section.
  function dropPoint(evt) {
    var e = evt && evt.originalEvent; if (!e) return null;
    var t = (e.changedTouches && e.changedTouches[0]) || (e.touches && e.touches[0]) || e;
    return typeof t.clientX === 'number' ? { x: t.clientX, y: t.clientY } : null;
  }
  function sectionAtPoint(p) {
    if (!p) return -1;
    var el = document.elementFromPoint(p.x, p.y);
    var sec = el && el.closest ? el.closest('#sections .sec') : null;
    return sec ? Number(sec.dataset.sec) : -1;
  }
  // A row dragged out of its list and let go somewhere else on a section: move it there (to the end).
  function onRowEnd(evt) {
    if (evt.to !== evt.from) return; // landed in another list: onAdd already handled it
    var fid = evt.item.dataset.fid, fromSi = Number(evt.from.dataset.sec);
    var si = sectionAtPoint(dropPoint(evt));
    if (si < 0 || si === fromSi || !state.sections[si]) return;
    var from = state.sections[fromSi], i = from ? from.fids.indexOf(fid) : -1;
    if (i > -1) from.fids.splice(i, 1);
    state.sections[si].fids.push(fid); entry(fid);
    state.activeSec = state.sections[si]; state.addNew = false;
    renderSections(); changed(); revealRow(fid);
    toast('Moved to ' + (state.sections[si].title || 'Section ' + (si + 1)) + '.');
  }
  // A library photo let go over a section but not exactly on its list: add it there.
  function onLibEnd(evt) {
    if (evt.to !== evt.from) return;
    var si = sectionAtPoint(dropPoint(evt));
    if (si < 0) return;
    addToSection([evt.item.dataset.fid], String(si));
  }
  window.__dropTest = { onRowEnd: onRowEnd, onLibEnd: onLibEnd };

  // Rebuild the sections from what is on screen (after drag and drop).
  function syncFromDom() {
    var seen = {};
    $$('.sec-list').forEach(function (ul) {
      var si = Number(ul.dataset.sec), fids = [];
      $$(':scope > [data-fid]', ul).forEach(function (li) {
        var fid = li.dataset.fid;
        if (seen[fid] || !state.byId[fid]) return;
        seen[fid] = true; fids.push(fid); entry(fid);
      });
      state.sections[si].fids = fids;
    });
    renderSections(); changed();
  }

  function addToSection(fids, target) {
    var used = usedSet(), add = fids.filter(function (f) { return !used[f]; });
    if (!add.length) { toast('Those photos are already in the report.'); return; }
    var si;
    if (target === 'new') { state.sections.push(newSection()); si = state.sections.length - 1; }
    else si = Math.max(0, Math.min(state.sections.length - 1, Number(target) || 0));
    state.activeSec = state.sections[si]; state.addNew = false;
    add.forEach(function (f) { entry(f); state.sections[si].fids.push(f); });
    state.selected = state.selected.filter(function (f) { return add.indexOf(f) === -1; });
    renderSections(); changed();
    revealRow(add[add.length - 1]);
    toast('Added ' + add.length + ' photo' + (add.length === 1 ? '' : 's') + ' to ' + (state.sections[si].title || 'Section ' + (si + 1)) + '.');
  }

  // A photo taken or chosen on this device goes straight into the report. It is NOT sent to JobTread yet:
  // when the PDF is generated the person is asked whether to upload these new photos to the job.
  var localSeq = 0;
  function shootIntoReport(file, target, replaceFid) {
    if (!state.job) return;
    if (target === undefined || target === null) target = $('#targetSec') ? $('#targetSec').value : String(activeIdx());
    overlay(true, 'Preparing photo...', 30);
    compressImage(file).then(function (r) {
      overlay(false);
      var id = 'local_' + (++localSeq) + '_' + Date.now();
      var f = { id: id, name: 'Photo ' + stampFor(Date.now()) + '.jpg', createdAt: new Date().toISOString(), folder: 'Photos',
                note: '', by: state.user ? titleCase(state.user.name) : '', tags: [], thumb: URL.createObjectURL(r.blob), local: true, blob: r.blob };
      state.files.unshift(f); state.byId[f.id] = f;
      renderLibrary();
      if (replaceFid && usedSet()[replaceFid]) replacePhoto(replaceFid, f.id);
      else addToSection([f.id], target);
      toast('Photo added. You will be asked to save it to JobTread when you generate the PDF.');
    }).catch(function (e) { overlay(false); handleError(e); });
  }
  // Photos in the report that only exist on this device so far.
  function localInReport() {
    var out = [];
    state.sections.forEach(function (sec) { sec.fids.forEach(function (fid) { var f = state.byId[fid]; if (f && f.local) out.push(fid); }); });
    return out;
  }
  // Send the device photos in the report to the job in JobTread, then swap their ids for the JobTread file ids
  // (labels and captions stay). Returns a promise.
  function uploadLocalPhotos(fids) {
    var n = 0;
    return fids.reduce(function (chain, fid) {
      return chain.then(function () {
        var f = state.byId[fid]; if (!f || !f.local) return;
        overlay(true, 'Saving photo ' + (++n) + ' of ' + fids.length + ' to JobTread...', (n - 1) / fids.length * 100);
        return blobToB64(f.blob).then(function (b64) {
          return API.call('uploadFile', { jobId: state.job.id, name: f.name.replace(/\.jpg$/, ''), base64: b64, note: '', tagIds: [], folder: '' });
        }).then(function (res) {
          var nf = res.file; if (!nf || !nf.id) return;
          if (!nf.thumb) nf.thumb = f.thumb; // keep the device preview until JobTread has a thumbnail
          state.byId[nf.id] = nf;
          var i = state.files.indexOf(f); if (i > -1) state.files[i] = nf; else state.files.unshift(nf);
          delete state.byId[fid];
          state.sections.forEach(function (sec) { var k = sec.fids.indexOf(fid); if (k > -1) sec.fids[k] = nf.id; });
          if (state.entries[fid]) { state.entries[nf.id] = state.entries[fid]; delete state.entries[fid]; }
          state.selected = state.selected.filter(function (x) { return x !== fid; });
        });
      });
    }, Promise.resolve()).then(function () { renderLibrary(); renderSections(); changed(); });
  }

  // Bring a section to the middle of the report area (its own scroll box on the upright screen, the page otherwise).
  // A section taller than the area is lined up by its top so the title stays visible.
  function centerSection(si) {
    var el = $('#sections .sec[data-sec="' + si + '"]'); if (!el) return;
    var sc = $('.rep-scroll');
    var portrait = window.matchMedia && window.matchMedia('(orientation: portrait)').matches;
    if (portrait && sc) {
      var c = sc.getBoundingClientRect(), r = el.getBoundingClientRect();
      var top = r.height >= c.height - 16 ? sc.scrollTop + (r.top - c.top) - 8
                                           : sc.scrollTop + (r.top + r.height / 2) - (c.top + c.height / 2);
      sc.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    } else if (el.scrollIntoView) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }

  // In the stacked (portrait) screen the report half scrolls on its own, so bring the new row into view there.
  function revealRow(fid) {
    if (!window.matchMedia || !window.matchMedia('(orientation: portrait)').matches) return;
    var row = $('#sections .row[data-fid="' + fid + '"]');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest' });
  }

  // Swap one photo in a section for another from the library. The slot (position, label, caption) stays.
  function replacePhoto(oldFid, newFid) {
    if (usedSet()[newFid]) { toast('That photo is already in the report. Pick a different one.'); return; }
    var done = false;
    state.sections.forEach(function (sec) {
      var i = sec.fids.indexOf(oldFid);
      if (i === -1 || done) return;
      sec.fids[i] = newFid; done = true;
      state.activeSec = sec;
      var o = entry(oldFid), e = entry(newFid);
      e.label = o.label; e.other = o.other; e.caption = o.caption;
    });
    state.replacing = null;
    state.selected = state.selected.filter(function (f) { return f !== newFid; });
    renderSections(); changed();
    var row = $('#sections .row[data-fid="' + newFid + '"]');
    if (row && row.scrollIntoView) row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    toast(done ? 'Photo replaced. The label and caption were kept.' : 'Could not find that photo.');
  }

  function addPair() {
    if (state.selected.length !== 2) return;
    var a = state.selected[0], b = state.selected[1];
    var used = usedSet();
    if (used[a] || used[b]) { toast('One of those photos is already in the report.'); return; }
    state.sections.push({ title: '', note: '', fids: [a, b] });
    state.activeSec = state.sections[state.sections.length - 1]; state.addNew = false;
    entry(a).label = 'Before Photo'; entry(a).other = false; entry(b).label = 'After Photo'; entry(b).other = false;
    state.selected = [];
    renderSections(); changed();
    toast('Added as Before + After (first photo you tapped = Before).');
  }

  function removeSection(si) {
    var s = state.sections[si];
    if (s.fids.length && !confirm('Remove this section and its ' + s.fids.length + ' photo(s) from the report? The photos stay in JobTread.')) return;
    state.sections.splice(si, 1);
    if (!state.sections.length) state.sections.push(newSection());
    if (state.activeSec === s) state.activeSec = state.sections[Math.min(si, state.sections.length - 1)];
    renderSections(); changed();
  }

  function moveSection(si, d) {
    var j = si + d; if (j < 0 || j >= state.sections.length) return;
    var t = state.sections[si]; state.sections[si] = state.sections[j]; state.sections[j] = t;
    renderSections(); changed();
  }

  function showPreview(fid) {
    var f = state.byId[fid]; if (!f) return;
    $('#preview-img').src = f.thumb.replace(/size=\d+/, 'size=1024');
    $('#preview').hidden = false;
  }

  /* ------------------------------------------------------------------ PDF generation */
  var directBlocked = false;

  function blobToJpeg(blob) {
    var maxEdge = CFG.PDF_IMAGE_EDGE || 1000, q = CFG.PDF_IMAGE_QUALITY || 0.75;
    var make = window.createImageBitmap
      ? createImageBitmap(blob, { imageOrientation: 'from-image' }).catch(function () { return viaImage(blob); })
      : viaImage(blob);
    return make.then(function (bmp) {
      var sc = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
      var w = Math.round(bmp.width * sc), h = Math.round(bmp.height * sc);
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
      return { dataUrl: c.toDataURL('image/jpeg', q), w: w, h: h };
    });
  }
  function viaImage(blob) {
    return new Promise(function (res, rej) {
      var i = new Image(); i.onload = function () { res(i); }; i.onerror = rej; i.src = URL.createObjectURL(blob);
    });
  }
  function b64ToBlob(b64, type) {
    var bin = atob(b64), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: type || 'image/jpeg' });
  }
  function blobToB64(blob) {
    return new Promise(function (res, rej) {
      var fr = new FileReader(); fr.onload = function () { res(String(fr.result).split(',')[1]); }; fr.onerror = rej; fr.readAsDataURL(blob);
    });
  }

  // Try the JobTread image link straight from the browser; if the browser is blocked, go through the backend.
  function fetchPhotoBlob(f) {
    if (f.local && f.blob) return Promise.resolve(f.blob);
    var url = f.thumb.replace(/size=\d+/, 'size=1024');
    var viaBackend = function () {
      return API.call('fetchImage', { fileId: f.id }).then(function (r) { return b64ToBlob(r.base64, r.contentType); });
    };
    if (directBlocked) return viaBackend();
    return fetch(url, { mode: 'cors' }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.blob();
    }).catch(function () { directBlocked = true; return viaBackend(); });
  }

  function loadForPdf(f) {
    var toJpeg = window.__imageToJpeg || blobToJpeg;
    return fetchPhotoBlob(f).then(toJpeg);
  }

  function loadLogo() {
    return fetch('icons/logo.jpg').then(function (r) { return r.blob(); }).then(function (b) {
      return new Promise(function (res, rej) {
        var fr = new FileReader();
        fr.onload = function () { res(String(fr.result)); }; fr.onerror = rej; fr.readAsDataURL(b);
      });
    }).then(function (dataUrl) {
      return new Promise(function (res) {
        var i = new Image();
        i.onload = function () { res({ dataUrl: dataUrl, w: i.naturalWidth || 746, h: i.naturalHeight || 351 }); };
        i.onerror = function () { res({ dataUrl: dataUrl, w: 746, h: 351 }); };
        i.src = dataUrl;
      });
    }).catch(function () { return null; });
  }

  function generate() {
    if (!photoTotal()) return;
    var pending = localInReport();
    if (pending.length && canShoot()) {
      var msg = pending.length === 1 ? 'The report has 1 new photo from this device that is not in JobTread yet.\n\nUpload it to ' + jn(state.job) + ' now?'
                                     : 'The report has ' + pending.length + ' new photos from this device that are not in JobTread yet.\n\nUpload them to ' + jn(state.job) + ' now?';
      if (confirm(msg)) {
        uploadLocalPhotos(pending).then(function () { overlay(false); buildPdf(); })
          .catch(function (e) { overlay(false); handleError(e); renderLibrary(); renderSections(); changed(); });
        return;
      }
    }
    buildPdf();
  }

  function buildPdf() {
    var fids = [];
    state.sections.forEach(function (s) { s.fids.forEach(function (f) { fids.push(f); }); });
    if (!fids.length) return;
    var results = {}, failed = 0, done = 0, idx = 0, CONC = 4;
    overlay(true, 'Preparing photos (0 of ' + fids.length + ')...', 2);

    function worker() {
      if (idx >= fids.length) return Promise.resolve();
      var fid = fids[idx++];
      return loadForPdf(state.byId[fid]).then(function (img) { results[fid] = img; })
        .catch(function (e) { if (e && e.code === 'auth') throw e; failed++; })
        .then(function () {
          done++; overlay(true, 'Preparing photos (' + done + ' of ' + fids.length + ')...', 5 + (done / fids.length) * 85);
          return worker();
        });
    }
    var workers = []; for (var k = 0; k < Math.min(CONC, fids.length); k++) workers.push(worker());

    Promise.all(workers).then(function () {
      overlay(true, 'Building PDF...', 95);
      return loadLogo();
    }).then(function (logo) {
      var data = {
        title: state.report.title, project: jn(state.job), author: state.report.author,
        company: CFG.COMPANY, dateText: state.report.dateText, logo: logo,
        sections: state.sections.map(function (s) {
          return {
            title: s.title, note: s.note, layout: state.report.layout,
            photos: s.fids.map(function (fid) {
              var f = state.byId[fid], e = entry(fid), im = results[fid] || {};
              return { dataUrl: im.dataUrl, w: im.w, h: im.h, label: e.label, caption: e.caption, dateText: fmtDateTime(f.createdAt), creator: f.by };
            })
          };
        })
      };
      var doc = PhotoReportPDF.buildReport(window.jspdf.jsPDF, data);
      var blob = doc.output('blob');
      if (state.pdf && state.pdf.url) URL.revokeObjectURL(state.pdf.url);
      state.pdf = {
        blob: blob, url: URL.createObjectURL(blob), pages: doc.getNumberOfPages(), failed: failed,
        name: safeFileName(state.job.name + ' Photo Report ' + isoToday()) + '.pdf', photos: fids.length
      };
      state.saved = false;
      overlay(false); go('result');
    }).catch(function (e) { overlay(false); handleError(e); });
  }

  /* ------------------------------------------------------------------ result */
  function renderResult() {
    var p = state.pdf;
    var mb = (p.blob.size / 1048576).toFixed(1);
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="backToEditor">&larr; Back to edit</button>' +
      '<div class="grow"><div class="title">' + esc(jn(state.job)) + '</div></div>' +
      settingsMenu() + '</header>' +
      '<main class="page result"><div class="card">' +
      '<h1>Your report is ready</h1>' +
      '<div class="summary"><span>' + p.pages + ' pages</span><span>' + p.photos + ' photos</span><span>' + mb + ' MB</span></div>' +
      (p.failed ? '<div class="warn">' + p.failed + ' photo(s) could not be loaded and show as "Image unavailable". Go back, remove them, or try again.</div>' : '') +
      '<label class="small muted" for="fname">File name</label><input id="fname" value="' + esc(p.name) + '">' +
      '<div class="actions">' +
      '<button class="btn primary" data-act="share">Email / Share</button>' +
      '<a class="btn" style="text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open preview</a>' +
      '<button class="btn" data-act="download">Download</button>' +
      (can('saveJT') ? '<button class="btn" data-act="saveJT" id="saveBtn"' + (state.saved || !canWrite() ? ' disabled' : '') + '>' + (state.saved ? 'Saved to JobTread' : 'Save to JobTread (Reports folder)') + '</button>' + (!canWrite() ? '<p class="small msg">' + esc(writeWhy()) + '</p>' : '') : '') +
      '<button class="btn cancel" data-act="backToEditor">Cancel</button>' +
      '</div><p id="msg" class="msg"></p></div></main>';
  }

  function currentName() {
    var v = ($('#fname') && $('#fname').value || state.pdf.name).trim();
    v = safeFileName(v.replace(/\.pdf$/i, '')) || 'Photo Report';
    return v + '.pdf';
  }

  function doShare() {
    var name = currentName();
    var file = new File([state.pdf.blob], name, { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      navigator.share({ files: [file], title: name }).catch(function (e) { if (e && e.name !== 'AbortError') toast('Could not open the share sheet. Use Download instead.'); });
    } else { doDownload(); toast('Downloaded. Attach it to your email.'); }
  }

  function doDownload() {
    var a = document.createElement('a');
    a.href = state.pdf.url; a.download = currentName(); document.body.appendChild(a); a.click(); a.remove();
  }

  function doSaveJT() {
    var name = currentName();
    overlay(true, 'Saving to JobTread...', 30);
    blobToB64(state.pdf.blob).then(function (b64) {
      overlay(true, 'Saving to JobTread...', 60);
      return API.call('uploadPdf', { jobId: state.job.id, name: name, pdfBase64: b64 });
    }).then(function (r) {
      overlay(false); state.saved = true;
      var b = $('#saveBtn'); if (b) { b.disabled = true; b.textContent = 'Saved to JobTread'; }
      setMsg('Saved in JobTread: ' + jn(state.job) + ' > Files > ' + (r.folder || 'Reports') + ' > ' + r.name, true);
    }).catch(function (e) { overlay(false); handleError(e, $('#msg')); });
  }

  /* ------------------------------------------------------------------ upload from this device */
  // Pick the job, add photos (camera or library), then organize each one (comment, JobTread tags, folder, order) and upload.
  var PRIORITY_TAGS = ['Pre-construction', 'Demolition', 'In Progress', 'Issues', 'Changes', 'Completion', 'Inspection Reports'];
  var MAX_TAGS = 10, MAX_PDF_MB = 15, SEP = '\u001f';
  var prepBusy = false, upSortable = null;

  function newUp(job, from) {
    return { job: job ? { id: job.id, name: job.name } : null, from: from || 'search', q: '', jobs: [], recent: null, seq: 0,
             info: null, items: [], sel: {}, uploaded: 0, busy: false, run: { total: 0, n: 0 }, nextId: 1, sheet: null };
  }
  function upItem(id) { var up = state.up; if (!up) return null; id = Number(id); return up.items.filter(function (i) { return i.id === id; })[0] || null; }
  function isUploadable(i) { return !!i.blob && (i.status === 'ready' || i.status === 'error'); }
  function pendingCount() {
    var up = state.up; if (!up) return 0;
    return up.items.filter(function (i) { return i.status === 'prep' || i.status === 'uploading' || isUploadable(i); }).length;
  }
  function selectedIds() {
    var up = state.up;
    return up.items.filter(function (i) { return up.sel[i.id] && i.status !== 'uploading' && i.status !== 'done'; }).map(function (i) { return i.id; });
  }
  function folderOf(it) { return it.folder || (it.kind === 'pdf' ? 'Reports' : 'Photos'); }
  function folderLabel(raw) { return String(raw || '').split(SEP).join(' / '); }
  function tagName(id) {
    var t = state.up.info && state.up.info.tags.filter(function (x) { return x.id === id; })[0];
    return t ? t.name : 'Tag';
  }
  function freeUp() {
    if (!state.up) return;
    state.up.items.forEach(function (i) { if (i.thumb) { try { URL.revokeObjectURL(i.thumb); } catch (e) { /* gone */ } } });
    state.up = null;
  }

  function openUpload(job, from) {
    var keep = state.up && state.up.items.length && (!job || !state.up.job || state.up.job.id === job.id);
    if (keep) { state.up.from = from; if (job && !state.up.job) state.up.job = { id: job.id, name: job.name }; }
    else { freeUp(); state.up = newUp(job, from); }
    if (!canWrite()) state.up.blocked = writeWhy();
    state.view = 'upload'; render();
    if (state.up.job) loadUploadInfo(); else loadRecent();
  }

  function loadRecent() {
    var up = state.up; if (up.recent) return;
    API.call('recentJobs').then(function (r) { up.recent = r.jobs; paintJobResults(); })
      .catch(function (e) { up.recent = []; paintJobResults(); handleError(e); });
  }

  function loadUploadInfo() {
    var up = state.up, jid = up.job.id;
    if (up.info && up.info.jobId === jid) return;
    API.call('uploadInfo', { jobId: jid }).then(function (r) {
      if (!state.up || !state.up.job || state.up.job.id !== jid) return;
      r.jobId = jid; state.up.info = r;
      if (!state.up.job.name && r.jobName) { state.up.job.name = r.jobName; paintJob(); }
      paintList();
    }).catch(function (e) {
      if (e && e.code === 'auth') return handleError(e);
      if (!state.up) return;
      if (e && (e.code === 'forbidden' || e.code === 'bad_request')) { state.up.blocked = e.message || 'Uploading is not allowed for you.'; paintBar(); return; }
      state.up.info = { jobId: jid, tags: [], folders: ['Photos', 'Reports'], failed: true };
      toast('Could not load the tags and folders. You can still upload.');
    });
  }

  function renderUpload() {
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="upBack">&larr; Back</button>' +
      '<div class="grow"><div class="title">Upload photos</div></div>' +
      settingsMenu() + '</header>' +
      '<main class="page upload">' +
      '<section class="upstep" id="upJob"></section>' +
      '<section class="upstep"><div class="uptitle"><span class="stepnum">2</span>Add photos</div>' +
      '<div class="pickbar"><label class="btn primary pick">Take photo<input id="fileCam" type="file" accept="image/*" capture="environment"></label>' +
      '<label class="btn pick">Choose photos or PDFs<input id="fileLib" type="file" accept="image/*,application/pdf" multiple></label></div></section>' +
      '<section class="upstep"><div class="uptitle"><span class="stepnum">3</span>Organize <span class="small muted" id="upCount"></span></div>' +
      '<p class="small muted" id="upHint">For each photo: add a comment, tags and a folder. Drag the grip to change the order.</p>' +
      '<div class="upbulk" id="upBulk"></div><ul class="uplist" id="upList"></ul></section>' +
      '<div class="upbar" id="upBar"></div></main>' +
      '<div class="sheet" id="sheet" hidden><div class="sheet-box"><header><b id="sheetTitle"></b>' +
      '<button class="btn small primary" data-act="sheetDone">Done</button></header><div id="sheetBody"></div></div></div>';
    paintJob(); paintList();
  }

  /* --- step 1: the job --- */
  function paintJob() {
    var box = $('#upJob'); if (!box) return;
    var up = state.up;
    if (up.job) {
      box.innerHTML = '<div class="uptitle"><span class="stepnum">1</span>Job</div>' +
        '<div class="jobchip"><span class="nm">' + esc(jn(up.job) || 'Job') + '</span>' +
        (up.busy ? '' : '<button class="link" data-act="upChangeJob">Change</button>') + '</div>';
      return;
    }
    box.innerHTML = '<div class="uptitle"><span class="stepnum">1</span>Pick the job</div>' +
      '<input id="upq" type="search" autocomplete="off" autocapitalize="off" placeholder="House number and street, e.g. 1900 Gough" aria-label="Search jobs" value="' + esc(up.q) + '">' +
      '<div class="results" id="upResults"></div>';
    paintJobResults();
  }
  function paintJobResults() {
    var box = $('#upResults'); if (!box) return;
    var up = state.up, searching = up.q.trim().length >= 2;
    var list = searching ? up.jobs : (up.recent || []);
    var html = '';
    if (!searching && state.myJobs.length) {
      html += '<div class="small muted">My jobs</div>' + state.myJobs.map(function (j) {
        return '<div class="jobrow"><button class="job" data-act="upPickJob" data-id="' + esc(j.id) + '"><span class="name">' + esc(jn(j)) + '</span></button>' + starBtn(j) + '</div>';
      }).join('');
    }
    if (!searching) html += up.recent ? '<div class="small muted sheet-sub">Open jobs, newest first. Or type to search.</div>' : '<p class="muted">Loading jobs...</p>';
    else if (!list.length) html += '<p class="muted">No jobs found. Try fewer words or just the house number.</p>';
    html += list.map(function (j) {
      return '<div class="jobrow"><button class="job" data-act="upPickJob" data-id="' + esc(j.id) + '"><span class="name">' + esc(jn(j)) +
        '<div class="sub">Created ' + esc(fmtShort(j.createdAt)) + '</div></span></button>' + starBtn(j) + '</div>';
    }).join('');
    box.innerHTML = html;
  }
  var upSearchTimer;
  function onUpSearch(value) {
    var up = state.up; up.q = value;
    clearTimeout(upSearchTimer);
    if (value.trim().length < 2) { up.jobs = []; return paintJobResults(); }
    upSearchTimer = setTimeout(function () {
      var seq = ++up.seq;
      API.call('searchJobs', { q: value }).then(function (r) {
        if (seq !== up.seq || state.up !== up) return;
        up.jobs = r.jobs; paintJobResults();
      }).catch(function (e) { handleError(e); });
    }, 300);
  }

  /* --- step 2: adding photos --- */
  function compressImage(file) {
    var maxEdge = CFG.UPLOAD_IMAGE_EDGE || 2048, q = CFG.UPLOAD_IMAGE_QUALITY || 0.85;
    var make = window.createImageBitmap
      ? createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () { return viaImage(file); })
      : viaImage(file);
    return make.then(function (bmp) {
      var w0 = bmp.width || bmp.naturalWidth, h0 = bmp.height || bmp.naturalHeight;
      var sc = Math.min(1, maxEdge / Math.max(w0, h0));
      var w = Math.max(1, Math.round(w0 * sc)), h = Math.max(1, Math.round(h0 * sc));
      var c = document.createElement('canvas'); c.width = w; c.height = h;
      var ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bmp, 0, 0, w, h);
      return new Promise(function (res, rej) {
        c.toBlob(function (b) { b ? res({ blob: b, w: w, h: h }) : rej(new Error('encode')); }, 'image/jpeg', q);
      });
    });
  }

  function addFiles(files) {
    var up = state.up; if (!up || up.busy || !files || !files.length) return;
    var skipped = 0, bigPdf = 0;
    Array.prototype.slice.call(files).forEach(function (f) {
      var isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(f.name || '');
      var isImg = /^image\//.test(f.type) || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name || '');
      if (!isPdf && !isImg) { skipped++; return; }
      if (isPdf && f.size > MAX_PDF_MB * 1048576) { bigPdf++; return; }
      up.items.push({
        id: up.nextId++, name: f.name || 'Photo', kind: isPdf ? 'pdf' : 'photo', when: f.lastModified || Date.now(),
        note: '', tags: [], folder: '', status: isPdf ? 'ready' : 'prep', err: '',
        src: isPdf ? null : f, blob: isPdf ? f : null, thumb: null, size: f.size
      });
    });
    if (skipped) toast(skipped + ' file(s) skipped. Only photos and PDFs can be uploaded.');
    if (bigPdf) toast(bigPdf + ' PDF(s) skipped. The limit is ' + MAX_PDF_MB + ' MB each.');
    paintList(); prepQueue();
  }

  // Shrinks photos one at a time (a 12 MP iPad photo becomes about 0.5 to 1 MB) so many photos do not exhaust memory.
  function prepQueue() {
    var up = state.up; if (prepBusy || !up) return;
    var it = up.items.filter(function (x) { return x.status === 'prep'; })[0];
    if (!it) { paintBar(); return; }
    prepBusy = true;
    compressImage(it.src).then(function (r) {
      it.blob = r.blob; it.size = r.blob.size; it.thumb = URL.createObjectURL(r.blob); it.status = 'ready';
    }).catch(function () { it.status = 'error'; it.err = 'Could not read this photo. Remove it and try again.'; })
      .then(function () {
        it.src = null; prepBusy = false;
        if (state.up !== up || up.items.indexOf(it) === -1) { if (it.thumb) URL.revokeObjectURL(it.thumb); } else paintItem(it);
        if (state.up) { paintBar(); prepQueue(); }
      });
  }

  /* --- step 3: organizing --- */
  function statusText(it) {
    if (it.status === 'prep') return 'Preparing...';
    if (it.status === 'uploading') return 'Uploading...';
    if (it.status === 'done') return '✓ Saved to ' + folderLabel(it.saved || folderOf(it));
    if (it.status === 'error') return it.err || 'Failed';
    return (it.size >= 1048576 ? (it.size / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(it.size / 1024)) + ' KB');
  }
  function thumbHtml(it) {
    if (it.kind === 'pdf') return '<div class="pdfic">PDF</div>';
    return it.thumb ? '<img src="' + esc(it.thumb) + '" alt="">' : '<div class="pdfic">&hellip;</div>';
  }
  function cardHtml(it) {
    var up = state.up, locked = it.status === 'uploading' || it.status === 'done', dis = locked ? ' disabled' : '';
    var tags = it.tags.map(function (id) {
      return '<button class="chip on" data-act="upTagDel" data-uid="' + it.id + '" data-tag="' + esc(id) + '"' + dis + '>' + esc(tagName(id)) + ' &times;</button>';
    }).join('');
    return '<li class="upcard ' + it.status + '" data-uid="' + it.id + '">' +
      '<input type="checkbox" class="upchk" data-uid="' + it.id + '" aria-label="Select this photo"' + (up.sel[it.id] ? ' checked' : '') + dis + '>' +
      '<span class="draghandle" aria-label="Drag to change the order">&#8942;&#8942;</span>' +
      '<div class="upthumb">' + thumbHtml(it) + '</div>' +
      '<div class="upmeta">' +
      '<textarea class="upnote" data-uid="' + it.id + '" maxlength="1000" rows="2" placeholder="Add a comment (optional)" aria-label="Comment"' + dis + '>' + esc(it.note) + '</textarea>' +
      '<div class="upchips">' + tags + '<button class="chip add" data-act="upTags" data-uid="' + it.id + '"' + dis + '>+ Tag</button></div>' +
      '<div class="uprow"><button class="chip folder" data-act="upFolder" data-uid="' + it.id + '"' + dis + '>&#128193; ' + esc(folderLabel(folderOf(it))) + '</button>' +
      '<span class="upstatus">' + esc(statusText(it)) + '</span></div></div>' +
      '<button class="icon-btn" data-act="upRemove" data-uid="' + it.id + '" aria-label="Remove"' + dis + '>&times;</button></li>';
  }
  function cardEl(id) {
    return $$('#upList > li').filter(function (li) { return li.dataset.uid === String(id); })[0] || null;
  }
  // Update one card in place (keeps the cursor if someone is typing in it).
  function paintItem(it) {
    var li = cardEl(it.id); if (!li) return;
    var locked = it.status === 'uploading' || it.status === 'done';
    li.className = 'upcard ' + it.status;
    $('.upthumb', li).innerHTML = thumbHtml(it);
    $('.upstatus', li).textContent = statusText(it);
    $$('textarea, input.upchk, button', li).forEach(function (el) { el.disabled = locked; });
  }

  function paintList() {
    var ul = $('#upList'); if (!ul) return;
    var up = state.up;
    if (upSortable) { try { upSortable.destroy(); } catch (e) { /* gone */ } sortables = sortables.filter(function (x) { return x !== upSortable; }); upSortable = null; }
    ul.innerHTML = up.items.map(cardHtml).join('');
    if (up.items.length) {
      upSortable = Sortable.create(ul, { handle: '.draghandle', animation: 150, ghostClass: 'sortable-ghost', disabled: up.busy, onEnd: onUpReorder });
      sortables.push(upSortable);
    }
    var c = $('#upCount'); if (c) c.textContent = up.items.length ? '(' + up.items.length + ')' : '';
    var h = $('#upHint'); if (h) h.hidden = !up.items.length;
    paintBulk(); paintBar();
  }
  function onUpReorder() {
    var up = state.up, byId = {};
    up.items.forEach(function (i) { byId[i.id] = i; });
    var order = $$('#upList > li').map(function (li) { return byId[li.dataset.uid]; }).filter(Boolean);
    if (order.length === up.items.length) up.items = order;
  }

  function paintBulk() {
    var box = $('#upBulk'); if (!box) return;
    var up = state.up, n = selectedIds().length;
    if (!up.items.length) { box.innerHTML = ''; return; }
    box.innerHTML = '<button class="link" data-act="upSelAll">Select all</button>' + (n
      ? '<span class="small"><b>' + n + '</b> selected</span>' +
        '<button class="btn small" data-act="upBulkTags">Tag...</button><button class="btn small" data-act="upBulkFolder">Folder...</button>' +
        '<button class="btn small cancel" data-act="upBulkRemove">Remove</button><button class="link" data-act="upSelNone">Clear</button>'
      : '');
  }

  function paintBar() {
    var bar = $('#upBar'); if (!bar) return;
    var up = state.up, items = up.items;
    var count = function (st) { return items.filter(function (i) { return i.status === st; }).length; };
    var prep = count('prep'), done = count('done'), todo = items.filter(isUploadable).length;
    var err = items.filter(function (i) { return i.status === 'error' && i.blob; }).length;
    var status, buttons;
    if (up.blocked) {
      status = up.blocked; buttons = '<button class="btn primary" disabled>Upload</button>';
      bar.innerHTML = '<div class="upstatusline msg">' + esc(status) + '</div><div class="upbtns">' + buttons + '</div>';
      $$('.pick').forEach(function (l) { l.classList.add('off'); }); return;
    }
    if (up.busy) {
      status = 'Uploading ' + Math.min(up.run.n + 1, up.run.total) + ' of ' + up.run.total + '...';
      buttons = '<button class="btn primary" disabled>Uploading...</button>';
    } else if (todo) {
      status = (err ? err + ' did not upload. ' : '') + todo + ' ready' + (prep ? ', ' + prep + ' preparing' : '');
      buttons = '<button class="btn primary" data-act="upGo" id="upGo"' + (!up.job || prep ? ' disabled' : '') + '>' +
        (up.job ? (err ? 'Retry / Upload (' + todo + ')' : 'Upload (' + todo + ')') : 'Pick a job first') + '</button>';
    } else if (prep) {
      status = 'Preparing photos...'; buttons = '<button class="btn primary" disabled>Upload</button>';
    } else if (done) {
      var where = {}; items.forEach(function (i) { if (i.status === 'done') where[folderLabel(i.saved || folderOf(i))] = true; });
      status = '✓ ' + done + ' saved to JobTread: ' + (up.job ? jn(up.job) : '') + ' > Files > ' + Object.keys(where).join(', ');
      buttons = (can('report') ? '<button class="btn" data-act="upReport">Make a report from this job</button>' : '') + '<button class="btn primary" data-act="upMore">Upload more</button>';
    } else {
      status = 'Add photos above.'; buttons = '<button class="btn primary" disabled>Upload</button>';
    }
    bar.innerHTML = '<div class="upstatusline" id="upStatus">' + esc(status) + '</div><div class="upbtns">' + buttons + '</div>';
    $$('.pick').forEach(function (l) { l.classList.toggle('off', up.busy); });
    var fc = $('#fileCam'), fl = $('#fileLib'); if (fc) fc.disabled = up.busy; if (fl) fl.disabled = up.busy;
  }

  /* --- the tag / folder sheet (for one photo, or for all selected) --- */
  function openSheet(kind, ids) {
    if (!ids.length) return;
    var up = state.up;
    if (!up.job) { toast('Pick the job first.'); return; }
    up.sheet = { kind: kind, ids: ids };
    $('#sheet').hidden = false; paintSheet();
  }
  function closeSheet() {
    var sh = $('#sheet'); if (sh) sh.hidden = true;
    if (state.up) { state.up.sheet = null; paintList(); }
  }
  function sheetItems() { return state.up.sheet.ids.map(upItem).filter(Boolean); }
  function paintSheet() {
    var up = state.up, sh = up.sheet; if (!sh) return;
    var items = sheetItems(), many = items.length > 1, body = $('#sheetBody');
    $('#sheetTitle').textContent = (sh.kind === 'tags' ? 'Tags' : 'Folder') + (many ? ' for ' + items.length + ' photos' : '');
    if (!up.info) { body.innerHTML = '<p class="muted">Loading from JobTread...</p>'; return; }
    if (sh.kind === 'tags') {
      var tags = up.info.tags.slice().sort(function (a, b) {
        var pa = PRIORITY_TAGS.indexOf(a.name), pb = PRIORITY_TAGS.indexOf(b.name);
        return (pa < 0 ? 99 : pa) - (pb < 0 ? 99 : pb) || a.name.localeCompare(b.name);
      });
      var chip = function (t) {
        var have = items.filter(function (i) { return i.tags.indexOf(t.id) > -1; }).length;
        var st = have === items.length ? ' on' : have ? ' some' : '';
        return '<button class="chip tag' + st + '" data-act="sheetTag" data-tag="' + esc(t.id) + '">' + esc(t.name) + '</button>';
      };
      var first = tags.filter(function (t) { return PRIORITY_TAGS.indexOf(t.name) > -1; }), rest = tags.filter(function (t) { return PRIORITY_TAGS.indexOf(t.name) < 0; });
      body.innerHTML = tags.length
        ? '<div class="chips">' + first.map(chip).join('') + '</div>' + (rest.length ? '<div class="small muted sheet-sub">Other tags</div><div class="chips">' + rest.map(chip).join('') + '</div>' : '') +
          '<p class="small muted">Tap to turn a tag on or off. Up to ' + MAX_TAGS + ' per photo.</p>'
        : '<p class="muted">JobTread has no file tags to offer.</p>';
      return;
    }
    var folders = up.info.folders.slice();
    items.forEach(function (i) { var f = folderOf(i); if (folders.indexOf(f) < 0) folders.push(f); });
    // Photos of a real job always go in Photos, or a sub-folder inside it (temporary jobs keep their own folder).
    var photoOnly = !(up.job && (up.job.temp || /^T~/.test(up.job.id))) && items.some(function (i) { return i.kind !== 'pdf'; });
    if (photoOnly) folders = folders.filter(function (f) { return f === 'Photos' || f.indexOf('Photos' + SEP) === 0; });
    if (photoOnly && folders.indexOf('Photos') < 0) folders.unshift('Photos');
    sh.folders = folders; sh.photoOnly = photoOnly;
    body.innerHTML = '<div class="folders">' + folders.map(function (f, k) {
      var on = items.every(function (i) { return folderOf(i) === f; });
      return '<button class="folderopt' + (on ? ' on' : '') + '" data-act="sheetFolder" data-fi="' + k + '">&#128193; ' + esc(folderLabel(f)) + '</button>';
    }).join('') + '</div>' +
      '<div class="newfolder"><label class="small muted" for="newFolder">' + (photoOnly ? 'Or make a sub-folder inside Photos, e.g. Kitchen' : 'Or make a new folder (use / for a sub-folder, e.g. Photos/Kitchen)') + '</label>' +
      '<div class="row2"><input id="newFolder" placeholder="New folder name" maxlength="100"><button class="btn small primary" data-act="sheetNewFolder">Use</button></div></div>';
  }
  function toggleTag(tagId) {
    var items = sheetItems(), all = items.every(function (i) { return i.tags.indexOf(tagId) > -1; }), blocked = 0;
    items.forEach(function (i) {
      var k = i.tags.indexOf(tagId);
      if (all) { if (k > -1) i.tags.splice(k, 1); }
      else if (k < 0) { if (i.tags.length >= MAX_TAGS) blocked++; else i.tags.push(tagId); }
    });
    if (blocked) toast(blocked + ' photo(s) already have ' + MAX_TAGS + ' tags.');
    paintSheet();
  }
  function setFolder(raw) {
    sheetItems().forEach(function (i) { i.folder = raw === (i.kind === 'pdf' ? 'Reports' : 'Photos') ? '' : raw; });
    closeSheet();
  }
  function newFolderName() {
    var v = ($('#newFolder') && $('#newFolder').value || '').replace(/[\\>]/g, '/');
    var parts = v.split('/').map(function (p) { return p.replace(/[^\w .,&()#'-]/g, ' ').replace(/\s+/g, ' ').trim(); }).filter(Boolean).slice(0, 4);
    var up = state.up;
    if (up && up.sheet && up.sheet.photoOnly && parts.length && parts[0] !== 'Photos') parts = ['Photos'].concat(parts).slice(0, 4);
    return parts.join(SEP);
  }

  /* --- uploading --- */
  function stampFor(ms) {
    var d = new Date(ms || Date.now());
    var tm = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d).replace(':', '');
    return dayKey(d.toISOString()) + ' ' + tm;
  }
  function nameFor(it, pos) {
    return it.kind === 'pdf' ? (safeFileName(String(it.name).replace(/\.pdf$/i, '')) || 'Document') : 'Photo ' + stampFor(it.when) + ' #' + pos;
  }
  function setSortDisabled(on) { if (upSortable) upSortable.option('disabled', !!on); }

  // One photo at a time, in the order shown, so JobTread lists them the way they were arranged.
  function startUpload() {
    var up = state.up;
    if (!up || up.busy) return;
    if (!up.job) return toast('Pick the job first.');
    if (up.items.some(function (i) { return i.status === 'prep'; })) return toast('Still preparing photos. One moment.');
    var todo = up.items.filter(isUploadable);
    if (!todo.length) return;
    up.busy = true; up.run = { total: todo.length, n: 0 }; setSortDisabled(true); paintJob(); paintBar();
    var i = 0, failed = 0, stop = null;
    function finish() {
      up.busy = false; setSortDisabled(false); paintJob(); paintBar();
      toast(stop || (failed ? failed + ' photo(s) did not upload. Tap Retry.' : 'Saved to JobTread.'));
    }
    function next() {
      if (i >= todo.length || stop) return finish();
      var it = todo[i++]; it.status = 'uploading'; it.err = ''; paintItem(it); paintBar();
      var pos = up.items.indexOf(it) + 1;
      return blobToB64(it.blob).then(function (b64) {
        return API.call('uploadFile', { jobId: up.job.id, name: nameFor(it, pos), base64: b64, note: it.note.trim(), tagIds: it.tags, folder: it.folder });
      }).then(function (r) {
        it.status = 'done'; it.saved = r.folder; up.uploaded++;
      }).catch(function (e) {
        if (e && e.code === 'auth') { it.status = 'ready'; throw e; }
        it.status = 'error'; it.err = (e && e.message) || 'Upload failed.'; failed++;
        if (e && /^(no_key|key_invalid|key_mismatch)$/.test(e.code)) stop = e.message; // same problem for every photo, so stop
      }).then(function () { up.run.n++; paintItem(it); paintBar(); return next(); });
    }
    next().catch(function (e) { up.busy = false; setSortDisabled(false); handleError(e); });
  }

  function upBack() {
    var up = state.up; if (!up) return go('search');
    if (up.busy) return toast('Please wait for the upload to finish.');
    var n = pendingCount();
    if (n && !confirm('Leave without uploading ' + n + ' item' + (n === 1 ? '' : 's') + '?')) return;
    var uploaded = up.uploaded, from = up.from, jobId = up.job && up.job.id;
    freeUp();
    if (from === 'editor' && state.job) {
      if (uploaded && jobId === state.job.id) return pullJob(state.job); // bring in the new photos; the report draft comes back too
      return go('editor');
    }
    if (from === 'gallery' && state.gallery && state.gallery.job) return uploaded ? openGallery(state.gallery.job) : go('gallery');
    if (from === 'files' && state.filesJob) return uploaded ? openFiles(state.filesJob, state.filesFrom) : go('files');
    go('search');
  }

  function removeItems(ids) {
    var up = state.up;
    ids.forEach(function (id) {
      var it = upItem(id); if (!it) return;
      if (it.thumb) { try { URL.revokeObjectURL(it.thumb); } catch (e) { /* gone */ } }
      up.items.splice(up.items.indexOf(it), 1); delete up.sel[id];
    });
    paintList();
  }

  function uploadAction(act, el, ev) {
    var up = state.up, uid = el && el.dataset ? el.dataset.uid : null;
    switch (act) {
      case 'upOpenAny': return openUpload(null, 'search');
      case 'upOpen': return state.pickedJob ? openUpload(state.pickedJob, 'search') : openUpload(null, 'search');
      case 'openUpload': return openUpload(state.job, 'editor');
      case 'upBack': return upBack();
      case 'upPickJob': {
        var all = up.jobs.concat(up.recent || [], state.myJobs), j = all.filter(function (x) { return x.id === el.dataset.id; })[0];
        if (!j) return;
        up.job = { id: j.id, name: j.name }; up.info = null; up.blocked = canWrite() ? null : writeWhy(); paintJob(); paintBar(); return loadUploadInfo();
      }
      case 'upChangeJob': up.job = null; up.info = null; up.blocked = canWrite() ? null : writeWhy(); paintJob(); paintBar(); $$('.pick').forEach(function (l) { l.classList.remove('off'); }); return loadRecent();
      case 'upRemove': return removeItems([uid]);
      case 'upTags': return openSheet('tags', [Number(uid)]);
      case 'upFolder': return openSheet('folder', [Number(uid)]);
      case 'upTagDel': {
        var it = upItem(uid), k = it ? it.tags.indexOf(el.dataset.tag) : -1;
        if (k > -1) { it.tags.splice(k, 1); paintList(); }
        return;
      }
      case 'upSelAll': up.items.forEach(function (i) { if (i.status !== 'uploading' && i.status !== 'done') up.sel[i.id] = true; }); return paintList();
      case 'upSelNone': up.sel = {}; return paintList();
      case 'upBulkTags': return openSheet('tags', selectedIds());
      case 'upBulkFolder': return openSheet('folder', selectedIds());
      case 'upBulkRemove': {
        var ids = selectedIds();
        if (ids.length && confirm('Remove ' + ids.length + ' photo' + (ids.length === 1 ? '' : 's') + ' from this list?')) removeItems(ids);
        return;
      }
      case 'sheetDone': return closeSheet();
      case 'sheetTag': return toggleTag(el.dataset.tag);
      case 'sheetFolder': return setFolder(up.sheet.folders[Number(el.dataset.fi)]);
      case 'sheetNewFolder': {
        var nf = newFolderName();
        if (!nf) return toast('Type a folder name.');
        if (up.info && up.info.folders.indexOf(nf) < 0) up.info.folders.push(nf);
        return setFolder(nf);
      }
      case 'upGo': return startUpload();
      case 'upMore':
        up.items.filter(function (i) { return i.status === 'done'; }).forEach(function (i) { if (i.thumb) { try { URL.revokeObjectURL(i.thumb); } catch (e) { /* gone */ } } });
        up.items = up.items.filter(function (i) { return i.status !== 'done'; }); up.sel = {}; return paintList();
      case 'upReport': { var jb = up.job; return pullJob({ id: jb.id, name: jb.name }); }
    }
  }

  window.addEventListener('beforeunload', function (ev) {
    if (state.view === 'upload' && pendingCount()) { ev.preventDefault(); ev.returnValue = ''; }
  });

  /* ------------------------------------------------------------------ Files (plans, permits, reports...) */
  var FOLDER_SEP_UI = '\u001f';
  function openFiles(job, from) {
    if (!job) return;
    state.filesJob = { id: job.id, name: job.name || '' }; state.filesFrom = from; state.filesList = null;
    go('files');
    if (!can('files')) { state.filesList = { files: [], off: true }; return renderFiles(); }
    API.call('listFiles', { jobId: job.id }).then(function (r) {
      if (!state.filesJob || state.filesJob.id !== job.id) return;
      if (r.jobName) state.filesJob.name = r.jobName;
      state.filesList = r; if (state.view === 'files') renderFiles();
    }).catch(function (e) { state.filesList = { files: [], failed: true }; if (state.view === 'files') renderFiles(); handleError(e); });
  }
  function fileKind(f) {
    var t = String(f.type || ''), n = String(f.name || '');
    if (/pdf/.test(t) || /\.pdf$/i.test(n)) return 'PDF';
    if (/^image\//.test(t)) return 'IMG';
    if (/spreadsheet|excel|csv/.test(t) || /\.(xlsx?|csv)$/i.test(n)) return 'XLS';
    if (/word|document/.test(t) || /\.docx?$/i.test(n)) return 'DOC';
    return (n.split('.').pop() || 'FILE').toUpperCase().slice(0, 4);
  }
  function fmtSize(b) { return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1024)) + ' KB'; }
  function renderFiles() {
    var j = state.filesJob, r = state.filesList;
    var body;
    if (!r) body = '<p class="muted">Loading files...</p>';
    else if (r.off) body = '';
    else if (!r.files.length) body = '<p class="muted">' + (r.failed ? 'Could not load the files.' : 'No plans or files in this job yet.') + '</p>';
    else {
      var groups = {}, order = [];
      r.files.forEach(function (f) {
        var parts = (f.folder || '').split(FOLDER_SEP_UI), top = parts[0] || 'Other files', sub = parts.slice(1).join(' / ');
        if (!groups[top]) { groups[top] = {}; order.push(top); }
        (groups[top][sub] = groups[top][sub] || []).push(f);
      });
      order.sort(function (a, b) { return (a === 'Other files') - (b === 'Other files') || a.localeCompare(b); });
      body = order.map(function (top) {
        var subs = Object.keys(groups[top]).sort(), count = 0; subs.forEach(function (sb) { count += groups[top][sb].length; });
        return '<div class="fgroup"><button class="fhead" data-act="folderToggle">&#128193; ' + esc(top) + '<span class="small muted">' + count + '</span><i class="chev"></i></button><div class="fbody">' +
          subs.map(function (sb) {
            return (sb ? '<div class="fsub">' + esc(sb) + '</div>' : '') + groups[top][sb].map(function (f) {
              return '<button class="file" data-act="fileOpen" data-fid="' + esc(f.id) + '"><span class="fkind ' + fileKind(f).toLowerCase() + '">' + fileKind(f) + '</span>' +
                '<span class="fname">' + esc(f.name) + (f.note ? '<div class="sub">' + esc(f.note) + '</div>' : '') + '<div class="sub">' + esc(fmtShort(f.createdAt)) + ' &middot; ' + fmtSize(f.size) + '</div></span><span class="fopen">Open</span></button>';
            }).join('');
          }).join('') + '</div></div>';
      }).join('');
      if (r.hiddenCost) body += '<p class="small muted">Cost folders (invoices, pay applications, subs...) are not shown.</p>';
    }
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="filesBack">&larr; Back</button>' +
      '<div class="grow"><div class="title">' + esc(jn(j)) + '</div><div class="small muted">Files and plans</div></div>' + starBtn(j) +
      settingsMenu() + '</header>' +
      '<main class="page files"><div class="fstrip">' +
      (can('photos') || can('report') ? '<button class="ftile" data-act="filesPhotos"><b>&#128247; Photos</b><span>See the job photos, by date or by tag</span></button>' : '') +
      (can('upload') && canWrite() ? '<button class="ftile" data-act="filesUpload"><b>&#8679; Upload</b><span>Plans, PDFs or photos from this device, with comments</span></button>' : '') +
      (can('report') ? '<button class="ftile primary" data-act="filesReport"><b>&#128196; Photo report</b><span>Build a before/after PDF</span></button>' : '') +
      '</div>' +
      (can('upload') && !canWrite() ? '<p class="small msg">' + esc(writeWhy()) + '</p>' : '') +
      (r && !r.off ? '<div class="lab">Plans and files</div>' : '') + body + '</main>';
  }
  function openFileLink(fid) {
    var f = (state.filesList && state.filesList.files || []).filter(function (x) { return x.id === fid; })[0];
    if (!f || !f.url) return toast('No link for this file.');
    var a = document.createElement('a'); a.href = f.url; a.target = '_blank'; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
  }

  /* ------------------------------------------------------------------ My tasks */
  function openTasks() {
    state.tasks = null; go('tasks');
    API.call('myTasks').then(function (r) { state.tasks = r.tasks; if (state.view === 'tasks') renderTasks(); })
      .catch(function (e) { state.tasks = []; state.tasksFailed = true; if (state.view === 'tasks') renderTasks(); handleError(e); });
  }
  function taskHtml(t) {
    var late = !t.done && t.end && t.end < isoToday();
    return '<div class="task' + (t.done ? ' done' : '') + (late ? ' late' : '') + '" data-tid="' + esc(t.id) + '">' +
      '<input type="checkbox" class="taskchk" data-id="' + esc(t.id) + '" aria-label="Done"' + (t.done ? ' checked' : '') + (canWrite() ? '' : ' disabled') + '>' +
      '<div class="tbody"><div class="tname">' + esc(t.name) + '</div>' +
      '<div class="sub">' + (t.end ? (late ? 'Was due ' : 'Due ') + esc(fmtShort(t.end + 'T12:00:00')) : 'No date') + (t.start && t.start !== t.end ? ' &middot; starts ' + esc(fmtShort(t.start + 'T12:00:00')) : '') + (t.todo ? ' &middot; To-do' : '') + '</div>' +
      (t.note ? '<button class="link small tnote" data-act="taskNote">Details</button><div class="tdesc">' + esc(t.note).replace(/\n/g, '<br>') + '</div>' : '') +
      '</div></div>';
  }
  function renderTasks() {
    var tasks = state.tasks, body;
    if (!tasks) body = '<p class="muted">Loading your tasks...</p>';
    else if (!tasks.length) body = '<p class="muted">' + (state.tasksFailed ? 'Could not load tasks.' : 'No tasks are assigned to you in JobTread.') + '</p>';
    else {
      var byJob = {}, order = [];
      tasks.forEach(function (t) { var k = t.jobId || ''; if (!byJob[k]) { byJob[k] = { name: t.jobName || 'No job', id: t.jobId, open: [], done: [] }; order.push(k); } byJob[k][t.done ? 'done' : 'open'].push(t); });
      body = order.map(function (k) {
        var g = byJob[k];
        return '<section class="tgroup"><h2>' + esc(jn(g)) + (g.id ? ' <button class="link small" data-act="taskJob" data-id="' + esc(g.id) + '" data-name="' + esc(g.name) + '">Open job</button>' : '') + '</h2>' +
          g.open.map(taskHtml).join('') + (g.done.length ? '<details class="tdone"><summary>' + g.done.length + ' completed</summary>' + g.done.map(taskHtml).join('') + '</details>' : '') + '</section>';
      }).join('');
    }
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="tasksBack">&larr; Back</button>' +
      '<div class="grow"><div class="title">My tasks</div></div>' +
      '<button class="btn small" data-act="tasks">&#8635; Reload</button></header>' +
      '<main class="page tasks"><p class="muted small">Tasks assigned to you in JobTread. ' + (canWrite() ? 'Tick a box to mark it done.' : esc(writeWhy())) + '</p>' + body + '</main>';
  }
  function setTaskDone(id, done, box) {
    var t = (state.tasks || []).filter(function (x) { return x.id === id; })[0]; if (!t) return;
    box.disabled = true;
    API.call('setTaskDone', { taskId: id, done: !!done }).then(function (r) {
      t.done = !!r.done; renderTasks(); toast(t.done ? 'Marked done in JobTread.' : 'Reopened in JobTread.');
    }).catch(function (e) { box.checked = !done; box.disabled = false; handleError(e); });
  }

  /* ------------------------------------------------------------------ Admin > Users */
  // The switches and their labels come from the script (one table there), so new ones appear here with no app change.
  function openAdmin() {
    state.admin = null; go('admin');
    API.call('listUsers').then(function (r) { state.admin = r; if (state.view === 'admin') renderAdmin(); })
      .catch(function (e) { state.admin = { users: [], failed: true }; if (state.view === 'admin') renderAdmin(); handleError(e); });
  }
  // The admin switches follow the app's two places. Server keys stay the same; this only groups and words them.
  var PERM_GROUPS = [
    { title: 'To-do list', keys: ['todo'] },
    { title: 'Files and plans', keys: ['files', 'costFiles'] },
    { title: 'Photos', keys: ['photos', 'upload', 'report', 'saveJT'] },
    { title: 'Top bar', keys: ['tasks'] },
    { title: 'Job lists on home', keys: ['status', 'newJob'] }
  ];
  var PERM_WORDS = {
    todo: 'See, add and tick off to-dos', files: 'See plans and job files', costFiles: 'Also see cost folders (invoices, subs, pay apps)',
    photos: 'See job photos', upload: 'Upload photos and files', report: 'Make photo reports (PDF)', saveJT: 'Save the report PDF into JobTread', tasks: 'My tasks', status: 'Change a job\'s Status (job lists on home)', newJob: 'Start a new (temporary) job from Find job'
  };
  function permGroups(defs, one) {
    var seen = {};
    var html = PERM_GROUPS.map(function (g) {
      var ds = g.keys.map(function (k) { seen[k] = true; return defs.filter(function (d) { return d.key === k; })[0]; }).filter(Boolean);
      return ds.length ? '<div class="pgroup"><div class="pgt">' + g.title + '</div><div class="perms">' + ds.map(one).join('') + '</div></div>' : '';
    }).join('');
    var rest = defs.filter(function (d) { return !seen[d.key]; });
    return html + (rest.length ? '<div class="pgroup"><div class="pgt">Other</div><div class="perms">' + rest.map(one).join('') + '</div></div>' : '');
  }
  // Per person: which Status values they may set. All ticked = no limit.
  function statusAllowHtml(u, a) {
    var opts = a.phaseOptions || [];
    if (!opts.length) return '';
    var allow = u.statuses;
    return '<div class="stallow"><div class="grp">May change jobs to and from these Statuses <span class="small muted">(needs the Status switch above)</span></div><div class="perms">' +
      opts.map(function (o) {
        return '<label class="perm"><input type="checkbox" class="stchk" data-email="' + esc(u.email) + '" value="' + esc(o) + '"' + (!allow || allow.indexOf(o) > -1 ? ' checked' : '') + '><span>' + esc(o) + '</span></label>';
      }).join('') + '</div><div class="row2"><button class="btn small" data-act="stAll" data-email="' + esc(u.email) + '" data-on="1">All</button><button class="btn small" data-act="stAll" data-email="' + esc(u.email) + '" data-on="0">None</button></div></div>';
  }
  function saveStatuses(email) {
    var boxes = $$('.stchk').filter(function (c) { return c.dataset.email === email; });
    var list = boxes.filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
    boxes.forEach(function (c) { c.disabled = true; });
    API.call('setStatuses', { email: email, statuses: list }).then(function () {
      boxes.forEach(function (c) { c.disabled = false; });
      toast(list.length === boxes.length ? 'All Statuses allowed.' : list.length ? list.length + ' Statuses allowed.' : 'No Status changes allowed.');
    }).catch(function (e) { boxes.forEach(function (c) { c.disabled = false; }); handleError(e); });
  }
  function permLabel(d) { return PERM_WORDS[d.key] || d.label || d.key; }

  function renderAdmin() {
    var a = state.admin, body;
    if (!a) body = '<p class="muted">Loading users...</p>';
    else if (!a.users.length) body = '<p class="muted">Could not load the users.</p>';
    else {
      var defs = (a.perms || []).map(function (p) { return typeof p === 'string' ? { key: p, label: p } : p; });
      var feats = a.features || {};
      var op = state.adminOpen || (state.adminOpen = { feats: true, phases: true });
      var isOpen = function (k) { return op[k] ? ' open' : ''; };
      body = '<details class="user feats" data-key="feats"' + isOpen('feats') + '><summary class="uhead"><b>Buttons for everyone</b><span class="small muted">Company-wide. A button switched off here is hidden for every Project Manager and Operations Manager, whatever their personal switch says. Admins always see everything.</span></summary>' +
        permGroups(defs, function (d) {
          return '<label class="perm"><input type="checkbox" class="featchk" data-perm="' + esc(d.key) + '"' + (feats[d.key] ? ' checked' : '') + '><span>' + esc(permLabel(d)) + '</span></label>';
        }) +
        '<div class="row2 presets"><span class="small muted">Quick set:</span><button class="btn small" data-act="featPreset" data-preset="report">Photo report only</button><button class="btn small" data-act="featPreset" data-preset="all">Everything on</button></div></details>' +
        ((a.phaseOptions || []).length ? '<details class="user feats phases" data-key="phases"' + isOpen('phases') + '><summary class="uhead"><b>Non Green Tree WO jobs list for everyone</b><span class="small muted">Open jobs whose JobTread Status is ticked here show under Non Green Tree WO jobs on everyone\'s home screen.</span></summary>' +
          '<div class="perms">' + (a.phaseOptions || []).map(function (ph) {
            var isNew = (a.phasesNew || []).indexOf(ph) > -1;
            return '<label class="perm"><input type="checkbox" class="phasechk" value="' + esc(ph) + '"' + ((a.phases || []).indexOf(ph) > -1 ? ' checked' : '') + '><span>' + esc(ph) + (isNew ? ' <b class="newtag">NEW in JobTread</b>' : '') + '</span></label>';
          }).join('') + '</div>' +
          ((a.phasesGone || []).length ? '<p class="small warn-txt">No longer in JobTread (renamed or removed there), so not used: ' + a.phasesGone.map(esc).join(', ') + '. Tick the new name above if it was renamed.</p>' : '') +
          '<p class="small muted">Status choices are read from JobTread each time this screen opens.</p></details>' : '') +
        '<div class="lab labrow">Per person <span class="expall"><button class="link small" data-act="adminExpand" data-open="1">Expand all</button> &middot; <button class="link small" data-act="adminExpand" data-open="0">Collapse all</button></span></div><div class="users">' + a.users.map(function (u) {
        var nOn = defs.filter(function (d) { return u.perms[d.key]; }).length;
        return '<details class="user' + (u.isAdmin ? ' adm' : '') + '" data-key="' + esc(u.email) + '"' + isOpen(u.email) + '><summary class="uhead"><b>' + esc(titleCase(u.name)) + '</b><span class="small muted">' + esc(u.email) + '</span>' +
          '<span class="badge' + (u.isAdmin ? ' has' : '') + '">' + esc(u.role) + '</span>' +
          '<span class="badge' + (u.hasKey ? ' has' : ' warn') + '" title="Needed to save or upload to JobTread">' + (u.hasKey ? 'JT key saved' : 'No JT key') + '</span>' +
          '<span class="small muted ucount">' + (u.isAdmin ? 'everything' : nOn + ' of ' + defs.length + ' on') + '</span></summary>' +
          (u.isAdmin ? '<div class="small muted">Admins always have full access here.</div>' :
            permGroups(defs, function (d) {
              var k = d.key;
              var off = a.features && a.features[k] === false;
              return '<label class="perm' + (off ? ' gated' : '') + '" title="' + (off ? 'Switched off for everyone above' : '') + '"><input type="checkbox" class="permchk" data-email="' + esc(u.email) + '" data-perm="' + esc(k) + '"' + (u.perms[k] ? ' checked' : '') + '><span>' + esc(permLabel(d)) + (off ? ' <i>(off for everyone)</i>' : '') + '</span></label>';
            }) + statusAllowHtml(u, a)) + '</details>';
      }).join('') + '</div>';
    }
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="adminBack">&larr; Back</button>' +
      '<div class="grow"><div class="title">Admin &rsaquo; Users</div></div></header>' +
      '<main class="page admin"><p class="muted small">Who may do what in this app. Changes apply right away. This does not change anyone\'s JobTread role. ' +
      'People appear here when their JobTread role is Admin, Project Manager or Operations Manager; a "No JT key" person can look but cannot save or upload until you add their key to the script.</p>' + body + '</main>';
  }
  function setFeatures(next, boxes) {
    boxes.forEach(function (b) { b.disabled = true; });
    API.call('setFeatures', { features: next }).then(function (r) {
      state.admin.features = r.features; renderAdmin(); toast('Saved for everyone.');
    }).catch(function (e) { renderAdmin(); handleError(e); });
  }
  function setPerm(email, perm, on, box) {
    var u = (state.admin && state.admin.users || []).filter(function (x) { return x.email === email; })[0]; if (!u) return;
    var next = {}; Object.keys(u.perms).forEach(function (k) { next[k] = u.perms[k]; }); next[perm] = !!on;
    box.disabled = true;
    API.call('setPerms', { email: email, perms: next }).then(function (r) {
      u.perms = r.perms; box.disabled = false; toast('Saved for ' + titleCase(u.name) + '.');
    }).catch(function (e) { box.checked = !on; box.disabled = false; handleError(e); });
  }

  /* ------------------------------------------------------------------ Photos (view only) */
  function openGallery(job) {
    if (!job) return;
    overlay(true, 'Loading photos...', 3);
    var all = [], page = null, j = { id: job.id, name: job.name || '' };
    function next() {
      return API.call('listPhotos', { jobId: j.id, page: page }).then(function (r) {
        if (!j.name && r.jobName) j.name = r.jobName;
        all = all.concat(r.files); page = r.nextPage;
        overlay(true, 'Loaded ' + all.length + ' of ' + r.count + ' photos...', r.count ? (all.length / r.count) * 100 : 100);
        if (page && all.length < 1500) return next();
      });
    }
    next().then(function () { overlay(false); state.gallery = { job: j, files: all }; go('gallery'); })
      .catch(function (e) { overlay(false); handleError(e); });
  }
  function renderGallery() {
    var g = state.gallery, files = g.files.slice().sort(function (a, b) { return a.createdAt < b.createdAt ? 1 : -1; });
    var grid = groupPhotos(files, state.groupBy).map(function (grp) { return headHtml(grp) + grp.files.map(function (f) {
      return '<button class="gph" data-act="galleryZoom" data-fid="' + esc(f.id) + '"><img loading="lazy" src="' + esc(f.thumb) + '" alt="">' +
        (f.note ? '<span class="gnote">' + esc(f.note) + '</span>' : '') + '<span class="when">' + esc(fmtShort(f.createdAt)) + (f.by ? ' &middot; ' + esc(f.by) : '') + '</span></button>';
    }).join(''); }).join('');
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="galleryBack">&larr; Back</button>' +
      '<div class="grow"><div class="title">' + esc(jn(g.job)) + '</div><div class="small muted">' + files.length + ' photos</div></div>' + starBtn(g.job) +
      groupSwitch('groupGal') + (can('upload') && canWrite() ? '<button class="btn small" data-act="galleryUpload">&#8679; Upload photos</button>' : '') +
      (can('report') ? '<button class="btn small primary" data-act="galleryReport">Make a report</button>' : '') + settingsMenu() + '</header>' +
      '<main class="page gallery">' + (files.length ? '<div class="lib gal">' + grid + '</div>' : '<p class="muted">No photos in this job yet.</p>') + '</main>';
  }

  /* ------------------------------------------------------------------ Job to-do list (this job only; "My tasks" is everything assigned to me) */
  function openTodos(job, add) {
    if (!job) return;
    state.todos = { job: { id: job.id, name: job.name || '' }, list: null, add: !!add };
    go('todos');
    API.call('jobTodos', { jobId: job.id }).then(function (r) {
      if (!state.todos || state.todos.job.id !== job.id) return;
      if (r.jobName) state.todos.job.name = r.jobName;
      state.todos.list = r.tasks; if (state.view === 'todos') renderTodos();
    }).catch(function (e) {
      state.todos.list = []; state.todos.failed = (e && e.message) || 'Could not load the list.';
      state.todos.blocked = !!(e && (e.code === 'forbidden' || e.code === 'bad_request' || e.code === 'no_key' || e.code === 'key_invalid' || e.code === 'key_mismatch'));
      if (state.view === 'todos') renderTodos(); if (e && e.code === 'auth') handleError(e);
    });
  }
  function todoHtml(t) {
    var late = !t.done && t.end && t.end < isoToday();
    return '<div class="task' + (t.done ? ' done' : '') + (late ? ' late' : '') + '">' +
      '<input type="checkbox" class="taskchk todochk" data-id="' + esc(t.id) + '" aria-label="Done"' + (t.done ? ' checked' : '') + (canWrite() ? '' : ' disabled') + '>' +
      '<div class="tbody"><div class="tname">' + esc(t.name) + '</div>' +
      '<div class="sub">' + (t.end ? (late ? 'Was due ' : 'Due ') + esc(fmtShort(t.end + 'T12:00:00')) : 'No date') + (t.who && t.who.length ? ' &middot; ' + esc(t.who.join(', ')) : '') + '</div>' +
      (t.note ? '<div class="tdesc" style="display:block">' + esc(t.note).replace(/\n/g, '<br>') + '</div>' : '') + '</div></div>';
  }
  function renderTodos() {
    var td = state.todos, list = td.list, body;
    if (!list) body = '<p class="muted">Loading the to-do list...</p>';
    else {
      var open = list.filter(function (t) { return !t.done; }), done = list.filter(function (t) { return t.done; });
      body = (open.length ? open.map(todoHtml).join('') : (td.failed ? '<p class="msg">Could not load the to-do list: ' + esc(td.failed) + '</p>' : '<p class="muted">Nothing open on this job\'s to-do list.</p>')) +
        (done.length ? '<details class="tdone"><summary>' + done.length + ' completed</summary>' + done.map(todoHtml).join('') + '</details>' : '');
    }
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="todosBack">&larr; Back</button>' +
      '<div class="grow"><div class="title">' + esc(jn(td.job)) + '</div><div class="small muted">To-do list</div></div>' + starBtn(td.job) + settingsMenu() + '</header>' +
      '<main class="page tasks">' + (td.blocked ? '<section class="tgroup"><p class="msg">To-do list is not available: ' + esc(td.failed) + '</p></section>' : !canWrite() ? '<section class="tgroup"><p class="small msg">' + esc(writeWhy()) + ' You can view the list.</p></section>' : '<section class="tgroup' + (td.add || td.added ? '' : ' bare') + '">' +
      (td.added ? '<div class="added"><b>&#10003; Added to JobTread:</b> ' + esc(td.added) + '<div class="row2"><button class="btn primary" data-act="todoShowAdd">Add another to-do</button><button class="btn" data-act="todosBack">Done</button></div></div>' :
      '<button class="btn primary" data-act="todoShowAdd" id="todoShowAdd"' + (td.add ? ' hidden' : '') + '>+ Add a to-do</button>' +
      '<div class="todoform" id="todoForm"' + (td.add ? '' : ' hidden') + '><label class="small muted" for="todoName">What needs to be done?</label>' +
      '<input id="todoName" maxlength="200" placeholder="e.g. Order 4 bags of mortar for F2">' +
      '<label class="small muted" for="todoDue">Due (optional)</label><input id="todoDue" type="date">' +
      '<label class="small muted" for="todoNote">Details (optional)</label><textarea id="todoNote" rows="2" placeholder="Where, how many, who to call..."></textarea>' +
      '<button class="btn primary" data-act="todoAdd" id="todoAddBtn">Add to JobTread</button>' +
      '<p class="small muted">It goes on the job\'s to-do list in JobTread, assigned to you.</p></div>') + '</section>') +
      (td.blocked ? '' : '<section class="tgroup">' + body + '</section>') + '</main>';
    if (td.add) { var n = $('#todoName'); if (n) n.focus(); }
  }
  function addTodo() {
    var td = state.todos, name = ($('#todoName').value || '').trim();
    if (!name) { toast('Type what needs to be done.'); $('#todoName').focus(); return; }
    var btn = $('#todoAddBtn'); btn.disabled = true; btn.textContent = 'Adding...';
    $$('#todoForm input, #todoForm textarea').forEach(function (el) { el.disabled = true; });
    API.call('addTodo', { jobId: td.job.id, name: name, note: $('#todoNote').value, due: $('#todoDue').value || '' }).then(function () {
      btn.textContent = '\u2713 Added'; toast('Added to the to-do list.');
      var j = td.job; state.todos = { job: j, list: null, add: false, added: name }; renderTodos();
      API.call('jobTodos', { jobId: j.id }).then(function (r) { if (state.todos && state.todos.job.id === j.id) { state.todos.list = r.tasks; if (state.view === 'todos') renderTodos(); } })
        .catch(function (e) { if (state.todos) { state.todos.list = []; state.todos.failed = (e && e.message) || 'Could not load the list.'; if (state.view === 'todos') renderTodos(); } });
    }).catch(function (e) { btn.disabled = false; btn.textContent = 'Add to JobTread'; $$('#todoForm input, #todoForm textarea').forEach(function (el) { el.disabled = false; }); handleError(e); });
  }
  function setTodoDone(id, done, box) {
    var t = (state.todos && state.todos.list || []).filter(function (x) { return x.id === id; })[0]; if (!t) return;
    box.disabled = true;
    API.call('setTaskDone', { taskId: id, done: !!done }).then(function (r) { t.done = !!r.done; renderTodos(); toast(t.done ? 'Done.' : 'Reopened.'); })
      .catch(function (e) { box.checked = !done; box.disabled = false; handleError(e); });
  }

  /* ------------------------------------------------------------------ ask sheets: remove / manage / assign */
  // One bottom sheet for three small questions. state.ask = { kind, job, pick, busy, ... }.
  function jobById(id) { return allKnownJobs().filter(function (j) { return j.id === id; })[0] || { id: id, name: '' }; }
  function openAsk(a) {
    state.ask = a;
    var sh = $('#askSheet');
    if (!sh) { sh = document.createElement('div'); sh.id = 'askSheet'; sh.className = 'sheet ask'; sh.innerHTML = '<div class="sheet-box"><header><b id="askTitle"></b><button class="btn small" data-act="askClose">Cancel</button></header><div id="askBody"></div></div>'; document.body.appendChild(sh); }
    sh.hidden = false; paintAsk();
  }
  function closeAsk() { var sh = $('#askSheet'); if (sh) sh.hidden = true; state.ask = null; }
  var REMOVE_CHOICES = [
    { v: 'Complete Pending Final Payment', t: 'Complete Pending Final Payment', jt: true },
    { v: 'On Hold', t: 'Hold', jt: true },
    { v: 'Canceled', t: 'Cancel', jt: true },
    { v: '', t: 'Not my managed job', jt: false }];
  function paintAsk() {
    var a = state.ask, body = $('#askBody'), title = $('#askTitle'); if (!a || !body) return;
    var name = esc(jn(a.job) || a.job.name || 'this job'), w = canWrite(), h = '';
    if (a.kind === 'remove') {
      title.textContent = 'Remove from My jobsite';
      h = '<p><b>' + name + '</b></p><p class="small muted">Pick why it comes off your list:</p><div class="askopts">' +
        REMOVE_CHOICES.map(function (c) {
          var off = c.jt && !w, on = a.pick === c.v && a.pick !== null;
          return '<button class="askopt' + (on ? ' on' : '') + '" data-act="rmPick" data-v="' + esc(c.v) + '"' + (off ? ' disabled' : '') + '><span class="dot"></span><span>' + esc(c.t) +
            '<small>' + (c.jt ? 'Changes the JobTread Status to “' + esc(c.v) + '”' : 'Nothing changes in JobTread') + '</small></span></button>';
        }).join('') + '</div>' + (!w ? '<p class="small msg">' + esc(writeWhy()) + '</p>' : '') +
        '<button class="btn primary big" data-act="rmGo"' + (a.pick === null || a.busy ? ' disabled' : '') + '>' + (a.busy ? 'Saving...' : 'Remove from My jobsite') + '</button>';
    } else if (a.kind === 'manage') {
      title.textContent = 'Added to My jobsite';
      h = '<p><b>' + name + '</b></p><p>Do you manage this job?</p><p class="small muted">Yes sets you as its Project Manager in JobTread. Either way the job stays in My jobsite.</p>' +
        '<div class="askrow"><button class="btn big" data-act="askClose">No</button><button class="btn primary big" data-act="mgYes"' + (a.busy ? ' disabled' : '') + '>' + (a.busy ? 'Saving...' : 'Yes, I manage it') + '</button></div>';
    } else if (a.kind === 'assign') {
      title.textContent = 'Assign project manager';
      h = '<p><b>' + name + '</b></p>' + (!a.options ? '<p class="small muted">Loading...</p>' :
        '<div class="askopts">' + a.options.map(function (o) {
          return '<button class="askopt' + (a.pick === o.name ? ' on' : '') + '" data-act="pmPick" data-v="' + esc(o.name) + '"><span class="dot"></span><span>' + esc(o.name) +
            '<small>' + (o.name === a.current ? 'Current Project Manager \u00b7 ' : '') + (o.inApp ? 'Also added to their My jobsite' : 'Not an app user') + '</small></span></button>';
        }).join('') + '</div>' + (!w ? '<p class="small msg">' + esc(writeWhy()) + '</p>' : '') +
        '<button class="btn primary big" data-act="pmGo"' + (!a.pick || a.busy || !w ? ' disabled' : '') + '>' + (a.busy ? 'Saving...' : 'Assign') + '</button>');
    }
    body.innerHTML = h + '<p class="small msg" id="askMsg"></p>';
  }
  function openRemove(id) { openAsk({ kind: 'remove', job: jobById(id), pick: null }); }
  function runRemove() {
    var a = state.ask; if (!a || a.pick === null) return;
    var id = a.job.id, done = function (msg) { closeAsk(); if (isMyJob(id)) toggleMyJob(id); if (msg) toast(msg); };
    if (!a.pick) return done();
    a.busy = true; paintAsk();
    API.call('releaseJob', { jobId: id, status: a.pick }).then(function (r) {
      (state.wo || []).concat(state.active || []).forEach(function (x) { if (x.id === id) x.phase = r.status; });
      done('Removed. JobTread Status is now \u201c' + r.status + '\u201d.');
      loadActiveJobs(true); loadWoJobs(true);
    }).catch(function (e) { a.busy = false; paintAsk(); handleError(e, $('#askMsg')); });
  }
  function askManage(id) { if (isPmRole() && canWrite()) openAsk({ kind: 'manage', job: jobById(id) }); }
  function runClaim() {
    var a = state.ask; if (!a) return;
    a.busy = true; paintAsk();
    API.call('claimJob', { jobId: a.job.id }).then(function (r) { closeAsk(); toast('You are now the Project Manager (' + r.pm + ') in JobTread.'); })
      .catch(function (e) { a.busy = false; paintAsk(); handleError(e, $('#askMsg')); });
  }
  function openAssign(j) {
    openAsk({ kind: 'assign', job: j, pick: '', options: null });
    var a = state.ask;
    API.call('pmOptions', { jobId: j.id }).then(function (r) { if (state.ask === a) { a.options = r.options || []; a.current = r.current || ''; a.pick = a.pick || a.current; paintAsk(); } })
      .catch(function (e) { handleError(e, $('#askMsg')); });
  }
  function runAssign() {
    var a = state.ask; if (!a || !a.pick) return;
    a.busy = true; paintAsk();
    API.call('assignPm', { jobId: a.job.id, pm: a.pick }).then(function (r) {
      closeAsk(); toast('Assigned to ' + r.pm + (r.addedToMyJobs ? ' and added to their My jobsite.' : '.'));
    }).catch(function (e) { a.busy = false; paintAsk(); handleError(e, $('#askMsg')); });
  }

  /* ------------------------------------------------------------------ Help */
  /* ------------------------------------------------------------------ new job from the field */
  // Temporary jobs (customer not known yet) live as folders in the JobTread job "Temporary Job Site" until an Admin
  // moves their photos to the real job. Admins and people allowed to start jobs see them in a list on the home screen.
  var tempsAt = 0;
  function loadTemps(force) {
    if (!force && state.temps && Date.now() - tempsAt < 120000) return renderTemps();
    API.call('tempJobs').then(function (r) { state.temps = r.jobs || []; tempsAt = Date.now(); renderTemps(); })
      .catch(function (e) { if (e && e.code === 'auth') handleError(e); });
  }
  function renderTemps() {
    var col = $('#tempCol'), box = $('#tempJobs'); if (!col || !box) return;
    var list = state.temps || [];
    col.hidden = !list.length;
    var c = $('#tempCnt'); if (c) c.textContent = '(' + list.length + ')';
    box.innerHTML = '<div class="results">' + list.map(function (j) {
      var picked = state.pickedJob && state.pickedJob.id === j.id;
      return '<div class="jobrow hasgo"><span class="star tempmark" aria-hidden="true">T</span><div class="jobcell"><button class="job' + (picked ? ' picked' : '') + '" data-act="pick" data-id="' + esc(j.id) + '" aria-pressed="' + !!picked + '">' +
        '<span class="name">' + esc((j.customer ? j.customer + ' \u00b7 ' : '') + j.longName.replace(/^TEMP: /, '')) + noteMark(j) + '</span><span class="phase">' + esc((j.by || '') + ' \u00b7 ' + fmtShort(j.at) + ' \u00b7 ' + (j.photos || 0) + ' photo' + (j.photos === 1 ? '' : 's')) + '</span></button>' +
        goBtn(j) + '</div>' + (state.isAdmin ? '<button class="btn small movebtn" data-act="moveTemp" data-id="' + esc(j.id) + '">Move to job&hellip;</button>' : '') + '</div>';
    }).join('') + '</div>';
  }
  function openNewJob() {
    state.nj = { name: state.query.trim(), address: '', sf: true, city: '', cust: null, custQ: '', custs: [] };
    go('newjob');
  }
  // Customer first: typing shows matching JobTread customers to pick. A name nobody picks is a NEW customer,
  // and the job is saved as a temporary job until the Admin makes the real one.
  function njMode() { var n = state.nj; return n.cust ? 'cust' : n.custQ.trim().length >= 2 ? 'temp' : ''; }
  function renderNewJob() {
    var n = state.nj;
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="njBack">&larr; Back</button><div class="grow"><div class="title">New job</div></div></header>' +
      '<main class="page newjob"><div class="card">' +
      '<label class="lab" for="njCustQ">Customer</label>' +
      (n.cust ? '<div class="njcust"><b>' + esc(n.cust.name) + '</b> <button class="link small" data-act="njCustClear">Change</button></div>'
        : '<input id="njCustQ" type="search" placeholder="Type the customer name" value="' + esc(n.custQ) + '" autocomplete="off"><div id="njCusts" class="results"></div>') +
      '<p class="njnote">Not a management job, choose <b>DH private</b> or <b>SP private</b> depending on who assigned you.</p>' +
      '<div id="njInfo" class="njinfo"></div>' +
      '<label class="lab" for="njName">Job name</label><input id="njName" maxlength="100" value="' + esc(n.name) + '" placeholder="e.g. 2560 Oak St bathroom leak">' +
      '<label class="lab" for="njAddr">Street address <span class="small muted">(if known)</span></label><input id="njAddr" maxlength="200" value="' + esc(n.address) + '" placeholder="e.g. 2560 Oak St">' +
      '<div class="lab">City</div><div class="njmode"><button class="' + (n.sf ? 'on' : '') + '" data-act="njSf" data-v="1">San Francisco</button><button class="' + (n.sf ? '' : 'on') + '" data-act="njSf" data-v="0">Other city</button></div>' +
      (n.sf ? '' : '<input id="njCity" maxlength="60" value="' + esc(n.city) + '" placeholder="Type the city, e.g. Oakland" autocomplete="address-level2">') +
      '<button class="btn primary big" data-act="njCreate"></button>' +
      '<p class="small msg" id="njMsg"></p></div></main>';
    paintCusts(); paintNjState();
  }
  function paintNjState() {
    var n = state.nj, mode = njMode(), info = $('#njInfo'), b = $('[data-act="njCreate"]');
    if (info) {
      info.hidden = !mode;
      info.innerHTML = mode === 'cust' ? 'Existing customer. A real JobTread job is made now, with Status “A New Lead”.'
        : mode === 'temp' ? '<b>New customer: “' + esc(n.custQ.trim()) + '”</b><br>Not in JobTread yet, so this is saved as a <b>temporary job</b>. Add photos right away; the Admin makes the real job and moves them.' : '';
      info.className = 'njinfo' + (mode === 'temp' ? ' warn' : '');
    }
    if (b) {
      b.disabled = !!n.busy || !mode;
      b.textContent = n.busy ? 'Saving...' : mode === 'temp' ? 'Start temporary job' : mode === 'cust' ? 'Create job in JobTread' : 'Type the customer first';
    }
  }
  function paintCusts() {
    var box = $('#njCusts'); if (!box) return;
    var n = state.nj, q = n.custQ.trim();
    box.innerHTML = q.length < 2 || !n.custs.length ? '' :
      '<p class="small muted">In JobTread — tap to use:</p>' +
      n.custs.map(function (c, i) { return '<button class="job" data-act="njPickCust" data-i="' + i + '"><span class="name">' + esc(c.name) + '</span></button>'; }).join('');
  }
  var custTimer;
  function onCustSearch(v) {
    var n = state.nj; n.custQ = v; clearTimeout(custTimer); paintNjState();
    if (v.trim().length < 2) { n.custs = []; return paintCusts(); }
    custTimer = setTimeout(function () {
      API.call('customers', { q: v }).then(function (r) { if (state.nj === n) { n.custs = r.customers || []; paintCusts(); } }).catch(handleError);
    }, 300);
  }
  function njKeep() { var n = state.nj; ['Name', 'Addr', 'City'].forEach(function (k) { var el = $('#nj' + k); if (el) n[{ Name: 'name', Addr: 'address', City: 'city' }[k]] = el.value; }); }
  function njErr(t) { var el = $('#njMsg'); if (el) { el.textContent = t; el.className = 'small msg'; } }
  function createNewJob() {
    njKeep();
    var n = state.nj;
    if (n.name.trim().length < 3) return njErr('Type a job name.');
    var mode = njMode();
    if (!mode) return njErr('Type the customer name.');
    if (!n.sf && n.city.trim().length < 2) { njErr('Type the city (the job is not in San Francisco).'); var ce = $('#njCity'); if (ce) ce.focus(); return; }
    var city = n.sf ? 'San Francisco' : n.city.trim(), street = n.address.trim();
    n.busy = true; paintNjState();
    API.call('newJob', { name: n.name, address: street ? street + ', ' + city : city, note: '', customerId: mode === 'cust' ? n.cust.id : '', customerName: mode === 'temp' ? n.custQ.trim() : '' }).then(function (r) {
      n.busy = false;
      var j = r.job;
      if (r.temp) { state.temps = [j].concat(state.temps || []); tempsAt = 0; }
      else { state.myJobs = sortMyJobs(state.myJobs.concat([{ id: j.id, name: j.name, longName: j.longName }])); saveMyJobs(); }
      state.pickedJob = j.temp ? j : { id: j.id, name: j.name, longName: j.longName };
      state.query = ''; state.jobs = [];
      go('search');
      toast(r.temp ? 'Temporary job started. Add photos now: Action \u2192 Photos.' : 'Job created in JobTread and added to My jobsite.');
    }).catch(function (e) { n.busy = false; paintNjState(); handleError(e, $('#njMsg')); });
  }

  /* --- Admin: move a temporary job's photos to the real job */
  /* ------------------------------------------------------------------ Edit job information (Admins, Operations Manager) */
  function openEditJob(j) {
    state.ej = { job: j, info: null, busy: false, msg: '' };
    go('editjob');
    API.call('jobInfo', { jobId: j.id }).then(function (r) {
      if (!state.ej || state.ej.job !== j) return;
      state.ej.info = r.job; state.ej.fields = r.fields || []; state.ej.custName = r.job.customer ? r.job.customer.name : '';
      renderEditJob();
    }).catch(function (e) { handleError(e, $('#ejMsg')); });
  }
  function renderEditJob() {
    var e = state.ej, i = e && e.info;
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="ejBack">&larr; Back</button><div class="grow"><div class="title">Edit job information</div></div></header>' +
      '<main class="page newjob"><div class="card">' +
      (!i ? '<p class="small muted">Loading from JobTread...</p><p class="small msg" id="ejMsg"></p>' :
        '<label class="lab" for="ejName">Job name <span class="small muted" id="ejCnt"></span></label><input id="ejName" maxlength="30" value="' + esc(i.name) + '">' +
        '<label class="lab" for="ejLong">Project Long Name <span class="small muted">(shown in this app)</span></label><input id="ejLong" maxlength="200" value="' + esc(i.longName) + '">' +
        '<label class="lab" for="ejAddr">Address</label><input id="ejAddr" maxlength="200" value="' + esc(i.address) + '" placeholder="Street, city">' +
        e.fields.map(function (f) {
          var cur = i.values[f.id] || '';
          return '<label class="lab" for="ejf_' + esc(f.id) + '">' + esc(f.name) + '</label><select id="ejf_' + esc(f.id) + '" class="ejsel" data-fid="' + esc(f.id) + '">' +
            (cur ? '' : '<option value="" selected>(not set)</option>') +
            f.options.map(function (o) { return '<option' + (o === cur ? ' selected' : '') + '>' + esc(o) + '</option>'; }).join('') +
            (cur && f.options.indexOf(cur) < 0 ? '<option selected>' + esc(cur) + '</option>' : '') + '</select>';
        }).join('') +
        '<button class="btn primary big" data-act="ejSave"' + (e.busy ? ' disabled' : '') + '>' + (e.busy ? 'Saving...' : 'Save to JobTread') + '</button>' +
        '<p class="small msg" id="ejMsg"></p>' +
        '<div class="ejcust"><div class="lab">Customer</div>' +
        (i.customer ? '<input id="ejCust" maxlength="100" value="' + esc(e.custName) + '">' +
          '<button class="btn" data-act="ejRename">Rename customer</button>' +
          '<p class="small muted">Renaming changes it on <b>all ' + i.customer.jobs + ' job' + (i.customer.jobs === 1 ? '' : 's') + '</b> of this customer. ' +
          'To move this job to a different customer, do it in JobTread (JobTread does not let other apps do that).</p>'
          : '<p class="small muted">This job has no customer in JobTread.</p>') +
        '<div class="lab">Add a new customer</div><input id="ejNewCust" maxlength="100" placeholder="New customer name">' +
        '<button class="btn" data-act="ejAddCust">Add customer to JobTread</button><p class="small msg" id="ejCustMsg"></p></div>') +
      '</div></main>';
    ejCount();
  }
  function ejCount() { var n = $('#ejName'), c = $('#ejCnt'); if (n && c) c.textContent = '(' + n.value.length + ' of 30)'; }
  function ejSave() {
    var e = state.ej, i = e.info; if (!i || e.busy) return;
    var f = {}; $$('.ejsel').forEach(function (s) { f[s.dataset.fid] = s.value; });
    var body = { jobId: i.id, name: $('#ejName').value, longName: $('#ejLong').value, address: $('#ejAddr').value, fields: f };
    if (body.name.trim().length < 3) { $('#ejMsg').textContent = 'The job name needs at least 3 letters.'; return; }
    e.busy = true; var b = $('[data-act="ejSave"]'); if (b) { b.disabled = true; b.textContent = 'Saving...'; }
    API.call('saveJobInfo', body).then(function (r) {
      e.busy = false;
      var j = Object.assign({}, e.job, { name: r.job.name, longName: r.job.longName });
      if (state.pickedJob && state.pickedJob.id === j.id) state.pickedJob = j;
      state.myJobs = (state.myJobs || []).map(function (m) { return m.id === j.id ? Object.assign({}, m, { name: j.name, longName: j.longName }) : m; });
      go('search'); loadActiveJobs(true); loadWoJobs(true);
      toast(r.changed ? 'Saved to JobTread (' + r.changed + ' change' + (r.changed === 1 ? '' : 's') + ').' : 'Nothing changed.');
    }).catch(function (err) { e.busy = false; if (b) { b.disabled = false; b.textContent = 'Save to JobTread'; } handleError(err, $('#ejMsg')); });
  }
  function ejRename() {
    var e = state.ej, c = e.info && e.info.customer, v = ($('#ejCust').value || '').trim(); if (!c) return;
    if (v === c.name) { $('#ejCustMsg').textContent = 'The name is the same.'; return; }
    if (!confirm('Rename customer\n"' + c.name + '"\nto\n"' + v + '"?\n\nThis changes it on all ' + c.jobs + ' jobs of this customer in JobTread.')) return;
    $('#ejCustMsg').textContent = 'Saving...';
    API.call('renameCustomer', { accountId: c.id, name: v }).then(function (r) { c.name = r.name; e.custName = r.name; $('#ejCustMsg').textContent = 'Customer renamed in JobTread.'; })
      .catch(function (err) { handleError(err, $('#ejCustMsg')); });
  }
  function ejAddCust() {
    var v = ($('#ejNewCust').value || '').trim();
    if (v.length < 2) { $('#ejCustMsg').textContent = 'Type the new customer name.'; return; }
    if (!confirm('Add the customer "' + v + '" to JobTread?')) return;
    $('#ejCustMsg').textContent = 'Saving...';
    API.call('addCustomer', { name: v }).then(function (r) { $('#ejNewCust').value = ''; $('#ejCustMsg').textContent = 'Customer "' + r.name + '" added to JobTread.'; })
      .catch(function (err) { handleError(err, $('#ejCustMsg')); });
  }

  function openMoveTemp(id) {
    var tj = (state.temps || []).filter(function (x) { return x.id === id; })[0]; if (!tj) return;
    state.mv = { temp: tj, mode: 'new', q: '', jobs: [], target: null, busy: false,
      newCust: tj.customer || '', cust: null, custs: [], name: tj.longName.replace(/^TEMP: /, ''), address: tj.address || '' };
    go('movetemp');
    if (state.mv.newCust.length >= 2) onMvCust(state.mv.newCust);
  }
  function mvKeep() { var m = state.mv; [['mvNewCust', 'newCust'], ['mvName', 'name'], ['mvAddr', 'address']].forEach(function (p) { var el = $('#' + p[0]); if (el) m[p[1]] = el.value; }); }
  function renderMoveTemp() {
    var m = state.mv, tj = m.temp, isNew = m.mode === 'new';
    var ready = isNew ? (m.name.trim().length >= 3 && (m.cust || m.newCust.trim().length >= 2)) : !!m.target;
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="mvBack">&larr; Back</button><div class="grow"><div class="title">Move temporary job</div></div></header>' +
      '<main class="page newjob"><div class="card">' +
      '<p><b>' + esc((tj.customer ? tj.customer + ' · ' : '') + tj.longName.replace(/^TEMP: /, '')) + '</b><br><span class="small muted">' + esc((tj.by || '') + ' · ' + fmtShort(tj.at) + ' · ' + (tj.photos || 0) + ' photos' + (tj.address ? ' · ' + tj.address : '')) + '</span></p>' +
      (tj.note ? '<p class="small">Note: ' + esc(tj.note) + '</p>' : '') +
      '<div class="njmode"><button class="' + (isNew ? 'on' : '') + '" data-act="mvMode" data-mode="new">Make the new job</button>' +
      '<button class="' + (isNew ? '' : 'on') + '" data-act="mvMode" data-mode="old">Job already in JobTread</button></div>' +
      (isNew ?
        '<div class="lab">Customer</div>' +
        (m.cust ? '<div class="njcust"><span class="small muted">Existing:</span> <b>' + esc(m.cust.name) + '</b> <button class="link small" data-act="mvCustClear">Change</button></div>'
          : '<input id="mvNewCust" maxlength="100" autocomplete="off" value="' + esc(m.newCust) + '" placeholder="Customer name"><div id="mvCusts" class="results"></div>') +
        '<label class="lab" for="mvName">Job name</label><input id="mvName" maxlength="100" value="' + esc(m.name) + '">' +
        '<label class="lab" for="mvAddr">Address</label><input id="mvAddr" maxlength="200" value="' + esc(m.address) + '" placeholder="Street, city">' +
        '<p class="small muted">Makes the customer (if new) and the job in JobTread with Status “A New Lead”, then copies every photo into its <b>Photos</b> folder. Originals stay in “Temporary Job Site” (Temporary / Moved).</p>'
      :
        '<label class="lab" for="mvQ">Real job in JobTread</label>' +
        (m.target ? '<div class="njcust"><b>' + esc(jn(m.target)) + '</b> <button class="link small" data-act="mvClear">Change</button></div>'
          : '<input id="mvQ" type="search" autocomplete="off" placeholder="House number and street" value="' + esc(m.q) + '"><div id="mvJobs" class="results"></div>') +
        '<p class="small muted">Every photo is copied into its <b>Photos</b> folder with its comment and tags. Originals stay in “Temporary Job Site” (Temporary / Moved).</p>') +
      '<button class="btn primary big" data-act="mvGo"' + (!ready || m.busy ? ' disabled' : '') + '>' + (m.busy ? 'Moving...' : isNew ? 'Make job and move photos' : 'Move photos') + '</button>' +
      '<p class="small msg" id="mvMsg"></p></div></main>';
    paintMvJobs(); paintMvCusts();
  }
  function paintMvCusts() {
    var box = $('#mvCusts'); if (!box) return;
    var m = state.mv;
    box.innerHTML = m.newCust.trim().length < 2 ? '' : m.custs.length
      ? '<p class="small muted">Already in JobTread? Tap to use it:</p>' + m.custs.map(function (c, i) { return '<button class="job" data-act="mvPickCust" data-i="' + i + '"><span class="name">' + esc(c.name) + '</span></button>'; }).join('')
      : '<p class="small muted">No customer with this name in JobTread. A new customer will be made.</p>';
  }
  var mvcTimer;
  function onMvCust(v) {
    var m = state.mv; m.newCust = v; clearTimeout(mvcTimer);
    var b = $('[data-act="mvGo"]'); if (b && !m.busy) b.disabled = !(m.name.trim().length >= 3 && v.trim().length >= 2);
    if (v.trim().length < 2) { m.custs = []; return paintMvCusts(); }
    mvcTimer = setTimeout(function () {
      API.call('adminCustomers', { q: v }).then(function (r) { if (state.mv === m) { m.custs = r.customers || []; paintMvCusts(); } }).catch(function () { /* list only */ });
    }, 300);
  }
  function paintMvJobs() {
    var box = $('#mvJobs'); if (!box) return;
    var m = state.mv;
    box.innerHTML = m.q.trim().length < 2 ? '' : !m.jobs.length ? '<p class="small muted">No job found.</p>' :
      m.jobs.map(function (j, i) { return '<button class="job" data-act="mvPick" data-i="' + i + '"><span class="name">' + esc(jn(j)) + '</span></button>'; }).join('');
  }
  var mvTimer;
  function onMvSearch(v) {
    var m = state.mv; m.q = v; clearTimeout(mvTimer);
    if (v.trim().length < 2) { m.jobs = []; return paintMvJobs(); }
    mvTimer = setTimeout(function () {
      API.call('searchJobs', { q: v }).then(function (r) { if (state.mv === m) { m.jobs = (r.jobs || []).filter(function (j) { return j.name !== 'Temporary Job Site'; }); paintMvJobs(); } }).catch(handleError);
    }, 300);
  }
  function runMove() {
    mvKeep();
    var m = state.mv, isNew = m.mode === 'new';
    if (!isNew && !m.target) return;
    var create = isNew ? { customerId: m.cust ? m.cust.id : '', newCustomer: m.cust ? '' : m.newCust, name: m.name, address: m.address } : null;
    var dest = isNew ? 'a NEW job “' + m.name + '” for ' + (m.cust ? 'customer ' + m.cust.name : 'NEW customer ' + m.newCust) : jn(m.target);
    if (!confirm('Copy all photos of\n' + m.temp.longName.replace(/^TEMP: /, '') + '\n\ninto\n' + dest + '?')) return;
    m.busy = true; renderMoveTemp();
    var copied = 0;
    (function step() {
      overlay(true, 'Copying photos... ' + copied + (m.temp.photos ? ' of ' + m.temp.photos : ''), m.temp.photos ? copied / m.temp.photos * 100 : 50);
      API.call('moveTemp', { tempId: m.temp.id.replace(/^T~/, ''), targetJobId: isNew ? '' : m.target.id, create: create }).then(function (r) {
        copied += r.copied;
        if (!r.done && r.copied) return step();
        overlay(false); m.busy = false;
        state.temps = (state.temps || []).filter(function (x) { return x.id !== m.temp.id; });
        var real = { id: r.jobId || (m.target && m.target.id), name: r.jobName || '', longName: isNew ? m.name : (m.target && m.target.longName) || '' };
        if (state.pickedJob && state.pickedJob.id === m.temp.id) state.pickedJob = real;
        go('search'); toast(copied + ' photo' + (copied === 1 ? '' : 's') + ' moved to ' + (r.jobName || 'the job') + '.');
      }).catch(function (e) { overlay(false); m.busy = false; renderMoveTemp(); handleError(e, $('#mvMsg')); });
    })();
  }

  function renderHelp() {
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="helpBack">&larr; Back</button><div class="grow"><div class="title">Help</div></div>' + settingsMenu() + '</header>' +
      '<main class="page help">' +
      '<h1>How to use the app</h1>' +
      '<h2>1. Pick the job</h2><p>Type the house number in <b>Find job</b>, or tap a job under <b>My jobsite</b>. Tap <b>+</b> on a found job to keep it in My jobsite; tap &times; in the list to remove it.</p>' +
      '<h2>2. To-do list</h2><p>This job\'s to-dos: tick to mark done, or <b>+ Add a to-do</b>.</p>' +
      '<h2>3. Files and plans</h2><p>Everything in one place: <b>Photos</b>, <b>Upload</b> and <b>Photo report</b> on top, then tap any plan or file to open it.</p>' +
      '<h2>4. Photos</h2><p>Browse the job photos by date or by tag. <b>Upload photos</b> adds photos from this device; <b>Make a report</b> builds the before/after PDF.</p>' +
      '<h2>My tasks</h2><p>Everything assigned to you in JobTread, across all jobs. Tick to mark done.</p>' +
      '<h2>Photos from your iPad in a report</h2><p>In a report, tap <b>&#8646;</b> on a slot or <b>+ Add photo to this section</b> to take a picture or pick one from your Photos. It stays on the device until you tap <b>Generate PDF</b>; the app then asks whether to save those new photos to the job in JobTread. Say No if one was a mistake, remove it with &times;, and generate again.</p>' +
      '<h2>Share the app with a co-worker</h2><p>Settings &rsaquo; <b>Share this app</b> sends the link by Messages, Mail or AirDrop (or copies it). They sign in with their own work email; an Admin sets what they can do.</p>' +
      '<h2>Something looks old or broken?</h2><p>Settings &rsaquo; <b>Refresh</b> loads the newest version. Your unfinished report comes back by itself.</p>' +
      '<h2>Signing in</h2><p>Use your work email. A 6-digit code arrives by email; it works for 10 minutes. You stay signed in on this device until you sign out.</p>' +
      '<h2>Can\'t save or upload?</h2><p>Your JobTread key is not set up yet. Ask Jason.</p>' +
      '<p class="small muted">HCI App &middot; questions: info@hcisf.com</p></main>';
  }

  /* ------------------------------------------------------------------ events */
  function destroySortables() { sortables.forEach(function (s) { try { s.destroy(); } catch (e) { /* gone */ } }); sortables = []; }

  document.addEventListener('click', function (ev) {
    // Menus stay open while a tap lands inside them: iPadOS drops the photo picker if its button is hidden mid-tap.
    if (!ev.target.closest('.dd, .swapmenu, .actmenu, .stf')) closeMenus();
    if (ev.target.id === 'sheet') return closeSheet();
    if (ev.target.id === 'askSheet') return closeAsk();
    var inSec = ev.target.closest('#sections .sec');
    if (inSec) setActive(Number(inSec.dataset.sec));
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var act = el.dataset.act;
    switch (act) {
      case 'sendCode': return doSendCode();
      case 'verify': return doVerify();
      case 'useOther': state.loginStep = 'email'; return renderLogin();
      case 'signOut': API.clearSession(); state.user = null; state.loginStep = 'email'; return go('login');
      case 'newJob': return openNewJob();
      case 'njBack': return go('search');
      case 'njPickCust': njKeep(); state.nj.cust = state.nj.custs[Number(el.dataset.i)]; return renderNewJob();
      case 'njCustClear': njKeep(); state.nj.cust = null; return renderNewJob();
      case 'njSf': njKeep(); state.nj.sf = el.dataset.v === '1'; renderNewJob(); if (!state.nj.sf) { var c = $('#njCity'); if (c) c.focus(); } return;
      case 'njCreate': return createNewJob();
      case 'moveTemp': return openMoveTemp(el.dataset.id);
      case 'mvBack': return go('search');
      case 'ejBack': state.ej = null; return go('search');
      case 'ejSave': return ejSave();
      case 'ejRename': return ejRename();
      case 'ejAddCust': return ejAddCust();
      case 'mvMode': mvKeep(); state.mv.mode = el.dataset.mode === 'new' ? 'new' : 'old'; return renderMoveTemp();
      case 'mvPickCust': mvKeep(); state.mv.cust = state.mv.custs[Number(el.dataset.i)]; return renderMoveTemp();
      case 'mvCustClear': mvKeep(); state.mv.cust = null; return renderMoveTemp();
      case 'mvPick': state.mv.target = state.mv.jobs[Number(el.dataset.i)]; return renderMoveTemp();
      case 'mvClear': state.mv.target = null; return renderMoveTemp();
      case 'mvGo': return runMove();
      case 'goAct': {
        var listId = (el.closest('[id]') || {}).id, gid = el.dataset.id;
        pickJob(gid);
        return openRowMenu(listId, gid);
      }
      case 'pick': {
        var pj = allKnownJobs().filter(function (j) { return j.id === el.dataset.id; })[0] || null;
        if (pj) pj = pj.temp ? pj : { id: pj.id, name: pj.name };
        state.pickedJob = pj && state.pickedJob && state.pickedJob.id === pj.id ? state.pickedJob : pj;
        if (el.closest('#results')) { state.query = ''; state.jobs = []; var qi = $('#q'); if (qi) qi.value = ''; }
        renderResults(); renderMyJobs(); renderActiveJobs(); renderWoJobs(); renderTemps(); return renderActions();
      }
      case 'menu': { ev.stopPropagation(); var m = el.nextElementSibling, open = m.hidden; closeMenus(); m.hidden = !open; el.setAttribute('aria-expanded', open); return; }
      case 'help': closeMenus(); return go('help');
      case 'helpBack': return go('search');
      case 'goTodos': case 'goAddTodo': case 'goFiles': case 'goGallery': case 'goUpload': case 'goReport': return runAction(act);
      case 'galleryBack': { var gf = state.galleryFrom; state.galleryFrom = null; return gf === 'files' && state.filesJob ? go('files') : go('search'); }
      case 'galleryUpload': return openUpload(state.gallery.job, 'gallery');
      case 'filesUpload': return openUpload(state.filesJob, 'files');
      case 'filesPhotos': state.galleryFrom = 'files'; return openGallery(state.filesJob);
      case 'filesReport': return pullJob(state.filesJob);
      case 'galleryReport': return openEditor(state.gallery.job, state.gallery.files);
      case 'galleryZoom': { var gf = state.gallery.files.filter(function (f) { return f.id === el.dataset.fid; })[0]; if (gf) { $('#preview-img').src = gf.thumb.replace(/size=\d+/, 'size=1024'); $('#preview').hidden = false; } return; }
      case 'todosBack': return go('search');
      case 'todoAdd': return addTodo();
      case 'todoShowAdd': if (state.todos && state.todos.added) { state.todos.added = null; state.todos.add = true; renderTodos(); return; } $('#todoForm').hidden = false; $('#todoShowAdd').hidden = true; $('#todoName').focus(); return;
      case 'pull': return pullPhotos();
      case 'star': ev.stopPropagation(); if (!isMyJob(el.dataset.id)) { toggleMyJob(el.dataset.id, el.dataset.name); if (isMyJob(el.dataset.id)) askManage(el.dataset.id); } return;
      case 'unstar': ev.stopPropagation(); if (isMyJob(el.dataset.id)) openRemove(el.dataset.id); return;
      case 'askClose': return closeAsk();
      case 'rmPick': state.ask.pick = el.dataset.v; return paintAsk();
      case 'rmGo': return runRemove();
      case 'mgYes': return runClaim();
      case 'pmPick': state.ask.pick = el.dataset.v; return paintAsk();
      case 'pmGo': return runAssign();
      case 'myPhotos': return pullJob(myJob(el.dataset.id));
      case 'myUpload': return openUpload(myJob(el.dataset.id), 'search');
      case 'myFiles': return openFiles(myJob(el.dataset.id), 'search');
      case 'filesOpen': return state.pickedJob ? openFiles(state.pickedJob, 'search') : toast('Pick a job first.');
      case 'editorFiles': return openFiles(state.job, 'editor');
      case 'filesBack': return go(state.filesFrom === 'editor' && state.job ? 'editor' : 'search');
      case 'fileOpen': return openFileLink(el.dataset.fid);
      case 'folderToggle': el.closest('.fgroup').classList.toggle('closed'); return;
      case 'tasks': return openTasks();
      case 'tasksBack': return go('search');
      case 'taskNote': el.closest('.task').classList.toggle('open'); return;
      case 'taskJob': return can('report') ? pullJob({ id: el.dataset.id, name: el.dataset.name }) : openFiles({ id: el.dataset.id, name: el.dataset.name }, 'search');
      case 'admin': return openAdmin();
      case 'noteToggle': state.noteOpen = !state.noteOpen; renderActions(); if (state.noteOpen) { var nt = $('#noteText'); if (nt) nt.focus(); } return;
      case 'noteDelete':
        if (state.pickedJob && confirm('Delete your notes for this job? This cannot be undone.')) { noteSet(state.pickedJob.id, ''); renderActions(); renderMyJobs(); renderActiveJobs(); renderWoJobs(); }
        return;
      case 'stfDrop': {
        var cur = (state.listSt[el.dataset.list] || []).filter(function (s) { return s !== el.dataset.st; });
        state.listSt[el.dataset.list] = cur.length ? cur : null;
        return rerenderList(el.dataset.list);
      }
      case 'stfClear': state.listSt[el.dataset.list] = null; return rerenderList(el.dataset.list);
      case 'stAll': {
        var on = el.dataset.on === '1';
        $$('.stchk').forEach(function (c) { if (c.dataset.email === el.dataset.email) c.checked = on; });
        return saveStatuses(el.dataset.email);
      }
      case 'adminExpand': {
        var openAll = el.dataset.open === '1';
        $$('.users details.user').forEach(function (d) { d.open = openAll; state.adminOpen[d.dataset.key] = openAll; });
        return;
      }
      case 'adminBack': return go('search');
      case 'featPreset': {
        var onlyReport = el.dataset.preset === 'report', pf = {};
        Object.keys(state.admin.features || {}).forEach(function (k) { pf[k] = onlyReport ? (k === 'report' || k === 'saveJT' || k === 'photos') : (k !== 'costFiles'); });
        return setFeatures(pf, $$('.featchk'));
      }
      case 'refreshApp': return refreshApp();
      case 'actMenu': ev.stopPropagation(); return toggleActMenu();
      case 'swapMenu': ev.stopPropagation(); return toggleSwapMenu(el);
      case 'runAct': closeMenus(); return runAction(el.dataset.run);
      case 'shareApp': return shareApp();
      case 'backToSearch': return go('search');
      case 'backToEditor': return go('editor');
      case 'toggle': {
        var fid = el.dataset.fid, i = state.selected.indexOf(fid);
        if (i > -1) state.selected.splice(i, 1); else state.selected.push(fid);
        return changed();
      }
      case 'swap': closeMenus(); {
        var fid0 = el.dataset.fid;
        state.replacing = state.replacing === fid0 ? null : fid0;
        renderSections(); refreshBars();
        if (state.replacing) toast('Now tap + on the new photo in the Photos list.');
        return;
      }
      case 'cancelSwap': state.replacing = null; renderSections(); return refreshBars();
      case 'addOne': ev.stopPropagation();
        if (state.replacing) return replacePhoto(state.replacing, el.closest('.ph').dataset.fid);
        return addToSection([el.closest('.ph').dataset.fid], $('#targetSec').value);
      case 'zoom': ev.stopPropagation(); return showPreview(el.closest('.ph').dataset.fid);
      case 'closePreview': $('#preview').hidden = true; return;
      case 'groupLib': state.groupBy = el.dataset.by; $$('[data-act=groupLib]').forEach(function (b) { var on = b.dataset.by === state.groupBy; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); }); return renderLibrary();
      case 'groupGal': state.groupBy = el.dataset.by; return renderGallery();
      case 'toggleSort': state.sortDesc = !state.sortDesc; el.textContent = state.sortDesc ? 'Newest first' : 'Oldest first'; return renderLibrary();
      case 'clearSel': state.selected = []; return changed();
      case 'addSel': return addToSection(state.selected.slice(), $('#targetSec').value);
      case 'addPair': return addPair();
      case 'addSection': {
        state.sections.push(newSection()); state.activeSec = state.sections[state.sections.length - 1]; state.addNew = false;
        renderSections(); changed();
        centerSection(state.sections.length - 1);
        return;
      }
      case 'setLayout': return setLayout(el.dataset.layout);
      case 'secUp': return moveSection(Number(el.dataset.si), -1);
      case 'secDown': return moveSection(Number(el.dataset.si), 1);
      case 'secDel': return removeSection(Number(el.dataset.si));
      case 'rm': {
        var f = el.dataset.fid;
        state.sections.forEach(function (s) { s.fids = s.fids.filter(function (x) { return x !== f; }); });
        if (state.replacing === f) state.replacing = null;
        renderSections(); return changed();
      }
      case 'generate': return generate();
      case 'share': return doShare();
      case 'download': return doDownload();
      case 'saveJT': return doSaveJT();
      default: return uploadAction(act, el, ev);
    }
  });

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'q') return onSearchInput(t.value);
    if (t.id === 'upq') return onUpSearch(t.value);
    if (t.id === 'njCustQ') return onCustSearch(t.value);
    if (t.id === 'mvQ') return onMvSearch(t.value);
    if (t.id === 'mvNewCust') return onMvCust(t.value);
    if (t.id === 'ejName') return ejCount();
    if (t.id === 'ejCust' && state.ej) { state.ej.custName = t.value; return; }
    if (t.id === 'mvName' && state.mv) { state.mv.name = t.value; var gb = $('[data-act="mvGo"]'); if (gb && !state.mv.busy) gb.disabled = !(t.value.trim().length >= 3 && (state.mv.cust || state.mv.newCust.trim().length >= 2)); return; }
    if (t.id === 'noteText' && state.pickedJob) {
      var had = !!noteGet(state.pickedJob.id);
      if (!noteSet(state.pickedJob.id, t.value)) { toast('Could not save the note: this device is out of space.'); return; }
      var info = $('#noteInfo'); if (info) info.textContent = (t.value.trim() ? 'Saved just now \u00b7 ' : '') + 'Only on this device, only for you. Not saved to JobTread.';
      if (had !== !!t.value.trim()) { var nb = $('.notebtn'); if (nb) nb.classList.toggle('has', !had); renderMyJobs(); renderActiveJobs(); renderWoJobs(); }
      return;
    }
    if (t.classList.contains('listq')) {
      (state.listQ = state.listQ || {})[t.dataset.list] = t.value;
      return ({ my: renderMyJobs, active: renderActiveJobs, wo: renderWoJobs })[t.dataset.list]();
    }
    if (t.classList.contains('upnote')) { var ui = upItem(t.dataset.uid); if (ui) ui.note = t.value; return; }
    if (t.id === 'repTitle') { state.report.title = t.value; return saveDraft(); }
    if (t.id === 'repAuthor') { state.report.author = t.value; return saveDraft(); }
    if (t.classList.contains('sec-title')) { state.sections[Number(t.dataset.si)].title = t.value; refreshTargets(); return saveDraft(); }
    if (t.classList.contains('sec-note-in')) { state.sections[Number(t.dataset.si)].note = t.value; return saveDraft(); }
    if (t.classList.contains('lbl')) { entry(t.dataset.fid).label = t.value; return saveDraft(); }
    if (t.classList.contains('cap')) { entry(t.dataset.fid).caption = t.value; return saveDraft(); }
  });

  document.addEventListener('focusin', function (ev) {
    var inSec = ev.target.closest && ev.target.closest('#sections .sec');
    if (inSec && Number(inSec.dataset.sec) !== activeIdx()) setActive(Number(inSec.dataset.sec));
  });

  // Remember which Admin sections are open, so a refresh of the screen keeps them as they were.
  document.addEventListener('toggle', function (ev) {
    var d = ev.target; if (!d || !d.matches || !d.matches('details.user') || !state.adminOpen) return;
    state.adminOpen[d.dataset.key] = d.open;
  }, true);
  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.id === 'fileCam' || t.id === 'fileLib') { addFiles(t.files); t.value = ''; return; }
    if (t.classList && t.classList.contains('camSlot')) { var s1 = t.files && t.files[0], fid1 = t.dataset.fid; t.value = ''; closeMenus(); if (s1) shootIntoReport(s1, null, fid1); return; }
    if (t.classList && t.classList.contains('camSec')) { var s2 = t.files && t.files[0], si2 = t.dataset.si; t.value = ''; if (s2) shootIntoReport(s2, si2); return; }
    if (t.classList && t.classList.contains('upchk')) { state.up.sel[t.dataset.uid] = t.checked; return paintBulk(); }
    if (t.classList && t.classList.contains('todochk')) return setTodoDone(t.dataset.id, t.checked, t);
    if (t.classList && t.classList.contains('taskchk')) return setTaskDone(t.dataset.id, t.checked, t);
    if (t.classList && t.classList.contains('permchk')) {
      var box = t.closest('details.user'), cnt = box && box.querySelector('.ucount');
      if (cnt) cnt.textContent = box.querySelectorAll('.permchk:checked').length + ' of ' + box.querySelectorAll('.permchk').length + ' on';
      return setPerm(t.dataset.email, t.dataset.perm, t.checked, t);
    }
    if (t.classList && t.classList.contains('stsel')) return changeStatus(t);
    if (t.classList && t.classList.contains('stchk')) return saveStatuses(t.dataset.email);
    if (t.classList && t.classList.contains('stfchk')) return onStatusFilter(t);
    if (t.classList && t.classList.contains('phasechk')) {
      var ph = $$('.phasechk').filter(function (c) { return c.checked; }).map(function (c) { return c.value; });
      $$('.phasechk').forEach(function (c) { c.disabled = true; });
      return API.call('setPhases', { phases: ph }).then(function (r) {
        state.admin.phases = r.phases; state.active = null; toast('Non Green Tree WO jobs list updated.'); $$('.phasechk').forEach(function (c) { c.disabled = false; });
      }).catch(function (e) { t.checked = !t.checked; $$('.phasechk').forEach(function (c) { c.disabled = false; }); handleError(e); });
    }
    if (t.classList && t.classList.contains('featchk')) {
      var nf = {}; Object.keys(state.admin.features || {}).forEach(function (k) { nf[k] = state.admin.features[k]; }); nf[t.dataset.perm] = t.checked;
      return setFeatures(nf, $$('.featchk'));
    }
    if (t.id === 'targetSec') {
      if (t.value === 'new') { state.addNew = true; return; }
      setActive(Number(t.value)); centerSection(Number(t.value)); return;
    }
    if (!t.classList || !t.classList.contains('lbl-sel')) return;
    var e = entry(t.dataset.fid), inp = t.parentNode.querySelector('.lbl');
    if (t.value === '__other') {
      e.other = true;
      if (e.label === 'Before Photo' || e.label === 'After Photo') e.label = '';
      inp.value = e.label; inp.hidden = false; inp.focus();
    } else {
      e.other = false; e.label = t.value; inp.value = ''; inp.hidden = true;
    }
    saveDraft();
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') { $('#preview').hidden = true; if (state.replacing) { state.replacing = null; renderSections(); refreshBars(); } }
    if (ev.key === 'Enter') {
      if (ev.target.id === 'email') doSendCode();
      else if (ev.target.id === 'code') doVerify();
      else if (ev.target.id === 'newFolder') uploadAction('sheetNewFolder');
      else if (ev.target.id === 'todoName') addTodo();
    }
  });

  /* ------------------------------------------------------------------ start */
  // Ask the browser to keep this site's saved data (notes, drafts, My jobsite) even when the device is low on space.
  function keepStorage() { try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(function () {}); } catch (e) { /* older browser */ } }
  function start() {
    keepStorage();
    if (!API.hasSession()) return go('login');
    // Open straight away with what this device knew last time; the server check runs in the background
    // and the screen is redrawn only if something changed (new switches, signed out, etc.).
    var saved = API.savedUser(), acc = API.savedAccess(), quick = !!(saved && acc && acc.perms);
    if (quick) { state.user = saved; state.perms = acc.perms; state.isAdmin = !!acc.isAdmin; state.write = acc.write || null; state.statusAllowed = acc.statusAllowed || null; state.role = acc.role || ''; afterSignIn(); }
    API.call('me').then(function (r) {
      var before = JSON.stringify([state.perms, state.isAdmin, state.write, state.statusAllowed]);
      state.user = r.user; takePerms(r);
      if (!quick) return afterSignIn();
      if (JSON.stringify([state.perms, state.isAdmin, state.write, state.statusAllowed]) !== before) render();
    }).catch(function (e) {
        if (e && e.code === 'auth') { API.clearSession(); return go('login'); }
        if (!quick) { state.user = API.savedUser(); go(state.user ? 'search' : 'login'); }
        toast(e.message);
      });
  }
  start();

  // exposed for tests
  window.__app = { state: state, openUpload: openUpload };
})();
