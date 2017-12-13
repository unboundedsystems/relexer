import * as stream from 'stream';
import * as sb from 'stream-buffers';
import * as util from 'util';
import * as makeError from 'make-error';

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

class LexError extends makeError.BaseError {
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

export interface Lexer {
    lex(ins: stream.Readable): Promise<void>
    regexString(): string; //Regex being used to lex
}

class LexerImpl implements Lexer {
    private expStr_: string;

    constructor(private rules_: Rules) {
        //FIXME(manishv) deep copy rules here so that user cannot change them and screw up the lexer
        this.expStr_ = rules_.map((r) => '(' + r.re + ')').join('|');
    }

    async lex(ins: stream.Readable) : Promise<void> {
        //Create a new RegExp so this function is re-entrant
        const exp = new RegExp(this.expStr_, "g");
        const rules = this.rules_;

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

    regexString() { return this.expStr_; }
}

export function create<T>(rules: Rules): Lexer {
    checkRules(rules);
    return new LexerImpl(rules);
}
