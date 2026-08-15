(() => {
  "use strict";

  const canvas = document.getElementById("robotCanvas");
  const ctx = canvas.getContext("2d");
  const toggleButton = document.getElementById("toggleSimulation");
  const resetButton = document.getElementById("resetSimulation");
  const menuButton = document.getElementById("menuButton");
  const sidebar = document.querySelector(".sidebar");
  const stateValue = document.getElementById("stateValue");
  const commandValue = document.getElementById("commandValue");
  const distanceValue = document.getElementById("distanceValue");
  const eventValue = document.getElementById("eventValue");
  const safetyValue = document.getElementById("safetyValue");

  const world = {
    width: 960,
    height: 540,
    running: true,
    events: 0,
    lastTime: performance.now(),
    robot: { x: 120, y: 280, angle: 0, speed: 80, turning: 0, turnUntil: 0 },
    obstacles: [
      { x: 310, y: 180, w: 70, h: 190 },
      { x: 520, y: 60, w: 85, h: 190 },
      { x: 555, y: 365, w: 190, h: 65 },
      { x: 790, y: 170, w: 70, h: 210 }
    ]
  };

  function resizeCanvas() {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(640, Math.round(rect.width * ratio));
    canvas.height = Math.max(330, Math.round(rect.height * ratio));
    ctx.setTransform(canvas.width / world.width, 0, 0, canvas.height / world.height, 0, 0);
  }

  function resetWorld() {
    Object.assign(world.robot, { x: 120, y: 280, angle: 0, speed: 80, turning: 0, turnUntil: 0 });
    world.events = 0;
    world.running = true;
    world.lastTime = performance.now();
    toggleButton.textContent = "Pausar";
  }

  function rayDistance() {
    const robot = world.robot;
    for (let distance = 0; distance <= 150; distance += 3) {
      const px = robot.x + Math.cos(robot.angle) * distance;
      const py = robot.y + Math.sin(robot.angle) * distance;
      if (px < 20 || py < 20 || px > world.width - 20 || py > world.height - 20) return distance;
      if (world.obstacles.some((o) => px >= o.x && px <= o.x + o.w && py >= o.y && py <= o.y + o.h)) return distance;
    }
    return 150;
  }

  function update(dt, time) {
    const robot = world.robot;
    const distance = rayDistance();
    if (robot.turnUntil > time) {
      robot.angle += robot.turning * dt;
      stateValue.textContent = "DESVIANDO";
      commandValue.textContent = robot.turning > 0 ? "DIREITA" : "ESQUERDA";
      safetyValue.textContent = "INTERVENÇÃO ATIVA";
    } else if (distance <= 44) {
      robot.turning = world.events % 2 === 0 ? 2.15 : -2.15;
      robot.turnUntil = time + 760;
      world.events += 1;
    } else {
      robot.x += Math.cos(robot.angle) * robot.speed * dt;
      robot.y += Math.sin(robot.angle) * robot.speed * dt;
      stateValue.textContent = "AVANÇANDO";
      commandValue.textContent = "FRENTE";
      safetyValue.textContent = "MONITORANDO";
    }
    distanceValue.textContent = `${Math.round(distance)} px`;
    eventValue.textContent = String(world.events);
  }

  function drawGrid() {
    ctx.fillStyle = "#030913";
    ctx.fillRect(0, 0, world.width, world.height);
    ctx.strokeStyle = "rgba(89, 132, 172, .10)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= world.width; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, world.height); ctx.stroke(); }
    for (let y = 0; y <= world.height; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(world.width, y); ctx.stroke(); }
  }

  function draw() {
    drawGrid();
    world.obstacles.forEach((o, index) => {
      const gradient = ctx.createLinearGradient(o.x, o.y, o.x + o.w, o.y + o.h);
      gradient.addColorStop(0, "#15263c"); gradient.addColorStop(1, "#0a1422");
      ctx.fillStyle = gradient; ctx.strokeStyle = "#294462"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(o.x, o.y, o.w, o.h, 10); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#59728e"; ctx.font = "700 10px system-ui"; ctx.fillText(`OBSTÁCULO ${index + 1}`, o.x + 10, o.y + 20);
    });
    const robot = world.robot;
    const distance = rayDistance();
    ctx.save(); ctx.translate(robot.x, robot.y); ctx.rotate(robot.angle);
    ctx.strokeStyle = distance <= 44 ? "#ffbd5c" : "rgba(33,212,253,.42)"; ctx.lineWidth = 2; ctx.setLineDash([6, 5]);
    ctx.beginPath(); ctx.moveTo(20, 0); ctx.lineTo(Math.min(distance, 150), 0); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = "rgba(33,212,253,.16)"; ctx.strokeStyle = "#21d4fd"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.roundRect(-24, -18, 48, 36, 10); ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#21d4fd"; ctx.beginPath(); ctx.moveTo(28, 0); ctx.lineTo(15, -8); ctx.lineTo(15, 8); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#31e6a1"; ctx.beginPath(); ctx.arc(-8, 0, 4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#9ab0c7"; ctx.font = "600 11px system-ui"; ctx.fillText("ROBÔ VIRTUAL", robot.x - 35, robot.y - 30);
  }

  function loop(time) {
    const dt = Math.min((time - world.lastTime) / 1000, 0.05);
    world.lastTime = time;
    if (world.running) update(dt, time);
    draw();
    requestAnimationFrame(loop);
  }

  toggleButton.addEventListener("click", () => {
    world.running = !world.running;
    toggleButton.textContent = world.running ? "Pausar" : "Continuar";
    if (!world.running) { stateValue.textContent = "PAUSADO"; commandValue.textContent = "PARAR"; }
  });
  resetButton.addEventListener("click", resetWorld);
  menuButton.addEventListener("click", () => {
    const open = sidebar.classList.toggle("open");
    menuButton.setAttribute("aria-expanded", String(open));
  });
  document.querySelectorAll(".nav-link").forEach((link) => link.addEventListener("click", () => {
    document.querySelectorAll(".nav-link").forEach((item) => item.classList.remove("active"));
    link.classList.add("active"); sidebar.classList.remove("open"); menuButton.setAttribute("aria-expanded", "false");
  }));
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas(); resetWorld(); requestAnimationFrame(loop);
})();
