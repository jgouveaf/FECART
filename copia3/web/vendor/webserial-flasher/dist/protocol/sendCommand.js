// Send a command and wait for the response.
//
// Fixes vs original:
//   1. Length check before Array.every() — prevents silent false-pass when
//      data.length > responseData.length (Array.every stops at caller length)
//   2. findIndex reports exact mismatch position in error messages
//   3. transport.write() is now async (Promise-based)
import Constants from '../core/constants.js';
import { STK500ProtocolError } from '../core/errors.js';
import receiveData from './receiveData.js';
export default async function sendCommand(transport, opt) {
    const timeout = opt.timeout ?? 0;
    // Determine how many bytes to collect
    let expectedLength = 0;
    if (opt.responseData && opt.responseData.length > 0) {
        expectedLength = opt.responseData.length;
    }
    if (opt.responseLength) {
        expectedLength = opt.responseLength; // responseLength wins over responseData.length
    }
    // Build the raw command — arrays get CRC_EOP appended, Uint8Arrays are sent as-is
    let cmd;
    if (Array.isArray(opt.cmd)) {
        cmd = new Uint8Array([...opt.cmd, Constants.Sync_CRC_EOP]);
    }
    else {
        cmd = opt.cmd;
    }
    // Transmit
    await transport.write(cmd);
    // Collect response
    const data = await receiveData(transport, timeout, expectedLength);
    // Validate response content when caller provided expected bytes
    if (opt.responseData && opt.responseData.length > 0) {
        const expected = opt.responseData;
        if (data.length !== expected.length) {
            throw new STK500ProtocolError(`Response length mismatch: got ${data.length} bytes, expected ${expected.length}`);
        }
        const mismatchAt = data.findIndex((v, i) => v !== expected[i]);
        if (mismatchAt !== -1) {
            const hex = (b) => Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join(' ');
            throw new STK500ProtocolError(`Response mismatch at byte ${mismatchAt}: ` +
                `expected [${hex(expected)}], got [${hex(data)}]`);
        }
    }
    return data;
}
//# sourceMappingURL=sendCommand.js.map