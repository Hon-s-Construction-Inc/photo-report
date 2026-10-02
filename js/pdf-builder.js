/*
 * pdf-builder.js — builds the HCI photo report PDF (layout modeled on the CompanyCam report).
 * Works in the browser (pass window.jspdf.jsPDF) and in Node (tests).
 *
 * data = {
 *   title, project, author, company, dateText,
 *   logo: { dataUrl, w, h } | null,
 *   sections: [{ title, note, photos: [{ dataUrl, w, h, label, caption, dateText, creator }] }]
 * }
 */
(function (root) {
  var PAGE_W = 612, PAGE_H = 792, M = 36;
  var DARK = [31, 41, 55], GREY = [138, 148, 166], CARD = [245, 245, 245],
      LINE = [229, 231, 235], BLUE = [11, 107, 211];
  var CARD_W = 270, CARD_H = 319, CARD_GAP = 20, CARD_TOP = 65;

  function setText(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

  // Shorten text with "..." so it fits maxW at the current font.
  function fit(doc, text, maxW) {
    var t = String(text || '');
    if (doc.getTextWidth(t) <= maxW) return t;
    while (t.length > 1 && doc.getTextWidth(t + '...') > maxW) t = t.slice(0, -1);
    return t + '...';
  }

  function footer(doc, left, pageNo, total, right) {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.5);
    doc.line(M, 752, PAGE_W - M, 752);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setText(doc, GREY);
    doc.text(String(left || ''), M, 768);
    doc.text(pageNo + ' / ' + total, PAGE_W / 2, 768, { align: 'center' });
    doc.text(fit(doc, right, 235), PAGE_W - M, 768, { align: 'right' });
  }

  function header(doc, title, dateText) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    setText(doc, GREY);
    doc.text(fit(doc, title, 380), M, 36);
    doc.text(String(dateText || ''), PAGE_W - M, 36, { align: 'right' });
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.5);
    doc.line(M, 45, PAGE_W - M, 45);
  }

  function drawCover(doc, d, total, N) {
    var y = 300;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    if (d.author) { setText(doc, DARK); doc.text(d.author, PAGE_W / 2, y, { align: 'center' }); y += 20; }
    if (d.company) { setText(doc, BLUE); doc.text(d.company, PAGE_W / 2, y, { align: 'center' }); y += 20; }
    setText(doc, DARK);
    doc.text((d.dateText || '') + '  |  ' + total + (total === 1 ? ' Photo' : ' Photos'), PAGE_W / 2, y, { align: 'center' });
    y += 26;
    if (d.logo && d.logo.dataUrl) {
      var lw = 200, lh = lw * d.logo.h / d.logo.w;
      doc.addImage(d.logo.dataUrl, 'JPEG', (PAGE_W - lw) / 2, y, lw, lh);
      y += lh + 38;
    } else { y += 20; }
    doc.setFont('helvetica', 'bold');
    setText(doc, DARK);
    var fs = 26, maxW = PAGE_W - 2 * M;
    doc.setFontSize(fs);
    while (fs > 18 && doc.getTextWidth(String(d.title || '')) > maxW) { fs -= 1; doc.setFontSize(fs); }
    var lines = doc.splitTextToSize(String(d.title || ''), maxW);
    doc.text(lines, PAGE_W / 2, y + 20, { align: 'center', lineHeightFactor: 1.25 });
    footer(doc, 'Cover Page', 1, N, (d.project ? d.project + '  -  ' : '') + (d.title || ''));
  }

  function drawSectionPage(doc, d, s, si, pageNo, N) {
    header(doc, d.title, d.dateText);
    var name = s.title && s.title.trim() ? s.title.trim() : 'Section ' + (si + 1);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(26);
    setText(doc, DARK);
    var y = 330;
    var tl = doc.splitTextToSize(name, PAGE_W - 2 * M);
    doc.text(tl, PAGE_W / 2, y, { align: 'center', lineHeightFactor: 1.25 });
    y += tl.length * 32 + 6;
    if (s.note && s.note.trim()) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(13);
      setText(doc, GREY);
      doc.text(doc.splitTextToSize(s.note.trim(), PAGE_W - 2 * M - 40), PAGE_W / 2, y + 10, { align: 'center', lineHeightFactor: 1.4 });
    }
    footer(doc, name, pageNo, N, d.project);
  }

  function drawPhotoCard(doc, d, s, ph, num, idx) {
    var x = M, y = CARD_TOP + idx * (CARD_H + CARD_GAP);
    doc.setFillColor(CARD[0], CARD[1], CARD[2]);
    doc.roundedRect(x, y, CARD_W, CARD_H, 4, 4, 'F');
    if (ph.dataUrl && ph.w && ph.h) {
      var sc = Math.min(CARD_W / ph.w, CARD_H / ph.h);
      var iw = ph.w * sc, ih = ph.h * sc;
      doc.addImage(ph.dataUrl, 'JPEG', x + (CARD_W - iw) / 2, y + (CARD_H - ih) / 2, iw, ih);
    } else {
      doc.setFont('helvetica', 'italic'); doc.setFontSize(9); setText(doc, GREY);
      doc.text('Image unavailable', x + CARD_W / 2, y + CARD_H / 2, { align: 'center' });
    }
    // number badge
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(x + 8, y + 8, 24, 20, 3, 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); setText(doc, DARK);
    doc.text(String(num), x + 20, y + 22, { align: 'center' });

    var tx = x + CARD_W + 16, tw = PAGE_W - M - tx;
    var ty = y + 18;
    if (ph.label) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(12); setText(doc, DARK);
      var ll = doc.splitTextToSize(ph.label, tw);
      doc.text(ll, tx, ty);
      ty += ll.length * 15 + 4;
    }
    if (ph.caption) {
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5); setText(doc, GREY);
      var cl = doc.splitTextToSize(ph.caption, tw);
      doc.text(cl.slice(0, 14), tx, ty, { lineHeightFactor: 1.35 });
    }
    // meta, bottom of card
    var rows = [['Project:', d.project], ['Date:', ph.dateText], ['Creator:', ph.creator]];
    var my = y + CARD_H - 26;
    doc.setFontSize(7.5);
    rows.forEach(function (r) {
      if (!r[1]) return;
      doc.setFont('helvetica', 'normal'); setText(doc, GREY); doc.text(r[0], tx, my);
      setText(doc, DARK); doc.text(fit(doc, r[1], tw - 38), tx + 38, my);
      my += 12;
    });
  }

  // jsPDF's built-in fonts only cover Latin-1; swap or replace anything else so text never garbles.
  function clean(t) {
    return String(t == null ? '' : t)
      .replace(/[\u2018\u2019]/g, "'").replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-').replace(/\u2026/g, '...')
      .replace(/[\u202F\u00A0]/g, ' ')
      .replace(/[^\x20-\x7E\u00A1-\u00FF\n]/g, '?');
  }

  function cleanData(d) {
    return {
      title: clean(d.title), project: clean(d.project), author: clean(d.author),
      company: clean(d.company), dateText: clean(d.dateText), logo: d.logo,
      sections: (d.sections || []).map(function (s) {
        return {
          title: clean(s.title), note: clean(s.note),
          photos: (s.photos || []).map(function (p) {
            return { dataUrl: p.dataUrl, w: p.w, h: p.h, label: clean(p.label), caption: clean(p.caption),
                     dateText: clean(p.dateText), creator: clean(p.creator) };
          })
        };
      })
    };
  }

  function buildReport(jsPDF, data) {
    var d = cleanData(data);
    var doc = new jsPDF({ unit: 'pt', format: 'letter', orientation: 'portrait', compress: true });
    var sections = (d.sections || []).filter(function (s) { return s.photos && s.photos.length; });
    var total = sections.reduce(function (n, s) { return n + s.photos.length; }, 0);

    var plan = [{ type: 'cover' }];
    sections.forEach(function (s, si) {
      plan.push({ type: 'section', s: s, si: si });
      for (var i = 0; i < s.photos.length; i += 2)
        plan.push({ type: 'photos', s: s, si: si, start: i, items: s.photos.slice(i, i + 2) });
    });
    var N = plan.length;

    plan.forEach(function (p, idx) {
      if (idx > 0) doc.addPage();
      var pageNo = idx + 1;
      if (p.type === 'cover') drawCover(doc, d, total, N);
      else if (p.type === 'section') drawSectionPage(doc, d, p.s, p.si, pageNo, N);
      else {
        header(doc, d.title, d.dateText);
        p.items.forEach(function (ph, k) { drawPhotoCard(doc, d, p.s, ph, p.start + k + 1, k); });
        var name = p.s.title && p.s.title.trim() ? p.s.title.trim() : 'Section ' + (p.si + 1);
        footer(doc, name, pageNo, N, d.project);
      }
    });
    doc.setProperties({ title: d.title || 'Photo Report', author: d.author || '', creator: 'HCI Photo Report' });
    return doc;
  }

  var api = { buildReport: buildReport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PhotoReportPDF = api;
})(typeof window !== 'undefined' ? window : globalThis);
