# Relexer
Regular Expression based lexing of Node.js streams

[Relexer on GitHub](https://github.com/unboundedsystems/relexer)

Relexer will lex a Node.js readable stream with user-controllable
buffering.  This allows large files to be analyzed without buffering
the entire file in memory.

## Quick Start

Below is a typescript example lexer to generate tokens that are words
separated by whitespace

```typescript
//example.ts
import * as relexer from 'relexer';

let tokens: string[] = [];

const rules: relexer.Rules = [
    //Match one-or-more non-whitepsace characters
    { re: '[^\\s]+', action: async (match, pos) => { tokens.push(match); } },  
    //Ignore whitespace
    { re: '\\s+', action: async (match, pos) => { }; } 
];

const lexer = relexer.create(rules);

lexer.lex(process.stdin).then(() => {
  console.log(tokens);
});
```

### Rules

In the example above, rules are an array of regular expression (`re`)
strings and actions (`action`) objects. (Note that RegExp objects will
not work since RegExp.toString() encloses the RegExp in slashes, e.g.,
/xxx/))

The action objects are functions that return void promises that are
resolved when the action is complete.  relexer will not process the next
token until the returned promise is fulfilled.  In the meantime the
input stream is paused.  An action rejecting the promise will cause
lex (see below) to reject its promise with the same error.  In the
example, async lambda functions serve as a concise way to write
actions.

### Lex

The `lex` method begins lexing based on the rules passed to
`relexer.create`.  It returns a promise that is resolved when the
stream ends and all tokens are processed.  The promise is rejected if
no rules match, there is an I/O error, or an action rejects its
promise.

When this program is run with
```shell
$ echo "Hello, how are you today?" | node example.js
```
it should produce
```javascript
[ 'Hello,', 'how', 'are', 'you', 'today?']
```

## Buffering

Relexer works by constructing a large regular expression and using the
native javascript RegExp package to process it.  Therefore, relexer
has to work within the restrictions of that library.  In particular,
there is no way to tell if a prefix of a string can never match a
regular expression.  Thus, perfect matching may require buffering the
entire stream contents, which is clearly not acceptable in many cases
involving large streams.

As a workaround, relexer limits the size of buffer it will aggregate
in order to match a token to the rule set.  By default relexer will
buffer 1024 bytes.  But this can be changed using the `aggregateUntil`
option to `lex`.  E.g.,

```typescript
lexer.lex(process.stdin, { aggregateUntil: 10 });
```

In this case, no more than 10 bytes will be buffered, and
so any tokens longer than 10 characters may not come back as a match.
However, because the stream can return chunks larger than the
`aggregateUntil` limit, there may be cases were relexer can return
larger tokens.

To continue the quick start example with an `aggregateUntil` limit of
10, if the stream returns data 1 byte at a time, the lexer will not
match the token `01234567890` because it is 11 characters long.
Instead, `lex` will reject its promise with a `No rules matched` exception.
However, if the stream returns the token in an 11 or more byte chunk, relexer
will match `01234567890`.

Generally you should set `aggregateUntil` to a value large enough for the
largest expected token size, but small enough that no issues will
arise if relexer has to fill a buffer of that size.

The default `aggregateUntil` limit is 1024 bytes which should suffice
for most applications.

## More information

If you have additional documentation to contribute, please submit a
pull request.  As time and contributions permit more documentation
will be added.  In the meantime, the unit tests in the
[test](http:/github.com/unboundedsystems/relexer/tree/master/test)
directory in the GitHub repository has more examples.

