// Real page + browser Web Serial mock. Never opens a physical port.
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req,res) => {
  const file = path.resolve(root, '.' + new URL(req.url,'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  const types = {'.js':'text/javascript','.html':'text/html','.svg':'image/svg+xml','.css':'text/css'};
  fs.readFile(file,(error,data) => {
    res.writeHead(error?404:200, {'Content-Type':types[path.extname(file)] || 'text/plain'});
    res.end(error?'not found':data);
  });
});
async function mockedPage(browser, incompatible = false) {
  const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.addInitScript(({ incompatible }) => {
    localStorage.setItem('quantumAuth:v1', 'ok');
    window.serialWrites = []; window.portOpenCount = 0; window.portRequestCount = 0;
    let holdChooser = false, cancelChooser;
    window.holdPortChooser = () => { holdChooser = true; };
    window.cancelPortChooser = () => { holdChooser = false; cancelChooser(new DOMException('cancelled', 'NotFoundError')); };
    let controller, timer, delayedStart = false;
    const encoder = new TextEncoder();
    const reply = line => { try { controller.enqueue(encoder.encode(line+'\n')); } catch {} };
    const status = () => reply('AUTO|UP:1234|N:5|RUN:0|PHASE:0|CMD:PARAR|DIST:20.0|ECHO_US:1160');
    window.delayStart = () => { delayedStart = true; };
    const port = {
      async open() {
        window.portOpenCount++;
        this.readable = new ReadableStream({ start(c) { controller=c; }, cancel() { clearInterval(timer); } });
        this.writable = new WritableStream({ write(bytes) {
          const text = new TextDecoder().decode(bytes).trim();
          window.serialWrites.push(text);
          if(text==='HELLO') reply(incompatible?'QT:READY:V5':'AUTO:READY:1');
          if(text==='ESTOP') { reply('OK:STOP'); if(!incompatible) status(); }
          if(text==='STATUS') status();
          if(text==='START') {
            if(delayedStart) setTimeout(()=>reply('OK:START'),500);
            else reply('OK:START');
          }
        }});
        if(!incompatible) timer=setInterval(status,300);
      },
      async close() { clearInterval(timer); },
    };
    Object.defineProperty(navigator,'serial',{value:{async requestPort(){
      window.portRequestCount++;
      if (holdChooser) await new Promise((resolve, reject) => { cancelChooser = reject; });
      return port;
    }}});
  }, { incompatible });
  return {page, errors};
}
(async () => {
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const url = `http://127.0.0.1:${server.address().port}/autonomo.html`;
  const browser = await chromium.launch({headless:true});
  try {
    const {page,errors} = await mockedPage(browser);
    await page.goto(url);
    assert.equal(await page.locator('#autoStart').isDisabled(),true);
    await page.locator('#autoConnect').click();
    await page.waitForFunction(()=>document.querySelector('#autoStatus').textContent.includes('conectado e parado'));
    assert.equal(await page.locator('#autoDistance').textContent(),'20.0 cm');
    assert.equal(await page.locator('#autoEcho').textContent(),'1160');
    assert.equal((await page.evaluate(()=>serialWrites)).includes('START'),false);
    await page.locator('#autoStart').click();
    await page.waitForFunction(()=>document.querySelector('#autoStatus').textContent.includes('Autônomo iniciado'));
    await page.locator('#autoStop').click();
    await page.waitForFunction(()=>document.querySelector('#autoStatus').textContent.includes('Parada confirmada'));
    await page.evaluate(()=>delayStart());
    await page.locator('#autoStart').click();
    await page.locator('#autoStop').click();
    await page.waitForTimeout(700);
    assert.match(await page.locator('#autoStatus').textContent(),/Parada confirmada/);
    assert.equal((await page.evaluate(()=>serialWrites)).at(-1),'ESTOP');
    fs.mkdirSync(path.join(root,'tests/artifacts'),{recursive:true});
    await page.screenshot({path:path.join(root,'tests/artifacts/autonomo-isolado.png'),fullPage:true});
    await page.setViewportSize({width:390,height:844});
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await page.locator('#autoDisconnect').click();
    await page.waitForFunction(()=>document.querySelector('#autoStatus').textContent==='Parado e desconectado.');
    assert.equal(await page.locator('#autoStart').isDisabled(),true);
    assert.deepEqual(errors,[]);
    await page.close();
    const wrong = await mockedPage(browser,true);
    await wrong.page.goto(url);
    await wrong.page.locator('#autoConnect').click();
    await wrong.page.waitForFunction(()=>document.querySelector('#autoStatus').textContent.includes('Nenhum START foi enviado'));
    assert.equal((await wrong.page.evaluate(()=>serialWrites)).includes('START'),false);
    assert.equal(await wrong.page.locator('#autoStart').isDisabled(),true);
    assert.deepEqual(wrong.errors,[]);
    await wrong.page.close();
    const invalidHex = await mockedPage(browser);
    await invalidHex.page.route('**/firmware/compiled/autonomo_isolado.ino.hex', route => route.fulfill({status:200,body:'invalid firmware'}));
    await invalidHex.page.goto(url);
    await invalidHex.page.locator('#autoFlash').click();
    await invalidHex.page.waitForFunction(()=>document.querySelector('#autoFlashStatus').textContent.includes('Integridade'));
    assert.equal(await invalidHex.page.evaluate(()=>portOpenCount),0);
    assert.deepEqual(invalidHex.errors,[]);
    await invalidHex.page.close();

    const integrated = await mockedPage(browser);
    const main = integrated.page;
    await main.goto(url.replace('autonomo.html', 'index.html#codigos'));
    await main.waitForFunction(() => window.quantumAutonomousBench && window.quantumRobot && window.quantumFirmwareFlasher);
    assert.equal(await main.locator('#codigos #autoConnect').isVisible(), true);
    assert.equal(await main.locator('#integratedFirmware').getAttribute('open'), null);
    assert.equal(await main.evaluate(()=>portRequestCount), 0, 'loading the main site cannot open USB');
    await main.locator('#autoConnect').click();
    // Isolation also holds during the handshake, before AUTO:READY.
    assert.equal(await main.evaluate(()=>window.quantumRobot.connect()), false);
    await main.evaluate(()=>window.quantumFirmwareFlasher.flash());
    assert.match(await main.locator('#firmwareFlashStatus').textContent(), /USB EM OUTRO PAINEL/);
    assert.equal(await main.evaluate(()=>portRequestCount), 1);
    await main.waitForFunction(()=>document.querySelector('#autoStatus').textContent.includes('conectado e parado'));
    assert.equal(await main.locator('#autoDistance').textContent(), '20.0 cm');
    await main.locator('#autoStart').click();
    await main.waitForFunction(()=>document.querySelector('#autoStatus').textContent.includes('Autônomo iniciado'));
    await main.locator('#autoStop').click();
    await main.waitForFunction(()=>document.querySelector('#autoStatus').textContent.includes('Parada confirmada'));
    assert.equal((await main.evaluate(()=>serialWrites)).some(line=>line.startsWith('MODE:') || line.startsWith('CMD:')), false);
    await main.locator('#autoDisconnect').click();
    await main.waitForFunction(()=>document.querySelector('#autoStatus').textContent==='Parado e desconectado.');

    // Reverse direction: integrated connection holds USB while the chooser is pending.
    await main.evaluate(()=>{holdPortChooser(); window.pendingConnect = window.quantumRobot.connect();});
    await main.waitForFunction(()=>portRequestCount === 2);
    assert.equal(await main.evaluate(()=>window.quantumRobot.usbBusy), true);
    assert.equal(await main.evaluate(()=>window.quantumRobot.connect()), false);
    await main.locator('#autoConnect').click();
    assert.match(await main.locator('#autoStatus').textContent(), /USB em uso pela versão integrada/);
    await main.locator('#autoFlash').click();
    assert.match(await main.locator('#autoFlashStatus').textContent(), /USB em uso pela versão integrada/);
    await main.evaluate(()=>window.quantumFirmwareFlasher.flash());
    assert.equal(await main.evaluate(()=>portRequestCount), 2);
    await main.evaluate(()=>cancelPortChooser());
    await main.evaluate(()=>window.pendingConnect);
    assert.equal(await main.evaluate(()=>window.quantumRobot.usbBusy), false, 'cancelled chooser must release integrated ownership');

    // A flash operation also owns USB before it has opened the port.
    await main.evaluate(()=>holdPortChooser());
    await main.locator('#autoFlash').click();
    await main.waitForFunction(()=>portRequestCount === 3);
    assert.equal(await main.evaluate(()=>window.quantumRobot.connect()), false);
    await main.evaluate(()=>window.quantumFirmwareFlasher.flash());
    assert.equal(await main.evaluate(()=>portRequestCount), 3);
    await main.evaluate(()=>cancelPortChooser());
    await main.waitForFunction(()=>!window.quantumAutonomousBench.usbBusy);

    // Integrated flasher blocks autonomous USB until its cancelled chooser is cleaned up.
    await main.evaluate(()=>{holdPortChooser(); window.pendingFlash = window.quantumFirmwareFlasher.flash();});
    await main.waitForFunction(()=>portRequestCount === 4);
    await main.locator('#autoConnect').click();
    await main.locator('#autoFlash').click();
    assert.equal(await main.evaluate(()=>window.quantumRobot.connect()), false);
    assert.equal(await main.evaluate(()=>portRequestCount), 4);
    await main.evaluate(()=>cancelPortChooser());
    await main.evaluate(()=>window.pendingFlash);
    assert.equal(await main.evaluate(()=>window.quantumFirmwareFlasher.busy), false);

    // The old editor remains available but is not mixed with isolated firmware controls.
    await main.locator('#integratedFirmware > summary').click();
    assert.equal(await main.locator('#codeTabMain').isVisible(), true);
    await main.locator('#codeTabSensor').click();
    await main.waitForFunction(()=>document.querySelector('#arduinoCode').value.includes('void setup()'));
    await main.locator('#integratedFirmware > summary').click();
    await main.locator('#autoConnect').click();
    await main.waitForFunction(()=>document.querySelector('#autoStatus').textContent.includes('conectado e parado'));
    await main.locator('#autoDisconnect').click();
    await main.waitForFunction(()=>document.querySelector('#autoStatus').textContent==='Parado e desconectado.');
    await main.locator('#codigos').screenshot({path:path.join(root,'tests/artifacts/autonomo-main-site.png')});
    await main.setViewportSize({width:390,height:844});
    await main.waitForTimeout(350); // finish the responsive sidebar transition
    await main.locator('#autoConnect').scrollIntoViewIfNeeded();
    assert.equal(await main.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await main.locator('#codigos').screenshot({path:path.join(root,'tests/artifacts/autonomo-main-mobile.png')});
    await main.screenshot({path:path.join(root,'tests/artifacts/autonomo-main-mobile-viewport.png')});
    assert.deepEqual(integrated.errors,[]);
    await main.close();
    console.log('PASS: isolated page, telemetry, START/STOP, STOP during pending START, disconnect, wrong firmware refusal, bad firmware hash refuses port opening, mobile overflow, no browser errors. USB simulated.');
    console.log('PASS: main site embedded controls, separate integrated editor, mutual USB exclusion for connections/choosers/flashing, cancellation releases ownership, reconnect and mobile layout. USB simulated.');
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
