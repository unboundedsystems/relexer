import * as relexer from "..";

describe('Single Rule', () => {
    const rules: relexer.Rules<void> = [
        { re: 'abc', action: (res) => res.should.equal('abc') }
    ];

    it('should compile', () => {
        const lexer = relexer.create(rules);
        should(lexer).not.null();
        should(lexer).not.undefined();
    })
});