// Real page + browser Web Serial mock. Never opens a physical port.
const { chromium } = require('playwright');
const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const server = http.createServer((req,res) => {
  const file = path.resolve(root, '.' + new URL(req.url,'http://localhost').pathname);
  if (!file.startsWith(root + path.sep)) { res.writeHead(403); return res.end(); }
  const types = {'.js':'text/javascript','.html':'text/html','.svg':'image/svg+xml'};
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
    window.serialWrites = []; window.portOpenCount = 0;
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
    Object.defineProperty(navigator,'serial',{value:{async requestPort(){return port;}}});
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
    console.log('PASS: isolated page, telemetry, START/STOP, STOP during pending START, disconnect, wrong firmware refusal, bad firmware hash refuses port opening, mobile overflow, no browser errors. USB simulated.');
  } finally { await browser.close(); await new Promise(r=>server.close(r)); }
})().catch(e=>{console.error(e);process.exitCode=1;server.close();});
