// ═══════════════════════════════════════════════════
//  Quantum Store — Canvas Screenshot Generator
//  Renders fake but convincing app screenshots using
//  the Canvas 2D API (no external images needed)
// ═══════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  drawTrackingScreen();
  drawGestureScreen();
  drawBiometricScreen();
  drawRobotScreen();
  drawAIScreen();
});

// ─── HELPERS ─────────────────────────────────────────────

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawBase(canvas, title) {
  const ctx = canvas.getContext('2d');
  const { width: W, height: H } = canvas;

  // Background
  ctx.fillStyle = '#0a0a0a';
  ctx.fillRect(0, 0, W, H);

  // Subtle scanline effect
  ctx.fillStyle = 'rgba(255,255,255,0.013)';
  for (let y = 0; y < H; y += 3) {
    ctx.fillRect(0, y, W, 1);
  }

  // Top bar
  ctx.fillStyle = '#111111';
  ctx.fillRect(0, 0, W, 28);
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 28);
  ctx.lineTo(W, 28);
  ctx.stroke();

  // Dot indicators (like traffic lights)
  const dots = ['#ff5f57','#ffbd2e','#28c840'];
  dots.forEach((c, i) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(14 + i * 18, 14, 5, 0, Math.PI * 2);
    ctx.fill();
  });

  // Title in topbar
  ctx.fillStyle = '#888';
  ctx.font = '500 10px "Google Sans", system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('QUANTUM TRACKER  —  ' + title, W / 2, 18);
  ctx.textAlign = 'left';

  return ctx;
}

function glowText(ctx, text, x, y, color, size = 11, weight = '600') {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 8;
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px "Google Sans", monospace`;
  ctx.fillText(text, x, y);
  ctx.restore();
}

function drawBBox(ctx, x, y, w, h, label, conf, color = '#00ff88', id = 1) {
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.strokeRect(x, y, w, h);

  // Corner accents
  const c = 10;
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = color;
  // TL
  ctx.beginPath(); ctx.moveTo(x, y + c); ctx.lineTo(x, y); ctx.lineTo(x + c, y); ctx.stroke();
  // TR
  ctx.beginPath(); ctx.moveTo(x + w - c, y); ctx.lineTo(x + w, y); ctx.lineTo(x + w, y + c); ctx.stroke();
  // BL
  ctx.beginPath(); ctx.moveTo(x, y + h - c); ctx.lineTo(x, y + h); ctx.lineTo(x + c, y + h); ctx.stroke();
  // BR
  ctx.beginPath(); ctx.moveTo(x + w - c, y + h); ctx.lineTo(x + w, y + h); ctx.lineTo(x + w, y + h - c); ctx.stroke();

  // Label pill
  const pillW = label.length * 6.5 + 16;
  roundRect(ctx, x, y - 16, pillW, 16, 3);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.fillStyle = '#000';
  ctx.font = 'bold 9px monospace';
  ctx.fillText(`ID:${id} ${label} ${conf}`, x + 5, y - 4);

  // Scanline overlay inside box
  ctx.fillStyle = `${color}08`;
  ctx.fillRect(x + 1, y + 1, w - 2, h - 2);
}

// ─── SCREENSHOT 1: TRACKING ───────────────────────────────
function drawTrackingScreen() {
  const canvas = document.getElementById('canvas-tracking');
  if (!canvas) return;
  const ctx = drawBase(canvas, 'RASTREAMENTO AO VIVO');
  const W = canvas.width, H = canvas.height;

  // Simulated camera feed (dark gradient)
  const grad = ctx.createLinearGradient(0, 28, 0, H);
  grad.addColorStop(0, '#101418');
  grad.addColorStop(1, '#080b0d');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 28, W, H - 28);

  // Grid lines (perspective floor)
  ctx.strokeStyle = 'rgba(0,255,136,0.04)';
  ctx.lineWidth = 0.5;
  for (let x = 0; x < W; x += 30) { ctx.beginPath(); ctx.moveTo(x, 28); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 28; y < H; y += 20) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  // Crosshair center
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.setLineDash([4, 4]);
  ctx.beginPath(); ctx.moveTo(W / 2, 28); ctx.lineTo(W / 2, H); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
  ctx.setLineDash([]);

  // Bounding boxes (persons)
  drawBBox(ctx, 42, 45, 58, 130, 'PESSOA', '98%', '#00ff88', 1);
  drawBBox(ctx, 175, 55, 52, 110, 'PESSOA', '94%', '#00e5ff', 2);
  drawBBox(ctx, 272, 60, 60, 120, 'GHOST', '72%', '#ff9800', 3);

  // Trajectory trail for ID 1
  ctx.strokeStyle = 'rgba(0,255,136,0.4)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  const trail = [[71,165],[73,160],[72,155],[70,148],[69,140],[71,132]];
  trail.forEach(([x, y], i) => {
    ctx.globalAlpha = 0.15 + i * 0.14;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Left HUD panel
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, 4, 35, 100, 85, 4);
  ctx.fill();
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  roundRect(ctx, 4, 35, 100, 85, 4);
  ctx.stroke();

  glowText(ctx, 'SISTEMA', 10, 50, '#555', 8, '700');
  glowText(ctx, 'FPS: 28.4', 10, 64, '#fff', 10, '600');
  glowText(ctx, 'ALVOS: 03', 10, 78, '#00ff88', 10, '600');
  glowText(ctx, 'MODO: CAMERA', 10, 92, '#fff', 9, '500');
  glowText(ctx, 'HORA: 16:08:22', 10, 106, '#666', 9);

  // Right HUD panel
  ctx.fillStyle = 'rgba(0,0,0,0.6)';
  roundRect(ctx, W - 120, 35, 116, 72, 4);
  ctx.fill();
  ctx.strokeStyle = '#2a2a2a';
  roundRect(ctx, W - 120, 35, 116, 72, 4);
  ctx.stroke();

  glowText(ctx, 'EVENTOS', W - 114, 50, '#555', 8, '700');
  glowText(ctx, '• TARGET_CREATED', W - 114, 63, '#00ff88', 8);
  glowText(ctx, '• GHOST_ACTIVATED', W - 114, 75, '#ff9800', 8);
  glowText(ctx, '• ID:1 SEGUINDO', W - 114, 87, '#00e5ff', 8);
  glowText(ctx, '• GESTURE: PARAR', W - 114, 99, '#fff', 8);

  // Bottom status bar
  ctx.fillStyle = '#111';
  ctx.fillRect(0, H - 20, W, 20);
  glowText(ctx, '● YOLO v8n + ByteTrack', 8, H - 7, '#00ff88', 8, '600');
  glowText(ctx, 'QUANTUM TRACKER v2.0', W / 2 - 55, H - 7, '#444', 8);
  glowText(ctx, 'InsightFace OK', W - 75, H - 7, '#4285f4', 8);
}

// ─── SCREENSHOT 2: GESTURES ───────────────────────────────
function drawGestureScreen() {
  const canvas = document.getElementById('canvas-gestures');
  if (!canvas) return;
  const ctx = drawBase(canvas, 'RECONHECIMENTO DE GESTOS');
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = '#0d0d0d';
  ctx.fillRect(0, 28, W, H - 28);

  // Hand silhouette (simplified skeleton)
  const palmX = W / 2 - 10, palmY = 145;
  const fingers = [
    [[palmX - 28, palmY - 10],[palmX - 35, palmY - 40],[palmX - 38, palmY - 65],[palmX - 36, palmY - 82]],
    [[palmX - 12, palmY - 18],[palmX - 14, palmY - 55],[palmX - 14, palmY - 82],[palmX - 14, palmY - 100]],
    [[palmX + 6, palmY - 20],[palmX + 8, palmY - 58],[palmX + 9, palmY - 86],[palmX + 9, palmY - 104]],
    [[palmX + 24, palmY - 16],[palmX + 28, palmY - 50],[palmX + 28, palmY - 75],[palmX + 27, palmY - 90]],
    [[palmX + 40, palmY - 5],[palmX + 55, palmY - 25],[palmX + 62, palmY - 40]],
  ];

  // Draw bones
  fingers.forEach((finger, fi) => {
    const col = fi === 1 ? '#00ff88' : fi === 2 ? '#00e5ff' : 'rgba(255,255,255,0.4)';
    ctx.strokeStyle = col;
    ctx.lineWidth = fi < 2 ? 2.5 : 1.5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    finger.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();

    // Knuckle dots
    finger.forEach(([x, y]) => {
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.arc(x, y, fi < 2 ? 3 : 2, 0, Math.PI * 2); ctx.fill();
    });
  });

  // Palm connections
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  fingers.forEach((f, i) => {
    if (i === 0) ctx.moveTo(f[0][0], f[0][1]); else ctx.lineTo(f[0][0], f[0][1]);
  });
  ctx.stroke();

  // Glow on index finger tip
  const tip = fingers[1][3];
  ctx.save();
  ctx.shadowColor = '#00ff88';
  ctx.shadowBlur = 20;
  ctx.fillStyle = '#00ff88';
  ctx.beginPath(); ctx.arc(tip[0], tip[1], 5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();

  // Gesture label pill
  const pill = { x: W / 2 - 68, y: 26, w: 136, h: 26 };
  roundRect(ctx, pill.x, pill.y, pill.w, pill.h, 13);
  ctx.fillStyle = 'rgba(0,255,136,0.15)';
  ctx.fill();
  ctx.strokeStyle = '#00ff88';
  ctx.lineWidth = 1;
  roundRect(ctx, pill.x, pill.y, pill.w, pill.h, 13);
  ctx.stroke();
  glowText(ctx, '▲ SEGUIR ALVO  conf: 97%', pill.x + 10, pill.y + 17, '#00ff88', 9, '700');

  // Stats on right
  const classes = ['VIRAR_ESQUERDA','VIRAR_DIREITA','PARAR','SEGUIR','RE'];
  glowText(ctx, 'CLASSES TREINADAS', W - 130, 48, '#555', 8, '700');
  classes.forEach((c, i) => {
    const active = i === 3;
    glowText(ctx, (active ? '● ' : '○ ') + c, W - 130, 62 + i * 14, active ? '#00ff88' : '#444', 8, active ? '700' : '500');
  });

  // Bottom accuracy meter
  ctx.fillStyle = '#111';
  ctx.fillRect(20, H - 38, W - 40, 24);
  ctx.strokeStyle = '#222';
  ctx.strokeRect(20, H - 38, W - 40, 24);
  ctx.fillStyle = '#1a3a2a';
  ctx.fillRect(22, H - 36, (W - 44) * 0.97, 20);
  glowText(ctx, 'Confiança: 97%', 26, H - 22, '#00ff88', 9, '600');
}

// ─── SCREENSHOT 3: BIOMETRICS ─────────────────────────────
function drawBiometricScreen() {
  const canvas = document.getElementById('canvas-biometrics');
  if (!canvas) return;
  const ctx = drawBase(canvas, 'BIOMETRIA FACIAL');
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = '#0a0c10';
  ctx.fillRect(0, 28, W, H - 28);

  // Face oval
  ctx.save();
  ctx.strokeStyle = '#4285f4';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#4285f4';
  ctx.shadowBlur = 14;
  ctx.beginPath();
  ctx.ellipse(W / 2, 115, 55, 70, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // Face scan lines
  for (let i = 0; i < 6; i++) {
    const y = 52 + i * 22;
    ctx.strokeStyle = `rgba(66,133,244,${0.04 + i * 0.01})`;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(W / 2 - 52, y); ctx.lineTo(W / 2 + 52, y); ctx.stroke();
  }

  // Landmark dots
  const landmarks = [
    [W/2-22, 88],[W/2+22, 88],    // eyes
    [W/2, 105],                     // nose bridge
    [W/2-8, 120],[W/2+8, 120],     // nose
    [W/2-18, 138],[W/2+18, 138],  // mouth corners
    [W/2, 142],                     // mouth center
    [W/2-40, 95],[W/2+40, 95],    // cheeks
    [W/2-50, 115],[W/2+50, 115],  // temples
  ];
  landmarks.forEach(([x, y]) => {
    ctx.fillStyle = '#4285f4';
    ctx.beginPath(); ctx.arc(x, y, 2, 0, Math.PI * 2); ctx.fill();
  });

  // Scanning bar animation (static at 60%)
  ctx.fillStyle = 'rgba(66,133,244,0.08)';
  ctx.fillRect(W/2 - 55, 52, 110, 25);
  ctx.strokeStyle = 'rgba(66,133,244,0.6)';
  ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(W/2-55, 77); ctx.lineTo(W/2+55, 77); ctx.stroke();

  // Identity result
  const resX = 20, resY = 202;
  ctx.fillStyle = 'rgba(66,133,244,0.1)';
  roundRect(ctx, resX, resY, W - 40, 14, 3);
  ctx.fill();
  glowText(ctx, '● IDENTIDADE CONFIRMADA', resX + 8, resY + 10, '#4285f4', 9, '700');

  // Person list
  const people = [
    { name: 'João G.', id: 'P001', conf: '99.2%', color: '#00ff88' },
    { name: 'Marcos A.', id: 'P002', conf: '97.8%', color: '#4285f4' },
  ];
  people.forEach(({ name, id, conf, color }, i) => {
    const py = 32 + i * 72;
    ctx.fillStyle = 'rgba(255,255,255,0.04)';
    roundRect(ctx, 5, py, 75, 60, 6);
    ctx.fill();

    ctx.fillStyle = 'rgba(255,255,255,0.06)';
    ctx.beginPath(); ctx.arc(42, py + 20, 15, 0, Math.PI * 2); ctx.fill();

    ctx.fillStyle = color;
    ctx.font = 'bold 9px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(name[0], 42, py + 24);
    ctx.textAlign = 'left';

    glowText(ctx, name, 12, py + 43, '#ccc', 8);
    glowText(ctx, `${id} · ${conf}`, 12, py + 54, color, 7.5, '600');
  });

  // Right stats
  glowText(ctx, 'BASE DE DADOS', W - 130, 50, '#555', 8, '700');
  glowText(ctx, '2 pessoas', W - 130, 64, '#fff', 10, '700');
  glowText(ctx, 'InsightFace ativo', W - 130, 80, '#00ff88', 8);
  glowText(ctx, 'Threshold: 0.65', W - 130, 94, '#888', 8);
  glowText(ctx, 'Embeddings: 2', W - 130, 108, '#888', 8);
}

// ─── SCREENSHOT 4: ROBOT DASHBOARD ───────────────────────
function drawRobotScreen() {
  const canvas = document.getElementById('canvas-robot');
  if (!canvas) return;
  const ctx = drawBase(canvas, 'PAINEL ROBÓTICO');
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = '#080a0c';
  ctx.fillRect(0, 28, W, H - 28);

  // Robot body (simple schematic)
  const rx = W / 2 - 35, ry = 55;
  ctx.strokeStyle = '#4285f4';
  ctx.lineWidth = 1.5;
  // Body
  ctx.strokeRect(rx, ry, 70, 80);
  // Head
  ctx.strokeRect(rx + 15, ry - 22, 40, 22);
  // Eyes
  ctx.fillStyle = '#4285f4';
  ctx.fillRect(rx + 22, ry - 16, 8, 8);
  ctx.fillRect(rx + 40, ry - 16, 8, 8);
  // Glow eyes
  ctx.save(); ctx.shadowColor='#4285f4'; ctx.shadowBlur=10;
  ctx.fillStyle='#00e5ff'; ctx.fillRect(rx+24,ry-14,4,4); ctx.fillRect(rx+42,ry-14,4,4);
  ctx.restore();
  // Arms
  ctx.beginPath(); ctx.moveTo(rx, ry+20); ctx.lineTo(rx-20, ry+45); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rx+70, ry+20); ctx.lineTo(rx+90, ry+45); ctx.stroke();
  // Legs
  ctx.beginPath(); ctx.moveTo(rx+20, ry+80); ctx.lineTo(rx+15, ry+108); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(rx+50, ry+80); ctx.lineTo(rx+55, ry+108); ctx.stroke();

  // Direction arrows
  const arrowColor = '#ff9800';
  glowText(ctx, '▲', W/2 - 6, ry + 42, arrowColor, 13, '700');

  // Telemetry panel (left)
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, 5, 35, 110, 100, 4);
  ctx.fill();
  ctx.strokeStyle = '#1a2a40';
  roundRect(ctx, 5, 35, 110, 100, 4);
  ctx.stroke();

  glowText(ctx, 'TELEMETRIA', 12, 50, '#555', 8, '700');
  const telem = [
    ['Velocidade', '0.8 m/s', '#00ff88'],
    ['Direção', '▲ FRENTE', '#fff'],
    ['Bateria', '87%', '#00ff88'],
    ['Conexão', 'ESP32 OK', '#4285f4'],
    ['Alvo', 'ID:1 João', '#00e5ff'],
  ];
  telem.forEach(([k, v, c], i) => {
    glowText(ctx, k + ':', 12, 64 + i * 14, '#666', 8);
    glowText(ctx, v, 75, 64 + i * 14, c, 8, '600');
  });

  // Command log (right)
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  roundRect(ctx, W - 120, 35, 116, 100, 4);
  ctx.fill();
  ctx.strokeStyle = '#1a2a40';
  roundRect(ctx, W - 120, 35, 116, 100, 4);
  ctx.stroke();

  glowText(ctx, 'COMANDOS', W - 113, 50, '#555', 8, '700');
  const cmds = ['SEGUIR ALVO', 'VIRAR_DIREITA', 'PARAR', 'SEGUIR ALVO', 'RE'];
  cmds.forEach((c, i) => glowText(ctx, '› ' + c, W - 113, 64 + i * 14, i === 0 ? '#ff9800' : '#444', 8));

  // Status bar
  ctx.fillStyle = '#0d1a0d';
  ctx.fillRect(0, H - 20, W, 20);
  glowText(ctx, '● ROBÔ ATIVO — MODO SEGUIR', 8, H - 7, '#00ff88', 8, '700');
}

// ─── SCREENSHOT 5: AI CHAT ────────────────────────────────
function drawAIScreen() {
  const canvas = document.getElementById('canvas-ai');
  if (!canvas) return;
  const ctx = drawBase(canvas, 'ASSISTENTE GEMINI AI');
  const W = canvas.width, H = canvas.height;

  ctx.fillStyle = '#080808';
  ctx.fillRect(0, 28, W, H - 28);

  // API key bar
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 28, W, 32);
  glowText(ctx, 'API Key Gemini:', 10, 48, '#555', 8, '600');
  ctx.fillStyle = '#181818';
  roundRect(ctx, 90, 33, W - 190, 20, 4);
  ctx.fill();
  ctx.strokeStyle = '#2a2a2a';
  roundRect(ctx, 90, 33, W - 190, 20, 4);
  ctx.stroke();
  glowText(ctx, '●●●●●●●●●●●●●●●●●●●●●●●●', 96, 47, '#4285f4', 8);
  ctx.fillStyle = '#4285f4';
  roundRect(ctx, W - 96, 33, 52, 20, 4);
  ctx.fill();
  glowText(ctx, 'CONECTAR', W - 89, 47, '#fff', 7.5, '700');

  // Chat messages
  const messages = [
    { who: 'ai', text: 'Sistema conectado. 3 alvos ativos na cena.', y: 78 },
    { who: 'user', text: 'Quem é o alvo primário?', y: 108 },
    { who: 'ai', text: 'Alvo ID:1 — João G. (conf. 99.2%). Estado VISIBLE, dist. 2.4m.', y: 130 },
    { who: 'user', text: 'Ative o modo seguir.', y: 162 },
    { who: 'ai', text: '✓ Modo SEGUIR ativado. Robô rastreando ID:1.', y: 184 },
  ];

  messages.forEach(({ who, text, y }) => {
    const isAI = who === 'ai';
    const maxW = W - 80;
    const words = text.split(' ');
    const lines = [];
    let line = '';
    ctx.font = '500 9px "Google Sans", system-ui';
    words.forEach(w => {
      const test = line + (line ? ' ' : '') + w;
      if (ctx.measureText(test).width > maxW - 20) { lines.push(line); line = w; } else line = test;
    });
    lines.push(line);

    const pillH = lines.length * 13 + 8;
    const pillW = Math.min(maxW, Math.max(...lines.map(l => ctx.measureText(l).width)) + 20);
    const pillX = isAI ? 30 : W - pillW - 10;

    roundRect(ctx, pillX, y - 2, pillW, pillH, 8);
    ctx.fillStyle = isAI ? 'rgba(66,133,244,0.12)' : 'rgba(255,255,255,0.07)';
    ctx.fill();
    ctx.strokeStyle = isAI ? 'rgba(66,133,244,0.3)' : 'rgba(255,255,255,0.1)';
    ctx.lineWidth = 1;
    roundRect(ctx, pillX, y - 2, pillW, pillH, 8);
    ctx.stroke();

    lines.forEach((l, i) => {
      ctx.fillStyle = isAI ? '#a8c7fa' : '#e8eaed';
      ctx.font = '500 9px "Google Sans", system-ui';
      ctx.fillText(l, pillX + 8, y + 10 + i * 13);
    });

    // Avatar dot
    const dotX = isAI ? 16 : W - 16;
    ctx.fillStyle = isAI ? '#4285f4' : '#555';
    ctx.beginPath(); ctx.arc(dotX, y + 6, 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 6px system-ui';
    ctx.textAlign = 'center';
    ctx.fillText(isAI ? 'G' : 'U', dotX, y + 9);
    ctx.textAlign = 'left';
  });

  // Input bar
  ctx.fillStyle = '#111';
  ctx.fillRect(0, H - 28, W, 28);
  ctx.fillStyle = '#1a1a1a';
  roundRect(ctx, 8, H - 24, W - 55, 20, 10);
  ctx.fill();
  ctx.strokeStyle = '#333';
  roundRect(ctx, 8, H - 24, W - 55, 20, 10);
  ctx.stroke();
  glowText(ctx, 'Pergunte ao Gemini...', 16, H - 10, '#444', 8);

  // Send button
  ctx.fillStyle = '#4285f4';
  roundRect(ctx, W - 44, H - 24, 36, 20, 10);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 11px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('→', W - 26, H - 10);
  ctx.textAlign = 'left';
}
