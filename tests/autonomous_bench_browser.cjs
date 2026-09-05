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
    let sample = { distance: '20.0', echo: 1160, near: 2, clear: 0 };
    const status = () => reply(`AUTO|UP:1234|N:5|RUN:0|PHASE:0|CMD:PARAR|DIST:${sample.distance}|ECHO_US:${sample.echo}|NEAR:${sample.near}|CLEAR:${sample.clear}`);
    window.setSensorSample = (distance, echo, near, clear) => { sample = {distance, echo, near, clear}; status(); };
    window.delayStart = () => { delayedStart = true; };
    const port = {
      async open() {
        window.portOpenCount++;
        this.readable = new ReadableStream({ start(c) { controller=c; }, cancel() { clearInterval(timer); } });
        this.writable = new WritableStream({ write(bytes) {
          const text = new TextDecoder().decode(bytes).trim();
          window.serialWrites.push(text);
          if(text==='HELLO') reply(incompatible === 'v1' ? 'AUTO:READY:1' : incompatible ? 'QT:READY:V5' : 'AUTO:READY:2');
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
    assert.match(await page.locator('#autoSensorStatus').textContent(), /Próximo em 2 leituras/);
    await page.evaluate(()=>setSensorSample('5.0',290,1,0));
    assert.equal(await page.locator('#autoDistance').textContent(),'5.0 cm');
    assert.match(await page.locator('#autoSensorStatus').textContent(), /falta confirmar/);
    await page.evaluate(()=>setSensorSample('50.0',2900,0,2));
    assert.match(await page.locator('#autoSensorStatus').textContent(), /Livre em 2 leituras/);
    await page.evaluate(()=>setSensorSample('ERR',0,0,0));
    assert.equal(await page.locator('#autoSensorStatus').textContent(),'Sem leitura válida');
    await page.evaluate(()=>setSensorSample('20.0',1160,2,0));
    // An older HTML can lack the new diagnostic field while loading updated JS.
    await page.locator('#autoSensorStatus').evaluate(el=>el.remove());
    await page.evaluate(()=>setSensorSample('20.0',1160,2,0));
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
    const old = await mockedPage(browser, 'v1');
    await old.page.goto(url);
    await old.page.locator('#autoConnect').click();
    await old.page.waitForFunction(()=>document.querySelector('#autoStatus').textContent.includes('Grave o autônomo isolado v2'));
    assert.equal((await old.page.evaluate(()=>serialWrites)).includes('START'),false);
    assert.equal(await old.page.locator('#autoStart').isDisabled(),true);
    assert.deepEqual(old.errors,[]);
    await old.page.close();
    const invalidHex = await mockedPage(browser);
    await invalidHex.page.route('**/firmware/compiled/autonomo_isolado.ino.hex', route => route.fulfill({status:200,body:'invalid firmware'}));
    await invalidHex.page.goto(url);
    await invalidHex.page.locator('#autoFlash').click();
    await invalidHex.page.waitForFunction(()=>document.querySelector('#autoFlashStatus').textContent.includes('Integridade'));
    assert.equal(await invalidHex.page.evaluate(()=>portOpenCount),0);
    assert.deepEqual(invalidHex.errors,[]);
    await invalidHex.page.close();

    // The main site now exposes one unambiguous official firmware workflow.
    const integrated = await mockedPage(browser);
    const main = integrated.page;
    await main.goto(url.replace('autonomo.html', 'index.html#codigos'));
    await main.waitForFunction(() => window.quantumRobot && window.quantumFirmwareFlasher);
    assert.equal(await main.locator('#autonomo-isolado').count(), 0);
    assert.equal(await main.locator('#integratedFirmware').count(), 0);
    assert.equal(await main.locator('#flashOfficialFirmware').isVisible(), true);
    assert.equal(await main.locator('#codeTabMain').isVisible(), true);
    assert.equal(await main.evaluate(()=>portRequestCount), 0, 'loading the main site cannot open USB');
    await main.locator('#codeTabSensor').click();
    await main.waitForFunction(()=>document.querySelector('#arduinoCode').value.includes('void setup()'));
    await main.locator('#codigos').screenshot({path:path.join(root,'tests/artifacts/autonomo-main-site.png')});
    await main.setViewportSize({width:390,height:844});
    await main.waitForTimeout(350); // finish the responsive sidebar transition
    await main.locator('#flashOfficialFirmware').scrollIntoViewIfNeeded();
    assert.equal(await main.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    await main.locator('#codigos').screenshot({path:path.join(root,'tests/artifacts/autonomo-main-mobile.png')});
    await main.screenshot({path:path.join(root,'tests/artifacts/autonomo-main-mobile-viewport.png')});
    assert.deepEqual(integrated.errors,[]);
    await main.close();
    console.log('PASS: isolated page, telemetry, START/STOP, STOP during pending START, disconnect, wrong firmware refusal, bad firmware hash refuses port opening, mobile overflow, no browser errors. USB simulated.');
    console.log('PASS: main site exposes one official firmware workflow, keeps the editor, opens no USB on load and fits mobile.');
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
