(function () {
  'use strict';

  var CFG = window.APP_CONFIG;
  var TZ = CFG.TIMEZONE || 'America/Los_Angeles';
  var LABELS = ['Before Photo', 'After Photo', 'Progress Photo', 'Completion Photo', 'Demolition', 'Existing Condition', 'Damage'];

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };
  var app = $('#app');

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
    query: '', jobs: [], pickedJob: null, searchSeq: 0,
    job: null, files: [], byId: {}, selected: [], sortDesc: true,
    sections: [], entries: {}, report: { title: '', author: '', dateText: '' },
    pdf: null, saved: false
  };
  var sortables = [];

  /* ------------------------------------------------------------------ routing */
  function go(view) { state.view = view; render(); }

  function render() {
    destroySortables();
    if (state.view === 'login') renderLogin();
    else if (state.view === 'search') renderSearch();
    else if (state.view === 'editor') renderEditor();
    else if (state.view === 'result') renderResult();
  }

  function handleError(err, msgEl) {
    if (err && err.code === 'auth') {
      API.clearSession(); state.user = null; state.loginStep = 'email';
      go('login'); setTimeout(function () { setMsg('Please sign in again.'); }, 0);
      return;
    }
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
      '<h1>Photo Report</h1>' +
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
      API.saveSession(r.token, r.user); state.user = r.user; go('search');
    }).catch(function (e) { handleError(e, $('#msg')); });
  }

  /* ------------------------------------------------------------------ job search */
  function renderSearch() {
    app.innerHTML =
      '<header class="topbar"><img class="logo-sm" src="icons/logo.jpg" alt="HCI"><div class="grow"><div class="title">Photo Report</div></div>' +
      '<span class="small muted">' + esc(state.user ? state.user.name : '') + '</span>' +
      '<button class="btn small" data-act="signOut">Sign out</button></header>' +
      '<main class="page"><h1>Find a job</h1>' +
      '<p class="muted">Type the house number and street, then pick the job.</p>' +
      '<input id="q" type="search" autocomplete="off" autocapitalize="off" placeholder="e.g. 1900 Gough" aria-label="Search jobs" value="' + esc(state.query) + '">' +
      '<div id="results" class="results"></div>' +
      '<div class="pullbar" id="pullbar" hidden><button class="btn primary" data-act="pull" id="pullBtn">Pull photos</button></div></main>';
    renderResults();
    $('#q').focus();
  }

  function renderResults() {
    var box = $('#results'); if (!box) return;
    if (state.query.trim().length < 2) { box.innerHTML = ''; }
    else if (!state.jobs.length) { box.innerHTML = '<p class="muted">No jobs found. Try fewer words or just the house number.</p>'; }
    else {
      box.innerHTML = state.jobs.map(function (j) {
        var picked = state.pickedJob && state.pickedJob.id === j.id;
        return '<button class="job' + (picked ? ' picked' : '') + '" data-act="pick" data-id="' + esc(j.id) + '">' +
          '<span class="name">' + esc(j.name) + '<div class="sub">Created ' + esc(fmtShort(j.createdAt)) + '</div></span>' +
          '<span class="badge' + (j.photoCount ? ' has' : '') + '">' + (j.photoCount ? 'Has photos' : 'No photos') + '</span></button>';
      }).join('');
    }
    var bar = $('#pullbar');
    if (bar) {
      bar.hidden = !state.pickedJob;
      var b = $('#pullBtn'); if (b && state.pickedJob) b.textContent = 'Pull photos for ' + state.pickedJob.name;
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

  /* ------------------------------------------------------------------ pull photos */
  function pullPhotos() {
    var job = state.pickedJob; if (!job) return;
    overlay(true, 'Pulling photos...', 3);
    var all = [], page = null;
    function next() {
      return API.call('listPhotos', { jobId: job.id, page: page }).then(function (r) {
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
  function draftKey() { return 'hci_pr_draft_' + state.job.id; }

  function openEditor(job, files) {
    state.job = { id: job.id, name: job.name };
    state.files = files; state.byId = {}; files.forEach(function (f) { state.byId[f.id] = f; });
    state.selected = []; state.sortDesc = true; state.pdf = null; state.saved = false;
    state.sections = []; state.entries = {};
    state.report = {
      title: job.name + ' Photo Report',
      author: state.user ? titleCase(state.user.name) : '',
      dateText: fmtToday()
    };
    try {
      var d = JSON.parse(localStorage.getItem(draftKey()) || 'null');
      if (d && d.sections) {
        state.sections = d.sections.map(function (s) {
          return { title: s.title || '', note: s.note || '', fids: (s.fids || []).filter(function (id) { return state.byId[id]; }) };
        });
        state.entries = d.entries || {};
        if (d.report) { state.report.title = d.report.title || state.report.title; state.report.author = d.report.author || state.report.author; }
        if (state.sections.length) setTimeout(function () { toast('Restored your unfinished report for this job.'); }, 300);
      }
    } catch (e) { /* ignore bad draft */ }
    if (!state.sections.length) state.sections = [newSection()];
    go('editor');
  }

  function newSection() { return { title: '', note: '', fids: [] }; }
  function entry(fid) { return state.entries[fid] || (state.entries[fid] = { label: '', caption: '' }); }
  function usedSet() { var s = {}; state.sections.forEach(function (sec) { sec.fids.forEach(function (f) { s[f] = true; }); }); return s; }
  function photoTotal() { return state.sections.reduce(function (n, s) { return n + s.fids.length; }, 0); }

  var saveTimer;
  function saveDraft() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () {
      if (!state.job) return;
      try { localStorage.setItem(draftKey(), JSON.stringify({ sections: state.sections, entries: state.entries, report: state.report })); } catch (e) { /* storage full */ }
    }, 400);
  }

  function renderEditor() {
    app.innerHTML =
      '<header class="topbar"><button class="btn small" data-act="backToSearch">&larr; Jobs</button>' +
      '<div class="grow"><div class="title">' + esc(state.job.name) + '</div></div>' +
      '<span class="small muted">' + state.files.length + ' photos</span></header>' +
      '<div class="editor">' +
      '<section class="panel" aria-label="Photos"><header><h2 class="grow">Photos</h2>' +
      '<button class="btn small" data-act="toggleSort">' + (state.sortDesc ? 'Newest first' : 'Oldest first') + '</button>' +
      '<button class="btn small" data-act="clearSel">Clear selection</button></header>' +
      '<div class="lib" id="lib"></div>' +
      '<div class="addbar"><span id="selCount" class="small muted">Tap photos to select, or drag them into the report.</span>' +
      '<select id="targetSec" aria-label="Add to section"></select>' +
      '<button class="btn small primary" data-act="addSel" id="addSelBtn">Add</button>' +
      '<button class="btn small" data-act="addPair" id="addPairBtn">Before + After</button></div></section>' +
      '<section class="panel" aria-label="Report"><header><h2 class="grow">Report</h2>' +
      '<button class="btn small" data-act="addSection">+ Section</button></header>' +
      '<div class="fields">' +
      '<label for="repTitle">Report title</label><input id="repTitle" value="' + esc(state.report.title) + '">' +
      '<label for="repAuthor">Prepared by</label><input id="repAuthor" value="' + esc(state.report.author) + '"></div>' +
      '<div id="sections"></div>' +
      '<div class="reportbar"><button class="btn primary" data-act="generate" id="genBtn">Generate PDF</button></div></section>' +
      '</div><datalist id="labels">' + LABELS.map(function (l) { return '<option value="' + esc(l) + '">'; }).join('') + '</datalist>';
    renderLibrary(); renderSections(); refreshBars();
  }

  function sortedFiles() {
    return state.files.slice().sort(function (a, b) {
      return state.sortDesc ? (a.createdAt < b.createdAt ? 1 : -1) : (a.createdAt < b.createdAt ? -1 : 1);
    });
  }

  function renderLibrary() {
    var lib = $('#lib'); if (!lib) return;
    var used = usedSet();
    lib.innerHTML = sortedFiles().map(function (f) {
      var idx = state.selected.indexOf(f.id);
      return '<div class="ph' + (idx > -1 ? ' sel' : '') + (used[f.id] ? ' in-report' : '') + '" data-fid="' + esc(f.id) + '" data-act="toggle">' +
        '<img loading="lazy" src="' + esc(f.thumb) + '" alt="' + esc(f.name) + '">' +
        '<span class="num">' + (idx > -1 ? idx + 1 : '') + '</span><span class="used">In report</span>' +
        '<button class="zoom" data-act="zoom" aria-label="Enlarge">&#10530;</button>' +
        '<span class="when">' + esc(fmtShort(f.createdAt)) + '</span></div>';
    }).join('');
    var s = Sortable.create(lib, {
      group: { name: 'photos', pull: 'clone', put: false }, sort: false, animation: 150,
      delay: 160, delayOnTouchOnly: true, filter: '.zoom', preventOnFilter: false
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
      return '<div class="sec" data-sec="' + si + '">' +
        '<div class="sec-head"><input class="sec-title" data-si="' + si + '" placeholder="Section ' + (si + 1) + '" value="' + esc(sec.title) + '" aria-label="Section title">' +
        '<div class="tools"><button class="icon-btn" data-act="secUp" data-si="' + si + '" aria-label="Move up">&uarr;</button>' +
        '<button class="icon-btn" data-act="secDown" data-si="' + si + '" aria-label="Move down">&darr;</button>' +
        '<button class="icon-btn" data-act="secDel" data-si="' + si + '" aria-label="Delete section">&times;</button></div></div>' +
        '<div class="sec-note"><input class="sec-note-in" data-si="' + si + '" placeholder="Description (optional)" value="' + esc(sec.note) + '" aria-label="Section description"></div>' +
        '<ul class="sec-list" data-sec="' + si + '">' + sec.fids.map(rowHtml).join('') + '</ul></div>';
    }).join('');
    $$('.sec-list', box).forEach(function (ul) {
      sortables.push(Sortable.create(ul, {
        group: { name: 'photos', pull: true, put: true }, animation: 150, handle: '.thumb',
        delay: 120, delayOnTouchOnly: true, ghostClass: 'sortable-ghost',
        onAdd: onListAdd, onUpdate: syncFromDom
      }));
    });
    refreshTargets();
  }

  function rowHtml(fid) {
    var f = state.byId[fid]; if (!f) return '';
    var e = entry(fid);
    return '<li class="row" data-fid="' + esc(fid) + '">' +
      '<img class="thumb" src="' + esc(f.thumb) + '" alt="">' +
      '<div class="meta"><input class="lbl" data-fid="' + esc(fid) + '" list="labels" placeholder="Label (e.g. Before Photo)" value="' + esc(e.label) + '" aria-label="Photo label">' +
      '<textarea class="cap" data-fid="' + esc(fid) + '" placeholder="Caption (optional)" aria-label="Caption">' + esc(e.caption) + '</textarea>' +
      '<div class="sub">' + esc(fmtDateTime(f.createdAt)) + (f.by ? ' &middot; ' + esc(f.by) : '') + '</div></div>' +
      '<button class="icon-btn" data-act="rm" data-fid="' + esc(fid) + '" aria-label="Remove photo">&times;</button></li>';
  }

  function refreshTargets() {
    var sel = $('#targetSec'); if (!sel) return;
    var cur = sel.value;
    sel.innerHTML = state.sections.map(function (s, i) {
      return '<option value="' + i + '">' + esc(s.title || 'Section ' + (i + 1)) + '</option>';
    }).join('') + '<option value="new">New section</option>';
    if (cur && sel.querySelector('option[value="' + cur + '"]')) sel.value = cur;
  }

  function refreshBars() {
    var n = state.selected.length;
    var c = $('#selCount');
    if (c) c.textContent = n ? n + ' selected' : 'Tap photos to select, or drag them into the report.';
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

  function changed() { refreshLibraryMarks(); refreshBars(); refreshTargets(); saveDraft(); }

  // Drop from the photo library into a section.
  function onListAdd(evt) {
    var fid = evt.item.dataset.fid;
    var already = usedSet()[fid];
    if (already) { evt.item.remove(); toast('That photo is already in the report.'); return; }
    syncFromDom();
  }

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
    add.forEach(function (f) { entry(f); state.sections[si].fids.push(f); });
    state.selected = state.selected.filter(function (f) { return add.indexOf(f) === -1; });
    renderSections(); changed();
    toast('Added ' + add.length + ' photo' + (add.length === 1 ? '' : 's') + ' to ' + (state.sections[si].title || 'Section ' + (si + 1)) + '.');
  }

  function addPair() {
    if (state.selected.length !== 2) return;
    var a = state.selected[0], b = state.selected[1];
    var used = usedSet();
    if (used[a] || used[b]) { toast('One of those photos is already in the report.'); return; }
    state.sections.push({ title: '', note: '', fids: [a, b] });
    entry(a).label = 'Before Photo'; entry(b).label = 'After Photo';
    state.selected = [];
    renderSections(); changed();
    toast('Added as Before + After (first photo you tapped = Before).');
  }

  function removeSection(si) {
    var s = state.sections[si];
    if (s.fids.length && !confirm('Remove this section and its ' + s.fids.length + ' photo(s) from the report? The photos stay in JobTread.')) return;
    state.sections.splice(si, 1);
    if (!state.sections.length) state.sections.push(newSection());
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
        title: state.report.title, project: state.job.name, author: state.report.author,
        company: CFG.COMPANY, dateText: state.report.dateText, logo: logo,
        sections: state.sections.map(function (s) {
          return {
            title: s.title, note: s.note,
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
      '<div class="grow"><div class="title">' + esc(state.job.name) + '</div></div></header>' +
      '<main class="page result"><div class="card">' +
      '<h1>Your report is ready</h1>' +
      '<div class="summary"><span>' + p.pages + ' pages</span><span>' + p.photos + ' photos</span><span>' + mb + ' MB</span></div>' +
      (p.failed ? '<div class="warn">' + p.failed + ' photo(s) could not be loaded and show as "Image unavailable". Go back, remove them, or try again.</div>' : '') +
      '<label class="small muted" for="fname">File name</label><input id="fname" value="' + esc(p.name) + '">' +
      '<div class="actions">' +
      '<button class="btn primary" data-act="share">Email / Share</button>' +
      '<a class="btn" style="text-align:center;text-decoration:none;display:flex;align-items:center;justify-content:center" href="' + esc(p.url) + '" target="_blank" rel="noopener">Open preview</a>' +
      '<button class="btn" data-act="download">Download</button>' +
      '<button class="btn" data-act="saveJT" id="saveBtn"' + (state.saved ? ' disabled' : '') + '>' + (state.saved ? 'Saved to JobTread' : 'Save to JobTread (Reports folder)') + '</button>' +
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
      setMsg('Saved in JobTread: ' + state.job.name + ' > Files > ' + (r.folder || 'Reports') + ' > ' + r.name, true);
    }).catch(function (e) { overlay(false); handleError(e, $('#msg')); });
  }

  /* ------------------------------------------------------------------ events */
  function destroySortables() { sortables.forEach(function (s) { try { s.destroy(); } catch (e) { /* gone */ } }); sortables = []; }

  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-act]'); if (!el) return;
    var act = el.dataset.act;
    switch (act) {
      case 'sendCode': return doSendCode();
      case 'verify': return doVerify();
      case 'useOther': state.loginStep = 'email'; return renderLogin();
      case 'signOut': API.clearSession(); state.user = null; state.loginStep = 'email'; return go('login');
      case 'pick':
        state.pickedJob = state.jobs.filter(function (j) { return j.id === el.dataset.id; })[0] || null;
        return renderResults();
      case 'pull': return pullPhotos();
      case 'backToSearch': return go('search');
      case 'backToEditor': return go('editor');
      case 'toggle': {
        var fid = el.dataset.fid, i = state.selected.indexOf(fid);
        if (i > -1) state.selected.splice(i, 1); else state.selected.push(fid);
        return changed();
      }
      case 'zoom': ev.stopPropagation(); return showPreview(el.closest('.ph').dataset.fid);
      case 'closePreview': $('#preview').hidden = true; return;
      case 'toggleSort': state.sortDesc = !state.sortDesc; el.textContent = state.sortDesc ? 'Newest first' : 'Oldest first'; return renderLibrary();
      case 'clearSel': state.selected = []; return changed();
      case 'addSel': return addToSection(state.selected.slice(), $('#targetSec').value);
      case 'addPair': return addPair();
      case 'addSection': state.sections.push(newSection()); renderSections(); return changed();
      case 'secUp': return moveSection(Number(el.dataset.si), -1);
      case 'secDown': return moveSection(Number(el.dataset.si), 1);
      case 'secDel': return removeSection(Number(el.dataset.si));
      case 'rm': {
        var f = el.dataset.fid;
        state.sections.forEach(function (s) { s.fids = s.fids.filter(function (x) { return x !== f; }); });
        renderSections(); return changed();
      }
      case 'generate': return generate();
      case 'share': return doShare();
      case 'download': return doDownload();
      case 'saveJT': return doSaveJT();
    }
  });

  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.id === 'q') return onSearchInput(t.value);
    if (t.id === 'repTitle') { state.report.title = t.value; return saveDraft(); }
    if (t.id === 'repAuthor') { state.report.author = t.value; return saveDraft(); }
    if (t.classList.contains('sec-title')) { state.sections[Number(t.dataset.si)].title = t.value; refreshTargets(); return saveDraft(); }
    if (t.classList.contains('sec-note-in')) { state.sections[Number(t.dataset.si)].note = t.value; return saveDraft(); }
    if (t.classList.contains('lbl')) { entry(t.dataset.fid).label = t.value; return saveDraft(); }
    if (t.classList.contains('cap')) { entry(t.dataset.fid).caption = t.value; return saveDraft(); }
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.key === 'Escape') $('#preview').hidden = true;
    if (ev.key === 'Enter') {
      if (ev.target.id === 'email') doSendCode();
      else if (ev.target.id === 'code') doVerify();
    }
  });

  /* ------------------------------------------------------------------ start */
  function start() {
    if (!API.hasSession()) return go('login');
    API.call('me').then(function (r) { state.user = r.user; go('search'); })
      .catch(function (e) {
        if (e && e.code === 'auth') { API.clearSession(); return go('login'); }
        state.user = API.savedUser(); go(state.user ? 'search' : 'login');
        toast(e.message);
      });
  }
  start();

  // exposed for tests
  window.__app = { state: state };
})();
