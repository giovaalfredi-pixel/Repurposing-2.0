const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = process.env.PORT || 3000;
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';

function indexOf(buf, search, start) {
  start = start || 0;
  for (var i = start; i <= buf.length - search.length; i++) {
    var found = true;
    for (var j = 0; j < search.length; j++) {
      if (buf[i + j] !== search[j]) { found = false; break; }
    }
    if (found) return i;
  }
  return -1;
}

function parseMultipart(buffer, boundary) {
  var parts = [];
  var sep = Buffer.from('--' + boundary);
  var pos = 0;
  while (pos < buffer.length) {
    var start = indexOf(buffer, sep, pos);
    if (start === -1) break;
    pos = start + sep.length;
    if (buffer.slice(pos, pos + 2).toString() === '--') break;
    pos += 2;
    var headerEnd = indexOf(buffer, Buffer.from('\r\n\r\n'), pos);
    if (headerEnd === -1) break;
    var headerStr = buffer.slice(pos, headerEnd).toString();
    pos = headerEnd + 4;
    var nextBound = indexOf(buffer, sep, pos);
    var dataEnd = nextBound === -1 ? buffer.length : nextBound - 2;
    var data = buffer.slice(pos, dataEnd);
    pos = nextBound;
    var disp = (headerStr.match(/Content-Disposition:[^\r\n]*/i) || [''])[0];
    var nameMatch = disp.match(/name="([^"]+)"/);
    var fileMatch = disp.match(/filename="([^"]+)"/);
    parts.push({ name: nameMatch ? nameMatch[1] : '', filename: fileMatch ? fileMatch[1] : null, data: data });
  }
  return parts;
}

function mkRng(seed) {
  var s = seed;
  return function() { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function buildFilters(options, seed, strength) {
  var r = mkRng(seed);
  var vf = [];
  var af = [];

  if (options.mirror && r() > 0.5) vf.push('hflip'); else r();
  if (options.crop) {
    var cp = (0.01 + r() * 0.02 * (strength / 5)).toFixed(4);
    var sc = (1 - parseFloat(cp) * 2).toFixed(4);
    vf.push('crop=iw*' + sc + ':ih*' + sc + ':iw*' + cp + ':ih*' + cp);
    vf.push('scale=trunc(iw/2)*2:trunc(ih/2)*2');
  }
  if (options.rotation) {
    var rad = ((r() - 0.5) * 0.008 * (strength / 5)).toFixed(5);
    vf.push('rotate=' + rad + ':fillcolor=black');
  }
  if (options.brightness) {
    var bv = ((r() - 0.5) * 0.08 * (strength / 5)).toFixed(3);
    var cv = (1 + (r() - 0.5) * 0.06 * (strength / 5)).toFixed(3);
    vf.push('eq=brightness=' + bv + ':contrast=' + cv);
  }
  if (options.saturation) {
    var sv = (1 + (r() - 0.5) * 0.15 * (strength / 5)).toFixed(3);
    vf.push('hue=s=' + sv);
  }
  if (options.vignette) vf.push('vignette');
  if (options.noise) {
    var ns = Math.max(1, Math.round(3 * (strength / 10)));
    vf.push('noise=alls=' + ns + ':allf=t+u');
  }
  if (options.speed) {
    var dir = r() > 0.5 ? 1 : -1;
    var spd = 1 + dir * (0.05 + r() * 0.05 * (strength / 10));
    spd = Math.max(0.88, Math.min(1.12, spd));
    vf.push('setpts=' + (1 / spd).toFixed(4) + '*PTS');
    af.push('atempo=' + spd.toFixed(4));
  }
  var gain = (0.97 + r() * 0.06).toFixed(3);
  af.push('volume=' + gain);

  return {
    vf: vf.length ? vf.join(',') : 'null',
    af: af.length ? af.join(',') : 'anull'
  };
}

function processVideo(inputPath, outputPath, filters) {
  return new Promise(function(resolve, reject) {
    var args = ['-i', inputPath, '-vf', filters.vf, '-af', filters.af,
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '22',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', '-y', outputPath];
    execFile(FFMPEG, args, { timeout: 300000 }, function(err, stdout, stderr) {
      if (err) reject(new Error(stderr || err.message));
      else resolve();
    });
  });
}

var HTML = `<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Myra - Video Spoofer</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=Syne:wght@700;800&display=swap');
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{--bg:#f0f2f5;--sur:#fff;--bor:#e2e5ea;--acc:#3b5bdb;--red:#f03e3e;--txt:#1a1d23;--mut:#7c8290;--r:14px}
body{font-family:'DM Sans',sans-serif;background:var(--bg);color:var(--txt);min-height:100vh;display:flex;flex-direction:column;align-items:center;padding-bottom:60px}
.topbar{width:100%;background:var(--sur);border-bottom:1px solid var(--bor);display:flex;align-items:center;padding:0 20px;height:56px;gap:10px;position:sticky;top:0;z-index:100}
.logo{font-family:'Syne',sans-serif;font-weight:800;font-size:18px;display:flex;align-items:center;gap:7px}
.dot{width:8px;height:8px;background:var(--acc);border-radius:50%;display:inline-block}
.tag{margin-left:auto;font-size:12px;background:#eef2ff;color:var(--acc);padding:4px 10px;border-radius:20px;font-weight:500}
.main{width:100%;max-width:700px;padding:20px 14px 0;display:flex;flex-direction:column;gap:14px}
.ptitle{font-family:'Syne',sans-serif;font-size:22px;font-weight:800;letter-spacing:-0.5px}
.psub{font-size:13px;color:var(--mut);margin-top:4px;line-height:1.5}
.card{background:var(--sur);border:1px solid var(--bor);border-radius:var(--r);padding:18px;box-shadow:0 2px 10px rgba(0,0,0,0.05)}
.sl{font-size:10px;font-weight:700;letter-spacing:1.2px;text-transform:uppercase;color:var(--mut);margin-bottom:12px}
.badge{background:#fff3e0;color:#e65100;font-size:10px;font-weight:700;padding:2px 7px;border-radius:5px}
.ulabel{display:flex;flex-direction:column;align-items:center;gap:8px;border:2px dashed var(--bor);border-radius:12px;padding:28px 16px;background:#fafbfc;cursor:pointer;transition:all .2s;text-align:center;-webkit-tap-highlight-color:transparent}
.ulabel:active{border-color:var(--acc);background:#eef2ff}
.flist{display:flex;flex-direction:column;gap:7px;margin-top:10px}
.fitem{display:flex;align-items:center;gap:9px;background:#f6f8fb;border-radius:8px;padding:8px 11px;font-size:13px}
.fname{flex:1;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.fsize{color:var(--mut);font-size:11px;white-space:nowrap}
.frem{background:none;border:none;cursor:pointer;color:var(--mut);font-size:15px;padding:3px 7px;border-radius:4px;min-width:30px;min-height:30px}
.frem:active{background:#ffe3e3;color:var(--red)}
.vrow{display:flex;gap:7px;flex-wrap:wrap}
.vbtn{min-width:44px;height:38px;border-radius:8px;border:1.5px solid var(--bor);background:transparent;font-size:14px;font-weight:600;cursor:pointer;color:var(--txt);transition:all .15s;padding:0 8px;-webkit-tap-highlight-color:transparent}
.vbtn.on{background:var(--acc);border-color:var(--acc);color:#fff}
.trow{display:flex;align-items:center;gap:11px;padding:12px 0;border-bottom:1px solid var(--bor);cursor:pointer;-webkit-tap-highlight-color:transparent}
.trow:last-child{border-bottom:none}
.temoji{font-size:18px;width:24px;text-align:center;flex-shrink:0}
.tinfo{flex:1}
.tname{font-weight:500;font-size:14px}
.tdesc{font-size:11px;color:var(--mut);margin-top:2px}
.tcheck{width:22px;height:22px;border-radius:5px;border:1.5px solid var(--bor);background:white;display:flex;align-items:center;justify-content:center;flex-shrink:0;transition:all .15s}
.tcheck.on{background:var(--acc);border-color:var(--acc)}
.tcheck.on::after{content:'';width:10px;height:6px;border-left:2px solid white;border-bottom:2px solid white;transform:rotate(-45deg) translateY(-1px);display:block}
.srow{display:flex;align-items:center;gap:12px;margin-top:12px;padding-top:12px;border-top:1px solid var(--bor)}
.slbl{font-size:12px;font-weight:500;color:var(--mut);width:56px}
input[type=range]{flex:1;-webkit-appearance:none;height:5px;background:var(--bor);border-radius:3px;outline:none;cursor:pointer}
input[type=range]::-webkit-slider-thumb{-webkit-appearance:none;width:22px;height:22px;background:var(--acc);border-radius:50%;border:3px solid white;box-shadow:0 1px 6px rgba(59,91,219,.35);cursor:pointer}
.sval{width:22px;text-align:right;font-weight:700;font-size:15px;color:var(--acc)}
.mrow{background:#f6f8fb;border-radius:8px;padding:9px 12px;font-size:11px;display:flex;flex-wrap:wrap;gap:4px 12px;align-items:center;margin-bottom:5px}
.mlbl{font-weight:700;color:var(--acc);min-width:60px}
.rbtn{background:none;border:1.5px solid var(--bor);border-radius:8px;padding:7px 14px;font-size:12px;font-weight:600;cursor:pointer;color:var(--mut);font-family:inherit;margin-top:6px;-webkit-tap-highlight-color:transparent}
.notice{background:#eef2ff;border:1px solid #c5d0f5;border-radius:10px;padding:11px 14px;font-size:12px;color:#3b5bdb;line-height:1.5}
.pbtn{width:100%;padding:16px;background:var(--acc);color:white;font-family:'Syne',sans-serif;font-size:16px;font-weight:700;border:none;border-radius:12px;cursor:pointer;transition:all .2s;-webkit-tap-highlight-color:transparent}
.pbtn:active:not(:disabled){background:#2f4ac7;transform:scale(0.99)}
.pbtn:disabled{background:var(--bor);color:var(--mut);cursor:not-allowed}
.pw{display:none}.pw.show{display:block}
.plbl{font-size:12px;color:var(--mut);margin-bottom:8px;font-weight:500}
.pbg{height:6px;background:var(--bor);border-radius:3px;overflow:hidden;margin-bottom:6px}
.pfill{height:100%;background:var(--acc);border-radius:3px;width:0%;transition:width .4s}
.ppct{font-size:11px;color:var(--mut);text-align:center}
.ogrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px}
.ocard{background:#f6f8fb;border-radius:10px;overflow:hidden;border:1px solid var(--bor)}
.ocard video{width:100%;aspect-ratio:9/16;object-fit:cover;display:block;background:#111}
.oinfo{padding:8px 10px;display:flex;align-items:center;justify-content:space-between;gap:6px}
.oname{font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1}
.dlbtn{background:var(--acc);color:white;border:none;border-radius:6px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;text-decoration:none;white-space:nowrap;display:inline-block;-webkit-tap-highlight-color:transparent}
.ometa{padding:5px 10px 9px;border-top:1px solid var(--bor);font-size:10px;color:var(--mut);line-height:1.8}
</style>
</head>
<body>
<div class="topbar">
  <div class="logo"><span class="dot"></span>Myra</div>
  <span style="font-size:12px;color:var(--mut)">/ Repurpose</span>
  <div class="tag">&#127916; Spoofer</div>
</div>
<div class="main">
  <div>
    <div class="ptitle">&#127916; Video Spoofer</div>
    <div class="psub">Modifiche invisibili — audio + video con FFmpeg. Privato, nessun server esterno.</div>
  </div>

  <div class="card">
    <input type="file" id="fileInput" accept="video/*" multiple style="display:none">
    <label for="fileInput" class="ulabel" id="uploadArea">
      <div style="font-size:34px">&#127909;</div>
      <div style="font-weight:600;font-size:15px">Tocca per scegliere video</div>
      <div style="font-size:12px;color:var(--mut)">MP4, MOV &middot; batch OK</div>
    </label>
    <div class="flist" id="fileList"></div>
  </div>

  <div class="card">
    <div class="sl">Varianti per video</div>
    <div class="vrow" id="varRow">
      <button class="vbtn on" id="vb1">1</button>
      <button class="vbtn" id="vb3">3</button>
      <button class="vbtn" id="vb5">5</button>
      <button class="vbtn" id="vb10">10</button>
      <button class="vbtn" id="vbown" style="padding:0 12px;font-size:13px">Proprio</button>
    </div>
    <div id="ownWrap" style="display:none;margin-top:10px">
      <input type="number" id="ownNum" min="1" max="50" value="7"
        style="width:70px;padding:8px 10px;border-radius:8px;border:1.5px solid var(--bor);font-size:14px;font-family:inherit">
    </div>
    <div id="varDesc" style="font-size:12px;color:var(--mut);margin-top:8px">1 variante per video</div>
  </div>

  <div class="card">
    <div class="sl">Modifiche</div>
    <div id="toggleContainer"></div>
    <div class="srow">
      <span class="slbl">Intensit&agrave;</span>
      <input type="range" min="1" max="10" value="4" id="strengthRange">
      <span class="sval" id="strengthVal">4</span>
    </div>
  </div>

  <div class="card">
    <div class="sl">Metadata <span class="badge">&#127922; auto per variante</span></div>
    <div style="font-size:12px;color:var(--mut);margin-bottom:12px">Dispositivo, GPS negli US e data randomizzati per ogni variante.</div>
    <div id="metaContainer"></div>
    <button class="rbtn" id="regenBtn">&#127922; Rigenera anteprima</button>
  </div>

  <div class="notice">&#128274; <strong>Privato</strong> &mdash; I file vengono processati e cancellati immediatamente.</div>

  <button class="pbtn" id="processBtn" disabled>&#10024; Genera Varianti</button>

  <div class="card pw" id="progressWrap">
    <div class="plbl" id="progressLabel">Elaborazione...</div>
    <div class="pbg"><div class="pfill" id="progressFill"></div></div>
    <div class="ppct" id="progressPct">0%</div>
  </div>

  <div class="card" id="outputCard" style="display:none">
    <div class="sl">Output</div>
    <div class="ogrid" id="outputGrid"></div>
  </div>
</div>

<script>
// ── Toggles ──────────────────────────────────────────────────────────────────
var TOGGLES = [
  { id: 'mirror',     emoji: '🪞', name: 'Specchio Orizzontale', desc: 'Flip 50% probabilita per variante', on: true  },
  { id: 'crop',       emoji: '✂️', name: 'Crop Casuale',         desc: 'Taglia 1-3% dai bordi',            on: true  },
  { id: 'speed',      emoji: '⚡', name: 'Velocita Variabile',   desc: '+-5-10% rompe audio fingerprint',   on: true  },
  { id: 'noise',      emoji: '📺', name: 'Micro Noise',          desc: 'Grain invisibile, cambia hash',     on: true  },
  { id: 'rotation',   emoji: '🔄', name: 'Rotazione Tiny',       desc: '0.1-0.5 gradi casuale',            on: true  },
  { id: 'brightness', emoji: '☀️', name: 'Luminosita',           desc: 'Off = qualita originale',           on: false },
  { id: 'saturation', emoji: '🎨', name: 'Saturazione',          desc: 'Off = qualita originale',           on: false },
  { id: 'vignette',   emoji: '🌑', name: 'Vignetta',             desc: 'Sconsigliato',                     on: false }
];

function buildToggles() {
  var container = document.getElementById('toggleContainer');
  container.innerHTML = '';
  TOGGLES.forEach(function(t) {
    var row = document.createElement('div');
    row.className = 'trow';
    row.innerHTML =
      '<span class="temoji">' + t.emoji + '</span>' +
      '<div class="tinfo"><div class="tname">' + t.name + '</div><div class="tdesc">' + t.desc + '</div></div>' +
      '<div class="tcheck' + (t.on ? ' on' : '') + '" id="check_' + t.id + '"></div>';
    row.addEventListener('click', function() {
      t.on = !t.on;
      document.getElementById('check_' + t.id).className = 'tcheck' + (t.on ? ' on' : '');
    });
    container.appendChild(row);
  });
}
buildToggles();

function getOptions() {
  var opts = {};
  TOGGLES.forEach(function(t) { opts[t.id] = t.on; });
  return opts;
}

// ── Strength slider ───────────────────────────────────────────────────────────
document.getElementById('strengthRange').addEventListener('input', function() {
  document.getElementById('strengthVal').textContent = this.value;
});

// ── Files ────────────────────────────────────────────────────────────────────
var FILES = [];

document.getElementById('fileInput').addEventListener('change', function() {
  var newFiles = Array.prototype.slice.call(this.files);
  FILES = FILES.concat(newFiles);
  renderFiles();
  updateProcessBtn();
});

function renderFiles() {
  var list = document.getElementById('fileList');
  if (!FILES.length) { list.innerHTML = ''; return; }
  list.innerHTML = '';
  FILES.forEach(function(f, i) {
    var item = document.createElement('div');
    item.className = 'fitem';
    item.innerHTML =
      '<span style="font-size:18px">🎬</span>' +
      '<span class="fname">' + f.name + '</span>' +
      '<span class="fsize">' + (f.size / 1024 / 1024).toFixed(1) + ' MB</span>' +
      '<button class="frem" data-i="' + i + '">✕</button>';
    item.querySelector('.frem').addEventListener('click', function() {
      FILES.splice(parseInt(this.getAttribute('data-i')), 1);
      renderFiles();
      updateProcessBtn();
    });
    list.appendChild(item);
  });
}

function updateProcessBtn() {
  document.getElementById('processBtn').disabled = FILES.length === 0;
}

// ── Variants ──────────────────────────────────────────────────────────────────
var NV = 1;
var vbtns = [
  { el: document.getElementById('vb1'),   val: 1    },
  { el: document.getElementById('vb3'),   val: 3    },
  { el: document.getElementById('vb5'),   val: 5    },
  { el: document.getElementById('vb10'),  val: 10   },
  { el: document.getElementById('vbown'), val: 'own'}
];

vbtns.forEach(function(b) {
  b.el.addEventListener('click', function() {
    vbtns.forEach(function(x) { x.el.classList.remove('on'); });
    b.el.classList.add('on');
    var ownWrap = document.getElementById('ownWrap');
    if (b.val === 'own') {
      ownWrap.style.display = 'block';
      NV = parseInt(document.getElementById('ownNum').value) || 1;
    } else {
      ownWrap.style.display = 'none';
      NV = b.val;
    }
    document.getElementById('varDesc').textContent = NV + ' variante' + (NV !== 1 ? 'i' : '') + ' per video';
  });
});

document.getElementById('ownNum').addEventListener('change', function() {
  NV = parseInt(this.value) || 1;
  document.getElementById('varDesc').textContent = NV + ' varianti per video';
});

// ── Metadata preview ──────────────────────────────────────────────────────────
var DEVICES = ['iPhone 17 Pro Max','iPhone 17 Pro','iPhone 16 Pro Max','iPhone 16 Pro',
  'iPhone 15 Pro Max','iPhone 15 Pro','Samsung Galaxy S25 Ultra','Samsung Galaxy S25+',
  'Samsung Galaxy S24 Ultra','Google Pixel 9 Pro','Google Pixel 8 Pro','OnePlus 13'];
var LOCS = [
  [25.70,25.85,-80.30,-80.15,'Miami, FL'],[29.65,30.10,-95.55,-95.10,'Houston, TX'],
  [33.90,34.15,-118.55,-118.15,'Los Angeles, CA'],[40.60,40.90,-74.10,-73.85,'New York, NY'],
  [41.70,42.05,-87.80,-87.55,'Chicago, IL'],[36.05,36.30,-115.25,-115.05,'Las Vegas, NV'],
  [47.50,47.75,-122.45,-122.20,'Seattle, WA'],[34.00,34.20,-84.50,-84.20,'Atlanta, GA'],
  [30.20,30.45,-97.85,-97.55,'Austin, TX'],[37.65,37.85,-122.55,-122.35,'San Francisco, CA'],
  [34.00,34.10,-118.45,-118.35,'Beverly Hills, CA'],[40.75,40.82,-74.02,-73.97,'Manhattan, NY']
];

function mkRng(seed) {
  var s = seed;
  return function() { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };
}

function mkMeta(seed) {
  var r = mkRng(seed);
  var loc = LOCS[Math.floor(r() * LOCS.length)];
  var dev = DEVICES[Math.floor(r() * DEVICES.length)];
  var ts = Date.now() - Math.floor(r() * 60 * 24 * 60 * 60 * 1000);
  var date = new Date(ts).toISOString().replace('T', ' ').slice(0, 19);
  return { dev: dev, city: loc[4], date: date };
}

function renderMeta() {
  var container = document.getElementById('metaContainer');
  container.innerHTML = '';
  for (var i = 1; i <= 3; i++) {
    var m = mkMeta(i * 7777 + (Date.now() % 9999));
    var row = document.createElement('div');
    row.className = 'mrow';
    row.innerHTML =
      '<span class="mlbl">Variante ' + i + '</span>' +
      '<span>📱 ' + m.dev + '</span>' +
      '<span>📍 ' + m.city + '</span>' +
      '<span>📅 ' + m.date + '</span>';
    container.appendChild(row);
  }
}
renderMeta();
document.getElementById('regenBtn').addEventListener('click', renderMeta);

// ── Process ───────────────────────────────────────────────────────────────────
document.getElementById('processBtn').addEventListener('click', function() {
  startProcessing();
});

async function startProcessing() {
  if (!FILES.length) return;
  var btn = document.getElementById('processBtn');
  btn.disabled = true;
  var pw = document.getElementById('progressWrap');
  pw.classList.add('show');
  document.getElementById('outputCard').style.display = 'none';
  document.getElementById('outputGrid').innerHTML = '';

  var strength = parseInt(document.getElementById('strengthRange').value);
  var options = getOptions();
  var outputs = [];
  var total = FILES.length * NV;
  var done = 0;

  for (var fi = 0; fi < FILES.length; fi++) {
    var file = FILES[fi];
    for (var v = 1; v <= NV; v++) {
      document.getElementById('progressLabel').textContent =
        'Elaboro: ' + file.name + ' — variante ' + v + '/' + NV;
      var seed = v * 9999 + (Date.now() % 1000);
      var meta = mkMeta(seed);
      try {
        var fd = new FormData();
        fd.append('video', file);
        fd.append('variant', String(v));
        fd.append('seed', String(seed));
        fd.append('strength', String(strength));
        fd.append('options', JSON.stringify(options));
        var resp = await fetch('/process', { method: 'POST', body: fd });
        if (!resp.ok) {
          var errText = await resp.text();
          throw new Error('Server: ' + errText);
        }
        var blob = await resp.blob();
        var url = URL.createObjectURL(blob);
        var base = file.name.replace(/\.[^.]+$/, '');
        outputs.push({ url: url, name: base + '_v' + v + '.mp4', meta: meta });
      } catch (e) {
        console.error('Errore v' + v, e);
        document.getElementById('progressLabel').textContent = 'Errore v' + v + ': ' + e.message;
      }
      done++;
      var pct = Math.round((done / total) * 100);
      document.getElementById('progressFill').style.width = pct + '%';
      document.getElementById('progressPct').textContent = pct + '%';
    }
  }

  document.getElementById('progressLabel').textContent = '✅ Completato! ' + outputs.length + ' varianti';
  document.getElementById('outputCard').style.display = 'block';
  var grid = document.getElementById('outputGrid');
  grid.innerHTML = '';
  outputs.forEach(function(o) {
    var card = document.createElement('div');
    card.className = 'ocard';
    var vid = document.createElement('video');
    vid.src = o.url;
    vid.controls = true;
    vid.setAttribute('playsinline', '');
    var info = document.createElement('div');
    info.className = 'oinfo';
    var nm = document.createElement('span');
    nm.className = 'oname';
    nm.textContent = o.name;
    var dl = document.createElement('a');
    dl.className = 'dlbtn';
    dl.href = o.url;
    dl.download = o.name;
    dl.textContent = '↓ Salva';
    var meta = document.createElement('div');
    meta.className = 'ometa';
    meta.innerHTML = '📱 ' + o.meta.dev + '<br>📍 ' + o.meta.city + '<br>📅 ' + o.meta.date;
    info.appendChild(nm);
    info.appendChild(dl);
    card.appendChild(vid);
    card.appendChild(info);
    card.appendChild(meta);
    grid.appendChild(card);
  });
  btn.disabled = false;
}
</script>
</body>
</html>`;

// ── Server ────────────────────────────────────────────────────────────────────
var server = http.createServer(function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(HTML);
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  if (req.method === 'POST' && req.url === '/process') {
    var chunks = [];
    req.on('data', function(c) { chunks.push(c); });
    req.on('end', function() {
      var body = Buffer.concat(chunks);
      var ct = req.headers['content-type'] || '';
      var bm = ct.match(/boundary=([^\s;]+)/);
      if (!bm) { res.writeHead(400); res.end('No boundary'); return; }

      var parts = parseMultipart(body, bm[1]);
      var vpart = parts.find(function(p) { return p.name === 'video' && p.filename; });
      if (!vpart) { res.writeHead(400); res.end('No video file'); return; }

      var getField = function(name) {
        var p = parts.find(function(x) { return x.name === name; });
        return p ? p.data.toString().trim() : '';
      };

      var variant  = parseInt(getField('variant'))  || 1;
      var seed     = parseInt(getField('seed'))     || 1234;
      var strength = parseInt(getField('strength')) || 4;
      var options  = { mirror:true, crop:true, speed:true, noise:true, rotation:true };
      try { options = JSON.parse(getField('options')); } catch(e) {}

      var tmpDir  = os.tmpdir();
      var id      = crypto.randomBytes(8).toString('hex');
      var inPath  = path.join(tmpDir, 'in_' + id + '.mp4');
      var outPath = path.join(tmpDir, 'out_' + id + '.mp4');

      fs.writeFile(inPath, vpart.data, function(err) {
        if (err) { res.writeHead(500); res.end('Write error'); return; }
        var filters = buildFilters(options, seed, strength);
        processVideo(inPath, outPath, filters).then(function() {
          fs.readFile(outPath, function(err2, data) {
            try { fs.unlinkSync(inPath); } catch(e) {}
            try { fs.unlinkSync(outPath); } catch(e) {}
            if (err2) { res.writeHead(500); res.end('Read error'); return; }
            res.writeHead(200, {
              'Content-Type': 'video/mp4',
              'Content-Disposition': 'attachment; filename="variant_' + variant + '.mp4"',
              'Content-Length': data.length
            });
            res.end(data);
          });
        }).catch(function(e) {
          try { fs.unlinkSync(inPath); } catch(x) {}
          try { fs.unlinkSync(outPath); } catch(x) {}
          console.error('FFmpeg error:', e.message);
          res.writeHead(500);
          res.end('FFmpeg error: ' + e.message);
        });
      });
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.listen(PORT, function() {
  console.log('Myra Spoofer running on port ' + PORT);
});
