import * as relexer from "..";
import * as sb from "stream-buffers";
import * as util from 'util';

type Token = { text:string, pos: number };
async function pushToken(tokens: Token[], match: string, pos: number): Promise<void> {
    tokens.push({ text: match, pos: pos });
}
async function ignore(): Promise<void> { }

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
        process.nextTick(() => {
            input.put('abc');
            input.stop();
        });

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
        process.nextTick(() => {
            ins.put("abc def ghi")
            ins.stop();
        });
        await lexer.lex(ins);
        const matches = tokens.map((val) => val.text);
        const positions = tokens.map((val) => val.pos);
        matches.should.be.eql(['abc', 'def', 'ghi']);
        positions.should.be.eql([0, 4, 8]);
    })
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
        process.nextTick(() => {
            ins.put("abc abcdef defghi def")
            ins.stop();
        });
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