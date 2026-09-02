// Browser WebSerial API transport for webserial-flasher.
// Works in Chrome 89+ and Edge 89+. Not available in Firefox or Safari.
//
// Usage:
//   const transport = await WebSerialTransport.requestPort([{ usbVendorId: 0x2341 }]);
//   await transport.open(115200);
//   const stk = new STK500(transport, board);
//   await stk.bootload(hex);
//   await transport.close();
export class WebSerialTransport {
    constructor(port) {
        this.port = port;
        this.writer = null;
        this.reader = null;
        this.readLoopActive = false;
        this.listeners = new Set();
        this.lastOpenOptions = null;
    }
    /** Check whether WebSerial is available in the current environment */
    static isSupported() {
        return typeof navigator !== 'undefined' && 'serial' in navigator;
    }
    /**
     * Show the browser's port-picker dialog and return a transport wrapping the selected port.
     * @param filters - Optional USB vendor/product ID filters to narrow the list shown to the user
     */
    static async requestPort(filters = []) {
        if (!WebSerialTransport.isSupported()) {
            throw new Error('WebSerial API is not supported. Use Chrome 89+ or Edge 89+.');
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const port = await navigator.serial.requestPort({ filters });
        return new WebSerialTransport(port);
    }
    /**
     * Return transports for all previously-approved ports (no dialog).
     * Useful for re-connecting without prompting the user again.
     */
    static async getPorts() {
        if (!WebSerialTransport.isSupported())
            return [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ports = await navigator.serial.getPorts();
        return ports.map((p) => new WebSerialTransport(p));
    }
    /** Open the serial port at the given baud rate with optional serial settings */
    async open(baudRate, options) {
        const opts = {
            baudRate,
            dataBits: options?.dataBits ?? 8,
            stopBits: options?.stopBits ?? 1,
            parity: options?.parity ?? 'none',
            flowControl: options?.flowControl ?? 'none',
        };
        this.lastOpenOptions = opts;
        await this.port.open(opts);
        this.writer = this.port.writable.getWriter();
        this.reader = this.port.readable.getReader();
        this.readLoopActive = true;
        this.startReadLoop();
    }
    /**
     * Send a BREAK condition to reset the UPDI state machine.
     *
     * Implementation: close the port, reopen at 300 baud 8N1, transmit 0x00
     * (which produces a ~33 ms break period relative to 115200 baud), then
     * reopen at the original settings.
     *
     * The current port must have been opened with open() before calling this.
     */
    async sendBreak() {
        if (!this.lastOpenOptions) {
            throw new Error('WebSerialTransport: call open() before sendBreak()');
        }
        const originalOptions = { ...this.lastOpenOptions };
        // 1. Tear down current connection
        await this._closePort();
        // 2. Reopen at 300 baud to generate a BREAK pulse
        await this.port.open({ baudRate: 300, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
        const breakWriter = this.port.writable.getWriter();
        await breakWriter.write(new Uint8Array([0x00])); // 0x00 at 300 baud ≈ 33 ms low
        await new Promise((r) => setTimeout(r, 50)); // ensure byte clocks out
        breakWriter.releaseLock();
        await this.port.close();
        // 3. Reopen at original settings
        await this.port.open(originalOptions);
        this.writer = this.port.writable.getWriter();
        this.reader = this.port.readable.getReader();
        this.readLoopActive = true;
        this.startReadLoop();
    }
    /** Internal helper: close writer, reader, and port without clearing lastOpenOptions */
    async _closePort() {
        this.readLoopActive = false;
        this.listeners.clear();
        try {
            await this.reader?.cancel();
        }
        catch { /* ignore */ }
        try {
            this.reader?.releaseLock();
        }
        catch { /* ignore */ }
        try {
            await this.writer?.abort();
        }
        catch { /* ignore */ }
        try {
            this.writer?.releaseLock();
        }
        catch { /* ignore */ }
        try {
            await this.port.close();
        }
        catch { /* ignore */ }
        this.reader = null;
        this.writer = null;
    }
    /** Set DTR/RTS hardware signals to trigger Arduino bootloader entry.
     * Translate the library's short names to the Web Serial specification. */
    async setSignals(opts) {
        // WebSerialPort.setSignals is defined in the WebSerial spec
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await this.port.setSignals({
            ...(typeof opts.dtr === 'boolean' && { dataTerminalReady: opts.dtr }),
            ...(typeof opts.rts === 'boolean' && { requestToSend: opts.rts }),
            ...(typeof opts.break === 'boolean' && { break: opts.break }),
        });
    }
    async write(data) {
        if (!this.writer)
            throw new Error('Transport not open — call open() first');
        await this.writer.write(data);
    }
    on(_event, handler) {
        this.listeners.add(handler);
    }
    off(_event, handler) {
        this.listeners.delete(handler);
    }
    startReadLoop() {
        void (async () => {
            while (this.readLoopActive) {
                try {
                    const { value, done } = await this.reader.read();
                    if (done || !this.readLoopActive)
                        break;
                    if (value && value.byteLength > 0) {
                        this.listeners.forEach((fn) => fn(value));
                    }
                }
                catch {
                    // Port closed externally or connection lost — stop loop silently
                    break;
                }
            }
        })();
    }
    async close() {
        this.lastOpenOptions = null;
        await this._closePort();
    }
}
//# sourceMappingURL=WebSerialTransport.js.map

