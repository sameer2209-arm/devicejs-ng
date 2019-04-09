/*
  * Copyright (c) 2018, Arm Limited and affiliates.
  * SPDX-License-Identifier: Apache-2.0
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *
  *     http://www.apache.org/licenses/LICENSE-2.0
  *
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
  */ 
var expect = require('expect.js');
var should = require('should');
var shouldPromised = require('should-promised');
var query = require('../src/core/selection');

describe('query.Tokenizer', function() {
    function checkTokenStream(string, expectedTokenStream) {
        var tokenizer = new query.Tokenizer(string);

        expectedTokenStream.forEach(function(expectedNextToken) {

            if(expectedNextToken instanceof Error) {
                (function() {
                    tokenizer.next();
                }).should.throw(expectedNextToken);
            }
            else {
                tokenizer.next();
                tokenizer.getCurrentToken().should.be.eql(expectedNextToken);
                expectedNextToken.__proto__.should.be.eql(tokenizer.getCurrentToken().__proto__)
            }
        });

        if(!(expectedTokenStream[expectedTokenStream.length-1] instanceof Error)) {
            tokenizer.next();
            should.equal(tokenizer.getCurrentToken(), null);
        }
    }

    it('should be able to tokenize a valid unnested expression regardless of whitespace', function() {
        checkTokenStream('group="" and id="hi"          or interface  =  "myinterface" and type=  "mytype"   ', [
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('and'),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.StringToken('"hi"'),
            new query.TerminalToken('or'),
            new query.TerminalToken('interface'),
            new query.TerminalToken('='),
            new query.StringToken('"myinterface"'),
            new query.TerminalToken('and'),
            new query.TerminalToken('type'),
            new query.TerminalToken('='),
            new query.StringToken('"mytype"')
        ]);
    });

    it('should be able to tokenize a valid nested expression regardless of whitespace', function() {
        checkTokenStream('group="" and (  id="hi"   or interface  =  "myinterface" and type=  "mytype"  )  ', [
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('and'),
            new query.TerminalToken('('),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.StringToken('"hi"'),
            new query.TerminalToken('or'),
            new query.TerminalToken('interface'),
            new query.TerminalToken('='),
            new query.StringToken('"myinterface"'),
            new query.TerminalToken('and'),
            new query.TerminalToken('type'),
            new query.TerminalToken('='),
            new query.StringToken('"mytype"'),
            new query.TerminalToken(')'),
        ]);
    });

    it('should be tokenize a string that is not a valid expression but only contains valid tokens', function() {
        checkTokenStream('group="" and ( ( )  id "hi" or interface "myinterface" type "mytype" = )  ', [
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('and'),
            new query.TerminalToken('('),
            new query.TerminalToken('('),
            new query.TerminalToken(')'),
            new query.TerminalToken('id'),
            new query.StringToken('"hi"'),
            new query.TerminalToken('or'),
            new query.TerminalToken('interface'),
            new query.StringToken('"myinterface"'),
            new query.TerminalToken('type'),
            new query.StringToken('"mytype"'),
            new query.TerminalToken('='),
            new query.TerminalToken(')')
        ]);
    });

    it('should be able to tokenize a valid unnested expression', function() {
        checkTokenStream('group="" and id="hi"', [
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('and'),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.StringToken('"hi"'),
        ]);
    });

    it('should throw an "Invalid token" exception when an improperly formatted string is used', function() {
        checkTokenStream('group=" and id="hi"', [
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('" and id="'),
            new Error('Invalid token')
        ]);
    });

    it('an empty string should result in no tokens produced', function() {
        checkTokenStream('', []);
    });

    it('an string with only whitespace should result in no tokens', function() {
        checkTokenStream('   \n \t      \f', []);
    });
});

describe('query.Parser', function() {
    var MockTokenizer = function(tokenSequence) {
        this.tokenSequence = tokenSequence;
        this.currentTokenIndex = -1;
    };

    MockTokenizer.prototype.next = function() {
        // return same as peek token but advance index
        this.currentTokenIndex += 1;
        
        var token = this.getCurrentToken();

        return token;
    };

    MockTokenizer.prototype.getCurrentToken = function() {
        // return next token without advancing it.
        // multiple calls to peekToken return the same
        // token.
        return this.tokenSequence[this.currentTokenIndex] || null;
    };

    it('should parse simple checks', function() {
        // simple check
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
        ]));

        parser.parse().should.be.eql(new query.StringCheckNode('group', ''));

        // negated check
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('not'),
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
        ]));

        parser.parse().should.be.eql(new query.NotNode(new query.StringCheckNode('group', '')));

        // simple check in parentheses
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('('),
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken(')'),
        ]));

        parser.parse().should.be.eql(new query.StringCheckNode('group', ''));

        // simple negated check in parentheses
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('('),
            new query.TerminalToken('not'),
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken(')'),
        ]));

        parser.parse().should.be.eql(new query.NotNode(new query.StringCheckNode('group', '')));

        // simple negated check in parentheses 2
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('not'),
            new query.TerminalToken('('),
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken(')'),
        ]));

        parser.parse().should.be.eql(new query.NotNode(new query.StringCheckNode('group', '')));
    });

    it('should parse simple boolean and expression', function() {
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('and'),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.StringToken('"hi"')
        ]));

        parser.parse().should.be.eql(new query.AndNode(
            new query.StringCheckNode('group', ''),
            new query.StringCheckNode('id', 'hi')
        ));
    });

    it('should parse simple boolean or expression', function() {
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('or'),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.TerminalToken('*')
        ]));

        parser.parse().should.be.eql(new query.OrNode(
            new query.StringCheckNode('group', ''),
            new query.WildcardCheckNode('id')
        ));
    });

    it('should parse expressions with multiple ands and ors in sequence', function() {
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('and'),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.StringToken('"hi"'),
            new query.TerminalToken('or'),
            new query.TerminalToken('interface'),
            new query.TerminalToken('='),
            new query.StringToken('"myinterface"'),
            new query.TerminalToken('and'),
            new query.TerminalToken('type'),
            new query.TerminalToken('='),
            new query.StringToken('"mytype"')
        ]));

        parser.parse().should.be.eql(new query.OrNode(
            new query.AndNode(
                new query.StringCheckNode('group', ''),
                new query.StringCheckNode('id', 'hi')
            ),
            new query.AndNode(
                new query.StringCheckNode('interface', 'myinterface'),
                new query.StringCheckNode('type', 'mytype')
            )
        ));
    });

    it('should throw parse error if checks are not seperated by boolean operators', function() {
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            //new query.TerminalToken('and'),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.StringToken('"hi"'),
            new query.TerminalToken('or'),
            new query.TerminalToken('interface'),
            new query.TerminalToken('='),
            new query.StringToken('"myinterface"'),
            new query.TerminalToken('and'),
            new query.TerminalToken('type'),
            new query.TerminalToken('='),
            new query.StringToken('"mytype"')
        ]));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));

        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('and'),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.StringToken('"hi"'),
            //new query.TerminalToken('or'),
            new query.TerminalToken('interface'),
            new query.TerminalToken('='),
            new query.StringToken('"myinterface"'),
            new query.TerminalToken('and'),
            new query.TerminalToken('type'),
            new query.TerminalToken('='),
            new query.StringToken('"mytype"')
        ]));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));

        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('and'),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.StringToken('"hi"'),
            new query.TerminalToken('or'),
            new query.TerminalToken('interface'),
            new query.TerminalToken('='),
            new query.StringToken('"myinterface"'),
            //new query.TerminalToken('and'),
            new query.TerminalToken('type'),
            new query.TerminalToken('='),
            new query.StringToken('"mytype"')
        ]));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));
    });

    it('should give precedence to operations grouped in parentheses', function() {
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('and'),
            new query.TerminalToken('('),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.StringToken('"hi"'),
            new query.TerminalToken('or'),
            new query.TerminalToken('interface'),
            new query.TerminalToken('='),
            new query.StringToken('"myinterface"'),
            new query.TerminalToken(')'),
            new query.TerminalToken('and'),
            new query.TerminalToken('type'),
            new query.TerminalToken('='),
            new query.StringToken('"mytype"')
        ]));

        parser.parse().should.be.eql(new query.AndNode(
            new query.StringCheckNode('group', ''),
            new query.AndNode(
                new query.OrNode(
                    new query.StringCheckNode('id', 'hi'),
                    new query.StringCheckNode('interface', 'myinterface')
                ),
                new query.StringCheckNode('type', 'mytype')
            )
        ));
    });

    it('should throw parse error if a predicate in parentheses is not finished with a close parenthesis', function() {
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
            new query.TerminalToken('and'),
            new query.TerminalToken('('),
            new query.TerminalToken('id'),
            new query.TerminalToken('='),
            new query.StringToken('"hi"'),
            new query.TerminalToken('or'),
            new query.TerminalToken('interface'),
            new query.TerminalToken('='),
            new query.StringToken('"myinterface"'),
            //new query.TerminalToken(')'),
            new query.TerminalToken('and'),
            new query.TerminalToken('type'),
            new query.TerminalToken('='),
            new query.StringToken('"mytype"')
        ]));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));
    });

    it('should fail on empty tokenizer', function() {
        var parser = new query.Parser(new MockTokenizer([
        ]));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));
    });

    it('should fail if check uses invalid property', function() {
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('property'),
            new query.TerminalToken('='),
            new query.StringToken('""'),
        ]));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));
    });

    it('should fail if check uses invalid value', function() {
        var parser = new query.Parser(new MockTokenizer([
            new query.TerminalToken('group'),
            new query.TerminalToken('='),
            new query.TerminalToken('#'),
        ]));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));
    });
});

describe('query.Parser + query.Tokenizer', function() {
    it('should parse simple checks', function() {
        // simple check
        var parser = new query.Parser(new query.Tokenizer('group=""'));
        parser.parse().should.be.eql(new query.StringCheckNode('group', ''));

        // negated check
        var parser = new query.Parser(new query.Tokenizer('not group=""'));
        parser.parse().should.be.eql(new query.NotNode(new query.StringCheckNode('group', '')));

        // simple check in parentheses
        var parser = new query.Parser(new query.Tokenizer('(group="")'));
        parser.parse().should.be.eql(new query.StringCheckNode('group', ''));

        // simple negated check in parentheses
        var parser = new query.Parser(new query.Tokenizer('(not group="")'));
        parser.parse().should.be.eql(new query.NotNode(new query.StringCheckNode('group', '')));

        // simple negated check in parentheses 2
        var parser = new query.Parser(new query.Tokenizer('not(group="")'));
        parser.parse().should.be.eql(new query.NotNode(new query.StringCheckNode('group', '')));
    });

    it('should parse simple boolean and expression', function() {
        var parser = new query.Parser(new query.Tokenizer('group="" and id="hi"'));
        parser.parse().should.be.eql(new query.AndNode(
            new query.StringCheckNode('group', ''),
            new query.StringCheckNode('id', 'hi')
        ));
    });

    it('should parse simple boolean or expression', function() {
        var parser = new query.Parser(new query.Tokenizer('group="" or id=*'));
        parser.parse().should.be.eql(new query.OrNode(
            new query.StringCheckNode('group', ''),
            new query.WildcardCheckNode('id')
        ));
    });

    it('should parse expressions with multiple ands and ors in sequence', function() {
        var parser = new query.Parser(new query.Tokenizer('group="" and id="hi" or interface="myinterface" and type="mytype"'));

        parser.parse().should.be.eql(new query.OrNode(
            new query.AndNode(
                new query.StringCheckNode('group', ''),
                new query.StringCheckNode('id', 'hi')
            ),
            new query.AndNode(
                new query.StringCheckNode('interface', 'myinterface'),
                new query.StringCheckNode('type', 'mytype')
            )
        ));
    });

    it('should produce identical stringified forms when asts are flattened for equivalent expressions', function() {
        var normalizedString = '( group="" and id="hi" and interface="myinterface" and type="mytype" )';
        var parser1 = new query.Parser(new query.Tokenizer('group="" and id="hi" and interface="myinterface" and type="mytype"'));
        var parser2 = new query.Parser(new query.Tokenizer('type="mytype" and group="" and interface="myinterface" and id="hi"'));
        var parser3 = new query.Parser(new query.Tokenizer('(group="" and id="hi") and (interface="myinterface" and type="mytype")'));

        var p1 = parser1.parse();
        var p2 = parser2.parse();
        var p3 = parser3.parse();

        p1.toNormalizedString().should.be.eql(p2.toNormalizedString());
        p2.toNormalizedString().should.be.eql(p3.toNormalizedString());
        p3.toNormalizedString().should.be.eql(normalizedString);

        p1.toString().should.not.be.eql(p2.toString());
        p2.toString().should.not.be.eql(p3.toString());

        p1.flatten();
        p2.flatten();
        p3.flatten();

        p1.toString().should.be.eql(p2.toString());
        p2.toString().should.be.eql(p3.toString());
        p3.toString().should.be.eql(normalizedString);
    });

    it('should throw parse error if checks are not seperated by boolean operators', function() {
        var parser = new query.Parser(new query.Tokenizer('group="" id="hi" or interface="myinterface" and type="mytype"'));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));

        var parser = new query.Parser(new query.Tokenizer('group="" and id="hi" interface="myinterface" and type="mytype"'));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));

        var parser = new query.Parser(new query.Tokenizer('group="" and id="hi" or interface="myinterface" type="mytype"'));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));
    });

    it('should give precedence to operations grouped in parentheses', function() {
        var parser = new query.Parser(new query.Tokenizer('group="" and ( id="hi" or interface="myinterface") and type="mytype"'));

        parser.parse().should.be.eql(new query.AndNode(
            new query.StringCheckNode('group', ''),
            new query.AndNode(
                new query.OrNode(
                    new query.StringCheckNode('id', 'hi'),
                    new query.StringCheckNode('interface', 'myinterface')
                ),
                new query.StringCheckNode('type', 'mytype')
            )
        ));
    });

    it('should throw parse error if a predicate in parentheses is not finished with a close parenthesis', function() {
        var parser = new query.Parser(new query.Tokenizer('group="" and ( id="hi" or interface="myinterface" and type="mytype"'));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));
    });

    it('should fail on empty tokenizer', function() {
        var parser = new query.Parser(new query.Tokenizer('\t\n  '));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));
    });

    it('should fail if check uses invalid property', function() {
        var parser = new query.Parser(new query.Tokenizer('property=""'));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));
    });

    it('should fail if check uses invalid value', function() {
        var parser = new query.Parser(new query.Tokenizer('group=#'));

        (function() {
            parser.parse();
        }).should.throw(new Error('Parse error'));
    });
});

