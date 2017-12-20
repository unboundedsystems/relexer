import * as stream from 'stream';
import * as util from 'util';
import * as makeError from 'make-error';
import { StringDecoder } from 'string_decoder';

export type Action = (match: string, pos: number) => Promise<void>;

export interface Rule {
    re: string;
    action: Action;
}

export type Rules = Rule[];

export class RuleError extends makeError.BaseError {
    constructor(private msg_: string,
        readonly ruleIndex: string,
        readonly char: number) { super(); }

    readonly name: string = "RuleError";
    public get message(): string {
        return this.name + ": rule " + this.ruleIndex + ", position " + this.char + ": " + this.msg_;
    }
}

function checkRules(rules: Rules) {
    for (const i in rules) {
        const r = rules[i]

        const re = new RegExp(r.re); //Does this ever throw?

        if ((typeof r.action) !== 'function') {
            throw new Error("Action is not a function for rule " + i + "(" + r.re + ")");
        }

        // No capturing parentheses in re
        const m = /[^\\]\([^?][^:]/.exec(r.re); // /[^\\]\([^?][^:]/.exec(r.re);
        if (m) {
            throw new RuleError("capturing parentheses forbidden: " + m[0], i, m.index);
        }
    }
}

export class LexError extends makeError.BaseError {
    constructor(public readonly msg: string,
        public readonly start: number,
        public readonly end?: number,
        public readonly text?: string) {
        super(LexError.makeMessage(msg, start, end, text));
    }

    private static makeMessage(msg: string, start: number, end?: number, text?: string) {
        let ret = msg + ": ";
        let dets: { start: number, end?: number, text?: string } = { start: start };
        if (end) {
            dets.end = end;
        }
        if (text) {
            dets.text = text;
        }
        return ret + JSON.stringify(dets);
    }
}

export interface LexOptions {
    aggregateUntil?: number;
    encoding?: string;
}

export interface Lexer {
    lex(ins: stream.Readable, options?: LexOptions): Promise<void>
    regexString(): string; //Regex being used to lex
}


async function processChunk(exp: RegExp, rules: Rules, offset: number, s: string): Promise<number> {
    let m = null;
    do {
        let oldIndex = exp.lastIndex;
        m = exp.exec(s);
        if (!m) {
            return oldIndex;
        }
        
        if (m.index != oldIndex) {
            throw new LexError("No rule matched",
                oldIndex + offset,
                m.index + offset,
                s.slice(oldIndex, m.index));
        }

        //We have a match, find out which rule matched
        for (let i = 0; i < rules.length; i++) {
            if (m[i + 1] !== undefined) {
                await rules[i].action(m[i + 1], m.index + offset);
                break;
            }
        }
    } while (m && exp.lastIndex != s.length);
    return exp.lastIndex;
}

function dataStream(ins: stream.Readable, f: (data: Buffer) => Promise<void>) {
    const ret = new Promise((resolve, reject) => {
        ins.on('data', (chunk: Buffer) => {
            (async () => {
                ins.pause(); //This blocks data and end events
                try {
                    await f(chunk);
                } catch (e) {
                    reject(e);
                }
                ins.resume();
            })();
        });

        ins.on('end', () => resolve());
    });

    return ret;
}

class LexerImpl implements Lexer {
    private expStr_: string;

    constructor(private rules_: Rules) {
        //FIXME(manishv) deep copy rules here so that user cannot change them and screw up the lexer
        this.expStr_ = rules_.map((r) => '(' + r.re + ')').join('|');
    }

    //aggregateUntil is characters not bytes, relevant for multi-byte UTF-8
    async lex(ins: stream.Readable, optionsIn?: LexOptions): Promise<void> {
        const options: LexOptions = Object.assign({}, {
            aggregateUntil: 1024,
            encoding: 'utf-8'
        }, optionsIn);
        //Create a new state (e.g., string decoder, RegExp) so this function is re-entrant
        const exp = new RegExp(this.expStr_, "g");
        const rules = this.rules_;
        const decode = new StringDecoder(options.encoding);

        let buf = "";
        let offset = 0;
        await dataStream(ins, async (chunk: Buffer) => {
            const newChars = decode.write(chunk);
            if ((chunk.length > 0) && (newChars.length == 0)) {
                return;
            }
            buf += newChars;
            //We must wait until the full aggregateUntil limit 
            //to ensure the largest possible token matches.
            if(buf.length < options.aggregateUntil) {
                return;
            }

            exp.lastIndex = 0; //parse from start of buf

            let consumed = await processChunk(exp, rules, offset, buf);
            buf = buf.slice(consumed);
            offset += consumed;

            if (buf.length >= options.aggregateUntil) {
                throw new LexError("No rule matched", offset, offset + buf.length, buf);
            }
        });

        if(buf.length > 0) {
            //Process any trailing chunk < aggregateUntil size
            let consumed = await processChunk(exp, rules, offset, buf);
            buf = buf.slice(consumed);
            offset += consumed;
        }

        if (buf.length === 0) {
            return;
        }

        throw new LexError("No rule matched at end of data", offset, offset + buf.length, buf);
    }

    regexString() { return this.expStr_; }
}

export function create(rules: Rules): Lexer {
    checkRules(rules);
    return new LexerImpl(rules);
}
