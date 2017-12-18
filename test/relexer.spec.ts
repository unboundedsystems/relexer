import * as relexer from "../index";
import * as sb from "stream-buffers";
import * as util from 'util';
import * as stream from 'stream';
import { read } from "fs";

type Token = { text: string, pos: number };
async function pushToken(tokens: Token[], match: string, pos: number): Promise<void> {
    tokens.push({ text: match, pos: pos });
}
async function ignore(): Promise<void> { }

function putOnTick(s: sb.ReadableStreamBuffer, txt: string) {
    process.nextTick(() => {
        s.put(txt);
        s.stop();
    });
}

describe('Single Rule', () => {
    let act: (match: string, pos: number) => Promise<void>;

    const rules: relexer.Rules = [
        { re: 'abc', action: (match, pos) => act(match, pos) }
    ];

    let lexer: relexer.Lexer = null;
    beforeEach((done) => {
        lexer = relexer.create(rules);
        done();
    })

    it('should compile', () => {
        const lexer = relexer.create(rules);
        should(lexer).not.null();
        should(lexer).not.undefined();
    });

    it('should match abc', async () => {
        let finished = false;
        act = async (m, i) => {
            m.should.equal("abc");
            i.should.be.exactly(0);
            finished = true;
        };

        const input = new sb.ReadableStreamBuffer();
        putOnTick(input, 'abc');

        try {
            await lexer.lex(input);
        } catch (e) {
            e.should.fail();
        }
        finished.should.be.true();
    });
});

describe('Multiple Easy Rules', () => {
    let tokens: { text: string, pos: number }[] = [];
    const lpushToken = (m: string, p: number) => pushToken(tokens, m, p);

    async function ignore(): Promise<void> { }
    const rules: relexer.Rules = [
        { re: 'abc', action: lpushToken },
        { re: 'def', action: lpushToken },
        { re: 'ghi', action: lpushToken },
        { re: '\\s+', action: ignore }
    ];

    let lexer: relexer.Lexer;

    beforeEach(() => {
        tokens = [];
        lexer = relexer.create(rules);
    });

    it('should match tokens', async () => {
        const ins = new sb.ReadableStreamBuffer();
        putOnTick(ins, 'abc def ghi');
        await lexer.lex(ins);
        const matches = tokens.map((val) => val.text);
        const positions = tokens.map((val) => val.pos);
        matches.should.be.eql(['abc', 'def', 'ghi']);
        positions.should.be.eql([0, 4, 8]);
    })

    it('should not match with intervening character', async () => {
        const ins = new sb.ReadableStreamBuffer();
        putOnTick(ins, 'abc xdef');
        try {
            await lexer.lex(ins);
            throw new Error("Whoops");
        } catch (e) {
            tokens.should.eql([{ text: 'abc', pos: 0 }]);
            e.should.be.instanceOf(relexer.LexError);
            e.message.should.containEql("No rule matched");
            e.start.should.equal(4);
            e.end.should.equal(5);
            e.text.should.equal("x");
        }
    });
});

describe('Multiple Overlapping Rules', () => {
    let tokens: Token[] = [];
    const lpushToken = (m: string, p: number) => pushToken(tokens, m, p);
    const rules: relexer.Rules = [
        { re: 'abc', action: lpushToken },
        { re: 'abcdef', action: lpushToken },
        { re: 'defghi', action: lpushToken },
        { re: 'def', action: lpushToken },
        { re: '\\s+', action: ignore }
    ];

    let lexer: relexer.Lexer;
    beforeEach(() => {
        tokens = [];
        lexer = relexer.create(rules);
    });

    it('should match shorter strings that come first, first', async () => {
        const ins = new sb.ReadableStreamBuffer();
        putOnTick(ins, 'abc abcdef defghi def');

        await lexer.lex(ins);
        const matches = tokens.map((val) => val.text);
        const positions = tokens.map((val) => val.pos);
        matches.should.be.eql(['abc', 'abc', 'def', 'defghi', 'def']);
        positions.should.be.eql([0, 4, 7, 11, 18]);

    });
})

describe('Rule Checks', () => {
    it('forbids capturing parentheses in rules', () => {
        const ruleset: relexer.Rules = [
            { re: 'xx(abc)', action: async (match, pos) => { return; } }
        ];
        try {
            relexer.create(ruleset);
        } catch (e) {
            should(e).instanceOf(relexer.RuleError);
            should(e).have.properties({ ruleIndex: "0", char: 1 });
        }
    });

    it('allows non-capturing parentheses in rules', () => {
        const ruleset: relexer.Rules = [
            { re: '(?:abc)', action: async (match, pos) => { ; } }
        ];
        try {
            relexer.create(ruleset);
        } catch (e) {
            e.should.fail();
        }
    });

    it('requires actions to be functions', () => {
        const ruleset: relexer.Rules = [
            { re: '(?:abc)', action: <relexer.Action>({}) }
        ]
        try {
            relexer.create(ruleset);
        } catch (e) {
            e.should.be.Error();
            e.message.should.containEql("Action is not a function");
        }
    });
});

async function nextTick() {
    return new Promise<void>((res, rej) => {
        process.nextTick(() => res());
    })
}

describe('Chunked Stream', () => {
    let tokens: Token[] = [];
    const lpushToken = (m: string, p: number) => pushToken(tokens, m, p);
    const rules: relexer.Rules = [
        { re: 'abc', action: lpushToken },
        { re: '0123456789', action: lpushToken },
        { re: '\ue05a\ue05a', action: lpushToken },
        { re: '\\s+', action: ignore }
    ];

    let lexer: relexer.Lexer;
    beforeEach(() => {
        tokens = [];
        lexer = relexer.create(rules);
    });

    async function checkToks(input: string, refToks: string[], refPos: number[],
        chunkSize: number, lexOpts?: relexer.LexOptions) {

        const s = new sb.ReadableStreamBuffer({
            chunkSize: chunkSize
        });
        const lexp = lexer.lex(s, lexOpts);
        putOnTick(s, input);
        await lexp;

        const matches = tokens.map((val) => val.text);
        const positions = tokens.map((val) => val.pos);
        matches.should.be.eql(refToks);
        positions.should.a.eql(refPos);
    }

    it('should match "abc abc"', async () => {
        await checkToks('abc abc', ['abc', 'abc'], [0, 4], 2)
    });

    it('should match double \ue05a', async () => {
        //This tests if utf-8 partial character decoding is working right.
        await checkToks('abc \ue05a\ue05a 0123456789',
            ['abc', '\ue05a\ue05a', '0123456789'],
            [0, 4, 7],
            1
        );
    });

    it('should not match 0123456789 because it is too long', async () => {
        const s = new sb.ReadableStreamBuffer({ chunkSize: 1 });
        const lexp = lexer.lex(s, { aggregateUntil: 9 });
        putOnTick(s, 'abc 0123456789');

        try {
            await lexp;
            throw new Error("Whoops");
        } catch (e) {
            tokens.should.be.eql([{ text: 'abc', pos: 0 }]);
            e.should.be.instanceOf(relexer.LexError);
            e.message.should.containEql("No rule matched");
            e.start.should.equal(4);
            e.end.should.equal(13);
            e.text.should.equal("012345678");
        }
    });
});

describe('Quick Start Example', () => {
    async function example(s: stream.Readable): Promise<string> {
        let tokens: string[] = [];

        const rules: relexer.Rules = [
            //Match one-or-more non-whitepsace characters
            { re: "[^\\s]+", action: async (match, pos) => { tokens.push(match); } },
            //Ignore whitespace
            { re: "\\s+", action: async (match, pos) => { } }
        ];

        const lexer = relexer.create(rules);

        await lexer.lex(s);
        return util.inspect(tokens);
    }

    it('should work', async () => {
        const s = new sb.ReadableStreamBuffer();
        putOnTick(s, 'Hello, how are you today?');
        const toks = await example(s);
        toks.should.equal("[ 'Hello,', 'how', 'are', 'you', 'today?' ]");
    })
})