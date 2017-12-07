import * as relexer from "..";
import * as sb from "stream-buffers";
import * as util from 'util';

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
            await lexer(input);
        } catch (e) {
            e.should.fail();
        }
        finished.should.be.true();
    });
});

describe('Rule Checks', () => {
    it('forbids capturing parentheses in rules', () => {
        const ruleset: relexer.Rules = [
            { re: 'xx(abc)', action: async (match, pos) => { return; } }
        ]
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
        ]
        try {
            relexer.create(ruleset);
        } catch (e) {
            e.should.fail();
        }
    });
});