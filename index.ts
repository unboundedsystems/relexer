import * as stream from 'stream';

export interface Rule<T> {
    re: string;
    action: (match: string) => T; 
}

export type Rules<T> = Rule<T>[];
export type Lexer<T> = (ins: stream.Readable) => void;

export function create<T>(rules: Rules<T>) : Lexer<T> {
    return (ins) => {};
}
