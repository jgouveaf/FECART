// Typed error hierarchy for webserial-flasher
// Callers can use instanceof to distinguish error types and show appropriate UI
export var STK500ErrorCode;
(function (STK500ErrorCode) {
    STK500ErrorCode["SYNC_FAILED"] = "STK_SYNC_FAILED";
    STK500ErrorCode["SIGNATURE_MISMATCH"] = "STK_SIGNATURE_MISMATCH";
    STK500ErrorCode["VERIFY_FAILED"] = "STK_VERIFY_FAILED";
    STK500ErrorCode["TIMEOUT"] = "STK_TIMEOUT";
    STK500ErrorCode["PORT_ERROR"] = "STK_PORT_ERROR";
    STK500ErrorCode["INVALID_HEX"] = "STK_INVALID_HEX";
    STK500ErrorCode["PROTOCOL_ERROR"] = "STK_PROTOCOL_ERROR";
    STK500ErrorCode["CHIP_ERASE_FAILED"] = "STK_CHIP_ERASE_FAILED";
    STK500ErrorCode["NOT_SUPPORTED"] = "STK_NOT_SUPPORTED";
})(STK500ErrorCode || (STK500ErrorCode = {}));
export class STK500Error extends Error {
    constructor(code, message) {
        super(message);
        this.code = code;
        this.name = 'STK500Error';
        // Restore prototype chain for correct instanceof checks in transpiled code
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
export class STK500SyncError extends STK500Error {
    constructor(attempts) {
        super(STK500ErrorCode.SYNC_FAILED, `Sync failed after ${attempts} attempts. ` +
            `Troubleshooting: (1) Is the correct COM port selected? ` +
            `(2) Is the baud rate correct for this board? ` +
            `(3) Is the Arduino connected and powered? ` +
            `(4) Try pressing the Reset button just before flashing if DTR is not available.`);
        this.attempts = attempts;
        this.name = 'STK500SyncError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
export class STK500SignatureMismatchError extends STK500Error {
    constructor(expected, actual) {
        const fmt = (b) => Array.from(b)
            .map((x) => `0x${x.toString(16).padStart(2, '0')}`)
            .join(', ');
        super(STK500ErrorCode.SIGNATURE_MISMATCH, `Signature mismatch: expected [${fmt(expected)}], got [${fmt(actual)}]. ` +
            `Did you select the wrong board type?`);
        this.expected = expected;
        this.actual = actual;
        this.name = 'STK500SignatureMismatchError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
export class STK500VerifyError extends STK500Error {
    constructor(address, expected, actual) {
        super(STK500ErrorCode.VERIFY_FAILED, `Verify failed at address 0x${address.toString(16).padStart(4, '0')}: ` +
            `expected 0x${expected.toString(16).padStart(2, '0')}, ` +
            `got 0x${actual.toString(16).padStart(2, '0')}. ` +
            `The flash write may have been corrupted.`);
        this.address = address;
        this.expected = expected;
        this.actual = actual;
        this.name = 'STK500VerifyError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
export class STK500TimeoutError extends STK500Error {
    constructor(timeoutMs, context) {
        super(STK500ErrorCode.TIMEOUT, `Timeout after ${timeoutMs}ms${context ? ` (${context})` : ''}`);
        this.timeoutMs = timeoutMs;
        this.name = 'STK500TimeoutError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
export class STK500ProtocolError extends STK500Error {
    constructor(message) {
        super(STK500ErrorCode.PROTOCOL_ERROR, message);
        this.name = 'STK500ProtocolError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
export class STK500InvalidHexError extends STK500Error {
    constructor(message, line) {
        super(STK500ErrorCode.INVALID_HEX, message);
        this.line = line;
        this.name = 'STK500InvalidHexError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
export class STK500PortError extends STK500Error {
    constructor(message) {
        super(STK500ErrorCode.PORT_ERROR, message);
        this.name = 'STK500PortError';
        Object.setPrototypeOf(this, new.target.prototype);
    }
}
//# sourceMappingURL=errors.js.map