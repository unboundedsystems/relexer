import * as stream from 'stream';
import * as sb from 'stream-buffers';
import * as util from 'util';

export type Action = (match: string, pos: number) => Promise<void>;

export interface Rule {
    re: string;
    action: Action;
}

export type Rules = Rule[];
export type Lexer = (ins: stream.Readable) => Promise<void>;

export class RuleError extends Error {
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

class LexError extends Error {
    constructor(msg: string,
        readonly start: number,
        readonly end?: number,
        readonly text?: string) {
        super(msg);
    }
}

export function create<T>(rules: Rules): Lexer {
    checkRules(rules);

    const expStr = rules.map((r) => '(' + r.re + ')').join('|');
    const exp = new RegExp(expStr, "g");

    return async (ins: stream.Readable) => {
        //FIXME(manishv) This should not buffer
        const buf = new sb.WritableStreamBuffer();
        ins.pipe(buf);
        const onEnd = util.promisify((cb) => ins.on('end', cb));

        return onEnd().then(async () => {
            const s = buf.getContentsAsString();
            let m = null;
            do {
                let oldIndex = exp.lastIndex;
                m = exp.exec(s);
                if (!m) {
                    throw new LexError("No token matched", oldIndex);
                }

                //We have a match, find out which rule matched
                for (let i = 0; i < rules.length; i++) {

                    if (m[i + 1] !== undefined) {
                        await rules[i].action(m[i + 1], m['index']);
                        break;
                    }
                }
            } while (m && exp.lastIndex != s.length)
        });
    }
}
